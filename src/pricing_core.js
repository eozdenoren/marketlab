/* Pricing Laboratory: the arithmetic and the SVG chart, shared by the class page (pricing.js) and the instructor
   page (pricing_instructor.js). Plain script, no dependencies.

   The challenge: a route with cost mc per passenger, `seats` seats, the trial flight (q0 seats sold at a fare of
   p0) and a hidden linear demand Q = a - b P through that point (a = q0 + b p0). A team chooses how many seats to
   sell; the fare is then the highest at which that many people buy, (a - seats) / b. The same arithmetic as the
   script's (backend/Pricing.gs): the fare to the penny, the profit to the pound.
   Mocha: a list of bids (each the most one student would pay); at price p the buyers are the bids >= p. */
var PricingCore = (function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmt(x, d, signed) {
    if (x == null || (typeof x === "number" && isNaN(x))) return "–";
    if (d === undefined) d = 0;
    if (Math.abs(x) < 5e-10) x = 0;
    var s = Math.abs(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
    return (x < 0 ? "-" : (signed ? "+" : "")) + s;
  }
  function money(x, d, signed) { return x == null || isNaN(x) ? "–" : (x < 0 ? "-£" : (signed ? "+£" : "£")) + fmt(Math.abs(x), d); }
  function round(x, d) { var m = Math.pow(10, d || 0); return Math.round(x * m) / m; }

  // ---- the challenge ---------------------------------------------------------------------------------------
  // demand d = {a, b, mc, seats}: Q = a - b P, so q seats sell at the fare (a - q) / b
  function intercept(s) { return s.q0 + s.b * s.p0; }
  function chokePrice(d) { return d.a / d.b; }
  function fareFor(d, q) { return (d.a - q) / d.b; }
  function profitSelling(d, q) { return Math.round((fareFor(d, q) - d.mc) * q); }
  function statusQuoProfit(s) { return (s.p0 - s.mc) * s.q0; }                      // what the trial flight made
  // The most seats that can be sold: the plane's, or everyone who would fly for nothing.
  function maxSeats(d) { return Math.max(1, Math.min(d.seats, Math.floor(d.a))); }
  // The best number of seats: MR = MC gives (a - b mc) / 2; with fewer seats than that, a full plane. Whole seats,
  // so every count is tried.
  function bestSeats(d) {
    var top = maxSeats(d), best = null;
    for (var q = 1; q <= top; q++) { var pr = profitSelling(d, q); if (!best || pr > best.profit) best = { seats: q, profit: pr }; }
    best.fare = fareFor(d, best.seats); best.capped = (d.a - d.b * d.mc) / 2 > d.seats;
    return best;
  }
  function fullPlane(d) { var q = maxSeats(d); return { seats: q, fare: fareFor(d, q), profit: profitSelling(d, q) }; }
  // A fare as text: whole pounds, or to the penny when it is not whole.
  function fareText(x) { return money(x, Math.abs(x - Math.round(x)) < 0.005 ? 0 : 2); }
  // A number with up to two decimals and no trailing zeros (the slope of the inverse demand: 2, 2.5, 3.33).
  function plain(x) { return Math.abs(x - Math.round(x)) < 0.005 ? fmt(x) : (Math.abs(x * 10 - Math.round(x * 10)) < 0.05 ? fmt(x, 1) : fmt(x, 2)); }
  // The demand as the slides write it: fare = choke - slope x Q.
  function inverseText(d) { return fmt(Math.round(chokePrice(d))) + " − " + plain(1 / d.b) + " × Q"; }
  // The profit chart: profit per flight against the seats sold, in a window centred on the best number of seats and
  // ending at the full plane (when the best is a full plane, the last 60% of the seats). The trial flight is a
  // hollow dot and a dashed line, the best a green dot, and the flights given are dots ({seats, profit, title,
  // name}); flights left of the window are listed under the chart instead of stretching it.
  function profitChartHtml(d, old, flights, opts) {
    opts = opts || {};
    var best = bestSeats(d), top = maxSeats(d), x0 = Math.max(0, best.seats < top ? 2 * best.seats - top : Math.round(0.4 * top));
    if (old && old.seats < x0) x0 = Math.max(0, old.seats - 10);
    var pts = [], lo = Infinity, hi = -Infinity;
    for (var q = Math.max(1, x0); q <= top; q++) { var pr = profitSelling(d, q); pts.push([q, pr]); lo = Math.min(lo, pr); hi = Math.max(hi, pr); }
    var r = Math.max(1, hi - lo), pad = Math.max(1, Math.round(0.03 * (top - x0))), markers = [], off = [];
    if (old) markers.push({ x: old.seats, y: old.profit, color: COLORS.grey, hollow: true, name: "The trial flight", title: "The trial flight: " + fmt(old.seats) + " seats, profit " + money(old.profit) });
    markers.push({ x: best.seats, y: best.profit, color: COLORS.green, r: 8, name: "Best: " + fmt(best.seats) + " seats", label: fmt(best.seats) + " seats", title: "Best: " + fmt(best.seats) + " seats at " + fareText(best.fare) + ", profit " + money(best.profit) });
    (flights || []).forEach(function (f) {
      if (f.seats < x0) { off.push(f); return; }
      markers.push({ x: f.seats, y: f.profit, color: COLORS.red, r: opts.r, name: f.name || "Flights", title: f.title || "" });
    });
    var html = chart({ title: "Profit against the seats sold", h: opts.h, x: { min: x0, max: top + pad, label: "Seats sold" }, y: { min: lo - 0.08 * r, max: hi + 0.08 * r, label: "Profit per flight (£)" },
                       lines: [{ pts: pts, color: COLORS.blue, width: 2.5, name: "Profit at each number of seats" }],
                       hlines: old ? [{ y: old.profit, label: "the trial flight's profit", color: COLORS.grey }] : [],
                       vlines: top >= d.seats ? [{ x: top, label: "plane full", color: COLORS.orange, left: true }] : [], markers: markers });
    if (off.length) html += '<p class="caption">Off the chart: ' + off.map(function (f) { return (f.title || fmt(f.seats) + " seats") + " (profit " + money(f.profit) + ")"; }).join("; ") + '.</p>';
    return html;
  }
  // The demand line with the trial flight and the best point on it.
  function demandChartHtml(t, d, h) {
    var choke = chokePrice(d), best = bestSeats(d);
    return chart({ title: "The demand", h: h, x: { max: Math.max(d.a, t.seats) * 1.05, label: "Seats sold" }, y: { max: choke * 1.05, label: "Fare (£)" },
                   lines: [{ pts: [[0, choke], [d.a, 0]], color: COLORS.red, width: 2.5, name: "Demand: fare = " + inverseText(d) }],
                   hlines: [{ y: t.mc, label: "cost per passenger", color: COLORS.grey }], vlines: [{ x: t.seats, label: "plane full", color: COLORS.orange }],
                   markers: [{ x: t.q0, y: t.p0, color: COLORS.grey, hollow: true, name: "The trial flight", label: fmt(t.q0) + " at " + fareText(t.p0) },
                             { x: best.seats, y: best.fare, color: COLORS.green, name: "Best", label: fmt(best.seats) + " at " + fareText(best.fare) }] });
  }
  // The line through the trial flight and one test flight: the group's own estimate of the demand.
  function lineThrough(p1, q1, p2, q2) {
    if (Math.abs(p2 - p1) < 1e-9) return null;
    var b = (q1 - q2) / (p2 - p1);
    return b > 0 ? { a: q1 + b * p1, b: b } : null;
  }

  // ---- Mocha -----------------------------------------------------------------------------------------------
  function buyersAt(bids, p) { var n = 0; for (var i = 0; i < bids.length; i++) if (bids[i] >= p - 1e-9) n++; return n; }
  function profitAtPrice(bids, p, mc) { return (p - mc) * buyersAt(bids, p); }
  // The bids that count: opts.dropZero leaves out bids of nothing, opts.above bids over an amount, and opts.cap the
  // bids at the most the auction accepted (a bid of the maximum says "at any price", not what the student would pay).
  function clean(bids, opts) {
    opts = opts || {};
    return bids.filter(function (v) { return !(opts.dropZero && v <= 0) && !(opts.above != null && !isNaN(opts.above) && v > opts.above) && !(opts.cap != null && !isNaN(opts.cap) && v >= opts.cap - 1e-9); });
  }
  // The demand schedule: at each whole price from 0 to the highest bid, how many would buy.
  function schedule(bids) {
    var top = bids.length ? Math.ceil(Math.max.apply(null, bids)) : 0, out = [];
    for (var p = 0; p <= top; p++) out.push([p, buyersAt(bids, p)]);
    return out;
  }
  // The best price is always one of the bids (raising the price to the next bid loses nobody).
  function bestPrice(bids, mc) {
    var best = null, seen = {};
    bids.forEach(function (v) {
      if (seen[v]) return; seen[v] = true;
      var pr = profitAtPrice(bids, v, mc);
      if (!best || pr > best.profit + 1e-9 || (Math.abs(pr - best.profit) < 1e-9 && v < best.price)) best = { price: v, buyers: buyersAt(bids, v), profit: pr };
    });
    return best || { price: null, buyers: 0, profit: 0 };
  }
  // The straight line fitted to points [[price, buyers], ...] of a schedule, price on quantity (as the spreadsheet
  // does with SLOPE and INTERCEPT over the Price and Demand columns): P = a - b Q, with the squared error it leaves
  // (in pounds squared). null when the points do not give a falling line.
  function fitPoints(pts) {
    var n = pts.length;
    if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (qp) { sx += qp[1]; sy += qp[0]; sxx += qp[1] * qp[1]; sxy += qp[1] * qp[0]; });
    var den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-9) return null;
    var slope = (n * sxy - sx * sy) / den, inter = (sy - slope * sx) / n, sse = 0;
    if (!(slope < 0)) return null;
    pts.forEach(function (qp) { var e = qp[0] - (inter + slope * qp[1]); sse += e * e; });
    return { a: inter, b: -slope, sse: sse, n: n };
  }
  function fitLine(bids) { return fitPoints(schedule(bids)); }
  // MR = MC on the fitted line: Q = (a - mc) / (2b), P = (a + mc) / 2, the midpoint of the line's choke price and
  // the cost, and what the line expects to earn there. The bids are in whole pounds, so the price charged is that
  // price to the nearest pound (`rounded`): to the penny, a price of 30.21 would lose everyone who bid 30. `buyers`
  // and `profit` are what the rounded price earns on the actual bids.
  function linePricing(line, bids, mc) {
    if (!line) return null;
    var p = (line.a + mc) / 2, q = (line.a - mc) / (2 * line.b), r = Math.round(p);
    return { price: p, rounded: r, lineQ: q, expected: (p - mc) * q, buyers: buyersAt(bids, r), profit: profitAtPrice(bids, r, mc) };
  }
  // Two lines: the schedule split at a price. The high segment is the prices of `split` and above, the low segment
  // the prices below it; each gets its own line. A segment needs three prices and a falling line.
  var SEGMENT_MIN = 3;
  function splitFit(pts, split) {
    var hi = pts.filter(function (qp) { return qp[0] >= split - 1e-9; }), lo = pts.filter(function (qp) { return qp[0] < split - 1e-9; });
    if (hi.length < SEGMENT_MIN || lo.length < SEGMENT_MIN) return null;
    var fh = fitPoints(hi), fl = fitPoints(lo);
    return fh && fl ? { split: split, high: fh, low: fl, sse: fh.sse + fl.sse } : null;
  }
  // The split (a whole price) whose two lines leave the smallest squared error; null when no split can be fitted.
  function bestSplit(bids) {
    var pts = schedule(bids), best = null;
    for (var t = 1; t < pts.length; t++) { var f = splitFit(pts, t); if (f && (!best || f.sse < best.sse - 1e-9)) best = f; }
    return best ? best.split : null;
  }
  // Pricing on the two lines. On each line MR = MC gives the midpoint of its choke price and the cost. That price
  // counts only if it lies among the prices the line was fitted to (the split to the highest bid for the high
  // line, below the split for the low line); otherwise the segment's best price is the nearest end of that range.
  // Of the two prices, the lines choose the one they expect to earn more. `split` null: the best-fitting split.
  // Returns the two segments ({a, b, mid, where: "inside" | "below" | "above", price, q, expected}), the price
  // chosen, that price to the nearest pound (`rounded`, the price charged: see linePricing) and what the rounded
  // price earns on the actual bids; null when the split cannot be fitted.
  function twoLines(bids, mc, split) {
    var auto = bestSplit(bids), pts = schedule(bids), top = pts.length ? pts[pts.length - 1][0] : 0;
    if (split == null || isNaN(split)) split = auto;
    if (split == null) return null;
    var f = splitFit(pts, split);
    if (!f) return null;
    function seg(line, isHigh) {
      var mid = (line.a + mc) / 2, where = mid < split - 1e-9 ? (isHigh ? "below" : "inside") : (isHigh ? (mid > top + 1e-9 ? "above" : "inside") : "above");
      var price = where === "inside" ? mid : (isHigh && where === "above" ? top : split), q = Math.max(0, (line.a - price) / line.b);
      return { a: line.a, b: line.b, mid: mid, where: where, price: price, q: q, expected: (price - mc) * q };
    }
    var high = seg(f.high, true), low = seg(f.low, false), pick = low.expected > high.expected + 1e-9 ? "low" : "high", chosen = pick === "high" ? high : low;
    var rounded = Math.round(chosen.price);
    return { split: split, auto: auto, top: top, sse: f.sse, high: high, low: low, pick: pick, price: chosen.price, rounded: rounded, lineQ: chosen.q, expected: chosen.expected,
             buyers: buyersAt(bids, rounded), profit: profitAtPrice(bids, rounded, mc) };
  }
  // The splits that can be fitted, as [lowest, highest] whole prices, or null.
  function splitRange(bids) {
    var pts = schedule(bids), lo = null, hi = null;
    for (var t = 1; t < pts.length; t++) if (splitFit(pts, t)) { if (lo == null) lo = t; hi = t; }
    return lo == null ? null : [lo, hi];
  }
  // A made-up demand that is a curve, not a straight line, to show what two lines are for (nobody's bids): 200
  // buyers, and every 14 pounds on the price halves the number who would buy, Q(P) = 200 x 0.5^(P / 14), to the
  // nearest buyer at each whole pound. No groups of buyers: one smooth curve with a long thin tail. At a cost of
  // 15 the best price is 36 (34 buyers, 714); one line, pulled up by the tail, says 48 (88% of that); two lines
  // follow the curve far better (a ninth of the squared error) and say 32 (98%).
  var CURVE = { buyers: 200, half: 14 };
  function curveBids() {
    var bids = [], q = function (p) { return Math.round(CURVE.buyers * Math.pow(0.5, p / CURVE.half)); };
    for (var p = 0; q(p) > 0; p++) for (var k = q(p) - q(p + 1); k > 0; k--) bids.push(p);
    return bids;
  }
  // One price for every set against a price per set.
  function segmentation(sets, mc) {
    var all = [], separate = [], total = 0;
    sets.forEach(function (s) { all = all.concat(s.bids); var b = bestPrice(s.bids, mc); separate.push({ name: s.name, price: b.price, buyers: b.buyers, profit: b.profit }); total += b.profit; });
    var uni = bestPrice(all, mc);
    var uniform = { price: uni.price, profit: uni.profit, per: sets.map(function (s) { return { name: s.name, buyers: buyersAt(s.bids, uni.price), profit: profitAtPrice(s.bids, uni.price, mc) }; }) };
    return { uniform: uniform, separate: separate, total: total, gain: total - uni.profit, gainPct: uni.profit > 0 ? (total - uni.profit) / uni.profit : null };
  }
  function histogram(bids, width) {
    width = width || 5;
    var top = bids.length ? Math.max.apply(null, bids) : 0, bins = [];
    for (var lo = 0; lo <= top; lo += width) {
      var hi = lo + width, n = bids.filter(function (v) { return v >= lo && (v < hi || (hi > top && v <= hi)); }).length;
      bins.push({ lo: lo, hi: hi, n: n });
    }
    return bins;
  }
  function median(bids) { if (!bids.length) return null; var s = bids.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // ---- the chart ------------------------------------------------------------------------------------------------
  // spec: {w, h, x: {min, max, label}, y: {min, max, label}, lines: [{pts, color, width, dash, name}],
  //        bars: [{x0, x1, y, color, name}], markers: [{x, y, color, hollow, label, name}], hlines: [{y, label, color}],
  //        vlines: [{x, label, color}], legend: true}
  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  }
  function ticks(lo, hi, target) {
    var step = niceStep(hi - lo || 1, target || 6), out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function rgba(hex, a) { var h = hex.replace("#", ""); return "rgba(" + parseInt(h.substr(0, 2), 16) + "," + parseInt(h.substr(2, 2), 16) + "," + parseInt(h.substr(4, 2), 16) + "," + a + ")"; }
  function dashAttr(d) { return d === "dash" ? ' stroke-dasharray="8,5"' : d === "dot" ? ' stroke-dasharray="2,4"' : d === "dashdot" ? ' stroke-dasharray="10,4,2,4"' : ""; }
  var COLORS = { blue: "#2a78d6", red: "#e34948", green: "#1baf7a", orange: "#eb6834", purple: "#7b4fb3", grey: "#8a8984", text: "#52514e", grid: "#ececea", black: "#0b0b0b" };
  function chart(spec) {
    var W = spec.w || 760, H = spec.h || 400, ml = 62, mr = 16, mt = 16, mb = 46, pw = W - ml - mr, ph = H - mt - mb;
    var xmin = spec.x.min || 0, xmax = spec.x.max, ymin = spec.y.min || 0, ymax = spec.y.max;
    if (!(xmax > xmin)) xmax = xmin + 1;
    if (!(ymax > ymin)) ymax = ymin + 1;
    var X = function (x) { return ml + (x - xmin) / (xmax - xmin) * pw; }, Y = function (y) { return H - mb - (y - ymin) / (ymax - ymin) * ph; };
    var body = [], legend = [];
    ticks(xmin, xmax, 7).forEach(function (t) {
      body.push('<line x1="' + X(t) + '" x2="' + X(t) + '" y1="' + mt + '" y2="' + (H - mb) + '" stroke="' + COLORS.grid + '"/>');
      body.push('<text x="' + X(t) + '" y="' + (H - mb + 16) + '" text-anchor="middle" class="tick">' + fmt(t, 0) + '</text>');
    });
    ticks(ymin, ymax, 6).forEach(function (t) {
      body.push('<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="' + (Math.abs(t) < 1e-9 ? COLORS.text : COLORS.grid) + '"/>');
      body.push('<text x="' + (ml - 6) + '" y="' + (Y(t) + 4) + '" text-anchor="end" class="tick">' + fmt(t, 0) + '</text>');
    });
    body.push('<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (H - mb) + '" y2="' + (H - mb) + '" stroke="' + COLORS.text + '" stroke-width="1.2"/>');
    body.push('<line x1="' + ml + '" x2="' + ml + '" y1="' + mt + '" y2="' + (H - mb) + '" stroke="' + COLORS.text + '" stroke-width="1.2"/>');
    body.push('<text x="' + (ml + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">' + esc(spec.x.label || "") + '</text>');
    body.push('<text transform="translate(14,' + (mt + ph / 2) + ') rotate(-90)" text-anchor="middle" class="axis">' + esc(spec.y.label || "") + '</text>');
    var cid = "clip" + Math.random().toString(16).slice(2, 8);
    body.push('<clipPath id="' + cid + '"><rect x="' + ml + '" y="' + mt + '" width="' + pw + '" height="' + ph + '"/></clipPath><g clip-path="url(#' + cid + ')">');
    (spec.bars || []).forEach(function (b, i) {
      var x0 = X(b.x0), x1 = X(b.x1), y1 = Y(b.y), y0 = Y(Math.max(ymin, 0));
      body.push('<rect x="' + (x0 + 1) + '" y="' + Math.min(y0, y1) + '" width="' + Math.max(0, x1 - x0 - 2) + '" height="' + Math.abs(y0 - y1) + '" fill="' + rgba(b.color || COLORS.blue, 0.55) + '"><title>' + esc(b.title || "") + '</title></rect>');
      if (b.name && !legend.some(function (l) { return l.name === b.name; })) legend.push({ name: b.name, color: b.color || COLORS.blue, kind: "area" });
    });
    (spec.lines || []).forEach(function (l) {
      if (!l.pts || l.pts.length < 2) return;
      var d = l.pts.map(function (xy) { return X(xy[0]).toFixed(2) + "," + Y(xy[1]).toFixed(2); }).join(" ");
      body.push('<polyline points="' + d + '" fill="none" stroke="' + l.color + '" stroke-width="' + (l.width || 2) + '"' + dashAttr(l.dash) + ' stroke-linejoin="round"/>');
      if (l.name) legend.push({ name: l.name, color: l.color, kind: "line", dash: l.dash });
    });
    body.push("</g>");
    (spec.hlines || []).forEach(function (l) {
      if (l.y < ymin || l.y > ymax) return;
      body.push('<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(l.y) + '" y2="' + Y(l.y) + '" stroke="' + (l.color || COLORS.text) + '" stroke-width="1.3"' + dashAttr("dashdot") + '/>');
      if (l.label) body.push('<text x="' + (W - mr - 4) + '" y="' + (Y(l.y) - 5) + '" text-anchor="end" class="tick">' + esc(l.label) + '</text>');
    });
    (spec.vlines || []).forEach(function (l) {
      if (l.x < xmin || l.x > xmax) return;
      body.push('<line x1="' + X(l.x) + '" x2="' + X(l.x) + '" y1="' + mt + '" y2="' + (H - mb) + '" stroke="' + (l.color || COLORS.text) + '" stroke-width="1.3"' + dashAttr("dashdot") + '/>');
      if (l.label) body.push('<text x="' + (X(l.x) + (l.left ? -4 : 4)) + '" y="' + (mt + 12) + '"' + (l.left ? ' text-anchor="end"' : "") + ' class="tick">' + esc(l.label) + '</text>');
    });
    (spec.markers || []).forEach(function (m) {
      if (m.x < xmin || m.x > xmax || m.y < ymin || m.y > ymax) return;
      var r = m.r || 5.5;
      body.push('<circle cx="' + X(m.x) + '" cy="' + Y(m.y) + '" r="' + r + '" fill="' + (m.hollow ? "white" : m.color) + '" stroke="' + (m.hollow ? m.color : "white") + '" stroke-width="2"><title>' + esc(m.title || m.name || "") + '</title></circle>');
      if (m.label) body.push('<text x="' + (X(m.x) + 8) + '" y="' + (Y(m.y) - 8) + '" class="note-text" paint-order="stroke" stroke="white" stroke-width="4" fill="' + COLORS.text + '">' + esc(m.label) + '</text>');
      if (m.name && !legend.some(function (l) { return l.name === m.name; })) legend.push({ name: m.name, color: m.color, kind: "marker", hollow: m.hollow });
    });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="' + esc(spec.title || "chart") + '">' + body.join("") + '</svg>';
    var lg = spec.legend === false ? "" : '<div class="legend">' + legend.map(function (it) {
      var sw = it.kind === "area" ? '<span class="sw area" style="background:' + rgba(it.color, 0.55) + '"></span>'
             : it.kind === "line" ? '<span class="sw line" style="border-top:2.5px ' + (it.dash ? "dashed" : "solid") + ' ' + it.color + '"></span>'
             : '<span class="sw dot" style="border-color:' + it.color + (it.hollow ? "" : ";background:" + it.color) + '"></span>';
      return '<span class="legend-item">' + sw + esc(it.name) + '</span>';
    }).join("") + '</div>';
    return svg + lg;
  }

  return { esc: esc, fmt: fmt, money: money, round: round, COLORS: COLORS,
           intercept: intercept, chokePrice: chokePrice, fareFor: fareFor, profitSelling: profitSelling, statusQuoProfit: statusQuoProfit, maxSeats: maxSeats,
           bestSeats: bestSeats, fullPlane: fullPlane, fareText: fareText, plain: plain, inverseText: inverseText,
           profitChartHtml: profitChartHtml, demandChartHtml: demandChartHtml, lineThrough: lineThrough,
           buyersAt: buyersAt, profitAtPrice: profitAtPrice, clean: clean, schedule: schedule, bestPrice: bestPrice, fitPoints: fitPoints, fitLine: fitLine, linePricing: linePricing,
           bestSplit: bestSplit, twoLines: twoLines, splitRange: splitRange, CURVE: CURVE, curveBids: curveBids,
           segmentation: segmentation, histogram: histogram, median: median, chart: chart };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PricingCore;
