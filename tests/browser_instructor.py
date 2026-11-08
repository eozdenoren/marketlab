"""Real-browser check of docs/instructor.html against a mock of the Apps Script endpoint (the behaviour of
backend/Code.gs, in memory, answered through Playwright's request interception), and of the class page's projector
mode that its links open. Builds both pages into a scratch folder with a mock config and serves them over http.
    python3 tests/browser_instructor.py [shots_dir]"""
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/marketlab_instructor_shots"
os.makedirs(OUT, exist_ok=True)
ENDPOINT = "https://marketlab.invalid/exec"
PAGE_TOKEN, ADMIN_TOKEN, PASSWORD = "page-token", "admin-token-0123456789", "Sesame-42"
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)
        print("FAIL:", msg)


def measures(state):
    """What the page's engine gives for a saved state (so the seeded records verify), via node."""
    js = """
var M = require(%r); var st = %s; var pol = st.policy || {};
var market = M.buildMarket(st.supply, st.demand), regional = {};
["supply", "demand"].forEach(function (side) { Object.keys((pol.regional || {})[side] || {}).forEach(function (n) { var rp = pol.regional[side][n]; regional[n] = { scale: rp.scale, shift: rp.shift || 0, tax: rp.tax || 0, cap: rp.cap || null }; }); });
var policy = M.defaultPolicy({ tax_supply: pol.tax_supply || 0, tax_demand: pol.tax_demand || 0, control: pol.control || "none", control_value: pol.control && pol.control !== "none" ? pol.control_value : null, rationing: pol.rationing || "efficient", rent_to: pol.rent_to || "sellers", regional: regional });
console.log(JSON.stringify([M.measuresLab(M.solve(market, {})), M.measuresLab(M.solve(market, policy))]));
""" % (os.path.join(ROOT, "src", "engine.js"), json.dumps(state))
    base, out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    return base, out


class Mock:
    """The class record: the findings and the groups tabs, with the script's rules."""
    def __init__(self):
        self.findings, self.groups, self.fails, self.posts = [], [], 0, []

    def admin_status(self, token):
        if not token or token == PAGE_TOKEN:
            return "no"
        if token == ADMIN_TOKEN:
            return "yes"
        if self.fails >= 3:
            return "locked"
        if token == PASSWORD:
            return "yes"
        self.fails += 1
        return "no"

    def find_group(self, cls, group):
        for g in self.groups:
            if g["class"] == cls and g["group"] == group:
                return g
        return None

    def records(self, cls=None, group=None):
        out = []
        for f in self.findings:
            if group is not None and f["group"] != group:
                continue
            if cls is not None and (f["state"].get("class") or "") != cls:
                continue
            out.append(f)
        return out

    def get(self, p):
        status = self.admin_status(p.get("token"))
        if status == "locked":
            return {"ok": False, "error": "locked"}
        admin = status == "yes"
        if not admin and p.get("token") != PAGE_TOKEN:
            return {"ok": False, "error": "bad token"}
        if admin:
            if p.get("action") == "groups":
                return {"ok": True, "groups": [g for g in self.groups if "class" not in p or g["class"] == p["class"]]}
            return {"ok": True, "records": self.records(p.get("class"))}
        if "group" not in p or "class" not in p:
            return {"ok": False, "error": "group and class required"}
        g = self.find_group(p["class"], p["group"])
        if not g:
            return {"ok": True, "status": "new"}
        if g["pin"] != p.get("pin", ""):
            return {"ok": False, "error": "bad pin"}
        return {"ok": True, "status": "ok", "names": g["names"], "records": self.records(p["class"], p["group"])}

    def post(self, data):
        self.posts.append(data)
        status = self.admin_status(data.get("token"))
        if status == "locked":
            return {"ok": False, "error": "locked"}
        admin = status == "yes"
        if not admin and data.get("token") != PAGE_TOKEN:
            return {"ok": False, "error": "bad token"}
        if data.get("action") == "register" and not admin:
            if self.find_group(data["class"], data["group"]):
                return {"ok": False, "error": "taken"}
            self.groups.append({"class": data["class"], "group": data["group"], "pin": data["pin"], "names": data.get("names", ""), "registered": "2026-11-08T10:00:00Z"})
            return {"ok": True, "status": "registered"}
        if data.get("action") == "reset" and admin:
            g = self.find_group(data.get("class", ""), data.get("group", ""))
            if g:
                self.groups.remove(g)
            return {"ok": True, "reset": bool(g)}
        rows, rejected = [], 0
        for i, r in enumerate(data.get("records", [])[:50]):
            st = r.get("state") or {}
            g = self.find_group(st.get("class", ""), r.get("group", ""))
            if not admin and (not g or g["pin"] != r.get("pin", "")):
                rejected += 1
                continue
            rows.append({"ts": time.time() + i / 1000, "group": r.get("group", ""), "question": r.get("question", ""), "finding": r.get("finding", ""), "state": st})
        self.findings += rows
        if rejected and not rows:
            return {"ok": False, "error": "bad pin", "rejected": rejected}
        return {"ok": True, "n": len(rows), "rejected": rejected}


