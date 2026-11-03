"""Generate cross-check cases from the Python engine (the specification) for
the JavaScript port: random markets and policies, with every number the UI
shows. Run from the html folder: python3 tests/gen_cases.py -> tests/cases.json"""
import json
import math
import os
import random
import sys

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "app")
sys.path.insert(0, APP)
from engine import DEMAND, SUPPLY, Curves, Market, Policy, RegionPolicy, RegionSpec, Segment, compare, curve_points, served_curve_points, solve  # noqa: E402
from externality import solve_social  # noqa: E402
import labbook as lb  # noqa: E402

rng = random.Random(20261103)


def rand_segments():
    segs = []
    for _ in range(rng.choice([1, 1, 2, 3])):
        q = rng.choice([20, 40, 60, 80, 100, 150])
        pmin = rng.choice([0, 0, 10, 20, 40, 60])
        width = rng.choice([0, 10, 25, 50, 100, 100])
        segs.append([q, pmin, pmin + width])
    return segs


def rand_market():
    sup_names = ["North", "South"][:rng.choice([1, 1, 2])]
    dem_names = ["West", "East"][:rng.choice([1, 1, 2])]
    rows = {SUPPLY: [[n] + s for n in sup_names for s in rand_segments()],
            DEMAND: [[n] + s for n in dem_names for s in rand_segments()]}
    return rows


def market_from_rows(rows):
    def group(side):
        order, segs = [], {}
        for name, q, lo, hi in rows[side]:
            if name not in segs:
                order.append(name); segs[name] = []
            segs[name].append(Segment(q, lo, hi))
        return [RegionSpec(n, side, segs[n]) for n in order]
    return Market(group(SUPPLY) + group(DEMAND))


def rand_policy(market, base):
    kind = rng.choice(["none", "tax", "tax", "shock", "regional", "control", "control", "control", "mix"])
    pol = {}
    if kind in ("tax", "mix"):
        if rng.random() < 0.7:
            pol["tax_supply"] = rng.choice([5, 10, 20, 30, -10, -20])
        if rng.random() < 0.4:
            pol["tax_demand"] = rng.choice([5, 10, 20, -15])
    if kind in ("shock", "mix"):
        if rng.random() < 0.6:
            pol["cost_shock"] = rng.choice([5, 10, 20, -10])
        if rng.random() < 0.5:
            pol["benefit_boost"] = rng.choice([10, 20, -10, -20])
    regional = {}
    if kind in ("regional", "mix"):
        for r in market.regions:
            if rng.random() < 0.5:
                rp = {}
                if rng.random() < 0.5:
                    rp["scale"] = rng.choice([0.4, 0.5, 0.8, 1.2, 1.5])
                if rng.random() < 0.4:
                    rp["shift"] = rng.choice([5, 10, -5])
                if rng.random() < 0.5:
                    rp["tax"] = rng.choice([5, 10, 15, -5])
                if r.side == SUPPLY and rng.random() < 0.4:
                    rp["cap"] = rng.choice([10, 20, 30, 50])
                if rp:
                    regional[r.name] = rp
    pol["regional"] = regional
    has_cap = any("cap" in rp for rp in regional.values())
    if kind in ("control", "mix") and base.quantity > 0:
        ctrl = rng.choice(["ceiling", "floor", "quota"] if not has_cap else ["ceiling", "floor"])
        if ctrl == "ceiling":
            val = round(base.price * rng.uniform(0.4, 0.95), 1)
        elif ctrl == "floor":
            val = round(base.price * rng.uniform(1.05, 1.7), 1)
        else:
            val = round(base.quantity * rng.uniform(0.3, 0.9), 1)
        pol["control"] = ctrl
        pol["control_value"] = val
    pol["rationing"] = rng.choice(["efficient", "random", "inefficient"])
    pol["rent_to"] = rng.choice(["sellers", "government"])
    return pol


