/* Checks src/pricing_core.js: the challenge arithmetic (seats in, fare out) against the numbers worked by hand, and the Mocha pricing
   against the figures computed independently in Python on the same bids (one line, two lines) and by hand.
       node tests/check_pricing_core.js */
"use strict";
var path = require("path");
var C = require(path.join(__dirname, "..", "src", "pricing_core.js"));
var D = require(path.join(__dirname, "..", "src", "mocha_data.js"));
var failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log("FAIL:", msg); } }
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

// ---- the challenge: cost 80, 450 seats, trial flights 350 seats at 580, slope 0.5. A team chooses the seats to
// sell; the fare is the highest at which that many people buy.
var s = { mc: 80, seats: 450, p0: 580, q0: 350, b: 0.5 };
var d = { a: C.intercept(s), b: s.b, mc: s.mc, seats: s.seats };
check(d.a === 640 && C.chokePrice(d) === 1280, "intercept 640, nobody flies above 1,280");
check(C.fareFor(d, 350) === 580, "the trial flights are on the line");
check(C.fareFor(d, 450) === 380 && C.maxSeats(d) === 450, "a full plane (450 seats) sells at 380");
check(C.maxSeats({ a: 400, b: 1, mc: 10, seats: 500 }) === 400, "no more seats than people who would fly for nothing");
var best = C.bestSeats(d);
check(best.seats === 300 && best.fare === 680 && best.profit === 180000 && !best.capped, "best: 300 seats at 680, 180,000: " + JSON.stringify(best));
check(C.statusQuoProfit(s) === 175000, "a trial flight made 175,000");
check(C.profitSelling(d, 275) === 178750 && C.profitSelling(d, 325) === 178750, "25 seats either side costs 1,250");
check(C.profitSelling(d, 301) - C.profitSelling(d, 300) === -2 && C.profitSelling(d, 401) - C.profitSelling(d, 400) === -402, "the 301st seat loses 2, the 401st loses 402 (MR - MC)");
var full = C.fullPlane(d);
check(full.seats === 450 && full.fare === 380 && full.profit === 135000, "a full plane earns 135,000");
var tight = C.bestSeats({ a: 640, b: 0.5, mc: 80, seats: 250 });
check(tight.seats === 250 && tight.capped && tight.fare === 780, "with 250 seats the best is a full plane, at 780: " + JSON.stringify(tight));
var third = { a: 540, b: 0.3, mc: 100, seats: 400 }, bt = C.bestSeats(third);
check(bt.seats === 255 && bt.fare === 950 && bt.profit === 216750 && C.profitSelling(third, 256) === 216747 && C.profitSelling(third, 254) === 216747, "a slope of 0.3: fares in pence, profits to the pound, the best still alone at the top: " + JSON.stringify(bt));
check(C.fareText(680) === "£680" && C.fareText(946.6666) === "£946.67" && C.plain(2) === "2" && C.plain(2.5) === "2.5" && C.plain(1 / 0.3) === "3.33", "fares to the penny only when they are not whole; slopes without trailing zeros");
check(C.inverseText(d) === "1,280 − 2 × Q" && C.inverseText(third) === "1,800 − 3.33 × Q", "the demand as the slides write it: " + C.inverseText(d) + "; " + C.inverseText(third));
var pc = C.profitChartHtml(d, { seats: 350, profit: 175000 }, [{ seats: 300, profit: 180000, title: "Flight 1: 300 seats" }, { seats: 40, profit: 44800, title: "Flight 2: 40 seats" }], {});
check(/<svg/.test(pc) && /Off the chart: Flight 2: 40 seats \(profit £44,800\)/.test(pc) && pc.indexOf("Flight 1") > 0 && /Seats sold/.test(pc) && /plane full/.test(pc), "the profit chart is against the seats sold; flights inside the window are drawn, the others listed");
check(/fare = 1,280 − 2 × Q/.test(C.demandChartHtml(s, d, 300)), "the demand chart names the line");
var line = C.lineThrough(580, 350, 780, 250);
check(line && line.b === 0.5 && line.a === 640, "two flights give the line exactly");
check(C.lineThrough(580, 350, 580, 350) === null, "no line from one point");
var lt = C.lineThrough(800, 300, 946.67, 256);
check(lt && Math.abs(lt.a - 540) < 0.5 && Math.abs(lt.b - 0.3) < 0.001 && C.inverseText(lt) === "1,800 − 3.33 × Q", "a fare to the penny still gives the line: " + JSON.stringify(lt));
check(C.bestFare === undefined && C.passengersAt === undefined, "the fare-first arithmetic is gone from the pages (the script keeps it for older pages)");

