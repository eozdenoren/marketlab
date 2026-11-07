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
    # Typed like a person. (1) Choose the section, then type a tax and leave the box: the redraw must keep the section
    # and the label being typed. (2) Type a tax and click Pin straight away: the box's "change" fires between mouse-down
    # and mouse-up, and the redraw must not swallow the click.
    page.locator("#lab-pin-q").select_option("2")            # "3. Tax rates, revenue and deadweight loss"
    page.locator("#lab-pin-label").fill("Typed label")
    page.locator("#lab-tax-s").click(click_count=3)
    page.keyboard.type("30")
    page.keyboard.press("Tab")
    page.wait_for_timeout(200)
    check(page.locator("#lab-pin-q").input_value() == "2" and page.locator("#lab-pin-label").input_value() == "Typed label",
          tag + " section and label survive a change of the tax")
    page.locator("#lab-pin-label").fill("")
    page.locator("#lab-tax-s").click(click_count=3)
    page.keyboard.type("35")
    page.locator("#lab-pin").click()
    try:
        page.get_by_text("Pinned as 'Tax 35 on sellers' under '3. Tax rates", exact=False).wait_for(timeout=3000)
        pinned = True
    except Exception:
        pinned = False
    check(pinned, tag + " a tax typed and pinned straight away is pinned, under the chosen section")
    page.locator("#lab-pin-q").select_option("0")
    # ceiling 40, random lottery
    set_num(page, "Tax on sellers (per unit)", 0)
    page.get_by_label("Market control").select_option("ceiling")
    set_num(page, "Ceiling price", 40)
    page.get_by_label("Random lottery: everyone willing has the same chance").check()
    page.wait_for_timeout(200)
    check("Shortage: 60.0 buyers" in page.locator("#lab-results").inner_text(), tag + " shortage note")
    check(metric(page, "Deadweight loss") == "500", tag + " ceiling random DWL: " + metric(page, "Deadweight loss"))
    check(page.locator("#lab-results [data-inner]").count() == 2 and "Winners and losers" not in page.locator("#lab-results").inner_text(), tag + " two inner tabs: outcomes and by region")
    shot(page, tag + "_03_ceiling")
    page.locator("#lab-pin-q").select_option("5")  # file under "6. Rent control"
    page.locator("#lab-pin-label").fill("Rent control 40, lottery")
    page.locator("#lab-pin").click()
    page.get_by_text("Pinned as 'Rent control 40, lottery'", exact=False).wait_for()
    page.locator("#lab-pin-q").select_option("10")  # a column to remove later, under "Your own experiments"
    page.locator("#lab-pin-label").fill("Throwaway")
    page.locator("#lab-pin").click()
    page.get_by_text("Pinned as 'Throwaway'", exact=False).wait_for()
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
    # a floor and a quota: the sellers' side of the same story, worded for sellers
    page.get_by_label("Market control").select_option("floor")
    set_num(page, "Floor price", 70)
    page.get_by_label("Random lottery: everyone willing has the same chance").check()
    page.wait_for_timeout(200)
    txt = page.locator("#lab-results").inner_text()
    check("Excess supply: 70.0 sellers want to sell" in txt and "if the lowest-cost sellers sold the units" in txt and "value them most" not in txt, tag + " floor wording")
    check("Producer surplus: a 30-in-70 share of the dotted triangle" in txt and "Sellers who want to sell at this price: 70" in txt, tag + " floor lottery chart")
    check(metric(page, "Deadweight loss") == "1,000", tag + " floor lottery DWL: " + metric(page, "Deadweight loss"))
    page.get_by_label("Market control").select_option("quota")
    set_num(page, "Quota (units)", 30)
    page.wait_for_timeout(200)
    txt = page.locator("#lab-results").inner_text()
    check("Quota: 70.0 sellers would sell at this price but only 30.0 units may be traded" in txt and "buyers take only" not in txt, tag + " quota wording")
    page.locator('input[name="lab-rent"][value="government"]').check()
    page.wait_for_timeout(200)
    txt = page.locator("#lab-results").inner_text()
    check("Sellers receive (after the licence fee)" in txt and "(after tax)" not in txt, tag + " quota licence row label")
    check("licences are auctioned" in txt and "sellers keep 30.0, and the difference on 30.0 units is 1,200" in txt, tag + " quota licence note")
    check("Licence rent" in page.locator("#lab-results .legend").inner_text(), tag + " quota licence area")
    page.locator("#lab-reset-exp").click()
    page.wait_for_timeout(200)
    check(metric(page, "Market price") == "50.0", tag + " reset after controls")
    # externalities
    page.locator("#main-tabs button[data-tab='ext']").click()
    page.wait_for_selector("#ext-results .metric")
    check(metric(page, "Socially optimal quantity") == "40.0" and metric(page, "Deadweight loss") == "100", tag + " ext default")
    set_num(page, "Tax on sellers (per unit)", 20)
    check(metric(page, "Deadweight loss") == "0", tag + " pigou tax")
    check(page.locator("#ext-results [data-inner]").count() == 0 and "third parties" in page.locator("#ext-results").inner_text(), tag + " externality outcomes without inner tabs")
    shot(page, tag + "_04_externality")
    page.locator("#ext-pin").click()
    page.get_by_text("Pinned as 'Harm 20: tax 20 on sellers'", exact=False).wait_for()
    # lab book
    page.locator("#main-tabs button[data-tab='book']").click()
    txt = page.locator("#tab-book").inner_text()
    check("Baseline, harm 20" in txt and "Rent control 40, lottery" in txt and "Tax 20 on sellers" in txt, tag + " lab book columns")
    # each pinned value carries its change from the baseline in small grey text; none where the baseline is 0
    q1 = page.locator("#tab-book .qsection[data-q='q1'] table.labbook")
    price_row = q1.locator("tbody tr", has_text="Market price").first
    check(price_row.locator("td").nth(1).locator(".delta").count() == 0 and price_row.locator("td").nth(2).locator(".delta").inner_text() == "+10.0", tag + " change under the pinned price")
    rev_row = q1.locator("tbody tr", has_text="Government revenue").first
    check(rev_row.locator(".delta").count() == 0, tag + " no change shown where the baseline is 0")
    # each section is the table and the answer box only: no label/section/note panel, no Note row
    first_cells = [c.strip() for c in page.locator("#tab-book table.labbook tbody td:first-child").all_inner_texts()]
    check("Labels, sections and notes" not in txt and page.locator("#tab-book input[aria-label='Note']").count() == 0
          and "Note" not in first_cells and page.locator("#tab-book .edit-grid").count() == 0, tag + " no editing panel in the lab book")
    # the x on a pinned column removes it, after a confirmation; baselines have no x
    own = "#tab-book .qsection[data-q='own']"
    check("Throwaway" in page.locator(own).inner_text(), tag + " throwaway column under own experiments")
    check(page.locator(own + " .remove-entry").count() == 1, tag + " one remove button: the baseline has none")
    page.once("dialog", lambda d: d.dismiss())
    page.locator(own).get_by_role("button", name="Remove Throwaway").click()
    page.wait_for_timeout(200)
    check("Throwaway" in page.locator(own).inner_text(), tag + " column kept when the removal is cancelled")
    page.once("dialog", lambda d: d.accept())
    page.locator(own).get_by_role("button", name="Remove Throwaway").click()
    page.wait_for_timeout(200)
    check("Throwaway" not in page.locator(own).inner_text() and "Nothing pinned here yet" in page.locator(own).inner_text(), tag + " column removed with the x")
    sec1 = page.locator("#tab-book .qsection[data-q='q1']").inner_text()
    check("Tax 20 on sellers" in sec1 and "Rent control 40, lottery" not in sec1, tag + " pins sit in their sections")
    sec6 = page.locator("#tab-book .qsection[data-q='q10']").inner_text()
    check("Harm 20: tax 20 on sellers" in sec6, tag + " externality pin under question 10")
    sec4 = page.locator("#tab-book .qsection[data-q='q6']").inner_text()
    check("Rent control 40, lottery" in sec4, tag + " rent control pin under question 6")
    # Question 4 the way students do it: reset, then split the sellers into North 50 and South 50 in the Supply table.
    page.locator("#main-tabs button[data-tab='lab']").click()
    page.locator("#lab-reset-market").click()
    page.locator("#lab-reset-exp").click()
    page.wait_for_timeout(200)
    q = page.locator("#lab-supply tbody tr").first.locator("input[aria-label='Quantity']")
    q.fill("50")
    q.press("Enter")
    page.locator("button.add-row[data-table='lab-supply']").click()
    page.wait_for_timeout(200)
    new_row = page.locator("#lab-supply tbody tr").nth(1)
    for field, value in (("Region", "South"), ("Quantity", "50"), ("Pmin", "0"), ("Pmax", "100")):
        cell = new_row.locator("input[aria-label='%s']" % field)
        cell.fill(value)
        cell.press("Enter")
    page.wait_for_timeout(200)
    names = [i.input_value() for i in page.locator("#lab-supply tbody tr td:first-child input").all()]
    check(names == ["North", "South"] and metric(page, "Market price") == "50.0" and metric(page, "Quantity traded") == "50.0",
          tag + " two selling regions built by hand still clear at 50 and 50")
    page.locator("#lab-pin-q").select_option("3")            # "4. Broad base or high rate?"
    q4 = "#tab-book .qsection[data-q='q4']"
    set_num(page, "Tax on sellers (per unit)", 20)
    page.locator("#lab-pin").click()
    page.get_by_text("Pinned as 'Tax 20 on sellers' under '4. Broad base", exact=False).wait_for()
    set_num(page, "Tax on sellers (per unit)", 0)
    page.locator("#lab-regional-panel summary").click()
    north = page.locator("#lab-regional tr[data-region='North'] input[data-f='tax']")
    north.click(click_count=3)
    page.keyboard.type("40")
    page.locator("#lab-pin").click()
    page.get_by_text("Pinned as 'North tax 40' under '4. Broad base", exact=False).wait_for()
    page.locator("#main-tabs button[data-tab='book']").click()
    rows = {}
    for tr in page.locator(q4 + " table.labbook tbody tr").all():
        # the value only: the small grey change under it is not part of the number
        cells = [c.strip().split("\n")[0] for c in tr.locator("td").all_inner_texts()]
        rows[cells[0]] = cells[1:]
    # (by now the tab has been rebuilt several times by the reset buttons: one click on
    # Pin must still give exactly one column, so three columns here: the baseline and the two pins)
    check(all(len(v) == 3 for v in rows.values()), tag + " one click on Pin gives one column, also after resets")
    check(rows.get("Government revenue") == ["0.0", "800.0", "400.0"] and rows.get("Deadweight loss") == ["0.0", "100.0", "300.0"]
          and rows.get("Buyers pay") == ["50.0", "60.0", "60.0"], tag + " question 4: same buyers' price, half the revenue, three times the loss")
    check(rows.get("Quantity: North") == ["25.0", "20.0", "10.0"] and rows.get("Quantity: South") == ["25.0", "20.0", "30.0"]
          and rows.get("Surplus: South") == ["625.0", "400.0", "900.0"], tag + " question 4: regional rows in the lab book")
    check("Quantity: North" not in page.locator("#tab-book .qsection[data-q='q1']").inner_text(), tag + " no regional rows for a one-region market")
    check(page.locator("#tab-book .start-q").count() == 0, tag + " no set-up buttons in the lab book")
    page.locator("#main-tabs button[data-tab='book']").click()
    page.locator("#book-notes").fill("Equal slopes, equal split.")
    page.locator("#book-notes").blur()
    shot(page, tag + "_05_labbook")
    # the answer box of question 1, inside the lab book
    page.locator("#tab-book textarea[data-q='q1']").fill("Price 60 vs 40; buyers pay 60 both times.")
    page.locator("#tab-book textarea[data-q='q1']").blur()
    shot(page, tag + "_06_answers")
    # reload: group, lab book, notes, answers and tab all come back
    page.reload()
    page.wait_for_selector("#group-panel")
    page.wait_for_timeout(500)
    check("Your group: Group 12" in page.locator("#group-panel").inner_text(), tag + " group restored after reload")
    check(not page.locator("#tab-book").is_hidden(), tag + " last tab restored after reload")
    page.locator("#main-tabs button[data-tab='book']").click()
    check("Rent control 40, lottery" in page.locator("#tab-book").inner_text() and page.locator("#book-notes").input_value() == "Equal slopes, equal split.", tag + " lab book restored")
    check(page.locator("#tab-book textarea[data-q='q1']").input_value().startswith("Price 60"), tag + " answer restored")
    check("Throwaway" not in page.locator("#tab-book").inner_text(), tag + " removed column stays removed after reload")
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
