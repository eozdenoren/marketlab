"""Real-browser check of the Pricing Laboratory: docs/pricing.html, its projector mode and docs/pricing_instructor.html,
against the real backend/Pricing.gs served by tests/pricing_server.js (node vm, fake sheets). Three groups sign in with
their Marketplace Laboratory registrations: Groups 13 and 7 fly the first route of the example set, Group 8 the
second. A team chooses the seats to sell; the fare follows. The instructor sets up and runs the challenge, the groups fly, the demand is revealed (the end of the challenge: there is no round 2), Mocha is
priced, the projector shows a board per route. There is no lab book: nothing is pinned, and the only things the
pages send to the record are registrations and flights.
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

            # ---- the instructor sets up the challenge and opens it
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
            ins.get_by_text("Best: 300 seats at £680", exact=False).first.wait_for()
            st = ins.locator("#view-challenge").inner_text()
            check(ins.locator("#settings .route-card").count() == 3 and "Best: 280 seats at £800" in st and "Best: 230 seats at £1,000" in st and "fare = 1,280 − 2 × Q" in st, "three routes, each with its hidden demand and its best seats")
            check("2 registered teams: 7, 13" in st and "1 registered team: 8" in st, "the routes list their teams by group number: %r" % st[:600])
            check(ins.locator("#settings details[data-route]").count() == 3 and ins.locator("#settings details[data-route][open]").count() == 0 and not ins.locator("#f-mc-0").is_visible(),
                  "each route's numbers and charts are folded away")
            ins.locator("#settings details[data-route] summary").first.click()
            check(ins.locator("#f-mc-0").is_visible() and ins.locator("#f-mc-0").input_value() == "80", "and unfold on a click")
            ins.locator("#settings details[data-route] summary").first.click()
            check("1. Open the challenge" in st and "3. Reveal the demand" in st and "round" not in st.lower(), "the steps are numbered, the reveal is the last, and nothing is called a round")
            check("script version 5 (" in ins.locator("#footer-status").inner_text() and ins.locator("#old-script").count() == 0, "the footer shows the script's version: %r" % ins.locator("#footer-status").inner_text())
            ins.evaluate("() => { var P = window.PricingLabInstructor; P.state.version = ''; P.render(); }")   # as if an old deployment had answered
            check(ins.locator("#old-script").count() == 1 and ins.locator("#save-settings").is_disabled() and "unknown (an old deployment)" in ins.locator("#footer-status").inner_text(), "an old deployment is called out and settings cannot be saved through it")
            ins.evaluate("() => { var P = window.PricingLabInstructor; P.state.version = '4 (13 Nov 2026)'; P.render(); }")
            check(ins.locator("#old-script").count() == 1 and "version 4" in ins.locator("#old-script").inner_text() and ins.locator("#save-settings").is_disabled(), "version 4, which takes fares, is called out too")
            ins.evaluate("() => { var P = window.PricingLabInstructor; P.state.version = '5 (test)'; P.render(); }")
            check(ins.locator("#old-script").count() == 0 and not ins.locator("#save-settings").is_disabled(), "with version 5 the warning goes")
            src = open(os.path.join(dist, "pricing_instructor.html")).read() + open(os.path.join(dist, "pricing.html")).read()
            check("London–Zanzibar" not in src and "a: 600" not in src and "PRESET_SETS" not in src, "the pages' source holds no preset routes: they come from the script after sign-in")
            ins.screenshot(path=os.path.join(OUT, "02_instructor_settings.png"), full_page=True)
            ins.click("#save-settings")
            ins.get_by_text("Settings saved", exact=False).wait_for()
            ins.click("button[data-phase=open]")
            ins.get_by_text("Now: Open", exact=False).wait_for()

            # ---- the student page picks the opening up by polling and flies: it chooses the seats, the fare follows
            s1.get_by_text("Seats to sell on flight 1 of 6", exact=False).wait_for(timeout=15000)
            brief = s1.locator("#tab-challenge .briefing").inner_text()
            check("Your route: London–Anchorage" in s1.locator("#tab-challenge").inner_text() and "between London and Anchorage" in brief and "Your class is split across three routes" in brief, "Group 13 flies the first route and is told the class is split: %r" % brief[:400])
            check("WeezyJet has just opened the only direct flight between" in brief and "The flight operates once a week" in brief and "does not know the exact demand" in brief
                  and "the more seats it sells on a flight, the lower the fare has to be" in brief and "all passengers on a flight pay the same fare" in brief
                  and "So far it has run one trial flight" in brief and "consulting teams" in brief and "It gave the teams the following information" in brief,
                  "the preamble: the new weekly route, what WeezyJet knows (more seats, a lower fare; one fare for all), one trial flight, the consulting teams: %r" % brief[:600])
            facts = s1.locator("#tab-challenge .briefing ul.facts").inner_text()
            check(s1.locator("#tab-challenge .briefing ul.facts li").count() == 4 and "The plane has 500 seats" in facts and "The trial flight sold 400 seats at a fare of £480, so 100 seats flew empty" in facts
                  and "Each passenger costs £80" in facts and "the trial flight made £160,000" in facts and s1.locator("#tab-challenge .briefing .metrics").count() == 0,
                  "what the teams were told is a list of four lines, with no tiles of large numbers: %r" % facts)
            how = s1.locator("#how").inner_text()
            check(s1.locator("#how").get_attribute("open") is not None and "the next six flights" in how and "how many seats to sell (1 to 500)" in how and "the highest fare at which that many people buy" in how
                  and "minus six times the trial flight's profit" in how and "the team with the highest score wins" in how and len(brief.split()) <= 260,
                  "how the challenge works is a short list, open before the first flight (%d words in all): %r" % (len(brief.split()), how[:300]))
            s1.screenshot(path=os.path.join(OUT, "03_student_open.png"), full_page=True)
            s1.fill("#seats", "501"); s1.click("#fly")
            s1.get_by_text("a whole number from 1 to 500", exact=False).wait_for()
            check(s1.locator("table.flights").count() == 0, "more seats than the plane has are not flown")
            s1.fill("#seats", "300"); s1.click("#fly")
            s1.get_by_text("Seats to sell on flight 2 of 6", exact=False).wait_for()
            row = s1.locator("table.flights tbody tr").first.inner_text()
            check("300" in row and "£680" in row and "£204,000" in row and "£180,000" in row and "+£20,000" in row, "flight 1: 300 seats sell at 680, revenue 204,000, profit 180,000, +20,000: %r" % row)
            check("to sell 300 seats the fare was £680" in s1.locator("#last-flight").inner_text() and s1.locator("#how").get_attribute("open") is None, "the flight is put in a sentence, and the rules fold away once the team has flown")
            s1.fill("#seats", "500"); s1.click("#fly")
            s1.get_by_text("Seats to sell on flight 3 of 6", exact=False).wait_for()
            row2 = s1.locator("table.flights tbody tr").nth(1).inner_text()
            check("500" in row2 and "(full)" in row2 and "£280" in row2 and "-£60,000" in row2, "flight 2 fills the plane at 280 and loses 60,000: %r" % row2)
            check(s1.locator("table.flights td.best").count() == 0, "nothing is marked during the challenge, not even the group's best so far (here the best there is)")
            check("Group 13" in s1.locator("table.board").inner_text() and "Leaderboard: London–Anchorage" in s1.locator("#tab-challenge").inner_text(), "the student's leaderboard is its route's and lists the group")
            s1.screenshot(path=os.path.join(OUT, "04_student_flown.png"), full_page=True)

            # ---- Group 7 on a phone
            ctx3, s2 = fresh(width=390)
            s2.goto(app_url + "/pricing.html?class=" + CLS)
            s2.wait_for_selector("#group-form")
            s2.get_by_text("to see your own route and fly", exact=False).wait_for(timeout=15000)
            check(s2.locator("table.routes tbody tr").count() == 3 and s2.locator("#seats").count() == 0, "before signing in: the three routes, no box for the seats")
            s2.fill("#group-number", "7"); s2.fill("#group-pin", "0777"); s2.click("#group-save")
            s2.get_by_text("Your group: Group 7", exact=False).wait_for()
            s2.wait_for_selector("#seats", timeout=15000)
            s2.fill("#seats", "290"); s2.click("#fly")
            s2.get_by_text("Seats to sell on flight 2 of 6", exact=False).wait_for()
            check("£700" in s2.locator("table.flights tbody tr").first.inner_text(), "290 seats sell at 700")
            s2.screenshot(path=os.path.join(OUT, "05_phone_flown.png"), full_page=True)
            check(s2.evaluate("document.documentElement.scrollWidth <= 390"), "the phone page does not overflow sideways")

            # ---- Group 8 flies the second route: its own numbers, its own board
            ctx6, s4 = fresh()
            s4.goto(app_url + "/pricing.html?class=" + CLS)
            s4.wait_for_selector("#group-form")
            s4.fill("#group-number", "8"); s4.fill("#group-pin", "0888"); s4.click("#group-save")
            s4.get_by_text("Your group: Group 8", exact=False).wait_for()
            s4.wait_for_selector("#seats", timeout=15000)
            brief4 = s4.locator("#tab-challenge .briefing").inner_text()
            check("between London and Zanzibar" in brief4 and "sold 380 seats at a fare of £550, so 100 seats flew empty" in brief4 and "(1 to 480)" in brief4, "Group 8 is briefed on the second route: %r" % brief4[:400])
            s4.fill("#seats", "280"); s4.click("#fly")
            s4.get_by_text("Seats to sell on flight 2 of 6", exact=False).wait_for()
            row4 = s4.locator("table.flights tbody tr").first.inner_text()
            check("£800" in row4 and "£196,000" in row4 and "+£25,000" in row4, "Group 8 flies the second route's demand: 280 seats sell at 800, +25,000: %r" % row4)
            b4 = s4.locator("table.board").inner_text()
            check("Group 8" in b4 and "Group 13" not in b4 and "Group 7" not in b4, "Group 8's board holds its route only: %r" % b4)
            s1.get_by_text("Group 7", exact=False).first.wait_for(timeout=15000)
            b1 = s1.locator("table.board").inner_text()
            check("Group 7" in b1 and "Group 8" not in b1, "Group 13's board holds Groups 13 and 7, not Group 8: %r" % b1)
            s4.screenshot(path=os.path.join(OUT, "05b_second_route.png"), full_page=True)

            # ---- the projector shows a board per route, and nothing a team flew
            ctx4, proj = fresh(width=1400)
            proj.goto(app_url + "/pricing.html?class=" + CLS + "&projector=1")
            proj.wait_for_selector("table.board")
            ptxt = proj.locator("#tab-challenge").inner_text()
            check(proj.locator("#group-form").count() == 0 and "three new routes" in ptxt and "to see your own route" not in ptxt and proj.locator(".route-card").nth(0).locator("table.board th").count() == 4 and "290" not in proj.locator(".route-card").nth(0).inner_text(),
                  "the projector shows the story, no sign-in, and neither seats nor fares flown")
            check(proj.locator(".route-card").count() == 3 and proj.locator("table.routes tbody tr").count() == 3 and proj.locator("#how").get_attribute("open") is None, "three routes on the projector; the rules are folded once the challenge is open")
            board = proj.locator(".route-card").nth(0).locator("table.board tbody tr").all_inner_texts()
            check(len(board) == 2 and board[0].startswith("1\tGroup 7"), "first route: Group 7 leads with its one flight: %r" % board)
            board2 = proj.locator(".route-card").nth(1).locator("table.board tbody tr").all_inner_texts()
            check(len(board2) == 1 and "Group 8" in board2[0] and "No flights flown yet on this route" in proj.locator(".route-card").nth(2).inner_text(), "second route: Group 8; third: nobody yet: %r" % board2)
            check(proj.evaluate("document.documentElement.scrollWidth <= 1400"), "the projector page does not overflow sideways")
            proj.screenshot(path=os.path.join(OUT, "06_projector_board.png"), full_page=True)

            # ---- the instructor closes and reveals
            ins.click("button[data-phase=closed]"); ins.get_by_text("Now: Closed", exact=False).wait_for()
            s1.get_by_text("The challenge is closed", exact=False).wait_for(timeout=15000)
            check(s1.locator("#seats").count() == 0, "no box for the seats after the close")
            ins.click("button[data-phase=revealed]"); ins.get_by_text("Now: Demand revealed", exact=False).wait_for()
            itxt = ins.locator("#view-challenge").inner_text()
            check("Leaderboards" in itxt and ins.locator("#view-challenge svg").count() == 8, "the instructor has two settings charts per route (folded) and the profit curve of the two routes flown: %d svg" % ins.locator("#view-challenge svg").count())
            check("300, 500" in itxt and "300 at £680" in itxt and "Seats sold, flight by flight" in itxt, "the instructor's boards list each team's seats, flight by flight, and its best flight")
            overall = ins.locator("table.overall tbody tr").all_inner_texts()
            check(len(overall) == 3 and "Group 8" in overall[0] and "London–Zanzibar" in overall[0] and "Group 13" in overall[2], "every team by its share of the possible gain: %r" % overall)
            ins.screenshot(path=os.path.join(OUT, "07_instructor_revealed.png"), full_page=True)
            s1.get_by_text("The demand on your route", exact=False).wait_for(timeout=15000)
            txt = s1.locator("#tab-challenge").inner_text()
            check("1,280 − 2 × Q" in txt and "nobody flies above £1,280" in txt and "each extra seat lowers the fare by £2" in txt, "the reveal states the demand as the slides write it: %r" % txt[:400])
            rt = s1.locator("#tab-challenge .metrics").first.inner_text()
            check("300" in rt and "200 seats left empty" in rt and "£680" in rt and "£180,000" in rt and "£20,000 more than the trial flight" in rt and "the best there is" in rt, "four tiles: the best seats, its fare, its profit, and the team's own best flight: %r" % rt)
            check("A full plane (500 seats) needs a fare of £280 and makes £100,000" in txt and "25 seats too many or too few costs £1,250" in txt, "the full plane and the cost of a small error")
            check("Two points give a line" in txt and "your first flight (300 seats at £680)" in txt and "the demand itself" in txt, "the line through the trial flights and the first flight is the demand")
            check(s1.locator("#tab-challenge svg").count() == 2 and "Seats sold" in s1.locator("#tab-challenge svg").first.text_content(), "two charts at the reveal, the profit against the seats sold")
            check("£680" not in s1.locator("table.board").inner_text() and "300" not in s1.locator("table.board").inner_text() and "Group 7" in s1.locator("table.board").inner_text(), "the board lists neither seats nor fares, even once revealed")
            check(s1.locator("table.flights td.best").count() == 1 and "300" in s1.locator("table.flights td.best").inner_text() and "+200" in s1.locator("table.flights tbody tr").nth(1).inner_text(), "after the reveal the group's most profitable flight is marked, and each flight is set against the best seats")
            s1.screenshot(path=os.path.join(OUT, "08_student_revealed.png"), full_page=True)
            proj.get_by_text("The demands the teams were facing", exact=False).wait_for(timeout=15000)
            card0 = proj.locator(".route-card").nth(0).inner_text()
            check(proj.locator("#tab-challenge svg").count() == 6 and "1,280 − 2 × Q" in card0 and "Best: 300 seats at £680" in card0 and "Flights flown" in card0,
                  "the projector shows each route's demand and two charts, with the flights as dots: %d svg, first route %r" % (proj.locator("#tab-challenge svg").count(), card0[:200]))
            check(proj.locator(".route-card").nth(0).locator(".reveal-line").count() == 2, "a route's card says two things: its demand, and the best")
            pb = proj.locator(".route-card").nth(0).locator("table.board").inner_text()
            check("Group 7" in pb and "£700" not in pb and "290" not in pb, "the projector's boards list nothing a team flew: %r" % pb)
            check("1,500 − 2.5 × Q" in proj.locator(".route-card").nth(1).inner_text() and "1,920 − 4 × Q" in proj.locator(".route-card").nth(2).inner_text(), "the other two routes' demands")
            pov = proj.locator("table.overall tbody tr").all_inner_texts()
            check(len(pov) == 3 and "Group 8" in pov[0] and "17%" in pov[0], "the projector ranks every team by its share of the possible gain: %r" % pov)
            proj.screenshot(path=os.path.join(OUT, "09_projector_revealed.png"), full_page=True)
            check(s1.locator("#challenge-pin").count() == 0 and s1.locator("#main-tabs button").count() == 2 and s1.locator("#tab-book").count() == 0 and "lab book" not in s1.locator("body").inner_text().lower(),
                  "no lab book: no pin after the reveal, two tabs, the words nowhere on the page")

            # ---- no round 2. A class left in that phase by an older page (the script still accepts it) reads as revealed
            req = urllib.request.Request(endpoint, data=json.dumps({"token": info["admin_token"], "action": "challenge_phase", "class": CLS, "phase": "round2"}).encode(), headers={"Content-Type": "text/plain"})
            check(json.load(urllib.request.urlopen(req))["ok"], "the script still accepts the old phase")
            s1.reload()
            s1.get_by_text("The demand on your route", exact=False).wait_for(timeout=15000)
            t2 = s1.locator("#tab-challenge").inner_text()
            check("Round 2" not in t2 and "Demand revealed" in t2 and s1.locator("#challenge-pin").count() == 0 and s1.locator("#r2-form").count() == 0 and s1.locator("table.flights tbody tr").count() >= 1,
                  "the old phase shows the reveal with the group's flights, nothing else: %r" % t2[:200])
            ins.click("#refresh"); ins.wait_for_timeout(1500)
            check("Now: Demand revealed" in ins.locator("#view-challenge").inner_text() and ins.locator("button[data-phase=round2]").count() == 0, "the instructor page has no round 2 step and calls the old phase revealed")
            s1.screenshot(path=os.path.join(OUT, "10_student_old_round2_phase.png"), full_page=True)

            # ---- Mocha: three ways to choose the price (every price, one line, two lines), on this year's bids only.
            # The bids at 50, the most the auction accepted, are left out to start with; the lines' prices are
            # charged to the nearest pound.
            def results():
                return s1.locator("#mo-results").inner_text()

            def method_rows():
                return s1.locator("table.methods tbody tr").all_inner_texts()

            s1.click("#main-tabs button[data-tab=mocha]")
            s1.wait_for_selector("#mo-results")
            check("Your stream (Stream A, 69 bids)" in s1.locator("#mo-data").inner_text() and s1.locator("#mo-data").input_value() == "mine", "the group's own stream is the default data")
            check("Last year" not in s1.locator("#mo-data").inner_text() and s1.locator("#mo-data option").count() == 5 and s1.locator("#mo-data option").last.inner_text() == "A made-up market with two kinds of buyer (132 bids)", "the bids are this year's streams, and a made-up market last: %r" % s1.locator("#mo-data").inner_text())
            check(s1.locator("#mo-note").is_hidden(), "nothing is said about made-up bids while the class's own are in view")
            check(s1.locator("#mo-cap").is_checked() and s1.locator("#mo-cap-row").inner_text().strip() == "Leave out the 6 bids at £50, the most the auction accepted", "the bids at the cap are left out to start with, in view: %r" % s1.locator("#mo-cap-row").inner_text())
            check(s1.locator("#mo-count").inner_text() == "63 of 69 bids counted", "how many bids count is in view: %r" % s1.locator("#mo-count").inner_text())
            check(s1.locator("#mo-results .tabs.inner button").all_inner_texts() == ["1. Every price", "2. One line", "3. Two lines", "The bids", "Three streams"], "the three methods, the bids and the streams: %r" % s1.locator("#mo-results .tabs.inner button").all_inner_texts())
            s1.fill("#mo-price", "25"); s1.press("#mo-price", "Enter"); s1.locator("#mo-price").dispatch_event("change")
            s1.get_by_text("Buyers at £25", exact=False).wait_for()
            mt = results()
            check("33% of 63 bids" in mt and "£210" in mt and "Best price on these bids: £25" in mt, "price 25 on stream A's 63 bids at cost 15: 21 buyers, 210, which is the best: %r" % mt[:200])
            rows = method_rows()
            check(len(rows) == 3 and rows[0].split() == ["1.", "Every", "price", "tried", "£25", "21", "£210", "100%"] and rows[1].split() == ["2.", "One", "line", "£27", "15", "£180", "86%"]
                  and rows[2].split() == ["3.", "Two", "lines,", "split", "at", "£33", "£25", "21", "£210", "100%"], "the three methods side by side: %r" % rows)
            check(s1.locator("table.methods tr.me").inner_text().startswith("1. Every price"), "the method in view is marked in the table")
            check(s1.locator("#mo-line").count() == 0 and s1.locator("#mo-results svg").count() == 2, "no tick box for the line; the demand and the profit charts")
            lg = s1.locator("#mo-results .legend").last.inner_text()
            check("Profit at each whole-pound price" in lg and "expects" not in lg, "the profit chart: whole-pound prices, and no line's hill on the first view: %r" % lg)
            s1.screenshot(path=os.path.join(OUT, "11_student_mocha.png"), full_page=True)
            s1.click("#mo-results button[data-inner=line]")
            s1.get_by_text("P = 39.68 − 0.679 Q", exact=False).first.wait_for()
            lt = results()
            check("MR = MC:" in lt and "Midpoint rule:" in lt and lt.count("£27.34") >= 2 and "The line expects 18 buyers and a profit of £224 there." in lt, "one line: MR = MC and the midpoint rule give the same 27.34: %r" % lt[:400])
            check("the price to charge is the nearest pound, £27. On the actual bids it sells 15 and earns £180, 86% of the best." in lt, "the line's price is charged to the nearest pound: %r" % lt[-700:])
            check(s1.locator("table.methods tr.me").inner_text().startswith("2. One line"), "the line's row is marked")
            check("What the line expects" in s1.locator("#mo-results .legend").last.inner_text(), "the line's view shows the profit hill the line expects")
            s1.screenshot(path=os.path.join(OUT, "11b_student_mocha_one_line.png"), full_page=True)
            s1.click("#mo-results button[data-inner=two]")
            s1.wait_for_selector("#mo-split")
            tw = results()
            check(s1.locator("#mo-split").input_value() == "33" and s1.locator("#mo-split-auto").is_disabled(), "the split starts at the best-fitting one, 33")
            lg = s1.locator("#mo-results .legend").last.inner_text()
            check("What the high line expects" in lg and "What the low line expects" in lg, "the two lines' view shows the hill each line expects: %r" % lg)
            check("P = 43.97 − 1.252 Q" in tw and "P = 35.02 − 0.568 Q" in tw and "below the split, where this line does not hold: the segment's best price is the split, £33" in tw, "two lines on stream A, the high line's midpoint below the split: %r" % tw[:600])
            check("The lines expect more from the low segment" in tw and "so the two lines say £25.01. The bids are in whole pounds, so the price to charge is the nearest pound, £25. On the actual bids it sells 21 and earns £210, 100% of the best." in tw, "the two lines' price, charged as 25: %r" % tw[-700:])
            s1.screenshot(path=os.path.join(OUT, "11c_student_mocha_two_lines.png"), full_page=True)
            s1.fill("#mo-split", "40"); s1.locator("#mo-split").dispatch_event("change")
            s1.get_by_text("split at £40", exact=False).first.wait_for()
            tw = results()
            check("so the two lines say £26.14" in tw and "nearest pound, £26" in tw and "84% of the best" in tw and not s1.locator("#mo-split-auto").is_disabled(), "moving the split to 40 moves the price to 26: %r" % tw[:500])
            s1.fill("#mo-split", "44"); s1.locator("#mo-split").dispatch_event("change")
            s1.get_by_text("Two lines cannot be fitted with the split at £44", exact=False).wait_for()
            check("between £3 and £40" in results() and "no line can be fitted" in method_rows()[2], "a split that cannot be fitted says so and names the range")
            s1.click("#mo-split-auto")
            s1.get_by_text("so the two lines say £25.01", exact=False).wait_for()
            check(s1.locator("#mo-split").input_value() == "33", "back to the best-fitting split")
            # the box unticked: the 6 bids at 50 count again, and everything moves
            s1.locator("#mo-cap-text").click()          # on the words, as a person does
            s1.get_by_text("so the two lines say £35.24", exact=False).wait_for()
            check(not s1.locator("#mo-cap").is_checked() and s1.locator("#mo-count").inner_text() == "69 bids counted", "the box unticked: all 69 bids counted: %r" % s1.locator("#mo-count").inner_text())
            rows = method_rows()
            check("of 69 bids" in results() and rows[0].split()[-4:] == ["£35", "14", "£280", "100%"] and rows[1].split()[-4:] == ["£30", "17", "£255", "91%"] and rows[2].split()[-5:] == ["£32", "£35", "14", "£280", "100%"],
                  "with the bids at 50 counted: 35, then the line's 30 at 91 per cent, then the two lines' 35: %r" % rows)
            s1.select_option("#mo-data", "CM03AUT26C")
            s1.get_by_text("above the highest bid (£50)", exact=False).wait_for()
            tw = results()
            check(s1.locator("#mo-split").input_value() == "40" and "so the two lines say £50. On the actual bids that price sells 7 and earns £245, 90% of the best." in tw and s1.locator("#mo-cap-row").inner_text().strip().startswith("Leave out the 7 bids at £50"),
                  "stream C with its 7 bids at 50 counted: a line does not price above the highest bid: %r" % tw[:500])
            s1.check("#mo-cap")
            s1.select_option("#mo-data", "all")
            s1.get_by_text("so the two lines say £24.41", exact=False).wait_for()
            rows = method_rows()
            check(s1.locator("#mo-cap-row").inner_text().strip().startswith("Leave out the 18 bids at £50") and "of 167 bids" in results() and rows[0].split()[-4:] == ["£25", "49", "£490", "100%"] and rows[1].split()[-4:] == ["£28", "35", "£455", "93%"]
                  and "split at £31" in rows[2] and rows[2].split()[-4:] == ["£24", "49", "£441", "90%"], "all three streams without the 18 bids at 50: %r" % rows)
            s1.screenshot(path=os.path.join(OUT, "11d_student_mocha_two_lines_all.png"), full_page=True)
            # the made-up market with two kinds of buyer: one line fails, two lines do not
            s1.select_option("#mo-data", "madeup")
            s1.get_by_text("so the two lines say £37.58", exact=False).wait_for()
            rows = method_rows()
            note = s1.locator("#mo-note").inner_text()
            check(s1.locator("#mo-note").is_visible() and "Made up" in note and "20 fans who would pay £38 to £57 (one at each pound) and 112 others who would pay £1 to £14 (eight at each pound)" in note, "the made-up market says what it is: %r" % note)
            check(s1.locator("#mo-cap-row").is_hidden() and s1.locator("#mo-count").inner_text() == "132 bids counted" and s1.locator("#mo-split").input_value() == "27", "no cap in a made-up market; 132 bids; the split at 27")
            check(rows[0].split()[-4:] == ["£38", "20", "£460", "100%"] and rows[1].split()[-4:] == ["£28", "20", "£260", "57%"] and rows[2].split()[-4:] == ["£38", "20", "£460", "100%"], "one line gets 57 per cent of the best there, two lines all of it: %r" % rows)
            s1.screenshot(path=os.path.join(OUT, "11e_student_mocha_made_up.png"), full_page=True)
            s1.reload()
            s1.wait_for_selector("#mo-results table.methods")
            check(s1.locator("#mo-data").input_value() == "mine" and s1.locator("#mo-note").is_hidden() and s1.locator("#mo-count").inner_text() == "63 of 69 bids counted", "a new visit starts on the class's own bids, not on the made-up market")
            s1.fill("#mo-price", "25"); s1.press("#mo-price", "Enter")
            s1.get_by_text("Buyers at £25", exact=False).wait_for()
            # a number typed in a box and then, without Enter, a press on a view's button: the box's change redraws the
            # results at that press, and the button must still act (it used to take a second click)
            s1.click("#mo-results button[data-inner=direct]")
            s1.fill("#mo-price", "28")
            s1.click("#mo-results button[data-inner=line]")
            s1.get_by_text("MR = MC:", exact=False).wait_for(timeout=5000)
            check("Buyers at £28" in results() and s1.locator("#mo-results .tabs.inner button.active").inner_text() == "2. One line", "a price typed and a view pressed straight after: both take effect")
            s1.click("#mo-results button[data-inner=two]")
            s1.fill("#mo-split", "25")
            s1.click("#mo-results button[data-inner=direct]")
            s1.get_by_text("With every bid known", exact=False).wait_for(timeout=5000)
            check("split at £25" in method_rows()[2] and method_rows()[2].split()[-4:] == ["£29", "11", "£154", "73%"], "a split typed and another view pressed: the split is kept: %r" % method_rows()[2])
            s1.click("#mo-results button[data-inner=two]")
            s1.fill("#mo-split", "27")
            s1.click("#mo-split-auto")
            s1.get_by_text("so the two lines say £25.01", exact=False).wait_for(timeout=5000)
            check(s1.locator("#mo-split").input_value() == "33" and s1.locator("#mo-split-auto").is_disabled(), "a split typed and 'Best-fitting split' pressed straight after: the best-fitting one")
            s1.fill("#mo-price", "25"); s1.press("#mo-price", "Enter")
            s1.click("#mo-results button[data-inner=segments]")
            s1.get_by_text("Gain from a price per market: £18", exact=False).wait_for()
            check(s1.locator("#mo-fourth").count() == 0 and "Last year" not in s1.locator("#tab-mocha").inner_text() and "the 18 bids at £50 left out" in results(), "the streams view: no fourth market from last year, and the bids at 50 left out there too: %r" % results()[:200])
            s1.screenshot(path=os.path.join(OUT, "12_student_segments.png"), full_page=True)
            s1.uncheck("#mo-cap")
            s1.get_by_text("Gain from a price per market: £125", exact=False).wait_for()
            s1.check("#mo-cap")
            s1.get_by_text("Gain from a price per market: £18", exact=False).wait_for()
            check(s1.locator("#mocha-pin").count() == 0 and s1.locator("#mocha-pin-wrap").count() == 0, "nothing to pin on the Mocha tab")
            s1.click("#mo-results button[data-inner=bids]")
            s1.wait_for_selector("#mo-results svg")
            bt = results()
            check("63 bids counted (the 6 bids at £50 left out); median £15, highest £46" in bt and "A bid of the most allowed says “at any price”, not what the student would pay; untick the box on the left to count them all the same." in bt, "the bids view says what is left out and why: %r" % bt[-500:])
            s1.screenshot(path=os.path.join(OUT, "12b_student_bids.png"), full_page=True)
            s1.uncheck("#mo-cap")
            s1.get_by_text("69 bids counted (none left out); median £17", exact=False).wait_for()
            check("The 6 bids at £50, the most the auction accepted, are counted" in results(), "and, unticked, that they are counted")
            s1.check("#mo-cap")
            s1.get_by_text("63 bids counted", exact=False).wait_for()
            check(not s1.locator("#mo-zero").is_visible(), "the other bids to ignore are folded away until wanted")
            s1.click("#mo-ignore summary")
            s1.check("#mo-zero")
            s1.get_by_text("62 bids counted", exact=False).wait_for()
            s1.fill("#mo-above", "-1"); s1.locator("#mo-above").dispatch_event("change")
            s1.get_by_text("No bids are left", exact=False).wait_for()
            s1.fill("#mo-above", ""); s1.locator("#mo-above").dispatch_event("change"); s1.uncheck("#mo-zero")
            s1.get_by_text("63 bids counted", exact=False).wait_for()

            # ---- nothing but registrations and flights reached the record; an address with the old tab still opens
            s1.wait_for_timeout(1500)
            recs = admin({"class": CLS})["records"]
            check(recs == [], "the pages sent no lab-book records: %r" % recs[:2])
            s1.goto(app_url + "/pricing.html?class=" + CLS + "&tab=book")
            s1.get_by_text("The demand on your route", exact=False).wait_for(timeout=15000)
            check(not s1.locator("#tab-challenge").is_hidden() and s1.locator("#main-tabs button.active").inner_text() == "Challenge", "an old link to the Lab book tab opens the Challenge tab")
            s1.goto(app_url + "/pricing.html?class=" + CLS + "&tab=mocha")
            s1.wait_for_selector("#mo-results")
            check(not s1.locator("#tab-mocha").is_hidden() and s1.locator("#tab-challenge").is_hidden(), "the address can open the Mocha tab directly")
            s1.screenshot(path=os.path.join(OUT, "13_student_mocha_link.png"), full_page=True)
            # a second device of Group 13 sees the group's flights and the reveal
            ctx5, s3 = fresh()
            s3.goto(app_url + "/pricing.html?class=" + CLS)
            s3.wait_for_selector("#group-form")
            s3.fill("#group-number", "13"); s3.fill("#group-pin", "1234"); s3.click("#group-save")
            s3.get_by_text("Your group: Group 13", exact=False).wait_for()
            s3.get_by_text("The demand on your route", exact=False).wait_for(timeout=15000)
            check(s3.locator("table.flights tbody tr").count() >= 1 and "1,280 − 2 × Q" in s3.locator("#tab-challenge").inner_text(), "a second device of the group sees its flights and the reveal")
            # with no group, the Mocha tab still works (the instructor's demonstration, a student at home)
            ctx7, s5 = fresh()
            s5.goto(app_url + "/pricing.html?class=" + CLS + "&tab=mocha")
            s5.wait_for_selector("#mo-results")
            s5.fill("#mo-price", "35"); s5.locator("#mo-price").dispatch_event("change")
            s5.get_by_text("Buyers at £35", exact=False).wait_for()
            check("Best price on these bids: £25" in s5.locator("#mo-results").inner_text() and "8" in s5.locator("#mo-results .metric .value").first.inner_text() and s5.locator("#group-form").count() == 1, "Mocha works without signing in")
            # what an older page stored (last year's bids, the one "Pricing" view, the line's tick box) opens the first method
            s5.evaluate("(k) => localStorage.setItem(k, JSON.stringify({tab: 'mocha', mocha: {dataset: 'last', cost: 15, price: '20', dropZero: true, above: '49', showLine: true, inner: 'pricing', fourth: true}}))", "pricinglab:" + CLS + ":_")
            s5.reload()
            s5.wait_for_selector("#mo-results table.methods")
            check(s5.locator("#mo-data").input_value() == "mine" and s5.locator("#mo-results .tabs.inner button.active").inner_text() == "1. Every price" and "Buyers at £20" in s5.locator("#mo-results").inner_text() and s5.locator("#mo-cap").is_checked(), "a browser that remembers the old Mocha tab opens on the first method with this year's bids, the bids at 50 left out")
            # the old tab's remembered "ignore bids above 49" and "bids of 0" are dropped: left in force they kept the bids
            # at 50 out whatever the new box said, so the box seemed to do nothing (the user's report, 14 November 2026)
            check(s5.locator("#mo-count").inner_text() == "63 of 69 bids counted" and s5.locator("#mo-above").input_value() == "" and not s5.locator("#mo-zero").is_checked() and not s5.locator("#mo-above").is_visible(), "bids the old tab was told to ignore are counted again: %r" % s5.locator("#mo-count").inner_text())
            before = s5.locator("table.methods tbody tr").first.inner_text()
            s5.locator("#mo-cap-text").click()
            s5.get_by_text("69 bids counted", exact=True).wait_for(timeout=5000)
            check(s5.locator("table.methods tbody tr").first.inner_text() != before and "£35" in s5.locator("table.methods tbody tr").first.inner_text(), "and the box acts: the best price moves from 25 to 35")
            # bids to ignore set on today's page are remembered, and the folded boxes then open so that they are seen
            s5.click("#mo-ignore summary"); s5.fill("#mo-above", "30"); s5.locator("#mo-above").dispatch_event("change")
            s5.get_by_text("of 69 bids counted", exact=False).wait_for()
            s5.reload()
            s5.wait_for_selector("#mo-results table.methods")
            check(s5.locator("#mo-above").input_value() == "30" and s5.locator("#mo-above").is_visible() and "of 69 bids counted" in s5.locator("#mo-count").inner_text(), "bids ignored on this page are remembered and shown open: %r" % s5.locator("#mo-count").inner_text())
            ctx5.close(); ctx7.close()

            # ---- the instructor page: two views, no lab books
            ins.click("#refresh"); ins.wait_for_timeout(1500)
            check(ins.locator("#views button").all_inner_texts() == ["Challenge", "Links and QR"] and "lab book" not in ins.locator("body").inner_text().lower(), "the instructor page has the challenge and the links, no lab books: %r" % ins.locator("#views button").all_inner_texts())
            check("registered group" in ins.locator("#class-bar").inner_text() and "Class record read at" in ins.locator("#footer-status").inner_text(), "the class bar counts the registered groups: %r" % ins.locator("#class-bar").inner_text()[:160])
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