// ---- Mocha: the figures Python gave on the same bids (scratch analyses, 2026-11-10 and 2026-11-14). This year's
// three streams only: last year's bids, collected another way, were taken out on 14 November 2026.
function stream(code) { return D.streams.filter(function (x) { return x.code === code; })[0].bids; }
var A = stream("CM03AUT26A"), B = stream("CM03AUT26B"), Cc = stream("CM03AUT26C"), ALL = A.concat(B, Cc);
check(A.length === 69 && B.length === 75 && Cc.length === 41 && D.last === undefined && D.streams.length === 3, "bid counts 69 / 75 / 41, and no bids from last year");
var bA5 = C.bestPrice(A, 5), bA15 = C.bestPrice(A, 15), bC15 = C.bestPrice(Cc, 15), bAll = C.bestPrice(ALL, 15);
check(bA5.price === 25 && bA5.buyers === 27 && bA5.profit === 540, "A at cost 5: 25, 27 buyers, 540: " + JSON.stringify(bA5));
check(bA15.price === 35 && bA15.buyers === 14 && bA15.profit === 280, "A at cost 15: 35 / 14 / 280");
check(bC15.price === 49 && bC15.buyers === 8 && bC15.profit === 272, "C at cost 15: 49 / 8 / 272");
check(bAll.price === 35 && bAll.buyers === 35 && bAll.profit === 700, "all three at cost 15: 35 / 35 / 700");
// one line: MR = MC on it is the midpoint of its choke price and the cost
var fA = C.fitLine(A), fAll = C.fitLine(ALL);
check(fA && near(fA.a, 45.5705, 0.001) && near(fA.b, 0.71807, 0.0001), "A's line P = 45.57 - 0.718 Q: " + JSON.stringify(fA));
check(fAll && near(fAll.a, 45.4201, 0.001) && near(fAll.b, 0.2645, 0.0001) && near(fAll.sse, 680.18, 0.01) && fAll.n === 51, "all three's line P = 45.42 - 0.264 Q, squared error 680: " + JSON.stringify(fAll));
var lA15 = C.linePricing(fA, A, 15), lAll = C.linePricing(fAll, ALL, 15);
check(near(lA15.price, 30.285, 0.001) && lA15.rounded === 30 && lA15.buyers === 17 && lA15.profit === 255, "A's line price at cost 15: 30.29, charged as 30 (the bids are whole pounds): 17 buyers, 255 (91% of the best)");
check(C.buyersAt(A, lA15.price) === 14 && near(C.profitAtPrice(A, lA15.price, 15), 213.99, 0.01), "to the penny the same price would lose the three who bid 30: 14 buyers, 214");
check(near(lA15.price, (fA.a + 15) / 2) && near(fA.a - 2 * fA.b * lA15.lineQ, 15) && near(lA15.expected, 325.37, 0.01), "the midpoint rule and MR = MC give the same price; the line expects 325");
check(near(lAll.price, 30.21, 0.001) && lAll.rounded === 30 && lAll.buyers === 46 && lAll.profit === 690 && near(lAll.lineQ, 57.51, 0.01), "all three's line price 30.21, charged as 30: 46 buyers, 690 (99% of the best)");
check(C.fitLine([7, 7, 7]) === null || C.fitLine([7, 7, 7]).b > 0, "a line is only ever a falling one");
// two lines: the split that fits best, each line's midpoint, and the one the lines expect more from
var tA = C.twoLines(A, 15, null), tB = C.twoLines(B, 15, null), tC = C.twoLines(Cc, 15, null), tAll = C.twoLines(ALL, 15, null);
check(C.bestSplit(A) === 32 && C.bestSplit(B) === 33 && C.bestSplit(Cc) === 40 && C.bestSplit(ALL) === 31, "best-fitting splits 32 / 33 / 40 / 31");
check(tA.split === 32 && tA.auto === 32 && near(tA.high.a, 55.479, 0.001) && near(tA.high.b, 1.5994, 0.0001) && near(tA.low.a, 38.196, 0.001) && near(tA.low.b, 0.5634, 0.0001), "A split at 32: P = 55.48 - 1.599 Q above, P = 38.20 - 0.563 Q below: " + JSON.stringify(tA));
check(tA.pick === "high" && near(tA.price, 35.239, 0.001) && tA.rounded === 35 && tA.buyers === 14 && tA.profit === 280 && tA.high.where === "inside" && tA.low.where === "inside", "A's two lines say 35.24, charged as 35: 14 buyers, 280 (the best)");
check(tB.pick === "low" && near(tB.price, 25.891, 0.001) && tB.rounded === 26 && tB.buyers === 22 && tB.profit === 242, "B's two lines say the low segment's 25.89, charged as 26: 22 buyers, 242 (89%)");
check(tC.high.where === "above" && near(tC.high.mid, 51.75, 0.001) && tC.price === 50 && tC.rounded === 50 && tC.buyers === 7 && tC.profit === 245 && tC.top === 50, "C's high line would price above the highest bid, so it stops there: 50, 7 buyers, 245 (90%)");
check(tAll.pick === "high" && near(tAll.price, 37.034, 0.001) && tAll.rounded === 37 && tAll.buyers === 29 && tAll.profit === 638 && near(tAll.sse, 116.05, 0.01) && tAll.sse < fAll.sse, "all three's two lines say 37.03, charged as 37: 29 buyers, 638 (91%), with a sixth of one line's squared error");
var tB35 = C.twoLines(B, 15, 35), tA15 = C.twoLines(A, 15, 15);
check(tB35.split === 35 && tB35.auto === 33 && tB35.high.where === "below" && tB35.high.price === 35 && near(tB35.high.expected, 209.14, 0.01) && tB35.pick === "low" && near(tB35.price, 26.154, 0.001) && tB35.rounded === 26 && tB35.buyers === 22 && tB35.profit === 242, "a split typed in: B at 35, the high line's midpoint falls below the split, so its best is the split");
check(tA15.low.where === "above" && tA15.low.price === 15 && tA15.low.expected === 0 && tA15.pick === "high" && near(tA15.price, 32.05, 0.001) && tA15.rounded === 32 && tA15.buyers === 14 && tA15.profit === 238, "A at 15: the low line's midpoint is not below the split");
check(C.twoLines(A, 15, 47) === null && C.twoLines(A, 15, 2) === null && C.twoLines([], 15, null) === null && C.twoLines([5, 5, 5], 15, null) === null, "a split that leaves a segment without a falling line gives nothing");
check(JSON.stringify([C.splitRange(A), C.splitRange(B), C.splitRange(Cc), C.splitRange(ALL)]) === "[[3,46],[3,40],[7,48],[3,48]]" && C.splitRange([5, 5]) === null, "the splits that can be fitted");
// a demand that is two lines exactly, worked by hand: one bid at each of 21..30, three at each of 0..20, so
// Q = 31 - P at 21 and above and Q = 73 - 3P below
var syn = [];
for (var sp = 21; sp <= 30; sp++) syn.push(sp);
for (sp = 0; sp <= 20; sp++) { syn.push(sp); syn.push(sp); syn.push(sp); }
var y5 = C.twoLines(syn, 5, null), y19 = C.twoLines(syn, 19, null);
check(C.bestSplit(syn) === 21 && near(y5.sse, 0, 1e-6) && near(y5.high.a, 31) && near(y5.high.b, 1) && near(y5.low.a, 73 / 3) && near(y5.low.b, 1 / 3), "an exact kink is found: split 21, P = 31 - Q and P = 24.33 - Q/3");
check(y5.high.where === "below" && y5.high.price === 21 && near(y5.high.expected, 160) && y5.pick === "low" && near(y5.price, 44 / 3) && near(y5.expected, 29 * 29 / 3) && y5.rounded === 15 && y5.buyers === 28 && y5.profit === 280, "cost 5: the low line's 14.67 (expected 280.33) beats the split's 160; charged as 15, 28 buy, 280");
check(y19.low.where === "above" && y19.low.price === 21 && near(y19.low.expected, 20) && y19.pick === "high" && near(y19.price, 25) && y19.rounded === 25 && y19.buyers === 6 && near(y19.profit, 36), "cost 19: the high line's 25, 6 buyers, 36");
// the made-up market with two kinds of buyer: 8 others at each of 1..14, one fan at each of 38..57 (worked in Python
// too, 2026-11-14). One line is dragged down by buyers nobody would serve; two lines find the fans' price.
var M = C.madeUpBids(), mBest = C.bestPrice(M, 15), mLine = C.fitLine(M), mLp = C.linePricing(mLine, M, 15), mTwo = C.twoLines(M, 15, null);
check(M.length === 132 && C.buyersAt(M, 15) === 20 && C.buyersAt(M, 38) === 20 && C.buyersAt(M, 14) === 28 && C.median(M) === 9 && C.MADE_UP.fans.from === 38 && C.MADE_UP.others.each === 8, "the made-up market: 112 others up to 14, 20 fans from 38");
check(mBest.price === 38 && mBest.buyers === 20 && mBest.profit === 460, "its best price is 38: all 20 fans, 460");
check(near(mLine.a, 41.254, 0.001) && near(mLine.b, 0.3849, 0.0001) && near(mLp.price, 28.127, 0.001) && mLp.rounded === 28 && mLp.buyers === 20 && mLp.profit === 260, "one line says 28: the 20 fans at too low a price, 260 (57% of the best): " + JSON.stringify(mLp));
check(mTwo.split === 27 && mTwo.pick === "high" && mTwo.high.where === "inside" && mTwo.low.where === "inside" && near(mTwo.high.a, 60.169, 0.001) && near(mTwo.high.b, 1.3099, 0.0001) && near(mTwo.price, 37.585, 0.001) && mTwo.rounded === 38 && mTwo.buyers === 20 && mTwo.profit === 460,
      "two lines, split at 27, say 38: the best: " + JSON.stringify(mTwo));
