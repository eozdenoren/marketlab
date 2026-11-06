/* Run the JavaScript engine on tests/cases.json (from gen_cases.py) and
   compare every number with the Python engine's. node tests/check_engine.js */
const fs = require("fs");
const path = require("path");
const M = require(path.join(__dirname, "..", "src", "engine.js"));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
const TOL = 1e-6;
let failures = [], checked = 0;

function same(a, b) {
  if (a === "nan" || (typeof a === "number" && isNaN(a))) return b === "nan" || (typeof b === "number" && isNaN(b));
  if (a === null || b === null) return a === b;
  if (typeof a === "boolean" || typeof a === "string") return a === b;
  return Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b));
}
function check(id, what, got, want) {
  checked++;
  if (!same(got, want)) failures.push(`${id} ${what}: js=${JSON.stringify(got)} py=${JSON.stringify(want)}`);
}
function checkPts(id, what, got, want) {
  check(id, what + ".length", got.length, want.length);
  if (got.length !== want.length) return;
  for (let i = 0; i < got.length; i++) { check(id, `${what}[${i}].q`, got[i][0], want[i][0]); check(id, `${what}[${i}].p`, got[i][1], want[i][1]); }
}
function checkOutcome(id, tag, o, want) {
  for (const k of ["price", "quantity", "consumer_surplus", "producer_surplus", "tax_revenue", "licence_rent", "total_surplus",
                   "deadweight_loss", "rationing_loss", "shortage", "rationed_side", "control_binding", "elasticity_demand", "elasticity_supply"]) {
    check(id, `${tag}.${k}`, o[k], want[k]);
  }
  check(id, `${tag}.flags.indeterminate`, o.flags.indeterminate_price, want.flags.indeterminate_price);
  check(id, `${tag}.flags.no_trade`, o.flags.no_trade, want.flags.no_trade);
  check(id, `${tag}.regions.length`, o.regions.length, want.regions.length);
  o.regions.forEach((r, i) => {
    const w = want.regions[i];
    for (const k of ["name", "side", "quantity", "surplus", "tax", "rent", "net_price", "willing", "capped"]) check(id, `${tag}.regions[${i}].${k}`, r[k], w[k]);
  });
}

for (const c of cases) {
  const market = M.buildMarket(c.rows.supply, c.rows.demand);
  const base = M.solve(market, {});
  let out;
  try { out = M.solve(market, c.policy); }
  catch (e) { if (c.error) { check(c.id, "error", e.message, c.error); continue; } failures.push(`${c.id} unexpected error ${e.message}`); continue; }
  if (c.error) { failures.push(`${c.id} expected error ${c.error}`); continue; }
  checkOutcome(c.id, "base", base, c.base);
  checkOutcome(c.id, "out", out, c.out);
  const groups = M.compare(base, out);
  const key = g => `${g.region}|${g.side}|${g.kind}`;
  const want = {}; c.groups.forEach(g => { want[key(g)] = g; });
  const got = {}; groups.forEach(g => { got[key(g)] = g; });
  check(c.id, "groups.count", Object.keys(got).length, Object.keys(want).length);
  for (const k of Object.keys(want)) {
    if (!got[k]) { failures.push(`${c.id} missing group ${k}`); continue; }
    check(c.id, `group ${k}.mass`, got[k].mass, want[k].mass);
    check(c.id, `group ${k}.change`, got[k].change, want[k].change);
  }
  const meas = M.measuresLab(out);
  for (const k of new Set([...M.MEASURES, ...Object.keys(c.measures), ...Object.keys(meas)])) check(c.id, `measure ${k}`, meas[k], c.measures[k]);
  check(c.id, "label", M.describeLab(c.policy), c.label);
  const real = new M.Curves(market, M.stripped(M.defaultPolicy(c.policy)));
  checkPts(c.id, "curve.supply", M.curvePoints(real, M.SUPPLY, c.p_max), c.curves.supply);
  checkPts(c.id, "curve.demand", M.curvePoints(real, M.DEMAND, c.p_max), c.curves.demand);
  if (c.served) {
    const pol = M.defaultPolicy(c.policy);
    checkPts(c.id, "served.demand", M.servedCurvePoints(out, M.DEMAND, pol.tax_demand), c.served.demand);
    checkPts(c.id, "served.supply", M.servedCurvePoints(out, M.SUPPLY, -pol.tax_supply), c.served.supply);
  }
  if (c.social) {
    const s = M.solveSocial(market, c.social.policy, c.social.harm);
    for (const k of ["third_party", "private_surplus", "social_surplus", "opt_quantity", "opt_buyer_price", "opt_seller_price", "opt_surplus", "deadweight_loss"]) {
      check(c.id, `social.${k}`, s[k], c.social[k]);
    }
    const ms = M.measuresSocial(s);
    for (const k of M.MEASURES) check(c.id, `social measure ${k}`, ms[k], c.social.measures[k]);
    check(c.id, "social.label", M.describeExt(c.social.policy, c.social.harm), c.social.label);
  }
}
console.log(`${cases.length} cases, ${checked} values checked, ${failures.length} mismatches`);
failures.slice(0, 25).forEach(f => console.log("  " + f));
process.exit(failures.length ? 1 : 0);
