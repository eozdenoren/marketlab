// ==== PRICING LAB SCRIPT, VERSION 5 (14 Nov 2026): teams choose the seats to sell ====
// (The pricing instructor page shows this version number at the bottom once this code is the live deployment.)
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
         "flights"   (ts | class | group | n | fare | passengers | profit | gain)   the teams' flights

   The challenge: each group is a consulting team pricing a new route. It is told the cost per passenger (mc),
   the seats, and the trial flights' fare p0 with the q0 passengers they carried on average (a single point,
   so nothing about the slope); the demand Q = a - b P is hidden (b in the
   settings, a = q0 + b p0). It flies `flights` flights. For each it chooses how many seats to sell (1 to the
   plane's seats); the fare is then the highest at which that many people buy, (a - seats) / b, to the penny, and
   the profit (fare - mc) x seats to the pound. (A page from before version 5 sends a fare instead: the passengers
   are then a - b x fare, rounded and capped by the seats.) Each flight's gain is its profit minus a trial
   flight's, (p0 - mc) q0. Phases: setup -> open -> closed -> revealed (the demand is sent to the pages);
   "round2" is a phase older pages could set and reads as revealed. Settings cannot change while flights exist.

   A class may run several routes at once (settings: {flights, routes: [{label, mc, seats, p0, q0, b}, ...]}): a
   group prices the route its number gives it, in turn (Group 1 the first route, Group 2 the second, ...), and
   competes only with the groups on that route; each route has its own hidden demand and its own board. A page
   with a group's PIN gets that group's route; a page without one (the projector) gets every route's told numbers
   and board. The routes offered as presets on the instructor page are PRESET_SETS below, sent to the instructor
   only: the pages are public, so no demand may sit in them.

   GET  ?token=<page>&action=check&class=&group=&pin=       -> {status:"new"} | {status:"ok", names, records, challenge}
        ?token=<page>&action=challenge&class=[&group=&pin=]  -> {challenge: phase, told numbers, board, revealed demand
                                                               once revealed, and the group's own flights if given}
        ?token=<admin>[&class=]                              -> every record
        ?token=<admin>&action=groups[&class=]                -> groups registered on the pricing page
        ?token=<admin>&action=challenge&class=               -> settings, phase and every flight of the class (with
                                                                its route), the preset sets, the class's groups
   POST {token:<page>, action:"register", class, group, pin, names}        -> registers here (refused if taken)
        {token:<page>, action:"fly", class, group, pin, seats}             -> flies one flight selling that many seats
                                                                              (phase open); `fare` in place of `seats`
                                                                              is the older form
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
var VERSION = "5 (14 Nov 2026)";   // sent with every reply; the same number as in the first line of this file
var PHASES = ["setup", "open", "closed", "revealed", "round2"];
var MAX_ROUTES = 6, DEFAULT_FLIGHTS = 6;
var DEFAULT_ROUTE = { label: "London–Anchorage", mc: 80, seats: 500, p0: 480, q0: 400, b: 0.5 };
// The sets of routes the instructor page offers: per route the label, the cost per passenger, the plane's capacity,
// the hidden demand Q = a - b P and the trial fare (the passengers it carried follow). This file is public, so it
// holds one example set only; the sets used in class are in the deployed copy and nowhere else.
var PRESET_SETS = [
  { name: "Example set", routes: [
    { label: "London–Anchorage", mc: 80, seats: 500, a: 640, b: 0.5, p0: 480 },
    { label: "London–Zanzibar", mc: 100, seats: 480, a: 600, b: 0.4, p0: 550 },
    { label: "London–Bali", mc: 80, seats: 400, a: 480, b: 0.25, p0: 700 }] }
];

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
function cleanRoute(r) {
  r = r || {};
  var out = { label: String(r.label || "") };
  ["mc", "seats", "p0", "q0", "b"].forEach(function (k) { var v = Number(r[k]); out[k] = isNaN(v) ? DEFAULT_ROUTE[k] : v; });
  if (!(out.b > 0)) out.b = DEFAULT_ROUTE.b;
  return out;
}
// {flights, routes: [...]}; a row saved before the routes (one route, its numbers beside `flights`) reads as one route.
function cleanSettings(s) {
  s = s || {};
  var list = (s.routes && s.routes.length) ? s.routes.slice(0, MAX_ROUTES) : [s];
  var fl = Number(s.flights); if (isNaN(fl)) fl = DEFAULT_FLIGHTS;
  return { flights: Math.max(1, Math.min(12, Math.round(fl))), routes: list.map(cleanRoute) };
}
// The route a group prices: by its number, in turn, so a stream's consecutive numbers split evenly over the routes
// and nobody has to allocate them.
function routeIndex(group, n) {
  var m = /(\d+)\s*$/.exec(String(group || "")), k = m ? Number(m[1]) : 1;
  return ((k - 1) % n + n) % n;
}
function intercept(s) { return s.q0 + s.b * s.p0; }                          // Q = a - b P through the trial point; s is a route
function passengersAt(s, fare) { return Math.max(0, Math.min(s.seats, Math.round(intercept(s) - s.b * fare))); }
function profitAt(s, fare) { return (fare - s.mc) * passengersAt(s, fare); }
function statusQuoProfit(s) { return (s.p0 - s.mc) * s.q0; }
// A flight that sells q seats: everyone pays the highest fare at which q people buy, (a - q) / b. The fare is
// kept to the penny and the profit to the pound (the profit is worked from the exact fare).
function seatsFlight(s, q) {
  var exact = (intercept(s) - q) / s.b;
  return { fare: Math.round(exact * 100) / 100, passengers: q, profit: Math.round((exact - s.mc) * q) };
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
    var g = by[f.group] || (by[f.group] = { group: f.group, n: 0, gain: 0, fares: [], sold: [] });
    g.n++; g.gain += f.gain; g.fares.push(f.fare); g.sold.push(f.passengers);
  });
  var out = Object.keys(by).map(function (k) { return by[k]; });
  if (!withFares) out.forEach(function (g) { delete g.fares; delete g.sold; });
  out.sort(function (x, y) { return y.gain - x.gain || x.group.localeCompare(y.group, undefined, { numeric: true }); });
  return out;
}
// What the pages may know: the told numbers always, the demand once revealed, the board (each team's seats sold
// and fares once revealed). With
// a group (its PIN checked by the caller), or in a class with one route: that route. Otherwise every route.
function publicChallenge(cls, group) {
  var c = readChallenge(cls);
  if (!c) return { phase: "setup", told: null };
  var s = c.settings, n = s.routes.length, revealed = c.phase === "revealed" || c.phase === "round2", flights = classFlights(cls);
  var byRoute = s.routes.map(function () { return []; });
  flights.forEach(function (f) { byRoute[routeIndex(f.group, n)].push(f); });
  function view(i) {
    var r = s.routes[i], v = { told: { mc: r.mc, seats: r.seats, p0: r.p0, q0: r.q0, flights: s.flights, label: r.label }, board: board(byRoute[i], revealed) };
    if (revealed) v.demand = { a: intercept(r), b: r.b };
    return v;
  }
  var out = { phase: c.phase, nroutes: n };
  if (group || n === 1) {
    var i = group ? routeIndex(group, n) : 0, v = view(i);
    out.route = i; out.told = v.told; out.board = v.board;
    if (v.demand) out.demand = v.demand;
    if (group) out.mine = flights.filter(function (f) { return f.group === group; });
  } else out.routes = s.routes.map(function (r, i) { return view(i); });
  return out;
}
// What the instructor sees: the settings with each route's intercept, and every flight with its route.
function adminChallenge(cls, phase, settings, flights) {
  var n = settings.routes.length;
  return { phase: phase,
           settings: { flights: settings.flights, routes: settings.routes.map(function (r) { return { label: r.label, mc: r.mc, seats: r.seats, p0: r.p0, q0: r.q0, b: r.b, a: intercept(r) }; }) },
           flights: (flights || classFlights(cls)).map(function (f) { f.route = routeIndex(f.group, n); return f; }) };
}
// The groups registered for a class, in the Marketplace Laboratory or here (names only).
function classGroups(cls) {
  var seen = {}, out = [];
  [marketlabGroupsRows(), groupsSheet().getDataRange().getValues()].forEach(function (values) {
    if (!values) return;
    for (var i = 1; i < values.length; i++) {
      var g = String(values[i][1]);
      if (String(values[i][0]) === cls && !seen[g]) { seen[g] = true; out.push(g); }
    }
  });
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
      var ccls = String(p["class"] || ""), c = readChallenge(ccls);
      return reply({ ok: true, challenge: c ? adminChallenge(ccls, c.phase, c.settings) : null, presets: PRESET_SETS, groups: classGroups(ccls) });
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
      if (!c || c.phase !== "open") return reply({ ok: false, error: "the challenge is not open", challenge: publicChallenge(cls, group) });
      var r = c.settings.routes[routeIndex(group, c.settings.routes.length)], fl;
      if (data.seats !== undefined) {                       // the team chooses the seats to sell
        var q = Number(data.seats), most = Math.min(r.seats, Math.floor(intercept(r)));
        if (isNaN(q) || q !== Math.round(q) || q < 1 || q > r.seats) return reply({ ok: false, error: "the seats to sell must be a whole number from 1 to " + r.seats });
        if (q > most) return reply({ ok: false, error: "at most " + most + " people would fly this route, whatever the fare" });
        fl = seatsFlight(r, q);
      } else {                                              // a page from before version 5 sends the fare
        var fare = Number(data.fare);
        if (isNaN(fare) || fare < 0 || fare > 1e6) return reply({ ok: false, error: "the fare must be a number of pounds" });
        fare = Math.round(fare);
        fl = { fare: fare, passengers: passengersAt(r, fare) };
        fl.profit = (fare - r.mc) * fl.passengers;
      }
      var mine = classFlights(cls).filter(function (f) { return f.group === group; });
      if (mine.length >= c.settings.flights) return reply({ ok: false, error: "all flights flown", challenge: publicChallenge(cls, group) });
      var gain = fl.profit - statusQuoProfit(r);
      flightsSheet().appendRow([String(Date.now() / 1000), cls, group, mine.length + 1, fl.fare, fl.passengers, fl.profit, gain]);
      return reply({ ok: true, flight: { n: mine.length + 1, fare: fl.fare, passengers: fl.passengers, profit: fl.profit, gain: gain }, challenge: publicChallenge(cls, group) });
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
      return reply({ ok: true, challenge: adminChallenge(cls, prev ? prev.phase : "setup", settings, []) });
    }
    if (data.action === "challenge_phase" && admin) {
      var phase = String(data.phase || "");
      if (!cls || PHASES.indexOf(phase) < 0) return reply({ ok: false, error: "class and a phase (" + PHASES.join(", ") + ") required" });
      var cur = readChallenge(cls), st = cur ? cur.settings : cleanSettings(null);
      writeChallenge(cls, phase, st);
      return reply({ ok: true, challenge: adminChallenge(cls, phase, st) });
    }
    if (data.action === "challenge_reset" && admin) {
      if (!cls) return reply({ ok: false, error: "class required" });
      var fs = flightsSheet(), vals = fs.getDataRange().getValues(), removed = 0;
      for (var i = vals.length - 1; i >= 1; i--) if (String(vals[i][1]) === cls) { fs.deleteRow(i + 1); removed++; }
      var old = readChallenge(cls);
      writeChallenge(cls, "setup", old ? old.settings : cleanSettings(null));
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
  obj.version = VERSION;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
