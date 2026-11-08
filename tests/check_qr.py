"""The page's QR encoder (src/qr.js) against segno: for a range of texts and versions 1..10, the modules for each
of the eight masks must be identical. segno 1.6 adds eight padding bits when the bit stream already ends on a
codeword boundary (ISO 18004 adds none; the bits after the terminator are ignored by readers, so both scan the
same), so its padding step is replaced here by the standard one before comparing. When npm's bundled copy of
Kazuhiko Arase's encoder is on this machine the automatic mask choice is also compared with it. Run from html/:
    python3 tests/check_qr.py"""
import json
import os
import subprocess
import sys

import segno
import segno.encoder as encoder

encoder.write_padding_bits = lambda buff, version, length: buff.extend([0] * ((8 - length % 8) % 8))
ARASE = "/opt/homebrew/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/"

HERE = os.path.dirname(os.path.abspath(__file__))
TEXTS = ["https://eozdenoren.github.io/marketlab/?class=MIM-A-9Nov",
         "https://eozdenoren.github.io/marketlab/?class=X",
         "A", "Hello, world", "https://eozdenoren.github.io/marketlab/?class=" + "Applied-Microeconomics-Stream-B-2026-11-09",
         "https://eozdenoren.github.io/marketlab/?class=" + "x" * 100, "ü£€ unicode 日本",
         "https://eozdenoren.github.io/marketlab/?class=" + "y" * 160]
JS = """
var MLQR = require(%r);
var texts = %s, out = [];
texts.forEach(function (t) {
  var auto = MLQR.matrix(t), masks = [];
  for (var k = 0; k < 8; k++) masks.push(MLQR.matrix(t, k));
  out.push({ auto: auto, masks: masks });
});
console.log(JSON.stringify(out));
"""
res = subprocess.run(["node", "-e", JS % (os.path.join(HERE, "..", "src", "qr.js"), json.dumps(TEXTS))],
                     capture_output=True, text=True, check=True)
got = json.loads(res.stdout)
bad = 0
for text, g in zip(TEXTS, got):
    n = len(g["auto"])
    version = (n - 17) // 4
    for k in range(8):
        ref = segno.make(text, error="m", version=version, mask=k, boost_error=False, mode="byte")
        ref_rows = [list(row) for row in ref.matrix]
        if ref_rows != g["masks"][k]:
            bad += 1
            diff = sum(1 for r in range(n) for c in range(n) if ref_rows[r][c] != g["masks"][k][r][c])
            print("DIFFERS: %r version %d mask %d: %d modules" % (text[:40], version, k, diff))
    if g["auto"] not in g["masks"]:
        bad += 1
        print("the automatic choice is none of the eight masks for %r" % text[:40])
    auto_mask = g["masks"].index(g["auto"]) if g["auto"] in g["masks"] else None
    # the page's choice must be one of the best by segno's own penalty score (ties are broken arbitrarily)
    scores = []
    for k in range(8):
        ref = segno.make(text, error="m", version=version, mask=k, boost_error=False, mode="byte")
        m = [bytearray(row) for row in ref.matrix]
        scores.append(encoder.evaluate_mask(m, len(m[0]), len(m)))
    if auto_mask is not None and scores[auto_mask] != min(scores):
        bad += 1
        print("the page picks mask %d (score %d) but the best score is %d" % (auto_mask, scores[auto_mask], min(scores)))
    print("%-44r version %2d: eight masks match; page picks mask %s, score %s, best %s"
          % (text[:40], version, auto_mask, scores[auto_mask] if auto_mask is not None else "?", min(scores)))
if os.path.isdir(ARASE):
    JS2 = """
var QRCode = require(%r + 'index.js'), L = require(%r + 'QRErrorCorrectLevel.js'), Q = require(%r);
var texts = %s, out = [];
texts.forEach(function (t) {
  var mine = Q.matrix(t), v = (mine.length - 17) / 4, q = new QRCode(v, L.M); q.addData(t); q.make();
  var n = q.getModuleCount(), ar = [];
  for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) row.push(q.isDark(r, c) ? 1 : 0); ar.push(row); }
  out.push(JSON.stringify(ar) === JSON.stringify(mine));
});
console.log(JSON.stringify(out));
"""
    ascii_texts = [t for t in TEXTS if all(ord(ch) < 128 for ch in t)]     # the Arase copy takes the text as bytes
    res2 = subprocess.run(["node", "-e", JS2 % (ARASE, ARASE, os.path.join(HERE, "..", "src", "qr.js"), json.dumps(ascii_texts))],
                          capture_output=True, text=True, check=True)
    same = json.loads(res2.stdout)
    print("Arase encoder (npm), for information: %d of %d codes identical, mask choice included" % (sum(same), len(same)))
print("qr.js: %s" % ("OK" if not bad else "%d differences" % bad))
sys.exit(1 if bad else 0)