check(C.profitCurve === undefined, "the saw-tooth profit curve is gone: the page draws the profit at whole-pound prices");
check(C.buyersAt(A, 0) === 69 && C.buyersAt(A, 50) === 6 && C.buyersAt(A, 51) === 0, "buyers at 0, at the cap, above it");
check(C.clean(A, { dropZero: true }).length === 68 && C.clean(A, { above: 49 }).length === 63, "cleaning: one zero, six at the cap");
// ---- without the bids at the most the auction accepted (50), which is how the page starts: a bid of the maximum
// says "at any price", not what the student would pay. The same figures from Python, 2026-11-14.
function uncapped(b) { return C.clean(b, { cap: 50 }); }
var A0 = uncapped(A), B0 = uncapped(B), C0 = uncapped(Cc), ALL0 = uncapped(ALL);
check(A0.length === 63 && B0.length === 70 && C0.length === 34 && ALL0.length === 167 && C.clean(A, { cap: null }).length === 69 && C.clean(A, {}).length === 69 && Math.max.apply(null, A0) === 46, "6 + 5 + 7 = 18 bids at the cap are left out, and only on request");
function triple(b) { var x = C.bestPrice(b, 15); return [x.price, x.buyers, x.profit].join("/"); }
check(triple(A0) === "25/21/210" && triple(B0) === "28/16/208" && triple(C0) === "25/9/90" && triple(ALL0) === "25/49/490", "best prices without the cap bids: 25, 28, 25 and, for all three, 25 with 49 buyers and 490");
function lineOf(b) { var x = C.linePricing(C.fitLine(b), b, 15); return [x.price.toFixed(2), x.rounded, x.buyers, x.profit].join("/"); }
check(lineOf(A0) === "27.34/27/15/180" && lineOf(B0) === "25.83/26/17/187" && lineOf(C0) === "27.18/27/6/72" && lineOf(ALL0) === "27.62/28/35/455", "one line without the cap bids: 27 (86%), 26 (90%), 27 (80%), 28 (93%): " + [lineOf(A0), lineOf(B0), lineOf(C0), lineOf(ALL0)].join(" "));
function twoOf(b, split) { var x = C.twoLines(b, 15, split == null ? null : split); return x ? [x.split, x.pick, x.price.toFixed(2), x.rounded, x.buyers, x.profit].join("/") : "none"; }
check(twoOf(A0) === "33/low/25.01/25/21/210" && twoOf(B0) === "23/high/27.55/28/16/208" && twoOf(C0) === "29/low/23.26/23/10/80" && twoOf(ALL0) === "31/low/24.41/24/49/441", "two lines without the cap bids: 25 (the best), 28 (the best), 23 (89%), 24 (90%): " + [twoOf(A0), twoOf(B0), twoOf(C0), twoOf(ALL0)].join(" "));
check(twoOf(A0, 40) === "40/low/26.14/26/16/176" && twoOf(A0, 25) === "25/high/28.96/29/11/154" && twoOf(A0, 44) === "none" && JSON.stringify(C.splitRange(A0)) === "[3,40]", "moving A's split: 40 gives 26, 25 gives 29, 44 cannot be fitted");
var seg0 = C.segmentation([{ name: "A", bids: A0 }, { name: "B", bids: B0 }, { name: "C", bids: C0 }], 15);
check(seg0.uniform.price === 25 && seg0.uniform.profit === 490 && seg0.total === 508 && seg0.gain === 18, "without the cap bids one price for all three is 25 (490), three prices give 508: a gain of 18");
check(C.schedule(A).length === 51 && C.schedule(A)[25][1] === 27, "the schedule runs 0..50 and has 27 buyers at 25");
var seg = C.segmentation([{ name: "A", bids: A }, { name: "B", bids: B }, { name: "C", bids: Cc }], 15);
check(seg.uniform.price === 35 && seg.uniform.profit === 700, "one price for all three streams at cost 15: 35, 700");
check(seg.total === 280 + 273 + 272 && seg.gain === 125, "three prices: 825, a gain of 125: " + JSON.stringify(seg));
check(C.median(A) === 17 && C.histogram(A, 5).length === 11, "median 17, eleven bins of 5");
var svg = C.chart({ x: { max: 100, label: "Price" }, y: { min: -10, max: 100, label: "Profit" }, lines: [{ pts: [[0, -10], [100, 100]], color: "#000", name: "line" }], markers: [{ x: 50, y: 45, color: "#f00", name: "dot" }] });
check(/<svg/.test(svg) && /legend-item/.test(svg) && svg.indexOf("line</span>") > 0, "a chart renders with a legend");
check(C.bookTable === undefined, "the core has no lab-book table any more");

