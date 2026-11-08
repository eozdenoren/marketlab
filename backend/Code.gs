/* Marketplace Laboratory: class record endpoint (Google Apps Script, bound to the Google Sheet).

   Two tokens: TOKEN is baked into the student page (anyone can read it); ADMIN_TOKEN is
   known only to the instructor view. The instructor page (instructor.html) signs in with
   either the admin token or the instructor password, which lives in the script's
   properties (Project settings > Script properties > INSTRUCTOR_PASSWORD), not in this
   file. Wrong credentials are counted; after LOCK_AFTER of them within LOCK_MINUTES the
   password answers "locked" until the window passes (the admin token still works). Groups register their own PIN
   the first time a group number is used in a class (first come, first served); the
   instructor can reset a group.

   Tabs: "findings" (ts | group | question | finding | state) and "groups" (class | group | pin | names | registered).

   GET  ?token=<page>&action=check&class=&group=&pin=   -> {status:"new"} | {status:"ok", records:[...]} | bad pin
        ?token=<admin>[&class=]                         -> every record (the instructor view)
        ?token=<admin>&action=groups&class=             -> registered groups of a class
   POST {token:<page>, action:"register", class, group, pin, names}   -> registers (refused if taken)
        {token:<page>, records:[{group, question, finding, state, pin}]} -> appended if the PIN matches
        {token:<admin>, records:[...]}                 -> appended, no PIN
        {token:<admin>, action:"reset", class, group}  -> clears that group's registration */
var FINDINGS = "findings", GROUPS = "groups";
var TOKEN = "PAGE-TOKEN";          // same value as "token" in the page's build config
var ADMIN_TOKEN = "ADMIN-TOKEN";   // instructor view only (app/.streamlit/secrets.toml, html/config.json)
var LOCK_AFTER = 10, LOCK_MINUTES = 15;

function sheet(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}
function findingsSheet() { return sheet(FINDINGS, ["ts", "group", "question", "finding", "state"]); }
function groupsSheet() { return sheet(GROUPS, ["class", "group", "pin", "names", "registered"]); }

// Is this credential the admin's? The admin token always is (it is long and random, so it cannot be guessed and is
// never locked out). The instructor password from the script properties is too, unless LOCK_AFTER wrong credentials
// have arrived within LOCK_MINUTES: then the password side answers "locked" until the window passes, which stops
// guessing. The page token and an empty token are simply "no" and are never counted.
function adminStatus(token) {
  if (token === undefined || token === null || token === "" || token === TOKEN) return "no";
  if (token === ADMIN_TOKEN) return "yes";
  var cache = CacheService.getScriptCache(), fails = Number(cache.get("admin-fails") || 0);
  if (fails >= LOCK_AFTER) return "locked";
  var password = PropertiesService.getScriptProperties().getProperty("INSTRUCTOR_PASSWORD");
  if (password && token === password) return "yes";
  cache.put("admin-fails", String(fails + 1), LOCK_MINUTES * 60);
  return "no";
}

function findGroup(cls, group) {
  var values = groupsSheet().getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === cls && String(values[i][1]) === group)
      return { row: i + 1, pin: String(values[i][2]), names: String(values[i][3] || ""), registered: values[i][4] };
  }
  return null;
}
function pinOk(cls, group, pin) {
  var g = findGroup(cls, group);
  return !!g && g.pin === String(pin || "");
}
function groupRecords(cls, group) {
  var values = findingsSheet().getDataRange().getValues(), out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (group !== undefined && String(row[1]) !== group) continue;
    var st = {};
    try { st = JSON.parse(row[4] || "{}"); } catch (err) {}
    if (cls !== undefined && String(st["class"] || "") !== cls) continue;
    out.push({ ts: Number(row[0]), group: row[1], question: row[2], finding: row[3], state: st });
  }
  return out;
}

function doGet(e) {
  var p = e.parameter || {};
  var status = adminStatus(p.token), admin = status === "yes";
  if (status === "locked") return reply({ ok: false, error: "locked" });
  if (!admin && p.token !== TOKEN) return reply({ ok: false, error: "bad token" });
  if (admin) {
    if (p.action === "groups") {
      var values = groupsSheet().getDataRange().getValues(), groups = [];
      for (var i = 1; i < values.length; i++) {
        if (p["class"] !== undefined && String(values[i][0]) !== p["class"]) continue;
        groups.push({ "class": values[i][0], group: values[i][1], pin: String(values[i][2]), names: values[i][3] || "", registered: String(values[i][4] || "") });
      }
      return reply({ ok: true, groups: groups });
    }
    return reply({ ok: true, records: groupRecords(p["class"], undefined) });
  }
  if (p.group === undefined || p["class"] === undefined) return reply({ ok: false, error: "group and class required" });
  var cls = String(p["class"]), group = String(p.group), g = findGroup(cls, group);
  if (!g) return reply({ ok: true, status: "new" });
  if (g.pin !== String(p.pin || "")) return reply({ ok: false, error: "bad pin" });
  return reply({ ok: true, status: "ok", names: g.names, records: groupRecords(cls, group) });
}

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: "bad JSON" }); }
  if (!data) return reply({ ok: false, error: "bad JSON" });
  var status = adminStatus(data.token), admin = status === "yes";
  if (status === "locked") return reply({ ok: false, error: "locked" });
  if (!admin && data.token !== TOKEN) return reply({ ok: false, error: "bad token" });
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (data.action === "register" && !admin) {
      var cls = String(data["class"] || ""), group = String(data.group || ""), pin = String(data.pin || "");
      if (!/^\d{4}$/.test(pin) || !/^Group \d+$/.test(group)) return reply({ ok: false, error: "a four-digit PIN and a group number are required" });
      if (findGroup(cls, group)) return reply({ ok: false, error: "taken" });
      groupsSheet().appendRow([cls, group, pin, String(data.names || ""), new Date().toISOString()]);
      return reply({ ok: true, status: "registered" });
    }
    if (data.action === "reset" && admin) {
      var g = findGroup(String(data["class"] || ""), String(data.group || ""));
      if (g) groupsSheet().deleteRow(g.row);
      return reply({ ok: true, reset: !!g });
    }
    var records = (data.records || []).slice(0, 50), rows = [], rejected = 0, now = Date.now() / 1000;
    records.forEach(function (r, i) {
      var st = r.state || {}, grp = String(r.group || "");
      if (!admin && !pinOk(String(st["class"] || ""), grp, r.pin)) { rejected++; return; }
      rows.push([String(now + i / 1000), grp, String(r.question || ""), String(r.finding || ""), JSON.stringify(st)]);
    });
    if (rows.length) { var sh = findingsSheet(); sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows); }
    if (rejected && !rows.length) return reply({ ok: false, error: "bad pin", rejected: rejected });
    return reply({ ok: true, n: rows.length, rejected: rejected });
  } finally { lock.releaseLock(); }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
