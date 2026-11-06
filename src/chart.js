/* SVG charts for the Marketplace Laboratory page: a port of app/charts.py.
   A figure is data (traces, markers, guide lines); render() turns it into SVG
   and a legend description. Plain script; depends on MarketLab (engine.js). */
var MLChart = (function () {
  "use strict";
  var M = (typeof MarketLab !== "undefined") ? MarketLab : require("./engine.js");
  var COLORS = { supply: "#2a78d6", demand: "#e34948", gov: "#1baf7a", dwl: "#eb6834", third: "#7b4fb3",
                 text: "#52514e", grid: "#ececea", black: "#0b0b0b" };

  function clipPath(points, q1, q2) {
    var out = [];
    for (var i = 0; i < points.length - 1; i++) {
      var qa = points[i][0], pa = points[i][1], qb = points[i + 1][0], pb = points[i + 1][1];
      var lo = Math.min(qa, qb), hi = Math.max(qa, qb);
      if (hi < q1 - 1e-12 || lo > q2 + 1e-12) continue;
      if (hi - lo <= 1e-12) { if (q1 + 1e-9 < qa && qa < q2 - 1e-9) { out.push([qa, pa]); out.push([qb, pb]); } continue; }
      var a = Math.max(q1, lo), b = Math.min(q2, hi);
      [a, b].forEach(function (q) { var t = (q - qa) / (qb - qa); out.push([q, pa + t * (pb - pa)]); });
    }
    var dedup = [];
    out.forEach(function (pt) { if (!dedup.length || Math.abs(dedup[dedup.length - 1][0] - pt[0]) > 1e-12 || Math.abs(dedup[dedup.length - 1][1] - pt[1]) > 1e-12) dedup.push(pt); });
    return dedup;
  }
  function area(traces, top, bottom, color, alpha, name, hatch, legendonly) {
    if (top.length < 2) return;
    var pts;
    if (typeof bottom === "number") { var q1 = top[0][0], q2 = top[top.length - 1][0]; pts = top.concat([[q2, bottom], [q1, bottom]]); }
    else pts = top.concat(bottom.slice().reverse());
    traces.push({ kind: "area", pts: pts, color: color, alpha: alpha, name: name, hatch: hatch || null, legendonly: !!legendonly });
  }
  function line(traces, pts, color, width, dash, name) {
    traces.push({ kind: "line", pts: pts, color: color, width: width, dash: dash || null, name: name });
  }
  function netPrice(out, side) {
    for (var i = 0; i < out.regions.length; i++) { var r = out.regions[i]; if (r.side === side && r.quantity > 0) return r.net_price; }
    return out.price;
  }
  function cap1(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function thousands(x) { return Number(x.toFixed(1)).toLocaleString("en-GB"); }

  function marketFigure(market, policy, out, benchOut) {
    policy = M.defaultPolicy(policy);
    var real = new M.Curves(market, M.stripped(policy)), eff = new M.Curves(market, policy);
    var allBps = real.breakpoints().concat(eff.breakpoints());
    var ctrlVals = (policy.control === "ceiling" || policy.control === "floor") && policy.control_value ? [policy.control_value] : [];
    var pMax = Math.max.apply(null, allBps.concat(ctrlVals, [1])) * 1.08;
    var qMax = Math.max(real.totalSupplyMass(), real.totalDemandMass(), 1) * 1.05;
    var traces = [], notes = [];
    var regionalTax = Object.keys(policy.regional || {}).some(function (n) { return M.regionPolicy(policy, n).tax; });
    var caps = Object.keys(eff.caps).length > 0;
    var simple = !regionalTax && !caps && out.quantity > 0;
    var dPts = M.curvePoints(real, M.DEMAND, pMax), sPts = M.curvePoints(real, M.SUPPLY, pMax);
    if (simple) {
      var buyerPrice = netPrice(out, M.DEMAND), sellerPrice = netPrice(out, M.SUPPLY);
      var dServed = M.servedCurvePoints(out, M.DEMAND, policy.tax_demand), sServed = M.servedCurvePoints(out, M.SUPPLY, -policy.tax_supply);
      var Q = out.quantity;
      // A lottery: everyone willing has the same chance, so the side's surplus is a share of the whole triangle it would
      // get if all of them traded. Draw that triangle, dotted, and say what share of it is won; the other side as usual.
      var lottery = policy.rationing === "random" && out.control_binding && out.rationed_side && out.shortage > 1e-9;
      var willing = Q + out.shortage;
      if (lottery && out.rationed_side === M.DEMAND) {
        var tri = clipPath(dPts, 0, willing), top = tri.length ? tri[0][1] : buyerPrice;
        area(traces, tri, buyerPrice, COLORS.demand, 0.12, "Consumer surplus: a " + M.num(Q) + "-in-" + M.num(willing) + " share of the dotted triangle", ".");
        notes.push({ q: willing * 0.85, p: buyerPrice + 0.8 * (top - buyerPrice), to: [willing * 0.3, buyerPrice + 0.3 * (top - buyerPrice)],
                     text: "Consumer surplus = " + M.num(Q) + "/" + M.num(willing) + " of this triangle = " + thousands(out.consumer_surplus) });
      } else area(traces, clipPath(dServed, 0, Q), buyerPrice, COLORS.demand, 0.25, "Consumer surplus");
      if (lottery && out.rationed_side === M.SUPPLY) {
        var triS = clipPath(sPts, 0, willing), bottom = triS.length ? triS[0][1] : sellerPrice;
        area(traces, triS, sellerPrice, COLORS.supply, 0.12, "Producer surplus: a " + M.num(Q) + "-in-" + M.num(willing) + " share of the dotted triangle", ".");
        notes.push({ q: willing * 0.85, p: sellerPrice - 0.8 * (sellerPrice - bottom), to: [willing * 0.3, sellerPrice - 0.3 * (sellerPrice - bottom)],
                     text: "Producer surplus = " + M.num(Q) + "/" + M.num(willing) + " of this triangle = " + thousands(out.producer_surplus) });
      } else area(traces, clipPath(sServed, 0, Q), sellerPrice, COLORS.supply, 0.25, "Producer surplus");
      if (buyerPrice - sellerPrice > 1e-9 && out.government_revenue > 1e-9)
        area(traces, [[0, buyerPrice], [Q, buyerPrice]], sellerPrice, COLORS.gov, 0.30, out.licence_rent > out.tax_revenue ? "Licence rent" : "Tax revenue");
      // Under a lottery the lost trades are not a definite set of buyers, so the usual triangle is not drawn: the dotted
      // triangle and its note carry the story, and the loss is read from the Outcomes table.
      if (benchOut.quantity > Q + 1e-9 && !lottery)
        area(traces, clipPath(dPts, Q, benchOut.quantity), clipPath(sPts, Q, benchOut.quantity), COLORS.dwl, 0.35, "Deadweight loss: lost trades", "/");
      if (out.rationing_loss > 1e-9 && out.rationed_side === M.DEMAND && !lottery) {
        area(traces, clipPath(dPts, 0, Q), clipPath(dServed, 0, Q), COLORS.dwl, 0.35, "Deadweight loss: rationing", "\\");
        line(traces, dServed, COLORS.demand, 1.5, "dot", "Values of the buyers actually served");
      }
      if (out.rationing_loss > 1e-9 && out.rationed_side === M.SUPPLY && !lottery) {
        area(traces, clipPath(sServed, 0, Q), clipPath(sPts, 0, Q), COLORS.dwl, 0.35, "Deadweight loss: rationing", "\\");
        line(traces, sServed, COLORS.supply, 1.5, "dot", "Costs of the sellers actually selling");
      }
    }
    // The shifted curve is drawn only for a side that is actually taxed or subsidised (everyone, or one of its regions),
    // and named after what was done to it.
    var shifted = function (side, all, plus, minus, both) {
      var taxes = out.regions.filter(function (r) { return r.side === side; }).map(function (r) { return M.regionPolicy(policy, r.name).tax || 0; }).concat([all || 0]);
      var up = taxes.some(function (t) { return t > 1e-12; }), down = taxes.some(function (t) { return t < -1e-12; });
      return up && down ? both : up ? plus : down ? minus : null;
    };
    var sName = shifted(M.SUPPLY, policy.tax_supply, "Supply plus tax", "Supply minus subsidy", "Supply after taxes and subsidies");
    var dName = shifted(M.DEMAND, policy.tax_demand, "Demand minus tax", "Demand plus subsidy", "Demand after taxes and subsidies");
    if (sName) line(traces, M.curvePoints(eff, M.SUPPLY, pMax), COLORS.supply, 1.5, "dash", sName);
    if (dName) line(traces, M.curvePoints(eff, M.DEMAND, pMax), COLORS.demand, 1.5, "dash", dName);
    line(traces, sPts, COLORS.supply, 2.5, null, "Supply");
    line(traces, dPts, COLORS.demand, 2.5, null, "Demand");
    var hlines = [], vlines = [], markers = [];
    if ((policy.control === "ceiling" || policy.control === "floor") && policy.control_value != null) hlines.push({ y: policy.control_value, label: cap1(policy.control) });
    if (policy.control === "quota" && policy.control_value != null && out.control_binding) vlines.push({ x: policy.control_value, label: "Quota" });
    if (out.quantity > 0) markers.push({ q: out.quantity, p: out.price, color: COLORS.black, name: "Market outcome", guides: "both", hollow: false });
    // When a control leaves willing traders out, show how many wanted to trade at that price: a hollow dot on the
    // rationed side's curve at the willing quantity, so a lottery reads as "70 wanted one, 30 were drawn".
    if (out.control_binding && out.rationed_side && out.shortage > 1e-9) {
      var willing = out.quantity + out.shortage, dem = out.rationed_side === M.DEMAND;
      markers.push({ q: willing, p: out.price, color: dem ? COLORS.demand : COLORS.supply,
                     name: (dem ? "Buyers who want to buy at this price: " : "Sellers who want to sell at this price: ") + M.num(willing), guides: "vertical", hollow: true });
    }
    return { traces: traces, hlines: hlines, vlines: vlines, markers: markers, notes: notes, qMax: qMax, pMax: pMax };
  }

  function externalityFigure(market, policy, soc) {
    policy = M.defaultPolicy(policy);
    var out = soc.out, opt = soc.opt, harm = soc.harm_per_unit, negative = harm >= 0;
    var real = new M.Curves(market, M.stripped(policy)), eff = new M.Curves(market, policy);
    var socPol = M.stripped(policy); if (negative) socPol.tax_supply = harm; else socPol.tax_demand = harm;
    var socCur = new M.Curves(market, socPol);
    var allBps = real.breakpoints().concat(eff.breakpoints(), socCur.breakpoints());
    var pMax = Math.max.apply(null, allBps.concat([1])) * 1.08;
    var qMax = Math.max(real.totalSupplyMass(), real.totalDemandMass(), 1) * 1.05;
    var traces = [];
    var dPts = M.curvePoints(real, M.DEMAND, pMax), sPts = M.curvePoints(real, M.SUPPLY, pMax);
    var socPts = M.curvePoints(socCur, negative ? M.SUPPLY : M.DEMAND, pMax);
    var Q = out.quantity, Qo = opt.quantity;
    var regionalTax = Object.keys(policy.regional || {}).some(function (n) { return M.regionPolicy(policy, n).tax; });
    var simple = out.quantity > 0 && !regionalTax && !Object.keys(eff.caps).length;
    if (simple) {
      var buyerPrice = netPrice(out, M.DEMAND), sellerPrice = netPrice(out, M.SUPPLY);
      var dServed = M.servedCurvePoints(out, M.DEMAND, policy.tax_demand), sServed = M.servedCurvePoints(out, M.SUPPLY, -policy.tax_supply);
      area(traces, clipPath(dServed, 0, Q), buyerPrice, COLORS.demand, 0.25, "Consumer surplus");
      area(traces, clipPath(sServed, 0, Q), sellerPrice, COLORS.supply, 0.25, "Producer surplus");
      if (Math.abs(buyerPrice - sellerPrice) > 1e-9 && Math.abs(out.government_revenue) > 1e-9) {
        var name = out.licence_rent > out.tax_revenue ? "Permit revenue" : (out.government_revenue > 0 ? "Tax revenue" : "Subsidy paid");
        area(traces, [[0, buyerPrice], [Q, buyerPrice]], sellerPrice, COLORS.gov, 0.30, name);
      }
    }
    var lo = Math.min(Q, Qo), hi = Math.max(Q, Qo);
    if (hi > lo + 1e-9) {
      var other = negative ? dPts : sPts;
      area(traces, clipPath(socPts, lo, hi), clipPath(other, lo, hi), COLORS.dwl, 0.35,
           Q > Qo ? "Deadweight loss: too much traded" : "Deadweight loss: too little traded", "/");
    }
    if (Math.abs(harm) > 1e-12 && Q > 1e-9) {
      var basePts = negative ? sPts : dPts;
      area(traces, clipPath(socPts, 0, Q), clipPath(basePts, 0, Q), COLORS.third, 0.25, negative ? "Harm to third parties" : "Benefit to third parties", "\\", true);
    }
    if (Math.abs(policy.tax_supply) > 1e-12) line(traces, M.curvePoints(eff, M.SUPPLY, pMax), COLORS.supply, 1.5, "dash", policy.tax_supply > 0 ? "Supply plus tax" : "Supply minus subsidy");
    if (Math.abs(policy.tax_demand) > 1e-12) line(traces, M.curvePoints(eff, M.DEMAND, pMax), COLORS.demand, 1.5, "dash", policy.tax_demand > 0 ? "Demand minus tax" : "Demand plus subsidy");
    if (Math.abs(harm) > 1e-12) line(traces, socPts, COLORS.third, 2.2, "longdash", negative ? "Social marginal cost (supply plus harm)" : "Social marginal benefit (demand plus benefit)");
    line(traces, sPts, COLORS.supply, 2.5, null, "Supply (private marginal cost)");
    line(traces, dPts, COLORS.demand, 2.5, null, "Demand (private marginal benefit)");
    var vlines = [], markers = [];
    if (policy.control === "quota" && policy.control_value != null && out.control_binding) vlines.push({ x: policy.control_value, label: "Permit cap" });
    if (Math.abs(harm) > 1e-12 && Qo > 1e-9) markers.push({ q: Qo, p: negative ? soc.opt_buyer_price : soc.opt_seller_price, color: COLORS.third, name: "Social optimum", guides: "vertical", hollow: true });
    if (out.quantity > 0) markers.push({ q: out.quantity, p: out.price, color: COLORS.black, name: "Market outcome", guides: "both", hollow: false });
    return { traces: traces, hlines: [], vlines: vlines, markers: markers, qMax: qMax, pMax: pMax };
  }

  // ---- rendering --------------------------------------------------------------
  function rgba(hex, a) { var h = hex.replace("#", ""); return "rgba(" + parseInt(h.substr(0, 2), 16) + "," + parseInt(h.substr(2, 2), 16) + "," + parseInt(h.substr(4, 2), 16) + "," + a + ")"; }
  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    var step = r < 1.5 ? 1 : (r < 3 ? 2 : (r < 7 ? 5 : 10));
    return step * mag;
  }
  function ticks(max, target) { var step = niceStep(max, target || 6), out = []; for (var v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(10)); return out; }
  function dashAttr(d) { return d === "dash" ? ' stroke-dasharray="8,5"' : d === "longdash" ? ' stroke-dasharray="14,6"' : d === "dot" ? ' stroke-dasharray="2,4"' : d === "dashdot" ? ' stroke-dasharray="10,4,2,4"' : ""; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function render(fig, hidden) {
    hidden = hidden || {};
    var W = 760, H = 430, ml = 54, mr = 14, mt = 14, mb = 44, pw = W - ml - mr, ph = H - mt - mb;
    var X = function (q) { return ml + q / fig.qMax * pw; }, Y = function (p) { return H - mb - p / fig.pMax * ph; };
    var defs = [], body = [];
    ticks(fig.qMax, 6).forEach(function (t) {
      body.push('<line x1="' + X(t) + '" x2="' + X(t) + '" y1="' + mt + '" y2="' + (H - mb) + '" stroke="' + COLORS.grid + '"/>');
      body.push('<text x="' + X(t) + '" y="' + (H - mb + 16) + '" text-anchor="middle" class="tick">' + M.num(t) + '</text>');
    });
    ticks(fig.pMax, 6).forEach(function (t) {
      body.push('<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="' + COLORS.grid + '"/>');
      body.push('<text x="' + (ml - 6) + '" y="' + (Y(t) + 4) + '" text-anchor="end" class="tick">' + M.num(t) + '</text>');
    });
    body.push('<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (H - mb) + '" y2="' + (H - mb) + '" stroke="' + COLORS.text + '" stroke-width="1.2"/>');
    body.push('<line x1="' + ml + '" x2="' + ml + '" y1="' + mt + '" y2="' + (H - mb) + '" stroke="' + COLORS.text + '" stroke-width="1.2"/>');
    body.push('<text x="' + (ml + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">Quantity</text>');
    body.push('<text transform="translate(14,' + (mt + ph / 2) + ') rotate(-90)" text-anchor="middle" class="axis">Price</text>');
    body.push('<clipPath id="plot"><rect x="' + ml + '" y="' + mt + '" width="' + pw + '" height="' + ph + '"/></clipPath>');
    body.push('<g clip-path="url(#plot)">');
    fig.traces.forEach(function (t, i) {
      var off = hidden[t.name] !== undefined ? hidden[t.name] : !!t.legendonly;
      if (off) return;
      var d = t.pts.map(function (qp) { return X(qp[0]).toFixed(2) + "," + Y(qp[1]).toFixed(2); }).join(" ");
      if (t.kind === "area") {
        if (t.hatch === ".") {
          var did = "dots" + i;
          defs.push('<pattern id="' + did + '" patternUnits="userSpaceOnUse" width="7" height="7"><rect width="7" height="7" fill="' + rgba(t.color, t.alpha) + '"/>' +
                    '<circle cx="3.5" cy="3.5" r="1.2" fill="' + rgba(t.color, 0.7) + '"/></pattern>');
          body.push('<polygon points="' + d + '" fill="url(#' + did + ')" stroke="none"/>');
        } else if (t.hatch) {
          var pid = "hatch" + i, rot = t.hatch === "/" ? -45 : 45;
          defs.push('<pattern id="' + pid + '" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(' + rot + ')">' +
                    '<rect width="7" height="7" fill="' + rgba(t.color, 0.15) + '"/><line x1="0" y1="0" x2="0" y2="7" stroke="' + rgba(t.color, 0.9) + '" stroke-width="1.6"/></pattern>');
          body.push('<polygon points="' + d + '" fill="url(#' + pid + ')" stroke="none"/>');
        } else body.push('<polygon points="' + d + '" fill="' + rgba(t.color, t.alpha) + '" stroke="none"/>');
      } else body.push('<polyline points="' + d + '" fill="none" stroke="' + t.color + '" stroke-width="' + t.width + '"' + dashAttr(t.dash) + ' stroke-linejoin="round"/>');
    });
    body.push("</g>");
    fig.hlines.forEach(function (l) {
      body.push('<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(l.y) + '" y2="' + Y(l.y) + '" stroke="' + COLORS.text + '" stroke-width="1.5"' + dashAttr("dashdot") + '/>');
      body.push('<text x="' + (W - mr - 4) + '" y="' + (Y(l.y) - 5) + '" text-anchor="end" class="tick">' + esc(l.label) + '</text>');
    });
    fig.vlines.forEach(function (l) {
      body.push('<line x1="' + X(l.x) + '" x2="' + X(l.x) + '" y1="' + mt + '" y2="' + (H - mb) + '" stroke="' + COLORS.text + '" stroke-width="1.5"' + dashAttr("dashdot") + '/>');
      body.push('<text x="' + (X(l.x) + 4) + '" y="' + (mt + 12) + '" class="tick">' + esc(l.label) + '</text>');
    });
    (fig.notes || []).forEach(function (n, i) {
      var aid = "arrow" + i;
      defs.push('<marker id="' + aid + '" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="' + COLORS.text + '"/></marker>');
      var x1 = X(n.q), y1 = Y(n.p), x2 = X(n.to[0]), y2 = Y(n.to[1]);
      body.push('<line x1="' + x1 + '" y1="' + (y1 + 6) + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + COLORS.text + '" stroke-width="1.3" marker-end="url(#' + aid + ')"/>');
      body.push('<text x="' + x1 + '" y="' + y1 + '" text-anchor="middle" class="note-text" paint-order="stroke" stroke="white" stroke-width="4" fill="' + COLORS.text + '">' + esc(n.text) + '</text>');
    });
    fig.markers.forEach(function (m) {
      if (m.guides === "both" || m.guides === "horizontal") body.push('<line x1="' + ml + '" x2="' + X(m.q) + '" y1="' + Y(m.p) + '" y2="' + Y(m.p) + '" stroke="' + m.color + '" stroke-width="1"' + dashAttr("dot") + '/>');
      if (m.guides === "both" || m.guides === "vertical") body.push('<line x1="' + X(m.q) + '" x2="' + X(m.q) + '" y1="' + Y(m.p) + '" y2="' + (H - mb) + '" stroke="' + m.color + '" stroke-width="1"' + dashAttr("dot") + '/>');
      body.push('<circle cx="' + X(m.q) + '" cy="' + Y(m.p) + '" r="5.5" fill="' + (m.hollow ? "white" : m.color) + '" stroke="' + (m.hollow ? m.color : "white") + '" stroke-width="2"><title>' + esc(m.name) + ": Q " + M.num(m.q) + ", P " + M.num(m.p) + '</title></circle>');
    });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Supply and demand chart"><defs>' + defs.join("") + '</defs>' + body.join("") + '</svg>';
    var legend = fig.traces.map(function (t) {
      return { name: t.name, color: t.color, kind: t.kind, hatch: t.hatch, dash: t.dash, off: hidden[t.name] !== undefined ? hidden[t.name] : !!t.legendonly };
    }).concat(fig.markers.filter(function (m) { return m.hollow; }).map(function (m) { return { name: m.name, color: m.color, kind: "marker", off: false, fixed: true }; }));
    return { svg: svg, legend: legend };
  }

  function legendHtml(legend) {
    return '<div class="legend">' + legend.map(function (it) {
      var sw;
      if (it.kind === "area") sw = '<span class="sw area" style="background:' + rgba(it.color, it.hatch ? 0.6 : 0.35) + '"></span>';
      else if (it.kind === "line") sw = '<span class="sw line" style="border-top:2.5px ' + (it.dash ? "dashed" : "solid") + ' ' + it.color + '"></span>';
      else sw = '<span class="sw dot" style="border-color:' + it.color + '"></span>';
      return '<button type="button" class="legend-item' + (it.off ? " off" : "") + (it.fixed ? " fixed" : "") + '" data-name="' + esc(it.name) + '"' + (it.fixed ? ' disabled' : '') + '>' + sw + esc(it.name) + '</button>';
    }).join("") + "</div>";
  }

  return { COLORS: COLORS, marketFigure: marketFigure, externalityFigure: externalityFigure, render: render, legendHtml: legendHtml, clipPath: clipPath };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MLChart;
