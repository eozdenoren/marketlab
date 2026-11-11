/* Checks src/pricing_core.js: the challenge arithmetic against the numbers worked by hand, and the Mocha pricing
   against the figures computed independently in Python (numpy) on the same bids.
       node tests/check_pricing_core.js */
"use strict";
var path = require("path");
var C = require(path.join(__dirname, "..", "src", "pricing_core.js"));
var D = require(path.join(__dirname, "..", "src", "mocha_data.js"));
var failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log("FAIL:", msg); } }
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

// ---- the challenge: cost 80, 450 seats, status quo 580 / 350, slope 0.5
var s = { mc: 80, seats: 450, p0: 580, q0: 350, b: 0.5 };
var d = { a: C.intercept(s), b: s.b, mc: s.mc, seats: s.seats };
check(d.a === 640, "intercept 640");
check(C.passengersAt(d, 580) === 350, "the status quo is on the line");
check(C.passengersAt(d, 380) === 450 && C.passengersAt(d, 379) === 450, "the plane is full from 380 down");
check(C.passengersAt(d, 1280) === 0 && C.passengersAt(d, 2000) === 0, "nobody flies at the choke price");
check(C.passengersAt(d, 601) === 340, "odd fares round to the whole passenger (339.5 -> 340)");
var best = C.bestFare(d);
check(best.fare === 680 && best.passengers === 300 && best.profit === 180000 && !best.capped, "best fare 680, 300 passengers, 180,000: " + JSON.stringify(best));
check(C.statusQuoProfit(s) === 175000, "status quo profit 175,000");
check(C.profitAt(d, 630) === 178750 && C.profitAt(d, 730) === 178750, "fifty pounds either side costs 1,250");
check(C.profitAt(d, 380) === 135000, "filling the plane earns 135,000");
var up = { a: d.a, b: d.b, mc: d.mc, seats: d.seats, scale: 1.4 }, bu = C.bestFare(up);
check(bu.fare === 680 && bu.passengers === 420 && !bu.capped, "demand up 40%: still 680, 420 passengers: " + JSON.stringify(bu));
var dbl = { a: d.a, b: d.b, mc: d.mc, seats: d.seats, scale: 2 }, bd = C.bestFare(dbl);
check(bd.fare === 830 && bd.passengers === 450 && bd.capped, "demand doubled: the seats bind, 830: " + JSON.stringify(bd));
var curve = C.profitCurve(d);
check(curve[0][0] === 0 && curve[curve.length - 1][0] === 1280 && curve.some(function (p) { return p[0] === 680 && p[1] === 180000; }), "the profit curve runs from 0 to the choke price through the best fare");
var win = C.focusWindow(d);
check(C.fillFare(d) === 380 && win.x0 === 365 && win.x1 === 995 && win.fill === 380, "the chart window runs from just below the fill-the-plane fare to its mirror beyond the best: " + JSON.stringify([win.x0, win.x1]));
check(win.y0 < 135000 && win.y0 > 120000 && win.y1 > 180000 && win.y1 < 185000, "profits from the fill-the-plane level up, not from zero: " + JSON.stringify([win.y0, win.y1]));
check(win.curve[0][0] === 365 && win.curve[win.curve.length - 1][0] === 995, "the curve covers the window");
var pc = C.profitChartHtml(d, { fare: 580, profit: 175000 }, [{ fare: 680, profit: 180000, title: "Flight 1: £680" }, { fare: 1200, profit: 16000, title: "Flight 2: £1,200" }], {});
check(/<svg/.test(pc) && /Off the chart: Flight 2: £1,200 \(profit £16,000\)/.test(pc) && pc.indexOf("Flight 1") > 0, "flights inside the window are drawn, the others listed");
var line = C.lineThrough(580, 350, 780, 250);
check(line && line.b === 0.5 && line.a === 640, "two flights give the line exactly");
check(C.lineThrough(580, 350, 580, 350) === null, "no line from one point");
var s2 = { mc: 100, seats: 420, p0: 650, q0: 340, b: 0.4 }, d2 = { a: C.intercept(s2), b: 0.4, mc: 100, seats: 420 }, b2 = C.bestFare(d2);
check(d2.a === 600 && b2.fare === 800 && b2.passengers === 280 && b2.profit === 196000, "second preset: best 800 / 280 / 196,000");
var s3 = { mc: 80, seats: 320, p0: 800, q0: 280, b: 0.25 }, d3 = { a: C.intercept(s3), b: 0.25, mc: 80, seats: 320 }, b3 = C.bestFare(d3);
check(d3.a === 480 && b3.fare === 1000 && b3.passengers === 230 && b3.profit === 211600, "third preset: best 1000 / 230 / 211,600");
var h1 = C.historyRange(s), h2 = C.historyRange(s2), h3 = C.historyRange(s3);
check(h1 && h1.fareLo === 570 && h1.fareHi === 590 && h1.paxAtLo === 355 && h1.paxAtHi === 345, "Detroit history: 570-590 carried 355-345: " + JSON.stringify(h1));
check(h2 && h2.fareLo === 640 && h2.fareHi === 660 && h2.paxAtLo === 344 && h2.paxAtHi === 336, "Chicago history: 640-660 carried 344-336: " + JSON.stringify(h2));
check(h3 && h3.fareLo === 780 && h3.fareHi === 820 && h3.paxAtLo === 285 && h3.paxAtHi === 275, "Singapore history: 780-820 carried 285-275 (10 would give half passengers): " + JSON.stringify(h3));
[h1, h2, h3].forEach(function (h, i) { var dd = [d, d2, d3][i]; check(C.passengersAt(dd, h.fareLo) === h.paxAtLo && C.passengersAt(dd, h.fareHi) === h.paxAtHi, "history " + (i + 1) + " lies on the demand"); });
check(C.historyRange({ mc: 80, seats: 450, p0: 580, q0: 350, b: 0.37 }) === null, "no round range for an awkward slope");

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
var table = C.bookTable([{ id: "x", label: "Flight", measures: { Fare: 680, Profit: 180000 } }, { id: "y", label: "Flight", measures: { Fare: 580, Note: "status quo" } }], { removable: true });
check(/Flight \(2\)/.test(table) && /remove-entry/.test(table) && /status quo/.test(table) && /180,000/.test(table), "the lab-book table: duplicate labels numbered, text cells kept");

console.log("pricing core:", failures ? failures + " checks failed" : "OK");
process.exit(failures ? 1 : 0);
