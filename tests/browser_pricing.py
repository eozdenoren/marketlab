"""Real-browser check of the Pricing Laboratory: docs/pricing.html, its projector mode and docs/pricing_instructor.html,
against the real backend/Pricing.gs served by tests/pricing_server.js (node vm, fake sheets). Three groups sign in with
their Marketplace Laboratory registrations: Groups 13 and 7 price the first route of the example set, Group 8 the
second. The instructor sets up and runs the challenge, the groups fly, the demand is revealed (the end of the challenge: there is no round 2), Mocha is
priced, pins and answers reach the record, the projector shows a board per route.
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
    json.dump({"marketlab_groups": [[CLS, "Group 13", "1234", "Ana, Bo", "2026-11-09T10:00:00Z"], [CLS, "Group 7", "0777", "", "2026-11-09T10:05:00Z"], [CLS, "Group 8", "0888", "", "2026-11-09T10:06:00Z"]], "password": "Sesame-42"}, open(seed, "w"))
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

            # ---- Group 13 signs in with its Marketplace registration
            ctx1, s1 = fresh()
            s1.goto(app_url + "/pricing.html?class=cm03aut26a")
            s1.wait_for_selector("#group-form")
            check(s1.url.endswith("?class=" + CLS), "the class code is cleaned in the address bar")
            s1.fill("#group-number", "13"); s1.fill("#group-pin", "1234"); s1.click("#group-save")
            s1.get_by_text("Your group: Group 13", exact=False).wait_for()
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
            ins.wait_for_selector("#settings .route-card")
            check(ins.locator("#preset").input_value() == "0" and "suggested for this class" in ins.locator("#preset").inner_text(), "the first class is offered the first set of routes")
            ins.select_option("#preset", "0")
            ins.get_by_text("Best fare £680", exact=False).first.wait_for()
            st = ins.locator("#view-challenge").inner_text()
            check(ins.locator("#settings .route-card").count() == 3 and "Best fare £800" in st and "Best fare £1,000" in st, "three routes, each with its best fare")
            check("2 registered teams: 7, 13" in st and "1 registered team: 8" in st, "the routes list their teams by group number: %r" % st[:600])
            check("1. Open round 1" in st and "3. Reveal the demand" in st and "round 2" not in st.lower(), "the steps are numbered, and the reveal is the last")
            check("script version 4 (" in ins.locator("#footer-status").inner_text() and ins.locator("#old-script").count() == 0, "the footer shows the script's version: %r" % ins.locator("#footer-status").inner_text())
            ins.evaluate("() => { var P = window.PricingLabInstructor; P.state.version = ''; P.render(); }")   # as if an old deployment had answered
            check(ins.locator("#old-script").count() == 1 and ins.locator("#save-settings").is_disabled() and "unknown (an old deployment)" in ins.locator("#footer-status").inner_text(), "an old deployment is called out and settings cannot be saved through it")
            ins.evaluate("() => { var P = window.PricingLabInstructor; P.state.version = '4 (test)'; P.render(); }")
            check(ins.locator("#old-script").count() == 0 and not ins.locator("#save-settings").is_disabled(), "with a version the warning goes")
            src = open(os.path.join(dist, "pricing_instructor.html")).read() + open(os.path.join(dist, "pricing.html")).read()
            check("London–Zanzibar" not in src and "a: 600" not in src and "PRESET_SETS" not in src, "the pages' source holds no preset routes: they come from the script after sign-in")
            ins.screenshot(path=os.path.join(OUT, "02_instructor_settings.png"), full_page=True)
            ins.click("#save-settings")
            ins.get_by_text("Settings saved", exact=False).wait_for()
            ins.click("button[data-phase=open]")
            ins.get_by_text("Round 1 open.", exact=False).wait_for()

            # ---- the student page picks the opening up by polling and flies
            s1.get_by_text("Fare for flight 1 of 6", exact=False).wait_for(timeout=15000)
            brief = s1.locator("#tab-challenge .briefing").inner_text()
            check("between London and Anchorage" in brief and "Your class is split across three routes" in brief, "Group 13 prices the first route and is told the class is split: %r" % brief[:400])
            check("WeezyJet has just opened the only direct flight between" in brief and "consulting teams" in brief and "trial flights" in brief
                  and "the next six flights" in brief and "after passenger costs" in brief and "£470" not in brief and "old fare" not in brief.lower(),
                  "the briefing: WeezyJet's new route, the consulting contest, the trial flights, six flights: %r" % brief[:500])
            s1.screenshot(path=os.path.join(OUT, "03_student_open.png"), full_page=True)
            s1.fill("#fare", "680"); s1.click("#fly")
            s1.get_by_text("Fare for flight 2 of 6", exact=False).wait_for()
            row = s1.locator("table.flights tbody tr").first.inner_text()
            check("£680" in row and "300" in row and "£180,000" in row and "+£20,000" in row, "flight 1: 680, 300 passengers, 180,000, +20,000: %r" % row)
            s1.fill("#fare", "280"); s1.click("#fly")
            s1.get_by_text("Fare for flight 3 of 6", exact=False).wait_for()
            row2 = s1.locator("table.flights tbody tr").nth(1).inner_text()
            check("500" in row2 and "(full)" in row2 and "-£60,000" in row2, "flight 2 fills the plane and loses 60,000: %r" % row2)
            check(s1.locator("table.flights td.best").count() == 0, "no fare is marked during the round, not even the group's best so far (here the best fare itself)")
            check("Group 13" in s1.locator("table.board").inner_text() and "Leaderboard: London–Anchorage" in s1.locator("#tab-challenge").inner_text(), "the student's leaderboard is its route's and lists the group")
            s1.screenshot(path=os.path.join(OUT, "04_student_flown.png"), full_page=True)

            # ---- Group 7 on a phone
            ctx3, s2 = fresh(width=390)
            s2.goto(app_url + "/pricing.html?class=" + CLS)
            s2.wait_for_selector("#group-form")
            s2.get_by_text("to see your route and its briefing", exact=False).wait_for(timeout=15000)
            check(s2.locator("table.routes tbody tr").count() == 3 and s2.locator("#fare").count() == 0, "before signing in: the three routes, no fare box")
            s2.fill("#group-number", "7"); s2.fill("#group-pin", "0777"); s2.click("#group-save")
            s2.get_by_text("Your group: Group 7", exact=False).wait_for()
            s2.wait_for_selector("#fare", timeout=15000)
            s2.fill("#fare", "700"); s2.click("#fly")
            s2.get_by_text("Fare for flight 2 of 6", exact=False).wait_for()
            s2.screenshot(path=os.path.join(OUT, "05_phone_flown.png"), full_page=True)
            check(s2.evaluate("document.documentElement.scrollWidth <= 390"), "the phone page does not overflow sideways")

            # ---- Group 8 prices the second route: its own numbers, its own board
            ctx6, s4 = fresh()
            s4.goto(app_url + "/pricing.html?class=" + CLS)
            s4.wait_for_selector("#group-form")
            s4.fill("#group-number", "8"); s4.fill("#group-pin", "0888"); s4.click("#group-save")
            s4.get_by_text("Your group: Group 8", exact=False).wait_for()
            s4.wait_for_selector("#fare", timeout=15000)
            brief4 = s4.locator("#tab-challenge .briefing").inner_text()
            check("between London and Zanzibar" in brief4 and "380 passengers at £550" in brief4 and "100 of the 480 seats" in brief4, "Group 8 is briefed on the second route: %r" % brief4[:400])
            s4.fill("#fare", "800"); s4.click("#fly")
            s4.get_by_text("Fare for flight 2 of 6", exact=False).wait_for()
            row4 = s4.locator("table.flights tbody tr").first.inner_text()
            check("280" in row4 and "£196,000" in row4 and "+£25,000" in row4, "Group 8 flies the second route's demand: 800 carries 280, +25,000: %r" % row4)
            b4 = s4.locator("table.board").inner_text()
            check("Group 8" in b4 and "Group 13" not in b4 and "Group 7" not in b4, "Group 8's board holds its route only: %r" % b4)
            s1.get_by_text("Group 7", exact=False).first.wait_for(timeout=15000)
            b1 = s1.locator("table.board").inner_text()
            check("Group 7" in b1 and "Group 8" not in b1, "Group 13's board holds Groups 13 and 7, not Group 8: %r" % b1)
            s4.screenshot(path=os.path.join(OUT, "05b_second_route.png"), full_page=True)

            # ---- the projector shows a board per route, without fares
            ctx4, proj = fresh(width=1400)
            proj.goto(app_url + "/pricing.html?class=" + CLS + "&projector=1")
            proj.wait_for_selector("table.board")
            ptxt = proj.locator("#tab-challenge").inner_text()
            check(proj.locator("#group-form").count() == 0 and "Fares" not in ptxt and "three new routes" in ptxt and "to see your route" not in ptxt, "the projector shows the contest, no sign-in, no fares yet")
            check(proj.locator(".route-card").count() == 3 and proj.locator("table.routes tbody tr").count() == 3, "three routes on the projector")
            board = proj.locator(".route-card").nth(0).locator("table.board tbody tr").all_inner_texts()
            check(len(board) == 2 and board[0].startswith("1\tGroup 7"), "first route: Group 7 leads with its one flight: %r" % board)
            board2 = proj.locator(".route-card").nth(1).locator("table.board tbody tr").all_inner_texts()
            check(len(board2) == 1 and "Group 8" in board2[0] and "No flights flown yet on this route" in proj.locator(".route-card").nth(2).inner_text(), "second route: Group 8; third: nobody yet: %r" % board2)
            check(proj.evaluate("document.documentElement.scrollWidth <= 1400"), "the projector page does not overflow sideways")
            proj.screenshot(path=os.path.join(OUT, "06_projector_board.png"), full_page=True)

            # ---- the instructor closes and reveals
            ins.click("button[data-phase=closed]"); ins.get_by_text("Round 1 closed.", exact=False).wait_for()
            s1.get_by_text("Round 1 is closed", exact=False).wait_for(timeout=15000)
            check(s1.locator("#fare").count() == 0, "no fare box after the close")
            ins.click("button[data-phase=revealed]"); ins.get_by_text("Demand revealed.", exact=False).wait_for()
            itxt = ins.locator("#view-challenge").inner_text()
            check("Leaderboards" in itxt and ins.locator("#view-challenge svg").count() == 8, "the instructor sees two settings charts per route and the profit curve of the two routes flown: %d svg" % ins.locator("#view-challenge svg").count())
            overall = ins.locator("table.overall tbody tr").all_inner_texts()
            check(len(overall) == 3 and "Group 8" in overall[0] and "London–Zanzibar" in overall[0] and "Group 13" in overall[2], "every team by its share of the possible gain: %r" % overall)
            check("Now: Demand revealed" in itxt, "the phase block says where the class is")
            ins.screenshot(path=os.path.join(OUT, "07_instructor_revealed.png"), full_page=True)
            s1.get_by_text("The demand you were facing", exact=False).wait_for(timeout=15000)
            txt = s1.locator("#tab-challenge").inner_text()
            check("640 − 0.5 × P" in txt and "£1,280" in txt and "best fare is £680" in txt, "the reveal states the demand and the best fare")
            check("Two points were enough" in txt, "the line through the status quo and the first flight is the demand")
            check(s1.locator("#tab-challenge svg").count() == 2, "two charts at the reveal")
            check("£680" not in s1.locator("table.board").inner_text() and "Fares" not in s1.locator("table.board").inner_text() and "Group 7" in s1.locator("table.board").inner_text(), "the board lists no fares, even once revealed")
            check(s1.locator("table.flights td.best").count() == 1 and "£680" in s1.locator("table.flights td.best").inner_text(), "after the reveal the group's most profitable flight is marked")
            s1.screenshot(path=os.path.join(OUT, "08_student_revealed.png"), full_page=True)
            proj.get_by_text("The demands the teams were facing", exact=False).wait_for(timeout=15000)
            card0 = proj.locator(".route-card").nth(0).inner_text()
            check(proj.locator("#tab-challenge svg").count() == 6 and "640 − 0.5 × P" in card0 and "Best fare £680" in card0 and "Flights flown" in card0,
                  "the projector shows each route's demand and two charts, with the flights as dots: %d svg, first route %r" % (proj.locator("#tab-challenge svg").count(), card0[:200]))
            pb = proj.locator(".route-card").nth(0).locator("table.board").inner_text()
            check("Group 7" in pb and "£700" not in pb and "Fares" not in pb, "the projector's boards list no fares: %r" % pb)
            check("600 − 0.4 × P" in proj.locator(".route-card").nth(1).inner_text() and "480 − 0.25 × P" in proj.locator(".route-card").nth(2).inner_text(), "the other two routes' demands")
            pov = proj.locator("table.overall tbody tr").all_inner_texts()
            check(len(pov) == 3 and "Group 8" in pov[0] and "17%" in pov[0], "the projector ranks every team by its share of the possible gain: %r" % pov)
            proj.screenshot(path=os.path.join(OUT, "09_projector_revealed.png"), full_page=True)
            # pin round 1
            s1.click("#challenge-pin")
            s1.get_by_text("Pinned as 'Round 1: my flights'", exact=False).wait_for()

            # ---- no round 2. A class left in that phase by an older page (the script still accepts it) reads as revealed
            req = urllib.request.Request(endpoint, data=json.dumps({"token": info["admin_token"], "action": "challenge_phase", "class": CLS, "phase": "round2"}).encode(), headers={"Content-Type": "text/plain"})
            check(json.load(urllib.request.urlopen(req))["ok"], "the script still accepts the old phase")
            s1.reload()
            s1.get_by_text("The demand you were facing", exact=False).wait_for(timeout=15000)
            t2 = s1.locator("#tab-challenge").inner_text()
            check("Round 2" not in t2 and "Demand revealed" in t2 and s1.locator("#challenge-pin").count() == 1 and s1.locator("#r2-form").count() == 0, "the old phase shows the reveal and the round 1 pin, nothing else: %r" % t2[:200])
            ins.click("#refresh"); ins.wait_for_timeout(1500)
            check("Now: Demand revealed" in ins.locator("#view-challenge").inner_text() and ins.locator("button[data-phase=round2]").count() == 0, "the instructor page has no round 2 step and calls the old phase revealed")
            s1.screenshot(path=os.path.join(OUT, "10_student_old_round2_phase.png"), full_page=True)

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
            check("Round 1: my flights" in sec.inner_text() and "180,000" in sec.inner_text() and "London–Anchorage" in sec.inner_text(), "the round 1 pin sits under question 1 with the route and the best profit")
            check(s1.locator("section[data-q=c2]").count() == 0 and s1.locator("section[data-q=c3]").count() == 0 and "2. Price Mocha for your stream" in s1.locator("#tab-book").inner_text(), "the lab book has no round 2 questions; Mocha starts at question 2")
            check("Your stream: price £35" in s1.locator("section[data-q=m1]").inner_text() and "Gain from separate prices" in s1.locator("section[data-q=m1]").inner_text(), "the Mocha pin with the segmentation numbers")
            s1.fill("#ans-c1", "Our first test at £280 cost us £60,000.")
            s1.locator("#ans-c1").dispatch_event("change")
            s1.get_by_text("Saved to the class record", exact=False).first.wait_for(timeout=10000)
            s1.wait_for_timeout(2500)
            recs = admin({"class": CLS})["records"]
            answers = [r for r in recs if r["state"].get("labbook", {}).get("kind") == "answers"]
            check(any(r["state"]["answers"].get("c1", "").startswith("Our first test") for r in answers), "the answer is in the record")
            pins = [r for r in recs if r["state"].get("labbook", {}).get("measures")]
            check(len(pins) == 2 and all(r["group"] == "Group 13" for r in pins), "two pins in the record: %d" % len(pins))
            s1.screenshot(path=os.path.join(OUT, "13_student_book.png"), full_page=True)
            # a second device of Group 13 sees the pins
            ctx5, s3 = fresh()
            s3.goto(app_url + "/pricing.html?class=" + CLS)
            s3.wait_for_selector("#group-form")
            s3.fill("#group-number", "13"); s3.fill("#group-pin", "1234"); s3.click("#group-save")
            s3.get_by_text("Your group: Group 13", exact=False).wait_for()
            s3.click("#main-tabs button[data-tab=book]")
            s3.wait_for_selector("#tab-book table.labbook")
            check("Round 1: my flights" in s3.locator("section[data-q=c1]").inner_text() and "Our first test" in s3.locator("#ans-c1").input_value(), "a second device restores pins and answers")
            ctx5.close()

            # ---- the instructor's lab-book views
            ins.click("#refresh"); ins.wait_for_timeout(1500)
            ins.click("#views button[data-view=overview]")
            ins.wait_for_selector("#view-overview table")
            ov = ins.locator("#view-overview").inner_text()
            check("Group 13" in ov and "Ana, Bo" in ov and "1/5" in ov, "overview: Group 13 with one answer: %r" % ov[:300])
            ins.click("#views button[data-view=question]")
            ins.wait_for_selector("#q-pick")
            check("Our first test" in ins.locator("#view-question").inner_text() and "Group 13: Round 1: my flights" in ins.locator("#view-question").inner_text(), "by question: the pin and the answer")
            ins.click("#views button[data-view=group]")
            ins.wait_for_selector("#g-pick")
            check("Your stream: price £35" in ins.locator("#view-group").inner_text(), "one group: the Mocha pin")
            ins.click("#views button[data-view=setup]")
            check("pricing.html?class=" + CLS in ins.locator("#view-setup").inner_text() and ins.locator("#view-setup svg.qr").count() == 1, "links and QR")
            ins.screenshot(path=os.path.join(OUT, "14_instructor_setup.png"), full_page=True)
            ins.click("#views button[data-view=challenge]")
            ins.on("dialog", lambda d: d.accept())
            ins.click("#reset-flights")
            ins.get_by_text("4 flights deleted", exact=False).wait_for()
            check(admin({"action": "challenge", "class": CLS})["challenge"]["phase"] == "setup", "the reset puts the class back to setup")
            for c in (ctx1, ctx2, ctx3, ctx4, ctx6):
                c.close()
            browser.close()
    finally:
        srv.terminate()
        httpd.shutdown()
    print("pricing pages: %s (%d checks failed); screenshots in %s" % ("OK" if not errors else "FAILURES", len(errors), OUT))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
