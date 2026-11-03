/* Marketplace Laboratory: class record endpoint (Google Apps Script, bound to the Google Sheet).
   POST appends records to the "findings" sheet (ts | group | question | finding | state);
   GET returns a group's records so a reloaded laptop gets its lab book back.
   The same sheet layout is read by the Streamlit instructor view. */
var SHEET_NAME = "findings";
var TOKEN = "CHANGE-ME";   // must equal the token baked into the page (build config)

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: "bad JSON" }); }
  if (!data || data.token !== TOKEN) return reply({ ok: false, error: "bad token" });
  var records = (data.records || []).slice(0, 50);
  var rows = records.map(function (r) {
    return [String(Number(r.ts) || Date.now() / 1000), String(r.group || ""), String(r.question || ""),
            String(r.finding || ""), JSON.stringify(r.state || {})];
  });
  if (!rows.length) return reply({ ok: true, n: 0 });
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheet();
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  } finally { lock.releaseLock(); }
  return reply({ ok: true, n: rows.length });
}

function doGet(e) {
  var p = e.parameter || {};
  if (p.token !== TOKEN) return reply({ ok: false, error: "bad token" });
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
