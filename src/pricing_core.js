/* Pricing Laboratory: the arithmetic, the SVG chart and the lab-book table, shared by the class page
   (pricing.js) and the instructor page (pricing_instructor.js). Plain script, no dependencies.

   The challenge: a route with cost mc per passenger, `seats` seats, last month's fare p0 carrying q0 passengers,
   and a hidden linear demand Q = a - b P through that point (a = q0 + b p0). The same arithmetic as the
   script's (backend/Pricing.gs): passengers are rounded to the whole and capped by the seats.
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
  function intercept(s) { return s.q0 + s.b * s.p0; }
  // demand d = {a, b, mc, seats, scale}: Q = scale (a - b P), capped by the seats
  function passengersAt(d, fare) { return Math.max(0, Math.min(d.seats, Math.round((d.scale || 1) * (d.a - d.b * fare)))); }
  function profitAt(d, fare) { return (fare - d.mc) * passengersAt(d, fare); }
  function chokePrice(d) { return d.a / d.b; }
  // The best fare: MR = MC gives Q = scale (a - b mc) / 2; if that exceeds the seats, sell every seat at the fare
  // that fills the plane. Fares in whole pounds, so the exact optimum is checked against its neighbours.
  function bestFare(d) {
    var scale = d.scale || 1, qStar = scale * (d.a - d.b * d.mc) / 2, capped = qStar > d.seats;
    var q = capped ? d.seats : qStar, fare = (d.a - q / scale) / d.b, best = null;
    [Math.floor(fare), Math.ceil(fare)].forEach(function (f) {
      var pr = profitAt(d, f);
      if (!best || pr > best.profit + 1e-9) best = { fare: f, passengers: passengersAt(d, f), profit: pr };
    });
    best.capped = capped; best.exactFare = fare; best.exactQ = q;
    return best;
  }
  function profitCurve(d, step, from) {
    var top = Math.ceil(chokePrice(d)), pts = [], start = Math.max(0, Math.floor(from || 0));
    step = step || Math.max(1, Math.ceil((top - start) / 1500));   // whole pounds up to a span of 1,500
    for (var f = start; f <= top; f += step) pts.push([f, profitAt(d, f)]);
    if (pts[pts.length - 1][0] !== top) pts.push([top, profitAt(d, top)]);
    return pts;
  }
  // The fare below which the plane is full (demand at or above the capacity).
  function fillFare(d) { var scale = d.scale || 1; return Math.ceil((scale * d.a - d.seats) / (scale * d.b)); }
  // The fares worth looking at: from a little below the fare that fills the plane (below it profit is a straight
  // line, every seat sold) to the choke price; widened to the left if any of the fares given was lower, so that
  // every flight flown stays on the chart.
  function profitRange(d, fares) {
    var choke = chokePrice(d), fill = fillFare(d), left = fill > 0 ? fill : d.mc;
    var x0 = Math.max(0, left - 0.12 * (choke - left));
    (fares || []).forEach(function (f) { if (f - 20 < x0) x0 = Math.max(0, f - 20); });
    return { x0: Math.floor(x0), x1: Math.ceil(choke), fill: fill };
  }
  function statusQuoProfit(s) { return (s.p0 - s.mc) * s.q0; }
  // The line through the status quo and one test flight: the group's own estimate of the demand.
  function lineThrough(p1, q1, p2, q2) {
    if (Math.abs(p2 - p1) < 1e-9) return null;
    var b = (q1 - q2) / (p2 - p1);
    return b > 0 ? { a: q1 + b * p1, b: b } : null;
  }

  // ---- Mocha -----------------------------------------------------------------------------------------------
  function buyersAt(bids, p) { var n = 0; for (var i = 0; i < bids.length; i++) if (bids[i] >= p - 1e-9) n++; return n; }
  function profitAtPrice(bids, p, mc) { return (p - mc) * buyersAt(bids, p); }
  function clean(bids, opts) {
    opts = opts || {};
    return bids.filter(function (v) { return !(opts.dropZero && v <= 0) && !(opts.above != null && !isNaN(opts.above) && v > opts.above); });
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
  // The straight line fitted to the schedule, price on quantity (as the spreadsheet does with SLOPE and
  // INTERCEPT over the Price and Demand columns): P = a - b Q.
  function fitLine(bids) {
    var pts = schedule(bids), n = pts.length;
    if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (qp) { sx += qp[1]; sy += qp[0]; sxx += qp[1] * qp[1]; sxy += qp[1] * qp[0]; });
    var den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return null;
    var slope = (n * sxy - sx * sy) / den, inter = (sy - slope * sx) / n;
    if (!(slope < 0)) return null;
    return { a: inter, b: -slope };
  }
  // MR = MC on the fitted line: Q = (a - mc) / (2b), P = (a + mc) / 2; the profit it earns on the actual bids.
  function linePricing(line, bids, mc) {
    if (!line) return null;
    var p = (line.a + mc) / 2, q = (line.a - mc) / (2 * line.b);
    return { price: p, lineQ: q, buyers: buyersAt(bids, p), profit: profitAtPrice(bids, p, mc) };
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
      if (l.label) body.push('<text x="' + (X(l.x) + 4) + '" y="' + (mt + 12) + '" class="tick">' + esc(l.label) + '</text>');
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

  // ---- the lab-book table: rows are the measures in order of first appearance, columns the pinned entries -----
  function bookTable(entries, opts) {
    opts = opts || {};
    var rows = [], seen = {};
    entries.forEach(function (e) { Object.keys(e.measures || {}).forEach(function (k) { if (!seen[k]) { seen[k] = true; rows.push(k); } }); });
    var labels = {}, h = '<div class="labbook-wrap"><table class="grid labbook"><thead><tr><th></th>' + entries.map(function (e) {
      var label = (e.label || "Experiment").trim(), n = (labels[label] || 0) + 1; labels[label] = n; if (n > 1) label += " (" + n + ")";
      var mark = opts.mark && opts.mark[e.id] ? opts.mark[e.id] + " " : "";
      var btn = opts.removable ? '<button type="button" class="small remove-entry" data-id="' + esc(e.id) + '" title="Remove this column from the lab book" aria-label="Remove ' + esc(label) + '">✕</button>' : "";
      return '<th>' + btn + mark + esc(label) + '</th>';
    }).join("") + '</tr></thead><tbody>';
    rows.forEach(function (m) {
      h += '<tr><td>' + esc(m) + '</td>' + entries.map(function (e) {
        var v = (e.measures || {})[m];
        return '<td class="num">' + (v == null ? "–" : (typeof v === "number" ? fmt(v, Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2) : esc(v))) + '</td>';
      }).join("") + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  return { esc: esc, fmt: fmt, money: money, round: round, COLORS: COLORS,
           intercept: intercept, passengersAt: passengersAt, profitAt: profitAt, chokePrice: chokePrice, bestFare: bestFare, profitCurve: profitCurve, fillFare: fillFare, profitRange: profitRange,
           statusQuoProfit: statusQuoProfit, lineThrough: lineThrough,
           buyersAt: buyersAt, profitAtPrice: profitAtPrice, clean: clean, schedule: schedule, bestPrice: bestPrice, fitLine: fitLine, linePricing: linePricing,
           segmentation: segmentation, histogram: histogram, median: median, chart: chart, bookTable: bookTable };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PricingCore;
