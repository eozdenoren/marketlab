/* Marketplace Laboratory: the lab-book table (pinned experiments side by side with their baselines), shared by the
   class page (app.js) and the instructor page (instructor.js). Depends on MarketLab (engine.js). */
var MLBook = (function () {
  "use strict";
  var M = MarketLab;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmt(x, d, signed) {
    if (x == null || (typeof x === "number" && isNaN(x))) return "–";
    if (d === undefined) d = 1;
    if (Math.abs(x) < 5e-10) x = 0;
    var s = Math.abs(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
    return (x < 0 ? "-" : (signed ? "+" : "")) + s;
  }
  function cell(x) { return x == null ? "–" : (typeof x === "string" ? x : fmt(x)); }
  function sameMarket(a, b) {
    return ["Market price", "Quantity traded"].every(function (k) { return a[k] != null && b[k] != null && Math.abs(a[k] - b[k]) <= 1e-6; });
  }
  function baselineName(e) {
    if (e.tab !== "externality") return "Baseline";
    var h = +(((e.state || {}).policy || {}).harm || 0);
    return "Baseline, " + (h >= 0 ? "harm " : "benefit ") + M.num(Math.abs(h));
  }
  // The table: rows are the measures present in any column; columns are the baselines (one per tab and harm) and then
  // the pinned experiments in order. Each pinned value carries its change from that experiment's own baseline, small
  // and grey under the number; not where the baseline is 0 (revenue, the loss, a shortage), since there the number is
  // the change. opts.removable adds the ✕ button per pinned column (the class page); opts.mark is {id: html} put in
  // front of a column's label (the instructor page's verification mark).
  function table(entries, opts) {
    opts = opts || {};
    var cols = [], foot = [], seen = {}, bases = {};
    entries.forEach(function (e) { var k = e.tab + "|" + baselineName(e); if (!bases[k]) { bases[k] = e.baseline; cols.push([baselineName(e), e.baseline, null]); } });
    entries.forEach(function (e) {
      var label = (e.label || "Experiment").trim(), n = (seen[label] || 0) + 1; seen[label] = n; if (n > 1) label += " (" + n + ")";
      var base = bases[e.tab + "|" + baselineName(e)];
      if (!sameMarket(e.baseline, base)) { foot.push("† " + label + " was run on a different market; its own baseline has price " + cell(e.baseline["Market price"]) + " and quantity " + cell(e.baseline["Quantity traded"]) + "."); label += " †"; }
      cols.push([label, e.measures, e.id, e.baseline]);
    });
    var rows = M.MEASURES.filter(function (m) { return cols.some(function (c) { return c[1][m] != null; }); })
                .concat(M.extraMeasures(cols.map(function (c) { return c[1]; })));
    var h = '<div class="labbook-wrap"><table class="grid labbook"><thead><tr><th></th>' + cols.map(function (c) {
      var mark = c[2] && opts.mark && opts.mark[c[2]] ? opts.mark[c[2]] + " " : "";
      var btn = c[2] && opts.removable ? '<button type="button" class="small remove-entry" data-id="' + c[2] + '" title="Remove this column from the lab book" aria-label="Remove ' + esc(c[0]) + '">✕</button>' : "";
      return '<th>' + btn + mark + esc(c[0]) + '</th>';
    }).join("") + '</tr></thead><tbody>';
    var delta = function (c, m) { var v = c[1][m], b = c[3] && c[3][m]; return (c[3] && v != null && b != null && typeof v === "number" && Math.abs(b) > 1e-9 && Math.abs(v - b) > 1e-9) ? '<span class="delta">' + fmt(v - b, 1, true) + '</span>' : ''; };
    rows.forEach(function (m) { h += '<tr><td>' + esc(m) + '</td>' + cols.map(function (c) { return '<td class="num">' + cell(c[1][m]) + delta(c, m) + '</td>'; }).join("") + '</tr>'; });
    h += '</tbody></table></div>';
    foot.forEach(function (f) { h += '<p class="caption">' + esc(f) + '</p>'; });
    return h;
  }
  return { esc: esc, fmt: fmt, cell: cell, sameMarket: sameMarket, baselineName: baselineName, table: table };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MLBook;
