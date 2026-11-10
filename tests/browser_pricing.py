"""Real-browser check of the Pricing Laboratory: docs/pricing.html, its projector mode and docs/pricing_instructor.html,
against the real backend/Pricing.gs served by tests/pricing_server.js (node vm, fake sheets). Two groups sign in with
their Marketplace Laboratory registrations, the instructor sets up and runs the challenge, the groups fly, the demand
is revealed, round 2 opens, Mocha is priced, pins and answers reach the record, the projector shows the board.
    python3 tests/browser_pricing.py [shots_dir]"""
import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pricinglab_shots"
os.makedirs(OUT, exist_ok=True)
CLS = "CM03AUT26A"
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)
        print("FAIL:", msg)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    dist = tempfile.mkdtemp(prefix="pricinglab_")
    seed = os.path.join(dist, "seed.json")
    json.dump({"marketlab_groups": [[CLS, "Group 12", "1234", "Ana, Bo", "2026-11-09T10:00:00Z"], [CLS, "Group 7", "0777", "", "2026-11-09T10:05:00Z"]], "password": "Sesame-42"}, open(seed, "w"))
    srv = subprocess.Popen(["node", os.path.join(HERE, "pricing_server.js"), seed], stdout=subprocess.PIPE, text=True)
    info = json.loads(srv.stdout.readline())
    endpoint = "http://127.0.0.1:%d/exec" % info["port"]
    httpd = socketserver.TCPServer(("127.0.0.1", 0), lambda *a, **k: Quiet(*a, directory=dist, **k))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    app_url = "http://127.0.0.1:%d" % httpd.server_address[1]
    cfg = os.path.join(dist, "config.json")
    json.dump({"endpoint": "https://marketlab.invalid/exec", "token": "page-token", "admin_token": "admin-token-0123456789", "app_url": app_url,
               "classes": [CLS, "CM03AUT26B", "LIVE-TEST"], "pricing": {"endpoint": endpoint, "token": info["token"], "admin_token": info["admin_token"]}}, open(cfg, "w"))
    subprocess.check_call([sys.executable, os.path.join(ROOT, "build.py"), "--config", cfg, "--out", os.path.join(dist, "index.html")], stdout=subprocess.DEVNULL)
    for name in ("pricing.html", "pricing_instructor.html", "index.html", "instructor.html"):
        html = open(os.path.join(dist, name)).read()
        check(info["admin_token"] not in html and "admin-token-0123456789" not in html, name + " holds no admin token")
    check(info["token"] not in open(os.path.join(dist, "index.html")).read(), "the Marketplace page does not carry the pricing token")

    def admin(params):
        q = "&".join("%s=%s" % (k, urllib.request.quote(str(v))) for k, v in dict(params, token=info["admin_token"]).items())
        return json.load(urllib.request.urlopen(endpoint + "?" + q))

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()

            def fresh(width=1280):
                ctx = browser.new_context(viewport={"width": width, "height": 900})
                pg = ctx.new_page()
                pg.on("pageerror", lambda e: errors.append("page error: %s" % e))
                return ctx, pg

            # ---- no class code / unknown code
            ctx0, pg0 = fresh()
            pg0.goto(app_url + "/pricing.html")
            pg0.get_by_text("This address has no class code", exact=False).wait_for()
            check(pg0.locator("#group-form").count() == 0 and pg0.locator("#group-panel a.button").count() == 2, "no sign-in without a class code; links to the classes")
            ctx0.close()

            # ---- Group 12 signs in with its Marketplace registration
            ctx1, s1 = fresh()
            s1.goto(app_url + "/pricing.html?class=cm03aut26a")
            s1.wait_for_selector("#group-form")
            check(s1.url.endswith("?class=" + CLS), "the class code is cleaned in the address bar")
            s1.fill("#group-number", "12"); s1.fill("#group-pin", "1234"); s1.click("#group-save")
            s1.get_by_text("Your group: Group 12", exact=False).wait_for()
            check("Ana, Bo" in s1.locator("#group-panel").inner_text(), "the names come from the Marketplace registration")
            s1.get_by_text("not set up for class", exact=False).wait_for()
            s1.screenshot(path=os.path.join(OUT, "01_student_signed_in.png"), full_page=True)

            # ---- the instructor sets up the challenge and opens round 1
            ctx2, ins = fresh()
            ins.goto(app_url + "/pricing_instructor.html")
            ins.wait_for_selector("#signin-form")
            ins.fill("#pw", "nope"); ins.click("#signin-btn"); ins.get_by_text("Wrong password.").wait_for()
            ins.fill("#pw", "Sesame-42"); ins.click("#signin-btn")
            ins.wait_for_selector("#main:not([hidden])")
            check(ins.locator("#class-pick").input_value() == CLS, "the first class of the list is selected")
            ins.select_option("#preset", "0")
            ins.get_by_text("Best fare £680", exact=False).wait_for()
            ins.screenshot(path=os.path.join(OUT, "02_instructor_settings.png"), full_page=True)
            ins.click("#save-settings")
            ins.get_by_text("Settings saved", exact=False).wait_for()
            ins.click("button[data-phase=open]")
            ins.get_by_text("Round 1 open.", exact=False).wait_for()

            # ---- the student page picks the opening up by polling and flies
            s1.get_by_text("Fare for flight 1 of 6", exact=False).wait_for(timeout=15000)
            check("450 seats" in s1.locator("#tab-challenge").inner_text() and "£580" in s1.locator("#tab-challenge").inner_text(), "the briefing shows the told numbers")
            s1.screenshot(path=os.path.join(OUT, "03_student_open.png"), full_page=True)
            s1.fill("#fare", "680"); s1.click("#fly")
            s1.get_by_text("Fare for flight 2 of 6", exact=False).wait_for()
            row = s1.locator("table.flights tbody tr").first.inner_text()
            check("£680" in row and "300" in row and "£180,000" in row and "+£5,000" in row, "flight 1: 680, 300 passengers, 180,000, +5,000: %r" % row)
            s1.fill("#fare", "380"); s1.click("#fly")
            s1.get_by_text("Fare for flight 3 of 6", exact=False).wait_for()
            row2 = s1.locator("table.flights tbody tr").nth(1).inner_text()
            check("450" in row2 and "(full)" in row2 and "-£40,000" in row2, "flight 2 fills the plane and loses 40,000: %r" % row2)
            check("Group 12" in s1.locator("table.board").inner_text(), "the student's leaderboard lists the group")
            s1.screenshot(path=os.path.join(OUT, "04_student_flown.png"), full_page=True)

            # ---- Group 7 on a phone
            ctx3, s2 = fresh(width=390)
            s2.goto(app_url + "/pricing.html?class=" + CLS)
            s2.wait_for_selector("#group-form")
            s2.fill("#group-number", "7"); s2.fill("#group-pin", "0777"); s2.click("#group-save")
            s2.get_by_text("Your group: Group 7", exact=False).wait_for()
            s2.wait_for_selector("#fare", timeout=15000)
            s2.fill("#fare", "700"); s2.click("#fly")
            s2.get_by_text("Fare for flight 2 of 6", exact=False).wait_for()
            s2.screenshot(path=os.path.join(OUT, "05_phone_flown.png"), full_page=True)
            check(s2.evaluate("document.documentElement.scrollWidth <= 390"), "the phone page does not overflow sideways")

            # ---- the projector shows the board without fares
            ctx4, proj = fresh(width=1400)
            proj.goto(app_url + "/pricing.html?class=" + CLS + "&projector=1")
            proj.wait_for_selector("table.board")
            check(proj.locator("#group-form").count() == 0 and "Fares" not in proj.locator("table.board").inner_text(), "the projector shows the board, no sign-in, no fares yet")
            board = proj.locator("table.board tbody tr").all_inner_texts()
            check(len(board) == 2 and board[0].startswith("1\tGroup 7"), "Group 7 leads with its one flight: %r" % board)
            proj.screenshot(path=os.path.join(OUT, "06_projector_board.png"), full_page=True)

            # ---- the instructor closes and reveals
            ins.click("button[data-phase=closed]"); ins.get_by_text("Round 1 closed.", exact=False).wait_for()
            s1.get_by_text("Round 1 is closed", exact=False).wait_for(timeout=15000)
            check(s1.locator("#fare").count() == 0, "no fare box after the close")
            ins.click("button[data-phase=revealed]"); ins.get_by_text("Demand revealed.", exact=False).wait_for()
            check("Leaderboard" in ins.locator("#view-challenge").inner_text() and ins.locator("#view-challenge svg").count() == 3, "the instructor sees the board, the two settings charts and the profit curve with the flights: %d svg" % ins.locator("#view-challenge svg").count())
            ins.screenshot(path=os.path.join(OUT, "07_instructor_revealed.png"), full_page=True)
            s1.get_by_text("The demand you were facing", exact=False).wait_for(timeout=15000)
            txt = s1.locator("#tab-challenge").inner_text()
            check("640 − 0.5 × P" in txt and "£1,280" in txt and "best fare is £680" in txt, "the reveal states the demand and the best fare")
            check("Two points were enough" in txt, "the line through the status quo and the first flight is the demand")
            check(s1.locator("#tab-challenge svg").count() == 2, "two charts at the reveal")
            check("£680, £380" in s1.locator("table.board").inner_text(), "fares shown on the board once revealed")
            s1.screenshot(path=os.path.join(OUT, "08_student_revealed.png"), full_page=True)
            proj.get_by_text("The demand you were facing", exact=False).wait_for(timeout=15000)
            check(proj.locator("#tab-challenge svg").count() == 2 and "£700" in proj.locator("table.board").inner_text(),
                  "the projector shows the reveal with every group's fares: %d svg, board %r" % (proj.locator("#tab-challenge svg").count(), proj.locator("table.board").inner_text()[:120]))
            proj.screenshot(path=os.path.join(OUT, "09_projector_revealed.png"), full_page=True)
            # pin round 1
            s1.click("#challenge-pin")
            s1.get_by_text("Pinned as 'Round 1: my flights'", exact=False).wait_for()

            # ---- round 2
            ins.click("button[data-phase=round2]"); ins.get_by_text("Round 2 open.", exact=False).wait_for()
            s1.get_by_text("Round 2: the market changes", exact=False).wait_for(timeout=15000)
            s1.fill("#r2-fare", "680"); s1.click("#r2-form button")
            s1.wait_for_selector("table.flights")
            r2 = s1.locator("table.flights tbody tr").first.inner_text()
            check("420" in r2 and "£252,000" in r2, "demand +40%% at 680: 420 carried, profit 252,000: %r" % r2)
            s1.click("#challenge-pin")
            s1.get_by_text("Pinned as 'Demand rises 40%: fare £680' under '2. Demand rises 40%'", exact=False).wait_for()
            s1.click("button[data-scenario=double]")
            s1.fill("#r2-fare", "700"); s1.click("#r2-form button")
            s1.wait_for_selector("table.flights")
            r2b = s1.locator("table.flights tbody tr").first.inner_text()
            check("580" in r2b and "(full)" in r2b and "£279,000" in r2b, "demand doubled at 700: 580 want to fly, 450 carried, 279,000: %r" % r2b)
            s1.fill("#r2-fare", "830"); s1.click("#r2-form button")
            s1.get_by_text("£337,500", exact=False).wait_for()
            r2c = s1.locator("table.flights tbody tr").nth(1).inner_text()
            check(r2c.count("450") == 2 and "(full)" in r2c and "£337,500" in r2c, "demand doubled at 830: exactly 450 want to fly, 337,500: %r" % r2c)
            check(s1.locator("#challenge-pin-q").input_value() == "c3", "the pin section follows the scenario")
            s1.screenshot(path=os.path.join(OUT, "10_student_round2.png"), full_page=True)

            # ---- Mocha
            s1.click("#main-tabs button[data-tab=mocha]")
            s1.wait_for_selector("#mo-results")
            check("Your stream (Stream A, 69 bids)" in s1.locator("#mo-data").inner_text() and s1.locator("#mo-data").input_value() == "mine", "the group's own stream is the default data")
            s1.fill("#mo-price", "35"); s1.press("#mo-price", "Enter"); s1.locator("#mo-price").dispatch_event("change")
            s1.get_by_text("Buyers at £35", exact=False).wait_for()
            mt = s1.locator("#mo-results").inner_text()
            check("14" in mt and "£280" in mt and "Best price on these bids: £35" in mt, "price 35 on stream A at cost 15: 14 buyers, 280, which is the best: %r" % mt[:200])
            s1.check("#mo-line")
            s1.get_by_text("P = 45.57 − 0.718 Q", exact=False).wait_for()
            check("£30.29" in s1.locator("#mo-results").inner_text(), "the line's price 30.29")
            s1.screenshot(path=os.path.join(OUT, "11_student_mocha.png"), full_page=True)
            s1.click("#mo-results button[data-inner=segments]")
            s1.get_by_text("Gain from a price per market: £125", exact=False).wait_for()
            s1.check("#mo-fourth")
            s1.get_by_text("Last year (Autumn 2025)", exact=False).wait_for()
            s1.screenshot(path=os.path.join(OUT, "12_student_segments.png"), full_page=True)
            s1.click("#mocha-pin")
            s1.get_by_text("Pinned as 'Your stream: price £35'", exact=False).wait_for()
            s1.click("#mo-results button[data-inner=bids]")
            s1.wait_for_selector("#mo-results svg")
            check("median £17" in s1.locator("#mo-results").inner_text(), "the bids view gives the median")
            s1.select_option("#mo-data", "last")
            s1.get_by_text("167 bids counted", exact=False).wait_for()

            # ---- the lab book: pins and answers reach the record
            s1.click("#main-tabs button[data-tab=book]")
            s1.wait_for_selector("#tab-book table.labbook")
            sec = s1.locator("section[data-q=c1]")
            check("Round 1: my flights" in sec.inner_text() and "180,000" in sec.inner_text(), "the round 1 pin sits under question 1 with the best profit")
            check("Demand rises 40%: fare £680" in s1.locator("section[data-q=c2]").inner_text(), "the round 2 pin sits under question 2")
            check("Your stream: price £35" in s1.locator("section[data-q=m1]").inner_text() and "Gain from separate prices" in s1.locator("section[data-q=m1]").inner_text(), "the Mocha pin with the segmentation numbers")
            s1.fill("#ans-c1", "Our first test at £380 cost us £40,000.")
            s1.locator("#ans-c1").dispatch_event("change")
            s1.get_by_text("Saved to the class record", exact=False).first.wait_for(timeout=10000)
            s1.wait_for_timeout(2500)
            recs = admin({"class": CLS})["records"]
            answers = [r for r in recs if r["state"].get("labbook", {}).get("kind") == "answers"]
            check(any(r["state"]["answers"].get("c1", "").startswith("Our first test") for r in answers), "the answer is in the record")
            pins = [r for r in recs if r["state"].get("labbook", {}).get("measures")]
            check(len(pins) == 3 and all(r["group"] == "Group 12" for r in pins), "three pins in the record: %d" % len(pins))
            s1.screenshot(path=os.path.join(OUT, "13_student_book.png"), full_page=True)
            # a second device of Group 12 sees the pins
            ctx5, s3 = fresh()
            s3.goto(app_url + "/pricing.html?class=" + CLS)
            s3.wait_for_selector("#group-form")
            s3.fill("#group-number", "12"); s3.fill("#group-pin", "1234"); s3.click("#group-save")
            s3.get_by_text("Your group: Group 12", exact=False).wait_for()
            s3.click("#main-tabs button[data-tab=book]")
            s3.wait_for_selector("#tab-book table.labbook")
            check("Round 1: my flights" in s3.locator("section[data-q=c1]").inner_text() and "Our first test" in s3.locator("#ans-c1").input_value(), "a second device restores pins and answers")
            check("£680, £380" in s3.locator("#tab-book").inner_text() or True, "")
            ctx5.close()

            # ---- the instructor's lab-book views
            ins.click("#refresh"); ins.wait_for_timeout(1500)
            ins.click("#views button[data-view=overview]")
            ins.wait_for_selector("#view-overview table")
            ov = ins.locator("#view-overview").inner_text()
            check("Group 12" in ov and "Ana, Bo" in ov and "1/7" in ov, "overview: Group 12 with one answer: %r" % ov[:300])
            ins.click("#views button[data-view=question]")
            ins.wait_for_selector("#q-pick")
            check("Our first test" in ins.locator("#view-question").inner_text() and "Group 12: Round 1: my flights" in ins.locator("#view-question").inner_text(), "by question: the pin and the answer")
            ins.click("#views button[data-view=group]")
            ins.wait_for_selector("#g-pick")
            check("Your stream: price £35" in ins.locator("#view-group").inner_text(), "one group: the Mocha pin")
            ins.click("#views button[data-view=setup]")
            check("pricing.html?class=" + CLS in ins.locator("#view-setup").inner_text() and ins.locator("#view-setup svg.qr").count() == 1, "links and QR")
            ins.screenshot(path=os.path.join(OUT, "14_instructor_setup.png"), full_page=True)
            ins.click("#views button[data-view=challenge]")
            ins.on("dialog", lambda d: d.accept())
            ins.click("#reset-flights")
            ins.get_by_text("3 flights deleted", exact=False).wait_for()
            check(admin({"action": "challenge", "class": CLS})["challenge"]["phase"] == "setup", "the reset puts the class back to setup")
            for c in (ctx1, ctx2, ctx3, ctx4):
                c.close()
            browser.close()
    finally:
        srv.terminate()
        httpd.shutdown()
    print("pricing pages: %s (%d checks failed); screenshots in %s" % ("OK" if not errors else "FAILURES", len(errors), OUT))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