def seed(mock, cls):
    """Two groups: Group 12 with two sound pins, an answer and notes; Group 7 with one pin whose numbers were edited."""
    def pin(group, label, question, state, ts, tamper=None):
        base, out = measures(state)
        if tamper:
            out[tamper] = out[tamper] + 100
        st = dict(state, **{"class": cls, "names": "", "labbook": {"id": "id-%s-%s" % (group[-2:], ts), "label": label, "tab": "lab", "measures": out, "baseline": base, "deleted": False}})
        mock.findings.append({"ts": ts, "group": group, "question": question, "finding": "", "state": st})
    default = {"page": "lab", "supply": [["North", 100, 0, 100]], "demand": [["West", 100, 0, 100]]}
    q1 = "1. Who really pays a tax?"
    pin("Group 12", "Tax 20 on sellers", q1, dict(default, policy={"tax_supply": 20}), 1762500000)
    pin("Group 12", "Tax 20 on buyers", q1, dict(default, policy={"tax_demand": 20}), 1762500060)
    pin("Group 7", "Tax 20 on sellers", q1, dict(default, policy={"tax_supply": 20}), 1762500120, tamper="Consumer surplus")
    mock.findings.append({"ts": 1762500200, "group": "Group 12", "question": "Assignment answers", "finding": "",
                          "state": {"class": cls, "names": "Ana, Bo", "answers": {"q1": "Same price for buyers either way: 60."}, "labbook": {"id": "answers", "kind": "answers"}}})
    mock.findings.append({"ts": 1762500300, "group": "Group 12", "question": "Notes for the debrief", "finding": "Why is the wedge the same?",
                          "state": {"class": cls, "names": "Ana, Bo", "labbook": {"id": "notes", "kind": "notes"}}})
    mock.groups.append({"class": cls, "group": "Group 12", "pin": "1234", "names": "Ana, Bo", "registered": "2026-11-08T09:00:00Z"})
    mock.groups.append({"class": cls, "group": "Group 7", "pin": "7777", "names": "", "registered": "2026-11-08T09:05:00Z"})


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    dist = tempfile.mkdtemp(prefix="marketlab_instructor_")
    httpd = socketserver.TCPServer(("127.0.0.1", 0), lambda *a, **k: Quiet(*a, directory=dist, **k))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    app_url = "http://127.0.0.1:%d" % port
    cfg = os.path.join(dist, "config.json")
    json.dump({"endpoint": ENDPOINT, "token": PAGE_TOKEN, "admin_token": ADMIN_TOKEN, "app_url": app_url}, open(cfg, "w"))
    subprocess.check_call([sys.executable, os.path.join(ROOT, "build.py"), "--config", cfg, "--out", os.path.join(dist, "index.html")])
    for name in ("index.html", "instructor.html"):
        check(ADMIN_TOKEN not in open(os.path.join(dist, name)).read(), name + " must not contain the admin token")
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
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.route(ENDPOINT + "*", route)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("page error: %s" % e))
        page.goto(app_url + "/instructor.html")
        page.wait_for_selector("#signin-form")
        page.screenshot(path=os.path.join(OUT, "01_signin.png"), full_page=True)
        # wrong password, then the right one
        page.fill("#pw", "wrong")
        page.click("#signin-btn")
        page.get_by_text("Wrong password.").wait_for()
        page.fill("#pw", PASSWORD)
        page.check("#remember")
        page.click("#signin-btn")
        page.wait_for_selector("#main:not([hidden])")
        check("No classes yet" in page.locator("#class-bar").inner_text(), "empty record: no classes yet")
        check(page.locator("#setup").get_attribute("open") is not None, "set-up panel open when there are no classes")
        check(page.locator("#projector-open").count() == 1 and "projector=1" in page.locator("#projector-open").get_attribute("href"), "projector button there before any class")
        page.screenshot(path=os.path.join(OUT, "02_empty.png"), full_page=True)
        # create a class
        page.fill("#new-code", "Test A 9Nov")
        page.click("#new-class button")
        page.wait_for_selector("#class-pick")
        check(page.locator("#class-pick").input_value() == "Test-A-9Nov", "class code cleaned and selected")
        check(page.locator("#class-link").inner_text() == app_url + "/?class=Test-A-9Nov", "class link shown: " + page.locator("#class-link").inner_text())
        check(page.locator("#qr-svg path").count() == 1, "QR code drawn")
        href = page.locator("#projector-open").get_attribute("href")
        check(href.startswith(app_url + "/?class=Test-A-9Nov&projector=1#state="), "projector link: " + href)
        check(any(p.get("records") and p["records"][0]["state"].get("labbook", {}).get("kind") == "class" for p in mock.posts), "class record posted")
        check(page.locator("#views").is_hidden() or "No group has pinned" in page.locator("section:not([hidden])").inner_text(), "no groups yet message")
        page.screenshot(path=os.path.join(OUT, "03_class_created.png"), full_page=True)
        # seed the record and refresh
        seed(mock, "Test-A-9Nov")
        page.click("#refresh")
        page.wait_for_selector("#view-overview table")
        text = page.locator("#view-overview").inner_text()
        check("Group 12" in text and "Group 7" in text, "overview lists both groups")
        rows = page.locator("#view-overview tbody tr")
        r12 = rows.filter(has_text="Group 12").first.inner_text()
        r7 = rows.filter(has_text="Group 7").first.inner_text()
        check("✓✓" in r12 and "✓ all" in r12 and "1/12" in r12 and "Why is the wedge" in r12 and "Ana, Bo" in r12, "Group 12 row: " + r12.replace("\t", " | "))
        check("✗ 1 differ" in r7, "Group 7 row flags the edited column: " + r7.replace("\t", " | "))
        check("2 groups, 3 pinned experiments" in page.locator("#class-bar").inner_text(), "class summary")
        page.screenshot(path=os.path.join(OUT, "04_overview.png"), full_page=True)
        with page.expect_download() as dl:
            page.click("#csv-books")
        csv_text = open(dl.value.path()).read()
        check(csv_text.startswith("class,time,group,members,tab,label,question,note,Market price") and csv_text.count("\n") == 5, "lab books CSV: header, 3 pins, notes: %d lines" % csv_text.count("\n"))
        with page.expect_download() as dl:
            page.click("#csv-answers")
        csv_text = open(dl.value.path()).read()
        check("Same price for buyers either way" in csv_text and csv_text.count("\n") == 3, "answers CSV: one row per group")
        # by experiment
        page.click("#views button[data-view=experiment]")
        page.wait_for_selector("#view-experiment table")
        text = page.locator("#view-experiment").inner_text()
        check("3 pinned columns across 2 groups" in text, "by experiment caption")
        check("Consumer surplus" in text and "✗ Consumer surplus" in text, "by experiment marks the edited measure")
        check("Same price for buyers either way" in text, "answer shown under the pins")
        links = page.locator("#view-experiment a.button")
        check(links.count() == 3, "three projector links")
        page.screenshot(path=os.path.join(OUT, "05_by_experiment.png"), full_page=True)
        # one group
        page.click("#views button[data-view=group]")
        page.wait_for_selector("#view-group .qblock")
        page.select_option("#g-pick", "Group 12")
        page.wait_for_selector("#view-group table.labbook")
        text = page.locator("#view-group").inner_text()
        check("Tax 20 on sellers" in text and "Tax 20 on buyers" in text and "Baseline" in text, "one group: both columns")
        check("All columns verified" in text and "Why is the wedge" in text and "Same price for buyers" in text, "one group: verification, notes, answer")
        cells = page.locator("#view-group table.labbook tbody tr", has_text="Buyers pay").first.inner_text()
        check("60.0" in cells and "+10.0" in cells, "one group: deltas shown: " + cells.replace("\t", " | "))
        page.select_option("#g-pick", "Group 7")
        page.wait_for_selector("#view-group .error")
        check("Not matching the saved settings" in page.locator("#view-group").inner_text(), "one group: edited column reported")
        page.screenshot(path=os.path.join(OUT, "06_one_group.png"), full_page=True)
        # registered groups and reset (the panel closes itself once groups have pinned; open it)
        if page.locator("#setup").get_attribute("open") is None:
            page.locator("#setup summary").click()
        page.wait_for_selector("#groups-box table")
        check("1234" in page.locator("#groups-box").inner_text() and "7777" in page.locator("#groups-box").inner_text(), "registered groups listed")
        page.select_option("#reset-pick", "Group 7")
        page.once("dialog", lambda d: d.accept())
        page.click("#reset-btn")
        page.wait_for_selector("#reset-msg .success")
        page.wait_for_function("document.querySelector('#groups-box table') && !document.querySelector('#groups-box').innerText.includes('7777')")
        check(not mock.find_group("Test-A-9Nov", "Group 7"), "group 7 reset in the record")
        page.screenshot(path=os.path.join(OUT, "07_setup.png"), full_page=True)
        # the projector link opens the class page in projector mode: pins allowed, nothing sent
        page.click("#views button[data-view=experiment]")
        page.wait_for_selector("#view-experiment a.button")
        posts_before = len(mock.posts)
        with ctx.expect_page() as pop:
            page.locator("#view-experiment a.button", has_text="Group 12: Tax 20 on sellers").click()
        proj = pop.value
        proj.wait_for_selector("#lab-results .metric")
        check("projector=1" in proj.url, "projector url")
        check("Projector" in proj.locator("#group-panel").inner_text(), "projector group panel")
        check(not proj.locator("#lab-pin").is_disabled(), "pin enabled in projector mode")
        check(proj.locator("section:not([hidden]) .metric", has_text="Market price").locator(".value").inner_text() == "60.0", "group's experiment loaded (tax 20)")
        proj.click("#lab-pin")
        proj.get_by_text("Pinned as", exact=False).wait_for()
        proj.click("#main-tabs button[data-tab=book]")
        proj.wait_for_selector("#tab-book table.labbook")
        check(proj.locator("#tab-book textarea").count() == 0, "no answer boxes in projector mode")
        check("Projector" in proj.locator("#footer-status").inner_text(), "projector footer")
        proj.wait_for_timeout(500)
        check(len(mock.posts) == posts_before, "projector pins are not sent to the record")
        proj.screenshot(path=os.path.join(OUT, "08_projector.png"), full_page=True)
        # the local store of a real group on this browser is untouched by projector mode
        check(proj.evaluate("localStorage.getItem('marketlab:Test-A-9Nov:last')") in (None, ""), "projector mode does not set the remembered group")
        proj.close()
        # remembered sign-in survives a reload; sign out forgets it
        page.reload()
        page.wait_for_selector("#main:not([hidden])")
        check(page.locator("#signin-form").count() == 0, "remembered password signs in again")
        page.click("#signout")
        page.wait_for_selector("#signin-form")
        page.reload()
        page.wait_for_selector("#signin-form")
        # lock-out message
        for i in range(3):
            page.fill("#pw", "guess%d" % i)
            page.click("#signin-btn")
            page.get_by_text("Wrong password.").wait_for()
        page.fill("#pw", PASSWORD)
        page.click("#signin-btn")
        page.get_by_text("Too many wrong passwords", exact=False).wait_for()
        page.screenshot(path=os.path.join(OUT, "09_locked.png"), full_page=True)
        browser.close()
    httpd.shutdown()
    print("instructor page: %s (%d checks failed); screenshots in %s" % ("OK" if not errors else "FAILURES", len(errors), OUT))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
