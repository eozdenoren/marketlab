"""Real-browser check of the exam calculator (docs/calculator.html): no group box, no pin button, no lab book; the
helper forms turn exam notation into rows; nothing is read from or written to the browser's storage, even when the
class page's own storage sits in the same origin. Reproduces the 2025 final's tariff table (Policy 1) as the check.
    python3 tests/browser_calculator.py [shots_dir]"""
import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/marketlab_calculator_shots"
os.makedirs(OUT, exist_ok=True)
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)
        print("FAIL:", msg)


def metric(page, label):
    return page.locator("section:not([hidden]) .metric", has_text=label).locator(".value").inner_text()


def outcome(page, row):
    """The Experiment column of the Outcomes table for a row label."""
    tr = page.locator("section:not([hidden]) #lab-results table.grid tbody tr", has_text=row).first
    return tr.locator("td").nth(2).inner_text()


def region(page, row):
    tr = page.locator("section:not([hidden]) #lab-results table.grid tbody tr", has_text=row).first
    return [tr.locator("td").nth(i).inner_text() for i in range(1, tr.locator("td").count())]


def add(page, table, kind, **fields):
    form = page.locator("form.helper[data-table=%s]" % table)
    form.locator("select[name=kind]").select_option(kind)
    for name, value in fields.items():
        form.locator("[name=%s]" % name).fill(str(value))
    form.locator("button").click()
    page.wait_for_timeout(200)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    dist = tempfile.mkdtemp(prefix="marketlab_calc_")
    subprocess.check_call([sys.executable, os.path.join(ROOT, "build.py"), "--out", os.path.join(dist, "index.html")])
    html = open(os.path.join(dist, "calculator.html")).read()
    check('"calculator": true' in html and '"endpoint"' not in html, "calculator config: calculator flag, no endpoint")
    httpd = socketserver.TCPServer(("127.0.0.1", 0), lambda *a, **k: Quiet(*a, directory=dist, **k))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % port
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("page error: %s" % e))
        # a group's work from the class page sits in the same origin's storage: the calculator must neither show it nor touch it
        page.goto(base + "/index.html")
        page.wait_for_selector("#lab-results .metric")
        page.evaluate("""() => { localStorage.setItem('marketlab::last', JSON.stringify({number: 12, pin: '1234'}));
            localStorage.setItem('marketlab::Group 12', JSON.stringify({lab: {supply: [['North', 50, 0, 100]], demand: [['West', 100, 0, 100]], policy: {cost_shock: 0, benefit_boost: 0, tax_supply: 20, tax_demand: 0, control: 'none', control_value: 0, rationing: 'efficient', rent_to: 'sellers', regional: {}}}, book: [], notes: '', answers: {}, group: {number: 12, pin: '1234'}, tab: 'lab'})); }""")
        before = page.evaluate("JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))")
        page.goto(base + "/calculator.html")
        page.wait_for_selector("#lab-results .metric")
        check(page.locator("#group-panel").count() == 0 and page.locator("#lab-pin").count() == 0 and page.locator("#tab-book").count() == 0, "no group box, pin button or lab book")
        check(metric(page, "Market price") == "50.0" and metric(page, "Quantity traded") == "50.0", "default market, not the stored group's: price %s" % metric(page, "Market price"))
        check("Calculator" in page.locator("#footer-status").inner_text(), "calculator footer")
        page.screenshot(path=os.path.join(OUT, "01_default.png"), full_page=True)
        # the 2025 final, question 11: China MC 20 capacity 80, USA MC 30 capacity 40; USA and ROW demand Q = 100 - P
        page.locator("#lab-supply tbody tr").first.locator("button").click()      # remove the default rows
        page.wait_for_timeout(150)
        page.locator("#lab-demand tbody tr").first.locator("button").click()
        page.wait_for_timeout(150)
        add(page, "lab-supply", "block", name="China", mc=20, cap=80)
        add(page, "lab-supply", "block", name="USA sellers", mc=30, cap=40)
        add(page, "lab-demand", "QofP", name="USA", a=100, b=1)
        add(page, "lab-demand", "QofP", name="ROW", a=100, b=1)
        rows = page.locator("#lab-supply tbody tr")
        check(rows.count() == 2 and [i.input_value() for i in rows.nth(0).locator("input").all()] == ["China", "80", "20", "20"], "block row: " + str([i.input_value() for i in rows.nth(0).locator("input").all()]))
        drows = page.locator("#lab-demand tbody tr")
        check(drows.count() == 2 and [i.input_value() for i in drows.nth(1).locator("input").all()] == ["ROW", "100", "0", "100"], "linear demand row: " + str([i.input_value() for i in drows.nth(1).locator("input").all()]))
        check(metric(page, "Market price") == "40.0" and metric(page, "Quantity traded") == "120.0", "baseline: price 40, quantity 120 (got %s, %s)" % (metric(page, "Market price"), metric(page, "Quantity traded")))
        page.screenshot(path=os.path.join(OUT, "02_market_built.png"), full_page=True)
        # Policy 1: a $10 tariff on Chinese imports to the USA = tax 10 on USA buyers + subsidy 10 to USA sellers
        page.locator("#lab-regional-panel summary").click()
        panel = page.locator("#lab-regional")
        panel.wait_for()
        tax_us_buyers = panel.locator("tr", has_text="USA").filter(has_not_text="sellers").locator("input[aria-label*='ax']").first
        tax_us_buyers.fill("10"); tax_us_buyers.press("Enter"); tax_us_buyers.blur()
        page.wait_for_timeout(200)
        tax_us_sellers = panel.locator("tr", has_text="USA sellers").locator("input[aria-label*='ax']").first
        tax_us_sellers.fill("-10"); tax_us_sellers.press("Enter"); tax_us_sellers.blur()
        page.wait_for_timeout(300)
        check(metric(page, "Market price") == "35.0", "policy 1: world (ROW) price 35, got " + metric(page, "Market price"))
        check(outcome(page, "Quantity traded") == "120.0" and outcome(page, "Tax revenue") == "150.0", "policy 1: quantity 120, net revenue 150 (got %s, %s)" % (outcome(page, "Quantity traded"), outcome(page, "Tax revenue")))
        page.locator("button[data-inner=regions]").click()
        page.wait_for_timeout(200)
        q = region(page, "Quantity")
        s = region(page, "Surplus")
        check(q[:4] == ["80.0", "40.0", "55.0", "65.0"], "policy 1 quantities by region: %s" % q)
        check(s[:4] == ["1,200.0", "600.0", "1,512.5", "2,112.5"], "policy 1 surpluses by region: %s" % s)
        page.screenshot(path=os.path.join(OUT, "03_policy1.png"), full_page=True)
        # externalities tab works and the storage is untouched
        page.click("#main-tabs button[data-tab=ext]")
        page.wait_for_selector("#ext-results .metric")
        check(page.locator("#ext-pin").count() == 0, "no pin button on the externalities tab")
        after = page.evaluate("JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))")
        check(before == after, "browser storage untouched by the calculator")
        page.reload()
        page.wait_for_selector("#lab-results .metric")
        check(metric(page, "Market price") == "50.0" and page.locator("#lab-supply tbody tr").count() == 1, "reload gives a clean start")
        browser.close()
    httpd.shutdown()
    print("calculator: %s (%d checks failed); screenshots in %s" % ("OK" if not errors else "FAILURES", len(errors), OUT))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