// ---- the preset routes. The public example set (backend/Pricing.gs), by the numbers worked by hand:
var fs = require("fs"), vm = require("vm");
function presetsOf(file) { var ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(file, "utf8"), ctx); return vm.runInContext("PRESET_SETS", ctx); }
var EXAMPLE = presetsOf(path.join(__dirname, "..", "backend", "Pricing.gs"));
check(EXAMPLE.length === 1 && EXAMPLE[0].routes.length === 3, "the public script holds one example set of three routes");
[["Anchorage", 80, 500, 640, 0.5, 480, 400, 160000, 300, 680, 180000, 280, 100000],
 ["Zanzibar", 100, 480, 600, 0.4, 550, 380, 171000, 280, 800, 196000, 300, 96000],
 ["Bali", 80, 400, 480, 0.25, 700, 305, 189100, 230, 1000, 211600, 320, 96000]].forEach(function (p, k) {
  var r = EXAMPLE[0].routes[k];
  check(r.label === "London–" + p[0] && r.mc === p[1] && r.seats === p[2] && r.a === p[3] && r.b === p[4] && r.p0 === p[5], "the example set's route " + (k + 1) + " is " + p[0] + ": " + JSON.stringify(r));
  var s0 = { mc: p[1], seats: p[2], p0: p[5], q0: p[3] - p[4] * p[5], b: p[4] }, dd = { a: p[3], b: p[4], mc: p[1], seats: p[2] }, bb = C.bestSeats(dd), ff = C.fullPlane(dd);
  check(s0.q0 === p[6] && C.statusQuoProfit(s0) === p[7] && p[2] - s0.q0 >= 95, p[0] + ": the trial flights sold " + p[6] + " seats, profit " + p[7] + ", about 100 empty");
  check(bb.seats === p[8] && bb.fare === p[9] && bb.profit === p[10], p[0] + ": best " + p[8] + " seats at " + p[9] + ", " + p[10] + ": " + JSON.stringify(bb));
  check(ff.fare === p[11] && ff.profit === p[12], p[0] + ": a full plane sells at " + p[11] + ", profit " + p[12]);
});
// The first example route is the slides' worked example (there called London-Honolulu), with its class question:
// 40% more demand keeps the fare at 680 with 420 passengers; doubled demand fills the 500 seats at 780.
(function () {
  var A0 = 640, B0 = 0.5, mc = 80, seats = 500;
  var q40 = 1.4 * (A0 - B0 * mc) / 2, q2 = 2 * (A0 - B0 * mc) / 2;
  check(q40 === 420 && q40 <= seats && (1.4 * A0 - q40) / (1.4 * B0) === 680, "the slides: demand up 40% keeps the fare at 680, with 420 passengers");
  check(q2 === 600 && q2 > seats && (2 * A0 - seats) / (2 * B0) === 780, "the slides: doubled demand fills the plane at 780");
})();

