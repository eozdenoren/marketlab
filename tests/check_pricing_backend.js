/* Runs backend/Pricing.gs (the template, with its placeholder tokens) against a fake spreadsheet (values converted
   the way Google Sheets converts them: "0001" becomes the number 1) plus a fake Marketplace Laboratory sheet named
   by the MARKETLAB_SHEET property, and checks sign-in through both, the challenge and the records.
       node tests/check_pricing_backend.js */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");
var src = fs.readFileSync(path.join(__dirname, "..", "backend", "Pricing.gs"), "utf8");
var failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log("FAIL:", msg); } }

function sheetValue(v) {
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return v;
}
function FakeSheet(name) { this.name = name; this.rows = []; }
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.appendRow = function (r) { this.rows.push(r.map(sheetValue)); };
FakeSheet.prototype.getDataRange = function () { var rows = this.rows; return { getValues: function () { return rows.map(function (r) { return r.slice(); }); } }; };
FakeSheet.prototype.deleteRow = function (i) { this.rows.splice(i - 1, 1); };
FakeSheet.prototype.getRange = function (r, c, nr, nc) {
  var self = this;
  return {
    setValue: function (v) { self.rows[r - 1][c - 1] = sheetValue(v); },
    setValues: function (vals) { vals.forEach(function (row, k) { self.rows[r - 1 + k] = row.map(sheetValue); }); }
  };
};
function FakeBook() { this.sheets = {}; }
FakeBook.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
FakeBook.prototype.insertSheet = function (n) { return (this.sheets[n] = new FakeSheet(n)); };
var own = new FakeBook(), marketlab = new FakeBook(), props = { MARKETLAB_SHEET: "https://docs.google.com/spreadsheets/d/MARKET-ID/edit#gid=0" };
marketlab.insertSheet("groups").rows = [["class", "group", "pin", "names", "registered"], ["A", "Group 5", 1, "Ana, Bo", "2026-11-09T10:00:00Z"], ["A", "Group 13", 4321, "", "2026-11-09T10:01:00Z"]];
var ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: function () { return own; }, openById: function (id) { if (id !== "MARKET-ID") throw new Error("no such sheet " + id); return marketlab; } },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: function (s) { return { setMimeType: function () { return JSON.parse(s); } }; } },
  PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; } }; } },
  CacheService: (function () { var c = {}; return { getScriptCache: function () { return { get: function (k) { return c[k] || null; }, put: function (k, v) { c[k] = v; } }; } }; })(),
  Date: Date, JSON: JSON, String: String, Number: Number, Math: Math, Object: Object, Error: Error
};
vm.createContext(ctx); vm.runInContext(src, ctx);
var PAGE = vm.runInContext("TOKEN", ctx), ADMIN = vm.runInContext("ADMIN_TOKEN", ctx);
function post(d) { return ctx.doPost({ postData: { contents: JSON.stringify(d) } }); }
function get(p) { return ctx.doGet({ parameter: p }); }

