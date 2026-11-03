"""Real-browser check of docs/index.html: file:// (offline edition) and http with a class code.
    python3 tests/browser_page.py [shots_dir]"""
import os
import sys
import threading
import http.server
import socketserver

from playwright.sync_api import sync_playwright

import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = tempfile.mkdtemp(prefix="marketlab_offline_")
subprocess.check_call([sys.executable, os.path.join(os.path.dirname(HERE), "build.py"), "--out", os.path.join(DIST, "index.html")])
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/marketlab_html_shots"
os.makedirs(OUT, exist_ok=True)
errors = []


def shot(page, name):
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)


def metric(page, label):
    return page.locator("section:not([hidden]) .metric", has_text=label).locator(".value").inner_text()


def set_num(page, label, value):
    loc = page.locator("section:not([hidden])").get_by_label(label, exact=True)
    loc.fill(str(value))
    loc.press("Enter")
    loc.blur()
    page.wait_for_timeout(150)


def check(cond, msg):
    if not cond:
        errors.append(msg)
        print("FAIL:", msg)


def run(page, base_url, tag):
    page.goto(base_url)
    page.wait_for_selector("#lab-results .metric")
    check(metric(page, "Market price") == "50.0", tag + " baseline price")
    shot(page, tag + "_01_default")
    # pin disabled without a group
    check(page.locator("#lab-pin").is_disabled(), tag + " pin disabled without group")
    page.get_by_label("Group number").fill("12")
    page.get_by_label("Names of the group members", exact=False).fill("Ana, Bo Chen and Chidi")
    page.get_by_role("button", name="Save").click()
    page.get_by_text("Your group: Group 12", exact=False).wait_for()
    check("Ana, Bo Chen, Chidi" in page.locator("#group-panel").inner_text(), tag + " names cleaned")
    # tax 20 on sellers
    set_num(page, "Tax on sellers (per unit)", 20)
    check(metric(page, "Market price") == "60.0" and metric(page, "Quantity traded") == "40.0", tag + " tax 20 metrics")
    check("Supply plus tax" in page.locator("#lab-results .legend").inner_text(), tag + " tax legend")
    shot(page, tag + "_02_tax")
    page.locator("#lab-pin").click()
    page.get_by_text("Pinned as 'Tax 20 on sellers'", exact=False).wait_for()
    # ceiling 40, random lottery, winners tab
    set_num(page, "Tax on sellers (per unit)", 0)
    page.get_by_label("Market control").select_option("ceiling")
    set_num(page, "Ceiling price", 40)
    page.get_by_label("Random lottery: everyone willing has the same chance").check()
    page.wait_for_timeout(200)
    check("Shortage: 60.0 buyers" in page.locator("#lab-results").inner_text(), tag + " shortage note")
    check(metric(page, "Deadweight loss") == "500", tag + " ceiling random DWL: " + metric(page, "Deadweight loss"))
    page.locator("#lab-results button[data-inner='winners']").click()
    check("Government" not in page.locator("#lab-results table").inner_text() and "buyers who no longer buy" in page.locator("#lab-results").inner_text(), tag + " winners table")
    shot(page, tag + "_03_ceiling_winners")
    page.locator("#lab-pin-label").fill("Rent control 40, lottery")
    page.locator("#lab-pin").click()
    page.get_by_text("Pinned as 'Rent control 40, lottery'", exact=False).wait_for()
    # steeper supply via the spec table (experiments cleared first), then reset
    page.locator("#lab-reset-exp").click()
    page.wait_for_timeout(200)
    check(metric(page, "Market price") == "50.0", tag + " reset experiments")
    page.locator("#lab-supply input[aria-label='Pmax']").first.fill("200")
    page.locator("#lab-supply input[aria-label='Pmax']").first.press("Enter")
    page.locator("#lab-supply input[aria-label='Pmax']").first.blur()
    page.wait_for_timeout(200)
    check(metric(page, "Market price") in ("66.7", "66,7"), tag + " steep supply price: " + metric(page, "Market price"))
    page.locator("#lab-reset-market").click()
    page.wait_for_timeout(200)
    check(metric(page, "Market price") == "50.0", tag + " reset market")
    # externalities
    page.locator("#main-tabs button[data-tab='ext']").click()
    page.wait_for_selector("#ext-results .metric")
    check(metric(page, "Socially optimal quantity") == "40.0" and metric(page, "Deadweight loss") == "100", tag + " ext default")
    set_num(page, "Tax on sellers (per unit)", 20)
    check(metric(page, "Deadweight loss") == "0", tag + " pigou tax")
    page.locator("#ext-results button[data-inner='winners']").click()
    check("People outside the market" in page.locator("#ext-results").inner_text(), tag + " third parties row")
    shot(page, tag + "_04_externality")
    page.locator("#ext-pin").click()
    page.get_by_text("Pinned as 'Harm 20: tax 20 on sellers'", exact=False).wait_for()
    # lab book
    page.locator("#main-tabs button[data-tab='book']").click()
    txt = page.locator("#tab-book").inner_text()
    check("Baseline, harm 20" in txt and "Rent control 40, lottery" in txt and "Tax 20 on sellers" in txt, tag + " lab book columns")
    note = page.locator("#tab-book input[aria-label='Note']").first
    note.fill("price up by 10 only")
    note.press("Enter")
    note.blur()
    page.wait_for_timeout(200)
    check("price up by 10 only" in page.locator("#tab-book table").inner_text(), tag + " note in table")
    page.locator("#book-notes").fill("Equal slopes, equal split.")
    page.locator("#book-notes").blur()
    shot(page, tag + "_05_labbook")
    # assignment
    page.locator("#main-tabs button[data-tab='assign']").click()
    page.locator("textarea[data-q='q1']").fill("Price 60 vs 40; buyers pay 60 both times.")
    page.locator("textarea[data-q='q1']").blur()
    shot(page, tag + "_06_assignment")
    # reload: group, lab book, notes, answers and tab all come back
    page.reload()
    page.wait_for_selector("#group-panel")
    page.wait_for_timeout(500)
    check("Your group: Group 12" in page.locator("#group-panel").inner_text(), tag + " group restored after reload")
    check(not page.locator("#tab-assign").is_hidden(), tag + " last tab restored after reload")
    page.locator("#main-tabs button[data-tab='book']").click()
    check("Rent control 40, lottery" in page.locator("#tab-book").inner_text() and page.locator("#book-notes").input_value() == "Equal slopes, equal split.", tag + " lab book restored")
    page.locator("#main-tabs button[data-tab='assign']").click()
    check(page.locator("textarea[data-q='q1']").input_value().startswith("Price 60"), tag + " answer restored")
    # instructor-style link with a state in the hash
    import base64, json
    st = {"page": "lab", "supply": [["North", 100, 0, 100]], "demand": [["West", 100, 0, 100]],
          "policy": {"tax_supply": 0, "tax_demand": 0, "control": "ceiling", "control_value": 30, "rationing": "inefficient", "regional": {}}}
    b64 = base64.urlsafe_b64encode(json.dumps(st).encode()).decode().rstrip("=")
    page.goto(base_url + "#state=" + b64)
    page.wait_for_selector("#lab-results .metric")
    page.wait_for_timeout(300)
    check(metric(page, "Deadweight loss") == "1,600", tag + " hash state loaded: DWL " + metric(page, "Deadweight loss"))
    check(not page.locator("#hint").is_hidden(), tag + " hint shown")
    shot(page, tag + "_07_hash_state")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class Server(socketserver.TCPServer):
    allow_reuse_address = True


def main():
    os.chdir(DIST)
    srv = Server(("127.0.0.1", 8655), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1300, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        page.on("console", lambda m: errors.append("console error: %s" % m.text) if m.type == "error" else None)
        run(page, "file://" + os.path.join(DIST, "index.html"), "file")
        check("Offline copy" in page.locator("#footer-status").inner_text(), "file offline footer")
        page2 = browser.new_context(viewport={"width": 1300, "height": 900}).new_page()
        page2.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        run(page2, "http://127.0.0.1:8655/index.html?class=TEST-A", "http")
        check("Class TEST-A" in page2.locator("#group-panel").inner_text(), "http class code shown")
        browser.close()
    srv.shutdown()
    print("%d checks failed" % len(errors))
    for e in errors:
        print("  " + e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
