/* Pricing Laboratory: class record endpoint (Google Apps Script, bound to the Pricing Lab's own Google Sheet).

   A second script, separate from the Marketplace Laboratory's Code.gs, so that the Marketplace record is never
   touched while an assignment runs on it. Groups sign in with the number and PIN they registered in the Marketplace
   Laboratory: the script reads the "groups" tab of that sheet (script property MARKETLAB_SHEET = its ID or URL),
   and falls back to a "groups" tab of its own for groups registered here. Same two tokens as the Marketplace
   script (its own values): TOKEN is baked into the student page, ADMIN_TOKEN is known only to the instructor
   page, which may also sign in with the instructor password (script property INSTRUCTOR_PASSWORD; LOCK_AFTER
   wrong credentials within LOCK_MINUTES lock the password out for LOCK_MINUTES).

   Tabs: "records"   (ts | group | question | finding | state)       the lab books: pins, answers, notes
         "groups"    (class | group | pin | names | registered)      groups registered on the pricing page
         "challenge" (class | phase | settings | updated)            one row per class: the pricing challenge
         "flights"   (ts | class | group | n | fare | passengers | profit | gain)   round 1 flights

   The challenge: each group is the airline's pricing team on one route. It is told the cost per passenger (mc),
   the seats, and last month's fare p0 with its q0 passengers; the demand Q = a - b P is hidden (b in the
   settings, a = q0 + b p0). It flies `flights` flights at fares of its choice; each flight's gain is its profit
   minus the status quo's (p0 - mc) q0. Phases: setup -> open (round 1) -> closed -> revealed (the demand is sent
   to the pages) -> round2 (the exercise on the revealed demand). Settings cannot change while flights exist.

   GET  ?token=<page>&action=check&class=&group=&pin=       -> {status:"new"} | {status:"ok", names, records, challenge}
        ?token=<page>&action=challenge&class=[&group=&pin=]  -> {challenge: phase, told numbers, board, revealed demand
                                                               once revealed, and the group's own flights if given}
        ?token=<admin>[&class=]                              -> every record
        ?token=<admin>&action=groups[&class=]                -> groups registered on the pricing page
        ?token=<admin>&action=challenge&class=               -> settings, phase and every flight of the class
   POST {token:<page>, action:"register", class, group, pin, names}        -> registers here (refused if taken)
        {token:<page>, action:"fly", class, group, pin, fare}              -> flies one flight (phase open)
        {token:<page>, records:[{group, question, finding, state, pin}]}   -> appended if the PIN matches
        {token:<admin>, records:[...]}                                     -> appended, no PIN
        {token:<admin>, action:"challenge_set", class, settings}           -> sets the settings (no flights yet)
        {token:<admin>, action:"challenge_phase", class, phase}            -> sets the phase
        {token:<admin>, action:"challenge_reset", class}                   -> deletes the class's flights, phase setup
        {token:<admin>, action:"reset", class, group}                      -> clears a registration made here */
var RECORDS = "records", GROUPS = "groups", CHALLENGE = "challenge", FLIGHTS = "flights";
var TOKEN = "PAGE-TOKEN";          // same value as "token" under "pricing" in the page's build config
var ADMIN_TOKEN = "ADMIN-TOKEN";   // instructor page only
var LOCK_AFTER = 10, LOCK_MINUTES = 15;
var PHASES = ["setup", "open", "closed", "revealed", "round2"];
var DEFAULT_SETTINGS = { mc: 80, seats: 500, p0: 480, q0: 400, b: 0.5, flights: 6, label: "London–Detroit" };

function sheet(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}
function recordsSheet() { return sheet(RECORDS, ["ts", "group", "question", "finding", "state"]); }
function groupsSheet() { return sheet(GROUPS, ["class", "group", "pin", "names", "registered"]); }
function challengeSheet() { return sheet(CHALLENGE, ["class", "phase", "settings", "updated"]); }
function flightsSheet() { return sheet(FLIGHTS, ["ts", "class", "group", "n", "fare", "passengers", "profit", "gain"]); }

