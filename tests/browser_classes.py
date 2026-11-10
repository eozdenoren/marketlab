"""Class codes: with this term's codes in the config, the class page signs groups in only under one of them. A code is
read without regard to case and with anything pasted after it ignored (and the address bar shows the clean link); an
address with no code or an unknown one shows the class links instead of the sign-in and sends nothing; projector mode
is unaffected; saves waiting on a laptop under a stray code go to the class the group signs into.
    python3 tests/browser_classes.py"""
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
CLASSES = ["CM03AUT26A", "CM03AUT26B", "LIVE-TEST"]
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)
        print("FAIL:", msg)


def main():
    dist = tempfile.mkdtemp(prefix="marketlab_classes_")
    cfg = os.path.join(dist, "config.json")
    json.dump({"endpoint": ENDPOINT, "token": PAGE_TOKEN, "admin_token": ADMIN_TOKEN, "classes": CLASSES}, open(cfg, "w"))
    subprocess.check_call([sys.executable, os.path.join(ROOT, "build.py"), "--config", cfg, "--out", os.path.join(dist, "index.html")], stdout=subprocess.DEVNULL)
    check(json.dumps(CLASSES) in open(os.path.join(dist, "index.html")).read(), "the class list is in the class page")
    check(ADMIN_TOKEN not in open(os.path.join(dist, "index.html")).read(), "no admin token in the page")
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

    stray = {"ts": time.time() - 3600, "group": "Group 12", "question": "1. Who really pays a tax?", "finding": "pinned under a stray code", "pin": "",
             "state": {"class": "CM04AUT26", "names": "", "labbook": {"id": "stray1", "kind": "pin", "label": "tax on sellers", "tab": "lab"}}}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        def fresh(queue=None):
            ctx = browser.new_context()
            ctx.route(ENDPOINT + "*", route)
            if queue is not None:
                ctx.add_init_script("localStorage.setItem('marketlab:queue', %s);" % json.dumps(json.dumps(queue)))
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append("page error: %s" % e))
            return ctx, pg

        # no class code: the class links, no sign-in, nothing sent even with a save waiting
        ctx, pg = fresh(queue=[stray])
        n0 = len(mock.posts)
        pg.goto(base + "/")
        pg.get_by_text("This address has no class code", exact=False).wait_for()
        check(pg.locator("#group-form").count() == 0, "no sign-in form without a class code")
        links = pg.locator("#group-panel a.button")
        check(links.count() == 2 and "?class=CM03AUT26A" in (links.nth(0).get_attribute("href") or ""), "links to this term's classes (LIVE-TEST hidden)")
        pg.wait_for_timeout(1500)
        check(len(mock.posts) == n0, "nothing is sent from a page without a valid code")
        check(pg.locator("#lab-pin-wrap").count() == 1, "the Laboratory tab still works")
        ctx.close()

        # unknown code
        ctx, pg = fresh()
        pg.goto(base + "/?class=CM04AUT26")
        pg.get_by_text("which is not one of this term", exact=False).wait_for()
        check(pg.locator("#group-form").count() == 0, "no sign-in under an unknown code")
        check("CM04AUT26" in pg.locator("#group-panel").inner_text(), "the message names the code")
        ctx.close()

        # lower case, and a link pasted after the code: both read as CM03AUT26A, and the address bar is cleaned
        for raw in ("cm03aut26a", "CM03AUt26A", "CM03AUT26Ahttps://eozdenoren.github.io/marketlab/?class=CM03AUT26A"):
            ctx, pg = fresh()
            pg.goto(base + "/?class=" + urllib.parse.quote(raw, safe=":/?="))
            pg.wait_for_selector("#group-form")
            check("Class CM03AUT26A" in pg.locator("#group-panel").inner_text(), "%r is read as CM03AUT26A" % raw)
            check(pg.url.endswith("/?class=CM03AUT26A"), "%r: the address bar shows the clean link (%s)" % (raw, pg.url))
            ctx.close()

        # projector mode needs no class code
        ctx, pg = fresh()
        pg.goto(base + "/?projector=1")
        pg.get_by_text("Projector", exact=False).first.wait_for()
        check("no class code" not in pg.locator("#group-panel").inner_text(), "projector mode is not blocked")
        ctx.close()

        # a save waiting under a stray code goes to the class the group signs into
        mock.groups.append({"class": "CM03AUT26A", "group": "Group 12", "pin": "1234", "names": "", "registered": "2026-11-09T13:59:00Z"})
        ctx, pg = fresh(queue=[stray])
        pg.goto(base + "/?class=CM03AUT26A")
        pg.wait_for_selector("#group-form")
        pg.fill("#group-number", "12"); pg.fill("#group-pin", "1234"); pg.click("#group-save")
        pg.get_by_text("Your group: Group 12", exact=False).wait_for()
        pg.wait_for_timeout(2000)
        got = [f for f in mock.findings if f["group"] == "Group 12"]
        check(len(got) == 1 and got[0]["state"]["class"] == "CM03AUT26A", "the stray save arrives under CM03AUT26A: %s" % [f["state"].get("class") for f in got])
        check("Saved to the class record" in pg.locator("#footer-status").inner_text(), "the footer says it is saved")
        ctx.close()
        browser.close()
    httpd.shutdown()
    print("classes: %s (%d checks failed)" % ("OK" if not errors else "FAILURES", len(errors)))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