// ---- sign-in through the Marketplace sheet, and registration here
var c = get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0001" });
check(c.ok && c.status === "ok" && c.names === "Ana, Bo", "Group 5 signs in with the Marketplace registration (PIN 0001 stored as 1): " + JSON.stringify(c));
check(c.challenge && c.challenge.phase === "setup" && c.challenge.told === null, "no challenge set up yet: " + JSON.stringify(c.challenge));
check(get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0002" }).error === "bad pin", "a wrong PIN is refused");
check(get({ token: PAGE, action: "check", "class": "A", group: "Group 7", pin: "7777" }).status === "new", "an unregistered group is new");
check(post({ token: PAGE, action: "register", "class": "A", group: "Group 5", pin: "9999" }).error === "taken", "cannot re-register a Marketplace group here");
check(post({ token: PAGE, action: "register", "class": "A", group: "Group 7", pin: "0777" }).ok, "Group 7 registers on the pricing page");
check(get({ token: PAGE, action: "check", "class": "A", group: "Group 7", pin: "0777" }).status === "ok", "Group 7 signs in with its pricing registration");
check(get({ token: ADMIN, action: "groups", "class": "A" }).groups.filter(function (g) { return g.group === "Group 7"; })[0].pin === "0777", "the instructor's list shows 0777");
props.MARKETLAB_SHEET = null;
check(get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0001" }).status === "new", "without the property, only the pricing sheet's groups are known");
props.MARKETLAB_SHEET = "MARKET-ID";
check(get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0001" }).status === "ok", "the property may also be the bare ID");

// ---- the challenge: settings, phases, flights
var bad = post({ token: PAGE, action: "challenge_set", "class": "A", settings: { b: 1 } });
check(!bad.ok || !bad.challenge, "the page token cannot set the challenge");
var setr = post({ token: ADMIN, action: "challenge_set", "class": "A", settings: { mc: 80, seats: 450, p0: 580, q0: 350, b: 0.5, flights: 6 } });
check(setr.ok && setr.challenge.a === 640 && setr.challenge.phase === "setup", "settings set, intercept 640: " + JSON.stringify(setr));
var fly0 = post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0001", fare: 680 });
check(!fly0.ok && /not open/.test(fly0.error), "cannot fly before round 1 opens");
check(post({ token: ADMIN, action: "challenge_phase", "class": "A", phase: "open" }).ok, "round 1 opened");
var pub = get({ token: PAGE, action: "challenge", "class": "A" }).challenge;
check(pub.phase === "open" && pub.told.p0 === 580 && pub.told.q0 === 350 && pub.told.mc === 80 && pub.told.seats === 450 && pub.told.flights === 6, "told numbers: " + JSON.stringify(pub.told));
check(pub.told.history === undefined, "no fare range is sent (it would give the slope away)");
check(pub.told.b === undefined && pub.told.a === undefined, "the slope and the intercept are not sent");
check(pub.demand === undefined, "the demand is not sent while round 1 is open");
var f1 = post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0001", fare: 680 });
check(f1.ok && f1.flight.passengers === 300 && f1.flight.profit === 180000 && f1.flight.gain === 5000, "fare 680: 300 passengers, profit 180,000, gain 5,000: " + JSON.stringify(f1.flight));
var f2 = post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0001", fare: 380 });
check(f2.ok && f2.flight.passengers === 450 && f2.flight.gain === -40000, "fare 380 fills the plane and loses 40,000: " + JSON.stringify(f2.flight));
var f3 = post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0001", fare: 2000 });
check(f3.ok && f3.flight.passengers === 0 && f3.flight.profit === 0 && f3.flight.gain === -175000, "a fare above the choke price flies empty");
check(f3.challenge.mine.length === 3 && f3.challenge.mine[2].n === 3, "the answer carries the group's three flights");
check(post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0002", fare: 600 }).error === "bad pin", "a wrong PIN cannot fly");
check(post({ token: PAGE, action: "fly", "class": "A", group: "Group 7", pin: "0777", fare: 599.6 }).flight.fare === 600, "fares are rounded to the pound");
check(post({ token: PAGE, action: "fly", "class": "A", group: "Group 7", pin: "0777", fare: "abc" }).ok === false, "a non-number is refused");
pub = get({ token: PAGE, action: "challenge", "class": "A", group: "Group 7", pin: "0777" }).challenge;
check(pub.board.length === 2 && pub.board[0].group === "Group 7" && pub.board[0].n === 1 && pub.board[0].fares === undefined, "board: Group 7 leads (one flight, gain " + pub.board[0].gain + "), fares hidden");
check(pub.board[1].group === "Group 5" && pub.board[1].gain === 5000 - 40000 - 175000, "Group 5's cumulative gain");
check(pub.mine.length === 1 && pub.mine[0].fare === 600, "own flights come with the group's PIN");
check(get({ token: PAGE, action: "challenge", "class": "A", group: "Group 7", pin: "0000" }).challenge.mine === undefined, "no own flights with a wrong PIN");
for (var k = 0; k < 3; k++) post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0001", fare: 680 });
var f7 = post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0001", fare: 680 });
check(!f7.ok && /all flights/.test(f7.error) && f7.challenge.mine.length === 6, "a seventh flight is refused");
var locked = post({ token: ADMIN, action: "challenge_set", "class": "A", settings: { b: 1 } });
check(!locked.ok && /reset/.test(locked.error), "settings cannot change once flights exist");
check(post({ token: ADMIN, action: "challenge_phase", "class": "A", phase: "closed" }).ok, "round 1 closed");
check(/not open/.test(post({ token: PAGE, action: "fly", "class": "A", group: "Group 7", pin: "0777", fare: 650 }).error), "no flights after the close");
check(post({ token: ADMIN, action: "challenge_phase", "class": "A", phase: "revealed" }).ok, "revealed");
pub = get({ token: PAGE, action: "challenge", "class": "A" }).challenge;
check(pub.demand && pub.demand.a === 640 && pub.demand.b === 0.5, "the demand is sent once revealed: " + JSON.stringify(pub.demand));
check(pub.board[0].fares && pub.board[0].fares.length === 1 && pub.board[1].fares.length === 6, "fares shown once revealed");
check(post({ token: ADMIN, action: "challenge_phase", "class": "A", phase: "round2" }).ok && get({ token: PAGE, action: "challenge", "class": "A" }).challenge.demand.a === 640, "round 2 keeps the demand");
check(post({ token: ADMIN, action: "challenge_phase", "class": "A", phase: "nonsense" }).ok === false, "an unknown phase is refused");
var adm = get({ token: ADMIN, action: "challenge", "class": "A" }).challenge;
check(adm.settings.b === 0.5 && adm.flights.length === 7 && adm.phase === "round2", "the instructor sees settings and every flight");
check(get({ token: ADMIN, action: "challenge", "class": "B" }).challenge === null, "a class without a challenge");
var rs = post({ token: ADMIN, action: "challenge_reset", "class": "A" });
check(rs.ok && rs.removed === 7 && get({ token: ADMIN, action: "challenge", "class": "A" }).challenge.flights.length === 0, "reset removes the flights");
check(get({ token: PAGE, action: "challenge", "class": "A" }).challenge.phase === "setup", "reset puts the class back to setup");
check(post({ token: ADMIN, action: "challenge_set", "class": "A", settings: { b: 0.4, mc: 100, seats: 420, p0: 650, q0: 340 } }).challenge.a === 600, "settings can change after a reset");
check(post({ token: ADMIN, action: "challenge_set", "class": "B", settings: { b: -1, flights: 99 } }).challenge.settings.b === 0.5, "a bad slope falls back to the default");

// ---- records (pins and answers)
var s = post({ token: PAGE, records: [{ group: "Group 5", question: "Challenge", finding: "f", pin: "0001", state: { "class": "A", labbook: { id: "p1", kind: "pin", tab: "challenge" } } }] });
check(s.ok && s.n === 1, "a save with the Marketplace PIN is accepted: " + JSON.stringify(s));
check(post({ token: PAGE, records: [{ group: "Group 5", question: "q", finding: "f", pin: "1", state: { "class": "A" } }] }).error === "bad pin", "the PIN must be typed as four digits");
var g5 = get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0001" });
check(g5.records.length === 1 && g5.records[0].state.labbook.id === "p1", "Group 5 finds its record at sign-in");
check(get({ token: ADMIN, "class": "A" }).records.length === 1 && get({ token: ADMIN, "class": "B" }).records.length === 0, "the instructor reads a class's records");
check(post({ token: ADMIN, action: "reset", "class": "A", group: "Group 7" }).reset === true && get({ token: PAGE, action: "check", "class": "A", group: "Group 7", pin: "0777" }).status === "new", "a pricing registration can be reset");
check(post({ token: ADMIN, action: "reset", "class": "A", group: "Group 5" }).reset === false, "a Marketplace registration is never touched");

// ---- the password and the lock
props.INSTRUCTOR_PASSWORD = "Sesame-42";
check(get({ token: "Sesame-42", "class": "A" }).ok, "the password signs in");
for (var w = 0; w < 10; w++) get({ token: "wrong" + w, "class": "A" });
check(get({ token: "Sesame-42", "class": "A" }).error === "locked", "locked after ten wrong credentials");
check(get({ token: ADMIN, "class": "A" }).ok, "the admin token is never locked");

console.log("pricing backend:", failures ? failures + " checks failed" : "OK");
process.exit(failures ? 1 : 0);