// The rows of the Marketplace Laboratory's groups tab, if the script property names that sheet (null otherwise),
// cached for two minutes: the pages poll the challenge every few seconds with the group's PIN, and opening another
// spreadsheet on every poll would be the slowest part of each call.
var MARKETLAB_CACHE_SECONDS = 120;
function marketlabGroupsRows() {
  var ref = PropertiesService.getScriptProperties().getProperty("MARKETLAB_SHEET");
  if (!ref) return null;
  var cache = CacheService.getScriptCache(), hit = cache.get("marketlab-groups");
  if (hit) { try { return JSON.parse(hit); } catch (err) {} }
  var m = /\/d\/([A-Za-z0-9_-]+)/.exec(ref), id = m ? m[1] : String(ref).trim(), rows;
  try { var sh = SpreadsheetApp.openById(id).getSheetByName("groups"); rows = sh ? sh.getDataRange().getValues() : []; } catch (err) { return null; }
  try { cache.put("marketlab-groups", JSON.stringify(rows), MARKETLAB_CACHE_SECONDS); } catch (err) {}   // too big for the cache: read every time
  return rows;
}

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

// The sheet turns a PIN typed as "0001" into the number 1, so read it back as four digits.
function pinText(v) {
  var s = String(v === undefined || v === null ? "" : v).trim();
  return /^\d{1,3}$/.test(s) ? ("0000" + s).slice(-4) : s;
}
function findGroupIn(values, cls, group, source) {
  if (!values) return null;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === cls && String(values[i][1]) === group)
      return { row: i + 1, pin: pinText(values[i][2]), names: String(values[i][3] || ""), registered: values[i][4], source: source };
  }
  return null;
}
// The Marketplace Laboratory's registration first (the number and PIN the group already has), then this sheet's.
function findGroup(cls, group) {
  return findGroupIn(marketlabGroupsRows(), cls, group, "marketlab") || findGroupIn(groupsSheet().getDataRange().getValues(), cls, group, "pricing");
}
function pinOk(cls, group, pin) {
  var g = findGroup(cls, group);
  return !!g && g.pin === String(pin || "");
}
function groupRecords(cls, group) {
  var values = recordsSheet().getDataRange().getValues(), out = [];
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

// ---- the challenge ----------------------------------------------------------------------------------------------
function cleanSettings(s) {
  s = s || {};
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (k === "label") { out.label = String(s.label || ""); return; }
    var v = Number(s[k]); out[k] = isNaN(v) ? DEFAULT_SETTINGS[k] : v;
  });
  out.flights = Math.max(1, Math.min(12, Math.round(out.flights)));
  if (!(out.b > 0)) out.b = DEFAULT_SETTINGS.b;
  return out;
}
function intercept(s) { return s.q0 + s.b * s.p0; }                          // Q = a - b P through the status quo
function passengersAt(s, fare) { return Math.max(0, Math.min(s.seats, Math.round(intercept(s) - s.b * fare))); }
function profitAt(s, fare) { return (fare - s.mc) * passengersAt(s, fare); }
function statusQuoProfit(s) { return (s.p0 - s.mc) * s.q0; }
// The history the students are told: over the past year the old fare moved within p0 ± d and the flights carried
// the passengers the demand gives at those fares (fewer at the higher fare), so the variation is the market reacting
// to the fare, not noise. d is the first of a few round numbers for which b·d is a whole number of passengers; null
// if none fits (then the pages show the single old fare). Same rule as historyRange in src/pricing_core.js.
function historyRange(s) {
  var ds = [10, 20, 25, 30, 40, 50];
  for (var i = 0; i < ds.length; i++) {
    var d = ds[i], dq = s.b * d;
    if (Math.abs(dq - Math.round(dq)) < 1e-9 && dq >= 2 && s.p0 - d > s.mc && s.q0 + dq <= s.seats && s.q0 - dq > 0)
      return { fareLo: s.p0 - d, fareHi: s.p0 + d, paxAtLo: s.q0 + Math.round(dq), paxAtHi: s.q0 - Math.round(dq) };
  }
  return null;
}
function readChallenge(cls) {
  var values = challengeSheet().getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== cls) continue;
    var settings = {}; try { settings = JSON.parse(values[i][2] || "{}"); } catch (err) {}
    var phase = String(values[i][1] || "setup");
    return { row: i + 1, phase: PHASES.indexOf(phase) >= 0 ? phase : "setup", settings: cleanSettings(settings) };
  }
  return null;
}
function writeChallenge(cls, phase, settings) {
  var c = readChallenge(cls), sh = challengeSheet(), row = [cls, phase, JSON.stringify(settings), new Date().toISOString()];
  if (c) sh.getRange(c.row, 1, 1, 4).setValues([row]); else sh.appendRow(row);
}
function classFlights(cls) {
  var values = flightsSheet().getDataRange().getValues(), out = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][1]) !== cls) continue;
    out.push({ ts: Number(values[i][0]), group: String(values[i][2]), n: Number(values[i][3]), fare: Number(values[i][4]),
               passengers: Number(values[i][5]), profit: Number(values[i][6]), gain: Number(values[i][7]) });
  }
  return out;
}
function board(flights, withFares) {
  var by = {};
  flights.forEach(function (f) {
    var g = by[f.group] || (by[f.group] = { group: f.group, n: 0, gain: 0, fares: [] });
    g.n++; g.gain += f.gain; g.fares.push(f.fare);
  });
  var out = Object.keys(by).map(function (k) { return by[k]; });
  if (!withFares) out.forEach(function (g) { delete g.fares; });
  out.sort(function (x, y) { return y.gain - x.gain || x.group.localeCompare(y.group, undefined, { numeric: true }); });
  return out;
}
// What the pages may know: the told numbers always, the demand once revealed, the board (fares once revealed).
function publicChallenge(cls, group) {
  var c = readChallenge(cls);
  if (!c) return { phase: "setup", told: null };
  var s = c.settings, revealed = c.phase === "revealed" || c.phase === "round2", flights = classFlights(cls);
  var out = { phase: c.phase, told: { mc: s.mc, seats: s.seats, p0: s.p0, q0: s.q0, flights: s.flights, label: s.label, history: historyRange(s) }, board: board(flights, revealed) };
  if (revealed) out.demand = { a: intercept(s), b: s.b };
  if (group) out.mine = flights.filter(function (f) { return f.group === group; });
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
        groups.push({ "class": values[i][0], group: values[i][1], pin: pinText(values[i][2]), names: values[i][3] || "", registered: String(values[i][4] || "") });
      }
      return reply({ ok: true, groups: groups });
    }
    if (p.action === "challenge") {
      var c = readChallenge(String(p["class"] || ""));
      return reply({ ok: true, challenge: c ? { phase: c.phase, settings: c.settings, a: intercept(c.settings), flights: classFlights(String(p["class"] || "")) } : null,
                     defaults: DEFAULT_SETTINGS });
    }
    return reply({ ok: true, records: groupRecords(p["class"], undefined) });
  }
  if (p["class"] === undefined) return reply({ ok: false, error: "class required" });
  var cls = String(p["class"]);
  if (p.action === "challenge") {
    var who = (p.group !== undefined && p.pin !== undefined && pinOk(cls, String(p.group), p.pin)) ? String(p.group) : undefined;
    return reply({ ok: true, challenge: publicChallenge(cls, who) });
  }
  if (p.group === undefined) return reply({ ok: false, error: "group and class required" });
  var group = String(p.group), g = findGroup(cls, group);
  if (!g) return reply({ ok: true, status: "new" });
  if (g.pin !== String(p.pin || "")) return reply({ ok: false, error: "bad pin" });
  return reply({ ok: true, status: "ok", names: g.names, records: groupRecords(cls, group), challenge: publicChallenge(cls, group) });
}

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: "bad JSON" }); }
  if (!data) return reply({ ok: false, error: "bad JSON" });
  var status = adminStatus(data.token), admin = status === "yes";
  if (status === "locked") return reply({ ok: false, error: "locked" });
  if (!admin && data.token !== TOKEN) return reply({ ok: false, error: "bad token" });
  var cls = String(data["class"] || ""), group = String(data.group || "");
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (data.action === "register" && !admin) {
      var pin = String(data.pin || "");
      if (!/^\d{4}$/.test(pin) || !/^Group \d+$/.test(group)) return reply({ ok: false, error: "a four-digit PIN and a group number are required" });
      if (findGroup(cls, group)) return reply({ ok: false, error: "taken" });
      groupsSheet().appendRow([cls, group, pin, String(data.names || ""), new Date().toISOString()]);
      return reply({ ok: true, status: "registered" });
    }
    if (data.action === "fly" && !admin) {
      if (!pinOk(cls, group, data.pin)) return reply({ ok: false, error: "bad pin" });
      var c = readChallenge(cls);
      if (!c || c.phase !== "open") return reply({ ok: false, error: "round 1 is not open", challenge: publicChallenge(cls, group) });
      var fare = Number(data.fare);
      if (isNaN(fare) || fare < 0 || fare > 1e6) return reply({ ok: false, error: "the fare must be a number of pounds" });
      fare = Math.round(fare);
      var mine = classFlights(cls).filter(function (f) { return f.group === group; });
      if (mine.length >= c.settings.flights) return reply({ ok: false, error: "all flights flown", challenge: publicChallenge(cls, group) });
      var s = c.settings, q = passengersAt(s, fare), profit = (fare - s.mc) * q, gain = profit - statusQuoProfit(s);
      flightsSheet().appendRow([String(Date.now() / 1000), cls, group, mine.length + 1, fare, q, profit, gain]);
      return reply({ ok: true, flight: { n: mine.length + 1, fare: fare, passengers: q, profit: profit, gain: gain }, challenge: publicChallenge(cls, group) });
    }
    if (data.action === "reset" && admin) {
      var g = findGroupIn(groupsSheet().getDataRange().getValues(), cls, group, "pricing");
      if (g) groupsSheet().deleteRow(g.row);
      return reply({ ok: true, reset: !!g });
    }
    if (data.action === "challenge_set" && admin) {
      if (!cls) return reply({ ok: false, error: "class required" });
      if (classFlights(cls).length) return reply({ ok: false, error: "flights have been flown in this class; reset the challenge first" });
      var settings = cleanSettings(data.settings), prev = readChallenge(cls);
      writeChallenge(cls, prev ? prev.phase : "setup", settings);
      return reply({ ok: true, challenge: { phase: prev ? prev.phase : "setup", settings: settings, a: intercept(settings), flights: [] } });
    }
    if (data.action === "challenge_phase" && admin) {
      var phase = String(data.phase || "");
      if (!cls || PHASES.indexOf(phase) < 0) return reply({ ok: false, error: "class and a phase (" + PHASES.join(", ") + ") required" });
      var cur = readChallenge(cls), st = cur ? cur.settings : cleanSettings(DEFAULT_SETTINGS);
      writeChallenge(cls, phase, st);
      return reply({ ok: true, challenge: { phase: phase, settings: st, a: intercept(st), flights: classFlights(cls) } });
    }
    if (data.action === "challenge_reset" && admin) {
      if (!cls) return reply({ ok: false, error: "class required" });
      var fs = flightsSheet(), vals = fs.getDataRange().getValues(), removed = 0;
      for (var i = vals.length - 1; i >= 1; i--) if (String(vals[i][1]) === cls) { fs.deleteRow(i + 1); removed++; }
      var old = readChallenge(cls);
      writeChallenge(cls, "setup", old ? old.settings : cleanSettings(DEFAULT_SETTINGS));
      return reply({ ok: true, removed: removed });
    }
    var records = (data.records || []).slice(0, 50), rows = [], rejected = 0, now = Date.now() / 1000;
    records.forEach(function (r, i) {
      var st = r.state || {}, grp = String(r.group || "");
      if (!admin && !pinOk(String(st["class"] || ""), grp, r.pin)) { rejected++; return; }
      rows.push([String(now + i / 1000), grp, String(r.question || ""), String(r.finding || ""), JSON.stringify(st)]);
    });
    if (rows.length) { var sh = recordsSheet(); sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows); }
    if (rejected && !rows.length) return reply({ ok: false, error: "bad pin", rejected: rejected });
    return reply({ ok: true, n: rows.length, rejected: rejected });
  } finally { lock.releaseLock(); }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
