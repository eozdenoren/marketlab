/* Marketplace Laboratory: QR codes for the class link, in the page itself (no library, no network). Byte mode, error
   correction level M, versions 1 to 10, so up to 213 bytes of text. MLQR.matrix(text) gives the modules as rows of
   0/1 without the quiet zone; MLQR.svg(text, size) the picture. tests/check_qr.py compares the modules with segno's. */
var MLQR = (function () {
  "use strict";
  // Level M, versions 1..10: [data codewords per block and blocks in group 1, the same for group 2, EC codewords per block]
  var BLOCKS = [[16, 1, 0, 0, 10], [28, 1, 0, 0, 16], [44, 1, 0, 0, 26], [32, 2, 0, 0, 18], [43, 2, 0, 0, 24],
                [27, 4, 0, 0, 16], [31, 4, 0, 0, 18], [38, 2, 39, 2, 22], [36, 3, 37, 2, 22], [43, 4, 44, 1, 26]];
  var ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var VERSION_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }];

  // GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
  var EXP = [], LOG = [];
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function generator(n) {       // coefficients of the degree-n generator polynomial, highest power first
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = []; for (var k = 0; k <= g.length; k++) ng.push(0);
      for (var j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }
  function ecCodewords(data, n) {
    var g = generator(n), res = [];
    for (var k = 0; k < n; k++) res.push(0);
    for (var i = 0; i < data.length; i++) {
      var f = data[i] ^ res[0];
      res.shift(); res.push(0);
      if (f) for (var j = 0; j < n; j++) res[j] ^= mul(g[j + 1], f);
    }
    return res;
  }
  function toBytes(text) {
    var s = unescape(encodeURIComponent(String(text))), out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  function formatBits(mask) {
    var data = mask;      // level M is 00, then the three mask bits
    var val = data << 10;
    for (var i = 14; i >= 10; i--) if ((val >> i) & 1) val ^= 0x537 << (i - 10);
    return ((data << 10) | val) ^ 0x5412;
  }
  function penalty(m) {
    var n = m.length, score = 0, r, c, run, dark = 0;
    for (var pass = 0; pass < 2; pass++) {
      for (r = 0; r < n; r++) {
        run = 1;
        for (c = 1; c <= n; c++) {
          var cur = c < n ? (pass ? m[c][r] : m[r][c]) : -1, prev = pass ? m[c - 1][r] : m[r][c - 1];
          if (cur === prev) run++; else { if (run >= 5) score += 3 + run - 5; run = 1; }
        }
        for (c = 0; c + 6 < n; c++) {
          var line = []; for (var k = 0; k < 7; k++) line.push(pass ? m[c + k][r] : m[r][c + k]);
          if (line.join("") === "1011101") {
            var before = 0, after = 0;     // the quiet zone outside the symbol counts as light
            for (k = 1; k <= 4; k++) { if (c - k < 0 || !(pass ? m[c - k][r] : m[r][c - k])) before++; if (c + 6 + k >= n || !(pass ? m[c + 6 + k][r] : m[r][c + 6 + k])) after++; }
            if (before === 4 || after === 4) { score += 40; c += 6; }   // the next pattern can only start after this one
          }
        }
      }
    }
    for (r = 0; r + 1 < n; r++) for (c = 0; c + 1 < n; c++) {
      var v = m[r][c]; if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3;
    }
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) dark += m[r][c];
    var pct = 100 * dark / (n * n), lo = Math.floor(pct / 5) * 5, hi = lo + 5;
    score += Math.min(Math.abs(lo - 50), Math.abs(hi - 50)) / 5 * 10;
    return score;
  }

  function matrix(text, forceMask) {
    var bytes = toBytes(text), v = 0, i, j, r, c;
    for (i = 0; i < BLOCKS.length; i++) {
      var cap0 = BLOCKS[i][0] * BLOCKS[i][1] + BLOCKS[i][2] * BLOCKS[i][3];
      if (4 + (i + 1 <= 9 ? 8 : 16) + 8 * bytes.length <= 8 * cap0) { v = i + 1; break; }
    }
    if (!v) throw new Error("too long for a QR code (" + bytes.length + " bytes; the limit is 213)");
    var b = BLOCKS[v - 1], cap = b[0] * b[1] + b[2] * b[3];
    // the bit stream: mode, count, the bytes, terminator, padding
    var bits = [];
    var push = function (val, nbits) { for (var k = nbits - 1; k >= 0; k--) bits.push((val >> k) & 1); };
    push(4, 4); push(bytes.length, v <= 9 ? 8 : 16);
    bytes.forEach(function (x) { push(x, 8); });
    for (i = 0; i < 4 && bits.length < 8 * cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) { var byte = 0; for (j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]; data.push(byte); }
    for (i = 0; data.length < cap; i++) data.push(i % 2 ? 0x11 : 0xEC);
    // blocks, error correction, interleaving
    var blocks = [], pos = 0;
    for (i = 0; i < b[1]; i++) { blocks.push(data.slice(pos, pos + b[0])); pos += b[0]; }
    for (i = 0; i < b[3]; i++) { blocks.push(data.slice(pos, pos + b[2])); pos += b[2]; }
    var ecs = blocks.map(function (blk) { return ecCodewords(blk, b[4]); });
    var stream = [], maxK = Math.max(b[0], b[2]);
    for (i = 0; i < maxK; i++) blocks.forEach(function (blk) { if (i < blk.length) stream.push(blk[i]); });
    for (i = 0; i < b[4]; i++) ecs.forEach(function (e) { stream.push(e[i]); });
    // the modules: m holds the bits, fn marks function patterns and reserved areas
    var n = 17 + 4 * v, m = [], fn = [];
    for (r = 0; r < n; r++) { var row = [], frow = []; for (c = 0; c < n; c++) { row.push(0); frow.push(false); } m.push(row); fn.push(frow); }
    var set = function (rr, cc, val) { m[rr][cc] = val ? 1 : 0; fn[rr][cc] = true; };
    var finder = function (r0, c0) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = r0 + dr, cc = c0 + dc; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        var inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        set(rr, cc, inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)));
      }
    };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    var al = ALIGN[v - 1];
    al.forEach(function (rc) { al.forEach(function (cc) {
      if ((rc <= 7 && cc <= 7) || (rc <= 7 && cc >= n - 8) || (rc >= n - 8 && cc <= 7)) return;   // would sit on a finder
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) set(rc + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }); });
    for (i = 0; i <= 8; i++) { fn[8][i] = true; fn[i][8] = true; }                // format information
    for (i = 0; i < 8; i++) { fn[8][n - 1 - i] = true; fn[n - 1 - i][8] = true; }
    if (v >= 7) {
      var vi = VERSION_INFO[v];
      for (i = 0; i < 18; i++) { var bit = (vi >> i) & 1; set(Math.floor(i / 3), n - 11 + i % 3, bit); set(n - 11 + i % 3, Math.floor(i / 3), bit); }
    }
    // the data, in the zigzag from the bottom right, two columns at a time, skipping the timing column
    var idx = 0, up = true;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var step = 0; step < n; step++) {
        var rr = up ? n - 1 - step : step;
        for (var dc = 0; dc < 2; dc++) {
          var cc = col - dc; if (fn[rr][cc]) continue;
          m[rr][cc] = idx < stream.length * 8 ? (stream[idx >> 3] >> (7 - (idx & 7))) & 1 : 0; idx++;
        }
      }
      up = !up;
    }
    // mask and format information: try the eight masks, keep the one with the lowest penalty
    var placeFormat = function (mm, mask) {
      var f = formatBits(mask), at = function (k) { return (f >> (14 - k)) & 1; };
      for (var k = 0; k < 6; k++) { mm[8][k] = at(k); mm[5 - k][8] = at(9 + k); }
      mm[8][7] = at(6); mm[8][8] = at(7); mm[7][8] = at(8);
      for (k = 0; k < 7; k++) mm[n - 1 - k][8] = at(k);
      for (k = 0; k < 8; k++) mm[8][n - 8 + k] = at(7 + k);
      mm[n - 8][8] = 1;
    };
    var masked = function (mask) {
      var mm = m.map(function (row) { return row.slice(); });
      for (var rr = 0; rr < n; rr++) for (var cc = 0; cc < n; cc++) if (!fn[rr][cc] && MASKS[mask](rr, cc)) mm[rr][cc] ^= 1;
      placeFormat(mm, mask);
      return mm;
    };
    if (forceMask != null) return masked(forceMask);
    var best = null, bestScore = Infinity;
    for (var k = 0; k < 8; k++) { var cand = masked(k), s = penalty(cand); if (s < bestScore) { best = cand; bestScore = s; } }
    return best;
  }

  function svg(text, size) {
    var m = matrix(text), n = m.length, q = 2, total = n + 2 * q, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += "M" + (c + q) + " " + (r + q) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + size + '" height="' + size +
           '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  return { matrix: matrix, svg: svg };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MLQR;
