"""Write src/mocha_data.js: the Mocha bids the Pricing Laboratory prices on, numbers only (no names, no emails).
This year's bids come from the Mocha auction's event sheet (replayed with the auction app's own store, read-only);
last year's from the WTP column of the Session 4 spreadsheet.
    python3 tools/mocha_data.py [--app <auction app folder>] [--last <xlsx>] [--out src/mocha_data.js]
Defaults are the teaching folders on this Mac. Re-run only when the bids change (they do not after Session 1)."""
import argparse
import datetime
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
TEACHING = os.path.join(os.path.expanduser("~"), "Library", "CloudStorage", "Dropbox-LBS", "Emre Ozdenoren", "teaching")
ap = argparse.ArgumentParser()
ap.add_argument("--app", default=os.path.join(TEACHING, "MIM", "Mocha Auction", "app"))
ap.add_argument("--last", default=os.path.join(TEACHING, "MIM", "Session 4", "mocha dog data aut2025.xlsx"))
ap.add_argument("--last-label", default="Autumn 2025")
ap.add_argument("--last-sheet", default="Sheet3")
ap.add_argument("--out", default=os.path.join(os.path.dirname(HERE), "src", "mocha_data.js"))
ap.add_argument("--codes", default="CM03AUT26A,CM03AUT26B,CM03AUT26C", help="the streams, in the order shown")
args = ap.parse_args()

import toml  # noqa: E402
import openpyxl  # noqa: E402

sys.path.insert(0, args.app)
import backend  # noqa: E402
import store  # noqa: E402

secrets = toml.load(os.path.join(args.app, ".streamlit", "secrets.toml"))
be = backend.SheetsBackend(secrets["gcp_service_account"], secrets["spreadsheet_key"], secrets.get("auction_worksheet") or "auction")
st = store.Store(None)
st.replay(be.load_all())
streams = []
for code in [c.strip() for c in args.codes.split(",") if c.strip()]:
    s = st.session(code)
    if s is None:
        sys.exit("no auction stream %s in the sheet" % code)
    amounts = sorted(s.amounts())
    streams.append({"code": code, "label": "Stream " + code[-1], "item": s.item, "min": s.min_bid, "max": s.max_bid, "step": s.step, "bids": amounts})
    print("%s: %d bids, %d at the cap of %s" % (code, len(amounts), sum(1 for a in amounts if a >= s.max_bid), s.max_bid))

ws = openpyxl.load_workbook(args.last, data_only=True)[args.last_sheet]
last = sorted(float(r[0]) for r in ws.iter_rows(min_row=2, values_only=True) if isinstance(r[0], (int, float)))
mc_cell = ws.cell(1, 11).value
print("%s: %d bids, max %s, cost on the sheet %s" % (args.last_label, len(last), max(last), mc_cell))

data = {"year": "Autumn 2026", "item": "Mocha", "streams": streams,
        "last": {"label": args.last_label, "bids": last, "max": max(last)},
        "cost": float(mc_cell) if isinstance(mc_cell, (int, float)) else 15,
        "written": datetime.date.today().isoformat()}
with open(args.out, "w", encoding="utf-8") as f:
    f.write("/* The Mocha bids the Pricing Laboratory prices on: amounts only, written by tools/mocha_data.py on %s. */\n" % data["written"])
    f.write("var MOCHA_DATA = %s;\n" % json.dumps(data, separators=(",", ":")))
    f.write('if (typeof module !== "undefined" && module.exports) module.exports = MOCHA_DATA;\n')
print("wrote", args.out)
