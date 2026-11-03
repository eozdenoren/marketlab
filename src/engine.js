/* Marketplace Laboratory engine: a line-by-line port of app/engine.py,
   app/externality.py and the measures/labels of app/labbook.py.
   Plain script: defines MarketLab (browser) and exports it for Node tests. */
var MarketLab = (function () {
  "use strict";
  var SUPPLY = "supply", DEMAND = "demand";
  var RULES = ["efficient", "random", "inefficient"];
  var CONTROLS = ["none", "ceiling", "floor", "quota"];

  function clip(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function normSeg(s) {
    var lo = Math.min(+s.pmin, +s.pmax), hi = Math.max(+s.pmin, +s.pmax);
    return { quantity: Math.max(0, +s.quantity), pmin: lo, pmax: hi };
  }
  function supplyRegions(m) { return m.regions.filter(function (r) { return r.side === SUPPLY; }); }
  function demandRegions(m) { return m.regions.filter(function (r) { return r.side === DEMAND; }); }

  // ---- policy -------------------------------------------------------------
  function defaultPolicy(over) {
    var p = { cost_shock: 0, benefit_boost: 0, tax_supply: 0, tax_demand: 0, control: "none",
              control_value: null, rationing: "efficient", rent_to: "sellers", regional: {} };
    if (over) for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k) && over[k] !== undefined) p[k] = over[k];
    if (!p.regional) p.regional = {};
    return p;
  }
  function regionPolicy(policy, name) {
    var rp = (policy.regional || {})[name] || {};
    return { scale: rp.scale == null ? 1 : +rp.scale, shift: +(rp.shift || 0), tax: +(rp.tax || 0),
             cap: rp.cap == null ? null : +rp.cap };
  }
  function stripped(policy) {
    var reg = {};
    for (var k in policy.regional || {}) {
      var v = regionPolicy(policy, k);
      reg[k] = { scale: v.scale, shift: v.shift, tax: 0, cap: null };
    }
    return defaultPolicy({ cost_shock: policy.cost_shock, benefit_boost: policy.benefit_boost, regional: reg });
  }

  // ---- effective segments and curves ---------------------------------------
  function effBlock(e) { return e.hi - e.lo <= 0; }
  function effDensity(e) { return effBlock(e) ? Infinity : e.mass / (e.hi - e.lo); }
  function effQ(e, p, limit) {
    if (e.mass <= 0) return 0;
    if (e.side === SUPPLY) {
      if (effBlock(e)) { if (p > e.lo) return e.mass; if (p < e.lo) return 0; return limit === "right" ? e.mass : 0; }
      return e.mass * clip((p - e.lo) / (e.hi - e.lo));
    }
    if (effBlock(e)) { if (p < e.hi) return e.mass; if (p > e.hi) return 0; return limit === "left" ? e.mass : 0; }
    return e.mass * clip((e.hi - p) / (e.hi - e.lo));
  }
  function buildEffective(market, policy) {
    var out = [];
    market.regions.forEach(function (r) {
      var rp = regionPolicy(policy, r.name);
      r.segments.forEach(function (s0, i) {
        var s = normSeg(s0), shift, tax, offset;
        if (r.side === SUPPLY) { shift = rp.shift + policy.cost_shock; tax = rp.tax + policy.tax_supply; offset = shift + tax; }
        else { shift = rp.shift + policy.benefit_boost; tax = rp.tax + policy.tax_demand; offset = shift - tax; }
        out.push({ region: r.name, side: r.side, index: i, mass: s.quantity * Math.max(0, rp.scale),
                   lo: s.pmin + offset, hi: s.pmax + offset, offset: offset, shift: shift, tax: tax });
      });
    });
    return out;
  }

  function Curves(market, policy) {
    this.market = market; this.policy = policy; this.effs = buildEffective(market, policy);
    this.caps = {};
    var self = this;
    supplyRegions(market).forEach(function (r) { var rp = regionPolicy(policy, r.name); if (rp.cap != null) self.caps[r.name] = rp.cap; });
    this.tol = 1e-9 * Math.max(1, this.effs.reduce(function (a, e) { return a + e.mass; }, 0));
  }
  Curves.prototype.supplyRegion = function (name, p, limit) {
    limit = limit || "right"; var q = 0;
    for (var i = 0; i < this.effs.length; i++) { var e = this.effs[i]; if (e.region === name && e.side === SUPPLY) q += effQ(e, p, limit); }
    var cap = this.caps[name]; return cap == null ? q : Math.min(q, Math.max(0, cap));
  };
  Curves.prototype.supply = function (p, limit) {
    limit = limit || "right"; var s = 0, regs = supplyRegions(this.market);
    for (var i = 0; i < regs.length; i++) s += this.supplyRegion(regs[i].name, p, limit);
    return s;
  };
  Curves.prototype.demand = function (p, limit) {
    limit = limit || "left"; var d = 0;
    for (var i = 0; i < this.effs.length; i++) if (this.effs[i].side === DEMAND) d += effQ(this.effs[i], p, limit);
    return d;
  };
  Curves.prototype.excess = function (p, limit) { return this.supply(p, limit) - this.demand(p, limit); };
  Curves.prototype.totalSupplyMass = function () {
    var t = 0, self = this;
    supplyRegions(this.market).forEach(function (r) {
      var m = 0; self.effs.forEach(function (e) { if (e.region === r.name) m += e.mass; });
      var cap = self.caps[r.name]; t += cap == null ? m : Math.min(cap, m);
    });
    return t;
  };
  Curves.prototype.totalDemandMass = function () { var t = 0; this.effs.forEach(function (e) { if (e.side === DEMAND) t += e.mass; }); return t; };
  Curves.prototype.breakpoints = function () {
    var pts = {}, self = this;
    this.effs.forEach(function (e) { if (e.mass > 0) { pts[e.lo] = e.lo; pts[e.hi] = e.hi; } });
    Object.keys(this.caps).forEach(function (name) { var p = self.regionInverseSupply(name, self.caps[name]); if (p != null) pts[p] = p; });
    return Object.keys(pts).map(function (k) { return pts[k]; }).sort(function (a, b) { return a - b; });
  };
  Curves.prototype.regionInverseSupply = function (name, q) {
    var segs = this.effs.filter(function (e) { return e.region === name && e.side === SUPPLY && e.mass > 0; });
    return inverseQuantity(segs, q, SUPPLY);
  };
  Curves.prototype.clear = function () {
    var flags = { indeterminate_price: false, no_trade: false };
    var S = this.totalSupplyMass(), D = this.totalDemandMass(), bps = this.breakpoints();
    if (S <= this.tol || D <= this.tol || !bps.length) { flags.no_trade = true; return [bps.length ? bps[0] : 0, 0, flags]; }
    var tol = this.tol, n = bps.length, self = this;
    var eRight = bps.map(function (b) { return self.excess(b, "right"); });
    var eLeft = [-D].concat(bps.slice(1).map(function (b) { return self.excess(b, "left"); }));
    for (var i = 0; i < n; i++) {
      var eL = eLeft[i], eR = eRight[i];
      if (eL <= tol && eR >= -tol && (eL < -tol || eR > tol)) {
        var p = bps[i], q = Math.min(this.supply(p, "right"), this.demand(p, "left"));
        return this.flatAdjust(p, q, i, bps, eRight, eLeft, flags);
      }
      if (i < n - 1 && eR < -tol && eLeft[i + 1] > tol) {
        var a = bps[i], b = bps[i + 1], pp = a + (b - a) * (-eR) / (eLeft[i + 1] - eR);
        return [pp, this.supply(pp, "right"), flags];
      }
    }
    var pl = bps[n - 1];
    return [pl, Math.min(this.supply(pl, "right"), this.demand(pl, "left")), flags];
  };
  Curves.prototype.flatAdjust = function (p, q, i, bps, eRight, eLeft, flags) {
    var tol = this.tol; if (Math.abs(eRight[i]) > tol) return [p, q, flags];
    var j = i, n = bps.length;
    while (j < n - 1 && Math.abs(eRight[j]) <= tol && Math.abs(eLeft[j + 1]) <= tol) j++;
    if (j > i) { var pHi = bps[j]; flags.indeterminate_price = true; flags.price_interval = [p, pHi];
                 var mid = 0.5 * (p + pHi); return [mid, this.supply(mid, "right"), flags]; }
    return [p, q, flags];
  };
  Curves.prototype.inverseDemand = function (q) {
    var bps = this.breakpoints(), self = this;
    if (q <= this.tol) return bps.length ? bps[bps.length - 1] : 0;
    var p = inverseDemandFn(function (x, l) { return self.demand(x, l); }, bps, q, this.tol);
    return p != null ? p : (bps.length ? bps[0] : 0);
  };
  Curves.prototype.inverseSupply = function (q) {
    var bps = this.breakpoints(), self = this;
    if (q <= this.tol) return bps.length ? bps[0] : 0;
    var p = inverseSupplyFn(function (x, l) { return self.supply(x, l); }, bps, q, this.tol);
    return p != null ? p : (bps.length ? bps[bps.length - 1] : 0);
  };

  function inverseSupplyFn(S, bps, q, tol) {
    if (!bps.length) return null;
    if (S(bps[0], "right") >= q - tol) return bps[0];
    for (var i = 0; i < bps.length - 1; i++) {
      var a = bps[i], b = bps[i + 1], sa = S(a, "right"), sb = S(b, "left");
      if (sb >= q - tol) { if (sb <= sa + tol) return a; return a + (b - a) * clip((q - sa) / (sb - sa)); }
      if (S(b, "right") >= q - tol) return b;
    }
    return null;
  }
  function inverseDemandFn(D, bps, q, tol) {
    if (!bps.length) return null;
    var top = bps[bps.length - 1];
    if (D(top, "left") >= q - tol) return top;
    for (var i = bps.length - 1; i >= 1; i--) {
      var b = bps[i], a = bps[i - 1], da = D(a, "right"), db = D(b, "left");
      if (da >= q - tol) { if (da <= db + tol) return b; return a + (b - a) * clip((da - q) / (da - db)); }
      if (D(a, "left") >= q - tol) return a;
    }
    return null;
  }
  function inverseQuantity(segs, q, side) {
    segs = segs.filter(function (e) { return e.mass > 0; });
    if (!segs.length) return null;
    var total = segs.reduce(function (a, e) { return a + e.mass; }, 0), tol = 1e-9 * Math.max(1, total);
    if (q > total + tol) return null;
    var set = {}; segs.forEach(function (e) { set[e.lo] = e.lo; set[e.hi] = e.hi; });
    var bps = Object.keys(set).map(function (k) { return set[k]; }).sort(function (a, b) { return a - b; });
    if (q <= tol) return side === DEMAND ? bps[bps.length - 1] : bps[0];
    var f = function (p, lim) { return segs.reduce(function (a, e) { return a + effQ(e, p, lim); }, 0); };
    return side === DEMAND ? inverseDemandFn(f, bps, q, tol) : inverseSupplyFn(f, bps, q, tol);
  }

  // ---- allocations --------------------------------------------------------
  function allocQuantity(a) {
    var e = a.eff;
    if (effBlock(e)) return a.pieces.reduce(function (s, p) { return s + p.prob * e.mass; }, 0);
    var d = effDensity(e); return a.pieces.reduce(function (s, p) { return s + p.prob * d * (p.hi - p.lo); }, 0);
  }
  function allocSurplus(a) {
    var e = a.eff, tot = 0;
    a.pieces.forEach(function (p) {
      var m, t;
      if (effBlock(e)) { m = p.prob * e.mass; t = e.lo; } else { m = p.prob * effDensity(e) * (p.hi - p.lo); t = 0.5 * (p.lo + p.hi); }
      tot += m * (e.side === SUPPLY ? (a.price_eff - t) : (t - a.price_eff));
    });
    return tot;
  }
  function allocTax(a) { return a.eff.tax * allocQuantity(a); }
  function willingPieces(e, p) {
    if (e.mass <= 0) return [];
    if (e.side === SUPPLY) {
      if (effBlock(e)) return e.lo <= p ? [{ lo: e.lo, hi: e.lo, prob: 1 }] : [];
      if (p <= e.lo) return [];
      return [{ lo: e.lo, hi: Math.min(e.hi, p), prob: 1 }];
    }
    if (effBlock(e)) return e.hi >= p ? [{ lo: e.hi, hi: e.hi, prob: 1 }] : [];
    if (p >= e.hi) return [];
    return [{ lo: Math.max(e.lo, p), hi: e.hi, prob: 1 }];
  }
  function pieceMass(e, pc) { return pc.prob * (effBlock(e) ? e.mass : effDensity(e) * (pc.hi - pc.lo)); }
  function willingMass(segs, willing) {
    var W = 0; willing.forEach(function (ps, k) { ps.forEach(function (pc) { W += pieceMass(segs[k], pc); }); }); return W;
  }
  function serveBest(segs, target, side) {
    var out = segs.map(function () { return []; });
    var total = segs.reduce(function (a, e) { return a + e.mass; }, 0), tol = 1e-9 * Math.max(1, total);
    if (target <= tol) return out;
    target = Math.min(target, total);
    var thr = inverseQuantity(segs, target, side);
    if (thr == null) return out;
    var strict = 0, ties = [];
    segs.forEach(function (e, k) {
      if (e.mass <= 0) return;
      if (side === DEMAND) {
        if (effBlock(e)) { if (e.lo > thr + tol) { out[k].push({ lo: e.lo, hi: e.lo, prob: 1 }); strict += e.mass; } else if (Math.abs(e.lo - thr) <= tol) ties.push(k); }
        else { var lo = Math.max(e.lo, thr); if (e.hi > lo + tol) { out[k].push({ lo: lo, hi: e.hi, prob: 1 }); strict += effDensity(e) * (e.hi - lo); } }
      } else {
        if (effBlock(e)) { if (e.lo < thr - tol) { out[k].push({ lo: e.lo, hi: e.lo, prob: 1 }); strict += e.mass; } else if (Math.abs(e.lo - thr) <= tol) ties.push(k); }
        else { var hi = Math.min(e.hi, thr); if (hi > e.lo + tol) { out[k].push({ lo: e.lo, hi: hi, prob: 1 }); strict += effDensity(e) * (hi - e.lo); } }
      }
    });
    var rem = target - strict;
    if (ties.length && rem > tol) {
      var tieMass = ties.reduce(function (a, k) { return a + segs[k].mass; }, 0), f = clip(rem / tieMass);
      ties.forEach(function (k) { out[k].push({ lo: segs[k].lo, hi: segs[k].lo, prob: f }); });
    }
    return out;
  }
  function serveWorst(segs, target, price, side) {
    var willing = segs.map(function (e) { return willingPieces(e, price); });
    var W = willingMass(segs, willing), tol = 1e-9 * Math.max(1, W);
    var out = segs.map(function () { return []; });
    if (target <= tol) return out;
    if (target >= W - tol) return willing;
    var best = serveBest(segs, W - target, side);
    segs.forEach(function (e, k) {
      willing[k].forEach(function (wp) {
        if (effBlock(e)) { var pb = best[k].reduce(function (a, b) { return a + b.prob; }, 0); if (1 - pb > tol) out[k].push({ lo: e.lo, hi: e.lo, prob: 1 - pb }); }
        else {
          var lo, hi;
          if (best[k].length) { var b = best[k][0]; if (side === DEMAND) { lo = wp.lo; hi = b.lo; } else { lo = b.hi; hi = wp.hi; } }
          else { lo = wp.lo; hi = wp.hi; }
          if (hi > lo + tol) out[k].push({ lo: lo, hi: hi, prob: 1 });
        }
      });
    });
    return out;
  }
  function serveRandom(segs, target, price) {
    var willing = segs.map(function (e) { return willingPieces(e, price); });
    var W = willingMass(segs, willing);
    if (W <= 0) return segs.map(function () { return []; });
    var f = clip(target / W);
    return willing.map(function (ps) { return ps.map(function (pc) { return { lo: pc.lo, hi: pc.hi, prob: pc.prob * f }; }); });
  }
  function ration(segs, target, price, side, rule) {
    var willing = segs.map(function (e) { return willingPieces(e, price); });
    var W = willingMass(segs, willing), tol = 1e-9 * Math.max(1, W);
    if (target >= W - tol) return willing;
    if (rule === "random") return serveRandom(segs, target, price);
    if (rule === "inefficient") return serveWorst(segs, target, price, side);
    return serveBest(segs, target, side);
  }

  // ---- solve --------------------------------------------------------------
  function solve(market, policy, withBenchmark) {
    if (withBenchmark === undefined) withBenchmark = true;
    policy = defaultPolicy(policy);
    if (RULES.indexOf(policy.rationing) < 0) throw new Error("unknown rationing rule " + policy.rationing);
    if (CONTROLS.indexOf(policy.control) < 0) throw new Error("unknown control " + policy.control);
    var cur = new Curves(market, policy), effs = cur.effs;
    var cl = cur.clear(), pStar = cl[0], qStar = cl[1], flags = cl[2];
    var price = pStar, quantity = qStar, rationedSide = null, shortage = 0, binding = false, sellerPrice = null;
    var ctrl = policy.control, val = policy.control_value;
    if (ctrl === "ceiling" && val != null && val < pStar - cur.tol && qStar > 0) {
      price = +val; quantity = cur.supply(price, "right"); shortage = cur.demand(price, "left") - quantity; rationedSide = DEMAND; binding = true;
    } else if (ctrl === "floor" && val != null && val > pStar + cur.tol && qStar > 0) {
      price = +val; quantity = cur.demand(price, "left"); shortage = cur.supply(price, "right") - quantity; rationedSide = SUPPLY; binding = true;
    } else if (ctrl === "quota" && val != null && val < qStar - cur.tol) {
      if (Object.keys(cur.caps).length) throw new Error("a market-wide quota cannot be combined with regional caps");
      quantity = Math.max(0, +val); price = cur.inverseDemand(quantity); binding = true;
      if (policy.rent_to === "government") sellerPrice = cur.inverseSupply(quantity);
      else { rationedSide = SUPPLY; shortage = cur.supply(price, "right") - quantity; }
    }
    var allocs = [];
    var dSegs = effs.filter(function (e) { return e.side === DEMAND; });
    var dPieces = ration(dSegs, quantity, price, DEMAND, rationedSide === DEMAND ? policy.rationing : "efficient");
    dSegs.forEach(function (e, k) { allocs.push({ eff: e, pieces: dPieces[k], price_eff: price }); });
    var sRegions = supplyRegions(market), pooled = [], pooledTarget = quantity, regionRent = {}, regionCapped = {};
    sRegions.forEach(function (r) {
      var segs = effs.filter(function (e) { return e.region === r.name && e.side === SUPPLY; });
      var cap = cur.caps[r.name];
      var raw = segs.reduce(function (a, e) { return a + effQ(e, price, "right"); }, 0);
      if (cap != null && raw > cap + cur.tol && quantity > cur.tol) {
        regionCapped[r.name] = true;
        var take = Math.min(cap, quantity); pooledTarget -= take;
        if (policy.rent_to === "government") {
          var pr = cur.regionInverseSupply(r.name, take); pr = pr == null ? price : Math.min(pr, price);
          var pcs = serveBest(segs, take, SUPPLY); regionRent[r.name] = (price - pr) * take;
          segs.forEach(function (e, k) { allocs.push({ eff: e, pieces: pcs[k], price_eff: pr }); });
        } else {
          var pcs2 = ration(segs, take, price, SUPPLY, policy.rationing);
          segs.forEach(function (e, k) { allocs.push({ eff: e, pieces: pcs2[k], price_eff: price }); });
        }
      } else { regionCapped[r.name] = false; segs.forEach(function (e) { pooled.push(e); }); }
    });
    if (sellerPrice != null) {
      var pcsP = serveBest(pooled, pooledTarget, SUPPLY), rentTotal = (price - sellerPrice) * pooledTarget;
      pooled.forEach(function (e, k) { allocs.push({ eff: e, pieces: pcsP[k], price_eff: sellerPrice }); });
      var qs = {}, totQ = 0;
      sRegions.forEach(function (r) { qs[r.name] = allocs.filter(function (a) { return a.eff.region === r.name; }).reduce(function (a, x) { return a + allocQuantity(x); }, 0); totQ += qs[r.name]; });
      totQ = totQ || 1;
      sRegions.forEach(function (r) { regionRent[r.name] = (regionRent[r.name] || 0) + rentTotal * qs[r.name] / totQ; });
    } else {
      var rule = rationedSide === SUPPLY ? policy.rationing : "efficient";
      var pcsQ = ration(pooled, Math.max(0, pooledTarget), price, SUPPLY, rule);
      pooled.forEach(function (e, k) { allocs.push({ eff: e, pieces: pcsQ[k], price_eff: price }); });
    }
    var regionsOut = [], cs = 0, ps = 0, tax = 0, rent = 0;
    market.regions.forEach(function (r) {
      var mine = allocs.filter(function (a) { return a.eff.region === r.name; });
      var q = mine.reduce(function (a, x) { return a + allocQuantity(x); }, 0);
      var s = mine.reduce(function (a, x) { return a + allocSurplus(x); }, 0);
      var t = mine.reduce(function (a, x) { return a + allocTax(x); }, 0);
      var rp = regionPolicy(policy, r.name), net, willing;
      if (r.side === SUPPLY) {
        var taxUnit = rp.tax + policy.tax_supply, priceEff = mine.length ? mine[0].price_eff : price;
        net = priceEff - taxUnit;
        willing = effs.filter(function (e) { return e.region === r.name; }).reduce(function (a, e) { return a + effQ(e, price, "right"); }, 0);
      } else {
        net = price + rp.tax + policy.tax_demand;
        willing = effs.filter(function (e) { return e.region === r.name; }).reduce(function (a, e) { return a + effQ(e, price, "left"); }, 0);
      }
      var rr = regionRent[r.name] || 0;
      regionsOut.push({ name: r.name, side: r.side, quantity: q, surplus: s, tax: t, rent: rr, net_price: net, willing: willing, capped: !!regionCapped[r.name] });
      if (r.side === SUPPLY) ps += s; else cs += s;
      tax += t; rent += rr;
    });
    var out = { price: price, quantity: quantity, allocs: allocs, regions: regionsOut, consumer_surplus: cs, producer_surplus: ps,
                tax_revenue: tax, licence_rent: rent, government_revenue: tax + rent, total_surplus: cs + ps + tax + rent,
                rationed_side: rationedSide, shortage: shortage, flags: flags, control_binding: binding,
                benchmark_surplus: NaN, deadweight_loss: NaN, rationing_loss: NaN, elasticity_demand: NaN, elasticity_supply: NaN };
    var el = elasticities(cur, price, quantity); out.elasticity_demand = el[0]; out.elasticity_supply = el[1];
    if (withBenchmark) {
      var bench = solve(market, stripped(policy), false);
      out.benchmark_surplus = bench.total_surplus; out.deadweight_loss = bench.total_surplus - out.total_surplus;
      var licensed = Object.keys(regionCapped).some(function (k) { return regionCapped[k]; }) && policy.rent_to === "sellers";
      if ((rationedSide != null || licensed) && policy.rationing !== "efficient") {
        var p2 = defaultPolicy(policy); p2.rationing = "efficient";
        out.rationing_loss = solve(market, p2, false).total_surplus - out.total_surplus;
      } else out.rationing_loss = 0;
    }
    return out;
  }
  function elasticities(cur, p, q) {
    if (q <= cur.tol || p <= 0) return [NaN, NaN];
    var h = 1e-6 * Math.max(1, Math.abs(p));
    var dD = (cur.demand(p + h, "right") - cur.demand(p - h, "left")) / (2 * h);
    var dS = (cur.supply(p + h, "right") - cur.supply(p - h, "left")) / (2 * h);
    return [-dD * p / q, dS * p / q];
  }

  // ---- winners and losers ----------------------------------------------------
  function probAt(pieces, x, block) {
    if (block) return pieces.reduce(function (a, p) { return a + p.prob; }, 0);
    for (var i = 0; i < pieces.length; i++) { var p = pieces[i]; if (p.lo - 1e-12 <= x && x <= p.hi + 1e-12) return p.prob; }
    return 0;
  }
  function accumulate(g, region, side, p0, p1, mass, x, s0, s1) {
    if (mass <= 0) return;
    var m, gg;
    if (p0 > 0 && p1 > 0) { m = mass * p0 * p1; gg = g(region, side, "kept"); gg.mass += m; gg.change += m * (s1(x) - s0(x)); }
    if (p0 > 0 && p1 < 1) { m = mass * p0 * (1 - p1); gg = g(region, side, "lost"); gg.mass += m; gg.change += -m * s0(x); }
    if (p1 > 0 && p0 < 1) { m = mass * (1 - p0) * p1; gg = g(region, side, "new"); gg.mass += m; gg.change += m * s1(x); }
  }
  function compare(before, after) {
    var groups = {}, order = [];
    var g = function (region, side, kind) {
      var key = region + "|" + side + "|" + kind;
      if (!groups[key]) { groups[key] = { region: region, side: side, kind: kind, mass: 0, change: 0 }; order.push(key); }
      return groups[key];
    };
    var bMap = {}, aMap = {}, keys = {};
    before.allocs.forEach(function (a) { var k = a.eff.region + "\u0000" + a.eff.index; bMap[k] = a; keys[k] = [a.eff.region, a.eff.index]; });
    after.allocs.forEach(function (a) { var k = a.eff.region + "\u0000" + a.eff.index; aMap[k] = a; keys[k] = [a.eff.region, a.eff.index]; });
    var sorted = Object.keys(keys).sort(function (x, y) { var kx = keys[x], ky = keys[y]; if (kx[0] < ky[0]) return -1; if (kx[0] > ky[0]) return 1; return kx[1] - ky[1]; });
    sorted.forEach(function (key) {
      var a0 = bMap[key], a1 = aMap[key];
      var e0 = a0 ? a0.eff : a1.eff, e1 = a1 ? a1.eff : a0.eff, side = e0.side, region = e0.region;
      var loU = e0.lo - e0.offset, hiU = e0.hi - e0.offset;
      var m0 = a0 ? a0.eff.mass : 0, m1 = a1 ? a1.eff.mass : 0, block = effBlock(e0), common = Math.min(m0, m1);
      var s0 = function (x) { return side === SUPPLY ? (a0.price_eff - (x + e0.offset)) : ((x + e0.offset) - a0.price_eff); };
      var s1 = function (x) { return side === SUPPLY ? (a1.price_eff - (x + e1.offset)) : ((x + e1.offset) - a1.price_eff); };
      var gg, m;
      if (block) {
        var p0 = a0 ? probAt(a0.pieces, e0.lo, true) : 0, p1 = a1 ? probAt(a1.pieces, e1.lo, true) : 0, x = loU;
        accumulate(g, region, side, p0, p1, common, x, a0 ? s0 : null, a1 ? s1 : null);
        if (m1 > m0 && a1) { gg = g(region, side, "new"); gg.mass += (m1 - m0) * p1; gg.change += (m1 - m0) * p1 * s1(x); }
        if (m0 > m1 && a0) { gg = g(region, side, "lost"); gg.mass += (m0 - m1) * p0; gg.change += -(m0 - m1) * p0 * s0(x); }
        return;
      }
      var set = {}; set[loU] = loU; set[hiU] = hiU;
      if (a0) a0.pieces.forEach(function (pc) { set[pc.lo - e0.offset] = pc.lo - e0.offset; set[pc.hi - e0.offset] = pc.hi - e0.offset; });
      if (a1) a1.pieces.forEach(function (pc) { set[pc.lo - e1.offset] = pc.lo - e1.offset; set[pc.hi - e1.offset] = pc.hi - e1.offset; });
      var pts = Object.keys(set).map(function (k) { return set[k]; }).filter(function (v) { return loU - 1e-12 <= v && v <= hiU + 1e-12; }).sort(function (a, b) { return a - b; });
      var width = hiU - loU;
      for (var i = 0; i < pts.length - 1; i++) {
        var x1 = pts[i], x2 = pts[i + 1]; if (x2 - x1 <= 1e-12) continue;
        var mid = 0.5 * (x1 + x2);
        var q0 = a0 ? probAt(a0.pieces, mid + e0.offset, false) : 0, q1 = a1 ? probAt(a1.pieces, mid + e1.offset, false) : 0;
        var share = (x2 - x1) / width;
        accumulate(g, region, side, q0, q1, common * share, mid, a0 ? s0 : null, a1 ? s1 : null);
        if (m1 > m0 && a1) { m = (m1 - m0) * share * q1; gg = g(region, side, "new"); gg.mass += m; gg.change += m * s1(mid); }
        if (m0 > m1 && a0) { m = (m0 - m1) * share * q0; gg = g(region, side, "lost"); gg.mass += m; gg.change += -m * s0(mid); }
      }
    });
    return order.map(function (k) { return groups[k]; }).filter(function (gr) { return gr.mass > 1e-9; })
      .map(function (gr) { gr.average = gr.mass > 1e-12 ? gr.change / gr.mass : 0; return gr; });
  }

  // ---- plot helpers ---------------------------------------------------------------
  function dedupPts(pts) {
    var out = [];
    pts.forEach(function (qp) { if (!out.length || Math.abs(out[out.length - 1][0] - qp[0]) > 1e-12 || Math.abs(out[out.length - 1][1] - qp[1]) > 1e-12) out.push(qp); });
    return out;
  }
  function curvePoints(cur, side, pMax) {
    var bps = cur.breakpoints().filter(function (b) { return 0 < b && b < pMax; });
    var grid = [0].concat(bps, [pMax]), pts = [];
    var f = side === SUPPLY ? function (b, l) { return cur.supply(b, l); } : function (b, l) { return cur.demand(b, l); };
    grid.forEach(function (b) { pts.push([f(b, "left"), b]); pts.push([f(b, "right"), b]); });
    if (side === DEMAND) pts.reverse();
    var out = dedupPts(pts);
    if (side === DEMAND) while (out.length > 1 && out[0][0] <= 1e-12 && out[1][0] <= 1e-12) out.shift();
    return out;
  }
  function servedCurvePoints(out, side, offset) {
    offset = offset || 0;
    var pieces = [];
    out.allocs.forEach(function (a) {
      var e = a.eff; if (e.side !== side) return;
      a.pieces.forEach(function (pc) {
        if (effBlock(e)) pieces.push([e.lo + offset, e.lo + offset, pc.prob * e.mass, null]);
        else if (pc.hi > pc.lo) pieces.push([pc.lo + offset, pc.hi + offset, null, pc.prob * effDensity(e)]);
      });
    });
    if (!pieces.length) return [];
    var set = {}; pieces.forEach(function (p) { set[p[0]] = p[0]; set[p[1]] = p[1]; });
    var bps = Object.keys(set).map(function (k) { return set[k]; }).sort(function (a, b) { return a - b; });
    var qAt = function (p, limit) {
      var tot = 0;
      pieces.forEach(function (pc) {
        var lo = pc[0], hi = pc[1], m = pc[2], d = pc[3];
        if (m != null) {
          if (side === DEMAND) tot += (lo > p || (lo === p && limit === "left")) ? m : 0;
          else tot += (lo < p || (lo === p && limit === "right")) ? m : 0;
        } else if (side === DEMAND) tot += d * Math.max(0, hi - Math.max(lo, p));
        else tot += d * Math.max(0, Math.min(hi, p) - lo);
      });
      return tot;
    };
    var pts = [];
    bps.forEach(function (b) { pts.push([qAt(b, "left"), b]); pts.push([qAt(b, "right"), b]); });
    if (side === DEMAND) pts.reverse();
    return dedupPts(pts);
  }

  // ---- externality ----------------------------------------------------------------
  function privateSurplus(out) { return out.consumer_surplus + out.producer_surplus + out.tax_revenue + out.licence_rent; }
  function socialOptimum(market, policy, harm) { var p = stripped(policy); p.tax_supply = +harm; return solve(market, p, false); }
  function solveSocial(market, policy, harm) {
    harm = +harm; policy = defaultPolicy(policy);
    var out = solve(market, policy, false), opt = socialOptimum(market, policy, harm);
    var priv = privateSurplus(out), third = -harm * out.quantity, w = priv + third;
    var wOpt = privateSurplus(opt) - harm * opt.quantity, dwl = wOpt - w;
    if (dwl < 0 && dwl > -1e-9 * Math.max(1, Math.abs(wOpt))) dwl = 0;
    return { out: out, harm_per_unit: harm, third_party: third, private_surplus: priv, social_surplus: w, opt: opt,
             opt_quantity: opt.quantity, opt_buyer_price: opt.price, opt_seller_price: opt.price - harm, opt_surplus: wOpt, deadweight_loss: dwl };
  }

  // ---- market from rows (scenarios.group_regions) ------------------------------------
  function groupRegions(rows, side, taken) {
    taken = taken || {}; var order = [], segs = {};
    rows.forEach(function (r) {
      var name = r[0] || "Unnamed"; if (taken[name]) name = name + " (" + side + ")";
      if (!segs[name]) { order.push(name); segs[name] = []; }
      segs[name].push({ quantity: +r[1], pmin: +r[2], pmax: +r[3] });
    });
    return order.map(function (n) { return { name: n, side: side, segments: segs[n] }; });
  }
  function buildMarket(supRows, demRows) {
    var sup = groupRegions(supRows, SUPPLY), taken = {};
    sup.forEach(function (r) { taken[r.name] = true; });
    var dem = groupRegions(demRows, DEMAND, taken);
    return { regions: sup.concat(dem) };
  }

  // ---- measures and labels (labbook.py) -------------------------------------------------
  var MEASURES = ["Market price", "Buyers pay", "Sellers receive", "Quantity traded", "Shortage or excess supply",
                  "Socially optimal quantity", "Consumer surplus", "Producer surplus", "Government revenue",
                  "Third parties", "Total surplus", "Deadweight loss"];
  function uniform(vals) {
    if (!vals.length) return null;
    for (var i = 1; i < vals.length; i++) if (Math.abs(vals[i] - vals[0]) >= 1e-9) return null;
    return vals[0];
  }
  function measuresLab(out) {
    var bp = uniform(out.regions.filter(function (r) { return r.side === DEMAND && r.quantity > 0; }).map(function (r) { return r.net_price; }));
    var sp = uniform(out.regions.filter(function (r) { return r.side === SUPPLY && r.quantity > 0; }).map(function (r) { return r.net_price; }));
    var gov = out.government_revenue;
    var m = {};
    m["Market price"] = out.price; m["Buyers pay"] = bp != null ? bp : out.price; m["Sellers receive"] = sp != null ? sp : out.price;
    m["Quantity traded"] = out.quantity;
    m["Shortage or excess supply"] = (out.control_binding && out.shortage > 1e-9) ? out.shortage : null;
    m["Socially optimal quantity"] = null; m["Consumer surplus"] = out.consumer_surplus; m["Producer surplus"] = out.producer_surplus;
    m["Government revenue"] = Math.abs(gov) > 1e-9 ? gov : 0; m["Third parties"] = null; m["Total surplus"] = out.total_surplus;
    m["Deadweight loss"] = out.deadweight_loss;
    return m;
  }
  function measuresSocial(soc) {
    var m = measuresLab(soc.out);
    m["Socially optimal quantity"] = soc.opt_quantity; m["Third parties"] = soc.third_party;
    m["Total surplus"] = soc.social_surplus; m["Deadweight loss"] = soc.deadweight_loss;
    return m;
  }
  function num(x) { var s = (+x).toFixed(1); return s.slice(-2) === ".0" ? s.slice(0, -2) : s; }
  function taxBits(ts, td) {
    var bits = [];
    if (ts > 0) bits.push("tax " + num(ts) + " on sellers"); else if (ts < 0) bits.push("subsidy " + num(-ts) + " to sellers");
    if (td > 0) bits.push("tax " + num(td) + " on buyers"); else if (td < 0) bits.push("subsidy " + num(-td) + " to buyers");
    return bits;
  }
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function describeLab(policy) {
    policy = defaultPolicy(policy); var bits = [];
    if (policy.cost_shock) bits.push("cost shock " + num(policy.cost_shock));
    if (policy.benefit_boost) bits.push("benefit boost " + num(policy.benefit_boost));
    bits = bits.concat(taxBits(policy.tax_supply, policy.tax_demand));
    Object.keys(policy.regional || {}).forEach(function (name) {
      var rp = regionPolicy(policy, name);
      if (Math.abs(rp.scale - 1) > 1e-9) bits.push(name + " capacity " + Math.round(100 * rp.scale) + "%");
      if (rp.shift) bits.push(name + " shift " + num(rp.shift));
      if (rp.tax > 0) bits.push(name + " tariff " + num(rp.tax)); else if (rp.tax < 0) bits.push(name + " subsidy " + num(-rp.tax));
      if (rp.cap != null) bits.push(name + " cap " + num(rp.cap));
    });
    var rule = { efficient: "", random: ", lottery", inefficient: ", worst served" }[policy.rationing] || "";
    if (policy.control === "ceiling" && policy.control_value != null) bits.push("ceiling " + num(policy.control_value) + rule);
    else if (policy.control === "floor" && policy.control_value != null) bits.push("floor " + num(policy.control_value) + rule);
    else if (policy.control === "quota" && policy.control_value != null) {
      var who = policy.rent_to === "government" ? "auctioned" : "given away" + rule;
      bits.push("quota " + num(policy.control_value) + ", licences " + who);
    }
    return bits.length ? cap1(bits.join("; ")) : "No experiment";
  }
  function describeExt(policy, harm) {
    policy = defaultPolicy(policy);
    var head = harm >= 0 ? "Harm " + num(harm) : "Benefit " + num(-harm);
    var bits = taxBits(policy.tax_supply, policy.tax_demand);
    if (policy.control === "quota" && policy.control_value != null) bits.push("permit cap " + num(policy.control_value));
    return head + ": " + (bits.length ? bits.join("; ") : "no policy");
  }

  return { SUPPLY: SUPPLY, DEMAND: DEMAND, RULES: RULES, CONTROLS: CONTROLS, MEASURES: MEASURES,
           defaultPolicy: defaultPolicy, stripped: stripped, regionPolicy: regionPolicy, Curves: Curves, solve: solve, compare: compare,
           curvePoints: curvePoints, servedCurvePoints: servedCurvePoints, solveSocial: solveSocial, buildMarket: buildMarket,
           groupRegions: groupRegions, measuresLab: measuresLab, measuresSocial: measuresSocial, describeLab: describeLab,
           describeExt: describeExt, num: num };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MarketLab;