def to_policy(pol):
    reg = {k: RegionPolicy(scale=v.get("scale", 1.0), shift=v.get("shift", 0.0), tax=v.get("tax", 0.0), cap=v.get("cap"))
           for k, v in pol.get("regional", {}).items()}
    return Policy(cost_shock=pol.get("cost_shock", 0.0), benefit_boost=pol.get("benefit_boost", 0.0),
                  tax_supply=pol.get("tax_supply", 0.0), tax_demand=pol.get("tax_demand", 0.0),
                  control=pol.get("control", "none"), control_value=pol.get("control_value"),
                  rationing=pol.get("rationing", "efficient"), rent_to=pol.get("rent_to", "sellers"), regional=reg)


def num(x):
    if x is None:
        return None
    if isinstance(x, float) and math.isnan(x):
        return "nan"
    return x


def outcome_dict(o):
    return {"price": o.price, "quantity": o.quantity, "consumer_surplus": o.consumer_surplus, "producer_surplus": o.producer_surplus,
            "tax_revenue": o.tax_revenue, "licence_rent": o.licence_rent, "total_surplus": o.total_surplus,
            "deadweight_loss": num(o.deadweight_loss), "rationing_loss": num(o.rationing_loss), "shortage": o.shortage,
            "rationed_side": o.rationed_side, "control_binding": o.control_binding,
            "elasticity_demand": num(o.elasticity_demand), "elasticity_supply": num(o.elasticity_supply),
            "flags": {"indeterminate_price": o.flags.get("indeterminate_price", False), "no_trade": o.flags.get("no_trade", False)},
            "regions": [{"name": r.name, "side": r.side, "quantity": r.quantity, "surplus": r.surplus, "tax": r.tax, "rent": r.rent,
                         "net_price": r.net_price, "willing": r.willing, "capped": r.capped} for r in o.regions]}


cases = []
n_social = 0
for i in range(420):
    rows = rand_market()
    market = market_from_rows(rows)
    base = solve(market, Policy())
    pol = rand_policy(market, base)
    policy = to_policy(pol)
    try:
        out = solve(market, policy)
    except ValueError as exc:
        cases.append({"id": i, "rows": rows, "policy": pol, "error": str(exc)})
        continue
    groups = compare(base, out)
    case = {"id": i, "rows": rows, "policy": pol, "base": outcome_dict(base), "out": outcome_dict(out),
            "groups": [{"region": g.region, "side": g.side, "kind": g.kind, "mass": g.mass, "change": g.change} for g in groups],
            "measures": {k: num(v) for k, v in lb.measures_lab(out).items()},
            "label": lb.describe_lab(policy)}
    real = Curves(market, policy.stripped())
    p_max = max(real.breakpoints() + Curves(market, policy).breakpoints() + [1.0]) * 1.08
    case["p_max"] = p_max
    case["curves"] = {"supply": curve_points(real, SUPPLY, p_max), "demand": curve_points(real, DEMAND, p_max)}
    if out.quantity > 0:
        case["served"] = {"demand": served_curve_points(out, DEMAND, offset=policy.tax_demand),
                          "supply": served_curve_points(out, SUPPLY, offset=-policy.tax_supply)}
    if policy.control in ("none", "quota") and not any(rp.cap is not None for rp in policy.regional.values()) and rng.random() < 0.5:
        harm = rng.choice([-20, 0, 10, 20, 35])
        pol_s = dict(pol)
        if policy.control == "quota":
            pol_s["rent_to"] = "government"
        soc = solve_social(market, to_policy(pol_s), harm)
        case["social"] = {"harm": harm, "policy": pol_s, "third_party": soc.third_party, "private_surplus": soc.private_surplus,
                          "social_surplus": soc.social_surplus, "opt_quantity": soc.opt_quantity, "opt_buyer_price": soc.opt_buyer_price,
                          "opt_seller_price": soc.opt_seller_price, "opt_surplus": soc.opt_surplus, "deadweight_loss": soc.deadweight_loss,
                          "measures": {k: num(v) for k, v in lb.measures_social(soc).items()},
                          "label": lb.describe_ext(to_policy(pol_s), harm)}
        n_social += 1
    cases.append(case)

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases.json")
json.dump(cases, open(out_path, "w"))
print("wrote %d cases (%d with an externality, %d raising errors) to %s" % (
    len(cases), n_social, sum(1 for c in cases if "error" in c), out_path))