// Every route of every set, by what the game needs of it (no numbers here: the class sets are private).
function whole(x) { return Math.abs(x - Math.round(x)) < 1e-9; }
function routeFacts(r) {
  var q0 = Math.round(r.a - r.b * r.p0), s0 = { mc: r.mc, seats: r.seats, p0: r.p0, q0: q0, b: r.b }, dd = { a: r.a, b: r.b, mc: r.mc, seats: r.seats };
  return { q0: q0, s0: s0, d: dd, sq: C.statusQuoProfit(s0), best: C.bestSeats(dd), full: C.fullPlane(dd) };
}
function checkRoute(r, name) {
  var f = routeFacts(r), empty = r.seats - f.q0, exact = (r.a - r.b * r.mc) / 2;
  check(whole(r.a - r.b * r.p0) && Math.abs(C.intercept(f.s0) - r.a) < 1e-9, name + ": whole seats sold on the trial flights, and the script recovers the intercept");
  check(empty >= 80 && empty <= 110, name + ": about 100 seats flew empty on the trial flights (" + empty + ")");
  check(whole(exact) && f.best.seats === exact && !f.best.capped && whole(f.best.fare) && f.best.fare > r.p0 + 100 && f.best.seats < f.q0 - 50, name + ": the best is a whole number of seats at a whole fare, well away from the trial flights");
  check(C.profitSelling(f.d, f.best.seats - 1) < f.best.profit && C.profitSelling(f.d, f.best.seats + 1) < f.best.profit, name + ": to the pound, the best number of seats is alone at the top");
  check((f.best.profit - f.sq) / f.sq > 0.1, name + ": the best beats a trial flight by more than 10%");
  check(f.full.seats === r.seats && f.full.fare > r.mc && f.full.fare < r.p0 && f.full.profit < f.sq, name + ": a full plane sells above cost, below the trial flights' fare, and makes less than a trial flight");
  return f;
}
function distinct(xs) { return xs.every(function (x, i) { return xs.indexOf(x) === i; }); }
function checkSets(sets, where) {
  sets.forEach(function (set) {
    var facts = set.routes.map(function (r) { return checkRoute(r, where + " " + set.name + " " + r.label); });
    check(set.routes.length === 3 && distinct(set.routes.map(function (r) { return r.label; })), where + " " + set.name + ": three routes with different names");
    check(distinct(set.routes.map(function (r) { return r.b; })) && distinct(set.routes.map(function (r) { return r.p0; })) && distinct(facts.map(function (f) { return f.best.fare; })),
          where + " " + set.name + ": the three routes differ in slope, trial flights' fare and best fare");
  });
}
checkSets(EXAMPLE, "public");
var LOCAL = path.join(__dirname, "..", "backend", "Pricing.local.gs");
if (fs.existsSync(LOCAL)) {
  var SETS = presetsOf(LOCAL), classSets = SETS.filter(function (x) { return !/example|rehearsal/i.test(x.name); });
  checkSets(SETS, "private");
  check(classSets.length === 3 && SETS.length === 4 && /rehearsal/i.test(SETS[3].name), "the private script holds three class sets and the rehearsal set last (so the fourth class of the list, LIVE-TEST, is offered it)");
  check(JSON.stringify(SETS[3].routes) === JSON.stringify(EXAMPLE[0].routes), "the rehearsal set is the public example");
  [0, 1, 2].forEach(function (k) {   // the same route in the three streams: nothing carries over
    var rs = classSets.map(function (x) { return x.routes[k]; }), fx = rs.map(routeFacts);
    check(distinct(rs.map(function (r) { return r.label; })) === false && rs[0].label === rs[1].label && rs[1].label === rs[2].label, "route " + (k + 1) + " has the same name in the three class sets");
    check(distinct(rs.map(function (r) { return r.b; })) && distinct(rs.map(function (r) { return r.p0; })) && distinct(fx.map(function (f) { return f.q0; })) &&
          distinct(fx.map(function (f) { return f.best.seats; })) && distinct(fx.map(function (f) { return f.best.fare; })) && distinct(fx.map(function (f) { return f.q0 - f.best.seats; })),
          "route " + (k + 1) + ": the three streams differ in slope, in the trial flights (seats and fare), in the best (seats and fare) and in the seats to cut from one to the other, so no number passed on from an earlier stream is right");
    rs.forEach(function (r) { check(!EXAMPLE[0].routes.some(function (e) { return e.a === r.a && e.b === r.b; }), "a class route is not a published example route"); });
  });
  // the class curves must not sit in anything public: the pages, their sources, the tests, the script template
  var ROOT = path.join(__dirname, ".."), publicFiles = [];
  ["docs", "src", "tests", "tools"].forEach(function (dir) { if (fs.existsSync(path.join(ROOT, dir))) fs.readdirSync(path.join(ROOT, dir)).forEach(function (f) { if (/\.(html|js|py|css|json|gs|md)$/.test(f) && f !== "cases.json") publicFiles.push(path.join(ROOT, dir, f)); }); });
  publicFiles.push(path.join(ROOT, "backend", "Pricing.gs"), path.join(ROOT, "build.py"));
  var leaks = [];
  publicFiles.forEach(function (file) {
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, "utf8").split("\n").forEach(function (line, n) {
      if (line.length > 4000) return;   // inlined data and minified lines hold every number
      classSets.forEach(function (set) { set.routes.forEach(function (r) {
        var has = function (x) { return new RegExp("(^|[^0-9.])" + String(x).replace(".", "\\.") + "([^0-9.]|$)").test(line); };
        if (has(r.a) && has(r.b) && has(r.p0)) leaks.push(path.relative(ROOT, file) + ":" + (n + 1));
      }); });
    });
  });
  check(leaks.length === 0, "no public file holds a class curve (intercept, slope and trial fare on one line): " + leaks.slice(0, 5).join(", "));
} else console.log("(backend/Pricing.local.gs is not on this machine: the class sets were not checked)");

console.log("pricing core:", failures ? failures + " checks failed" : "OK");
process.exit(failures ? 1 : 0);
