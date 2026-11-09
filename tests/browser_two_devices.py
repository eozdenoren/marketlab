"""Two devices, one group: answers typed on one laptop appear on the other, a remembered group is brought up to date on
load, and a later save from another device never wipes answers it has not seen. Runs the class page against the
in-memory copy of the class record from browser_instructor.py.
    python3 tests/browser_two_devices.py"""
import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from browser_instructor import ADMIN_TOKEN, ENDPOINT, PAGE_TOKEN, Mock, Quiet  # noqa: E402

ROOT = os.path.dirname(HERE)
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)
        print("FAIL:", msg)


def login(page, base, number, pin, register=False):
    page.goto(base + "/?class=T-2DEV")
    page.wait_for_selector("#group-form")
    page.fill("#group-number", str(number))
    page.fill("#group-pin", pin)
    page.click("#group-save")
    if register:
        page.wait_for_selector("#register-form")
        page.fill("#reg-pin2", pin)
        page.click("#reg-save")
    page.get_by_text("Your group: Group %d" % number, exact=False).wait_for()


def answer(page, qid, text):
    page.click("#main-tabs button[data-tab=book]")
    page.wait_for_selector("#ans-" + qid)
    page.fill("#ans-" + qid, text)
    page.locator("#ans-" + qid).blur()
    page.wait_for_timeout(2500)        # the save waits 1.2 s for typing to stop, then posts


def shown(page, qid):
    page.click("#main-tabs button[data-tab=book]")
    page.wait_for_selector("#ans-" + qid)
    page.wait_for_timeout(1000)        # opening the Lab book re-reads the record; the boxes update when it answers
    return page.locator("#ans-" + qid).input_value()


def main():
    dist = tempfile.mkdtemp(prefix="marketlab_2dev_")
    cfg = os.path.join(dist, "config.json")
    json.dump({"endpoint": ENDPOINT, "token": PAGE_TOKEN, "admin_token": ADMIN_TOKEN}, open(cfg, "w"))
    subprocess.check_call([sys.executable, os.path.join(ROOT, "build.py"), "--config", cfg, "--out", os.path.join(dist, "index.html")], stdout=subprocess.DEVNULL)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), lambda *a, **k: Quiet(*a, directory=dist, **k))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % httpd.server_address[1]
    mock = Mock()

    def route(r):
        req = r.request
        if req.method == "POST":
            body = mock.post(json.loads(req.post_data or "{}"))
        else:
            q = urllib.parse.urlparse(req.url).query
            body = mock.get({k: v[0] for k, v in urllib.parse.parse_qs(q, keep_blank_values=True).items()})
        r.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"Access-Control-Allow-Origin": "*"})

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        A, B = browser.new_context(), browser.new_context()       # two laptops: separate storage
        for ctx in (A, B):
            ctx.route(ENDPOINT + "*", route)
        a, b = A.new_page(), B.new_page()
        for pg in (a, b):
            pg.on("pageerror", lambda e: errors.append("page error: %s" % e))
        # laptop A registers the group and answers question 1
        login(a, base, 5, "1234", register=True)
        answer(a, "q1", "Answer to one, typed on laptop A")
        # laptop B logs in: question 1 is there; it answers question 2
        login(b, base, 5, "1234")
        check(shown(b, "q1") == "Answer to one, typed on laptop A", "laptop B sees laptop A's answer after logging in")
        answer(b, "q2", "Answer to two, typed on laptop B")
        posted = [r for p in mock.posts for r in p.get("records", []) if ((r.get("state") or {}).get("labbook") or {}).get("kind") == "answers"]
        check(all(list((r["state"]["answers"] or {})) in (["q1"], ["q2"]) for r in posted), "each save carries only the edited box: %s" % [list(r["state"]["answers"]) for r in posted])
        # laptop A reloads: the group is remembered, and the page fetches the record on load
        a.reload()
        a.get_by_text("Your group: Group 5", exact=False).wait_for()
        a.wait_for_timeout(1200)
        check(shown(a, "q2") == "Answer to two, typed on laptop B", "laptop A sees laptop B's answer after a reload")
        check(shown(a, "q1") == "Answer to one, typed on laptop A", "laptop A still has its own answer")
        # laptop A edits question 1; laptop B, opening the Lab book again later, gets the new text and keeps question 2
        answer(a, "q1", "Answer to one, revised on laptop A")
        b.click("#main-tabs button[data-tab=lab]")
        b.wait_for_timeout(16000)          # the Lab book re-reads the record at most every 15 s
        check(shown(b, "q1") == "Answer to one, revised on laptop A", "laptop B picks up the revision on opening the Lab book")
        check(shown(b, "q2") == "Answer to two, typed on laptop B", "laptop B keeps its own answer")
        # an old-style save (a whole set, all empty) from a third device must not wipe anything
        mock.findings.append({"ts": time.time(), "group": "Group 5", "question": "Assignment answers", "finding": "",
                              "state": {"class": "T-2DEV", "answers": {"q1": "", "q2": "", "q3": ""}, "labbook": {"id": "answers", "kind": "answers"}}})
        a.reload()
        a.get_by_text("Your group: Group 5", exact=False).wait_for()
        a.wait_for_timeout(1200)
        check(shown(a, "q1") == "Answer to one, revised on laptop A" and shown(a, "q2") == "Answer to two, typed on laptop B", "an empty whole-set save does not wipe the answers")
        browser.close()
    httpd.shutdown()
    print("two devices: %s (%d checks failed)" % ("OK" if not errors else "FAILURES", len(errors)))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
