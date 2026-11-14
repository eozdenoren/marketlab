/* Checks src/pricing_core.js: the challenge arithmetic (seats in, fare out) against the numbers worked by hand, and the Mocha pricing
   against the figures computed independently in Python (numpy) on the same bids.
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

// ---- Mocha: the figures numpy gave on the same bids (scratch analysis, 2026-11-10)
function stream(code) { return D.streams.filter(function (x) { return x.code === code; })[0].bids; }
var A = stream("CM03AUT26A"), B = stream("CM03AUT26B"), Cc = stream("CM03AUT26C"), L = D.last.bids;
check(A.length === 69 && B.length === 75 && Cc.length === 41 && L.length === 167, "bid counts 69 / 75 / 41 / 167");
var bA5 = C.bestPrice(A, 5), bA15 = C.bestPrice(A, 15), bC15 = C.bestPrice(Cc, 15), bL15 = C.bestPrice(L, 15);
check(bA5.price === 25 && bA5.buyers === 27 && bA5.profit === 540, "A at cost 5: 25, 27 buyers, 540: " + JSON.stringify(bA5));
check(bA15.price === 35 && bA15.buyers === 14 && bA15.profit === 280, "A at cost 15: 35 / 14 / 280");
check(bC15.price === 49 && bC15.buyers === 8 && bC15.profit === 272, "C at cost 15: 49 / 8 / 272");
check(bL15.price === 77 && bL15.buyers === 14 && bL15.profit === 868, "last year at cost 15: 77 / 14 / 868");
var fA = C.fitLine(A), fL = C.fitLine(L);
check(fA && near(fA.a, 45.5705, 0.001) && near(fA.b, 0.71807, 0.0001), "A's line P = 45.57 - 0.718 Q: " + JSON.stringify(fA));
check(fL && near(fL.a, 69.478, 0.001) && near(fL.b, 0.61151, 0.0001), "last year's line P = 69.48 - 0.612 Q");
var lA15 = C.linePricing(fA, A, 15), lL15 = C.linePricing(fL, L, 15);
check(near(lA15.price, 30.285, 0.001) && lA15.buyers === 14 && near(lA15.profit, 213.99, 0.01), "A's line price at cost 15: 30.29, 14 buyers, 214");
check(near(lL15.price, 42.239, 0.001) && lL15.buyers === 19 && near(lL15.profit, 517.54, 0.01), "last year's line price 42.24, 19 buyers, 518 (60% of the best)");
check(C.buyersAt(A, 0) === 69 && C.buyersAt(A, 50) === 6 && C.buyersAt(A, 51) === 0, "buyers at 0, at the cap, above it");
check(C.clean(A, { dropZero: true }).length === 68 && C.clean(A, { above: 49 }).length === 63, "cleaning: one zero, six at the cap");
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
