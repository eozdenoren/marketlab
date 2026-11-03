/* Marketplace Laboratory: class record endpoint (Google Apps Script, bound to the Google Sheet).

   Two tokens: TOKEN is baked into the student page (anyone can read it); ADMIN_TOKEN is
   known only to the instructor view. A group's PIN is derived from PIN_SECRET, so there is
   no list to keep: pin = first four digits of SHA-256(PIN_SECRET | class | group).

   POST {token, records:[{group, question, finding, state, pin}]}
        page token: each record needs the right PIN for (state.class, group); admin: no PIN.
        The server stamps the time; a client's ts is ignored.
   GET  ?token=<page>&class=&group=&pin=   -> that group's records
        ?token=<admin>[&class=]            -> every record (the instructor view)
        ?token=<admin>&action=pins&class=&n=45 -> the PIN list for groups 1..n
   Sheet layout (tab "findings"): ts | group | question | finding | state, read by both sides. */
var SHEET_NAME = "findings";
var TOKEN = "PAGE-TOKEN";          // same value as "token" in the page's build config
var ADMIN_TOKEN = "ADMIN-TOKEN";   // instructor view only (app/.streamlit/secrets.toml)
var PIN_SECRET = "PIN-SECRET";     // never shared; changing it changes every PIN

function pinFor(cls, group) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, PIN_SECRET + "|" + cls + "|" + group, Utilities.Charset.UTF_8);
  var n = 0;
  for (var i = 0; i < 4; i++) n = n * 256 + (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]);
  var s = String(n % 10000);
  while (s.length < 4) s = "0" + s;
  return s;
}

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: "bad JSON" }); }
  if (!data) return reply({ ok: false, error: "bad JSON" });
  var admin = data.token === ADMIN_TOKEN;
  if (!admin && data.token !== TOKEN) return reply({ ok: false, error: "bad token" });
  var records = (data.records || []).slice(0, 50), rows = [], rejected = 0, now = Date.now() / 1000;
  records.forEach(function (r, i) {
    var st = r.state || {}, group = String(r.group || "");
    if (!admin && pinFor(String(st["class"] || ""), group) !== String(r.pin || "")) { rejected++; return; }
    rows.push([String(now + i / 1000), group, String(r.question || ""), String(r.finding || ""), JSON.stringify(st)]);
  });
  if (rows.length) {
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try { var sh = sheet(); sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows); }
    finally { lock.releaseLock(); }
  }
  if (rejected && !rows.length) return reply({ ok: false, error: "bad pin", rejected: rejected });
  return reply({ ok: true, n: rows.length, rejected: rejected });
}

function doGet(e) {
  var p = e.parameter || {};
  var admin = p.token === ADMIN_TOKEN;
  if (!admin && p.token !== TOKEN) return reply({ ok: false, error: "bad token" });
  if (admin && p.action === "pins") {
    var n = Math.min(parseInt(p.n, 10) || 45, 500), pins = [];
    for (var g = 1; g <= n; g++) pins.push({ group: "Group " + g, pin: pinFor(String(p["class"] || ""), "Group " + g) });
    return reply({ ok: true, pins: pins });
  }
  if (!admin) {
    if (p.group === undefined || p["class"] === undefined) return reply({ ok: false, error: "group and class required" });
    if (pinFor(String(p["class"]), String(p.group)) !== String(p.pin || "")) return reply({ ok: false, error: "bad pin" });
  }
  var values = sheet().getDataRange().getValues(), out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (p.group !== undefined && String(row[1]) !== p.group) continue;
    var st = {};
    try { st = JSON.parse(row[4] || "{}"); } catch (err) {}
    if (p["class"] !== undefined && String(st["class"] || "") !== p["class"]) continue;
    out.push({ ts: Number(row[0]), group: row[1], question: row[2], finding: row[3], state: st });
  }
  return reply({ ok: true, records: out });
}

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(["ts", "group", "question", "finding", "state"]);
  return sh;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
