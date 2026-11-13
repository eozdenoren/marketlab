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
check(setr.ok && setr.challenge.settings.routes.length === 1 && setr.challenge.settings.routes[0].a === 640 && setr.challenge.settings.flights === 6 && setr.challenge.phase === "setup", "settings set (the older flat form reads as one route), intercept 640: " + JSON.stringify(setr));
var fly0 = post({ token: PAGE, action: "fly", "class": "A", group: "Group 5", pin: "0001", fare: 680 });
check(!fly0.ok && /not open/.test(fly0.error), "cannot fly before round 1 opens");
check(post({ token: ADMIN, action: "challenge_phase", "class": "A", phase: "open" }).ok, "round 1 opened");
var pub = get({ token: PAGE, action: "challenge", "class": "A" }).challenge;
check(pub.phase === "open" && pub.told.p0 === 580 && pub.told.q0 === 350 && pub.told.mc === 80 && pub.told.seats === 450 && pub.told.flights === 6, "told numbers: " + JSON.stringify(pub.told));
check(pub.told.history === undefined, "no fare range is sent (it would give the slope away)");
check(pub.told.b === undefined && pub.told.a === undefined, "the slope and the intercept are not sent");
check(pub.demand === undefined, "the demand is not sent while round 1 is open");
check(pub.nroutes === 1 && pub.route === 0 && pub.routes === undefined, "a class with one route: the page gets that route, group or not");
var pubRaw = get({ token: PAGE, action: "challenge", "class": "A" });
check(pubRaw.presets === undefined && pubRaw.groups === undefined, "the page token gets no presets and no group list");
check(/^\d+ \(/.test(pubRaw.version) && src.indexOf("VERSION " + pubRaw.version.split(" ")[0] + " (") > 0 && src.indexOf("VERSION " + pubRaw.version.split(" ")[0] + " (") < 60, "every reply carries the version, the same number as in the first line of the script: " + pubRaw.version);
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
check(adm.settings.routes[0].b === 0.5 && adm.settings.routes[0].a === 640 && adm.flights.length === 7 && adm.flights[0].route === 0 && adm.phase === "round2", "the instructor sees settings and every flight");
var admRaw = get({ token: ADMIN, action: "challenge", "class": "A" });
check(admRaw.presets.length >= 1 && admRaw.presets[0].routes.length === 3 && admRaw.presets[0].routes[0].a > 0 && admRaw.presets[0].routes[0].b > 0, "the instructor gets the preset sets");
check(["Group 5", "Group 13", "Group 7"].every(function (g) { return admRaw.groups.indexOf(g) >= 0; }) && admRaw.groups.length === 3, "the instructor gets the class's groups, from both sheets: " + JSON.stringify(admRaw.groups));
check(get({ token: ADMIN, action: "challenge", "class": "B" }).challenge === null, "a class without a challenge");
var rs = post({ token: ADMIN, action: "challenge_reset", "class": "A" });
check(rs.ok && rs.removed === 7 && get({ token: ADMIN, action: "challenge", "class": "A" }).challenge.flights.length === 0, "reset removes the flights");
check(get({ token: PAGE, action: "challenge", "class": "A" }).challenge.phase === "setup", "reset puts the class back to setup");
check(post({ token: ADMIN, action: "challenge_set", "class": "A", settings: { b: 0.4, mc: 100, seats: 420, p0: 650, q0: 340 } }).challenge.settings.routes[0].a === 600, "settings can change after a reset");
var badS = post({ token: ADMIN, action: "challenge_set", "class": "B", settings: { b: -1, flights: 99 } }).challenge.settings;
check(badS.routes[0].b === 0.5 && badS.flights === 12, "a bad slope falls back to the default, the flights are capped at 12");

// ---- several routes in one class: a group prices the route its number gives it and competes on that route only
for (var gn = 1; gn <= 5; gn++) post({ token: PAGE, action: "register", "class": "R", group: "Group " + gn, pin: "1111" });
var three = { flights: 2, routes: [{ label: "X–One", mc: 80, seats: 500, p0: 480, q0: 400, b: 0.5 }, { label: "X–Two", mc: 100, seats: 480, p0: 550, q0: 380, b: 0.4 }, { label: "X–Three", mc: 80, seats: 400, p0: 700, q0: 305, b: 0.25 }] };
var set3 = post({ token: ADMIN, action: "challenge_set", "class": "R", settings: three });
check(set3.ok && set3.challenge.settings.routes.map(function (r) { return r.a; }).join() === "640,600,480" && set3.challenge.settings.flights === 2, "three routes saved with their intercepts: " + JSON.stringify(set3.challenge.settings));
post({ token: ADMIN, action: "challenge_phase", "class": "R", phase: "open" });
function asGroup(n, pin) { return get({ token: PAGE, action: "challenge", "class": "R", group: "Group " + n, pin: pin || "1111" }).challenge; }
var r1 = asGroup(1), r2 = asGroup(2), r3 = asGroup(3), r4 = asGroup(4);
check(r1.route === 0 && r1.told.label === "X–One" && r1.told.p0 === 480 && r1.nroutes === 3 && r1.routes === undefined, "Group 1 prices the first route: " + JSON.stringify(r1.told));
check(r2.route === 1 && r2.told.p0 === 550 && r2.told.seats === 480 && r3.route === 2 && r3.told.q0 === 305 && r4.route === 0 && r4.told.flights === 2, "Groups 2, 3, 4 price routes two, three and one");
var anon = get({ token: PAGE, action: "challenge", "class": "R" }).challenge;
check(anon.told === undefined && anon.routes.length === 3 && anon.routes[1].told.p0 === 550 && anon.routes[2].told.label === "X–Three" && anon.mine === undefined, "without a group the page gets every route's told numbers");
check(!/"(a|b|demand)":/.test(JSON.stringify(anon)) && !/"(a|b|demand)":/.test(JSON.stringify(r2)), "no slope, intercept or demand before the reveal, on any route");
check(asGroup(2, "0000").routes.length === 3, "a wrong PIN gets the general view, not a route");
function flyR(n, fare) { return post({ token: PAGE, action: "fly", "class": "R", group: "Group " + n, pin: "1111", fare: fare }); }
var fr1 = flyR(1, 680), fr2 = flyR(2, 800), fr3 = flyR(3, 1000), fr4 = flyR(4, 700);
check(fr1.flight.passengers === 300 && fr1.flight.gain === 20000, "Group 1 flies its own demand: 680 carries 300, +20,000: " + JSON.stringify(fr1.flight));
check(fr2.flight.passengers === 280 && fr2.flight.profit === 196000 && fr2.flight.gain === 25000, "Group 2 flies the second demand: 800 carries 280, +25,000: " + JSON.stringify(fr2.flight));
check(fr3.flight.passengers === 230 && fr3.flight.profit === 211600 && fr3.flight.gain === 22500, "Group 3 flies the third demand: 1000 carries 230, +22,500: " + JSON.stringify(fr3.flight));
check(fr4.flight.passengers === 290 && fr4.flight.gain === 19800, "Group 4 is on the first route: 700 carries 290, +19,800");
check(fr1.challenge.board.length === 1 && fr4.challenge.board.length === 2 && fr4.challenge.board[0].group === "Group 1" && fr4.challenge.board[1].group === "Group 4", "the first route's board holds Groups 1 and 4 only");
check(asGroup(2).board.length === 1 && asGroup(2).board[0].group === "Group 2" && asGroup(5).board.length === 1 && asGroup(5).mine.length === 0, "Group 5 (second route) sees Group 2's flight, none of its own");
anon = get({ token: PAGE, action: "challenge", "class": "R" }).challenge;
check(anon.routes.map(function (v) { return v.board.length; }).join() === "2,1,1" && anon.routes[0].board[0].fares === undefined, "the general view has a board per route, fares hidden");
flyR(1, 690);
check(/all flights/.test(flyR(1, 700).error), "the flights per group apply on every route");
var admR = get({ token: ADMIN, action: "challenge", "class": "R" });
check(admR.challenge.flights.map(function (f) { return f.group + ":" + f.route; }).join() === "Group 1:0,Group 2:1,Group 3:2,Group 4:0,Group 1:0", "the instructor's flights carry their route");
check(admR.groups.length === 5, "the class's five groups are listed");
post({ token: ADMIN, action: "challenge_phase", "class": "R", phase: "revealed" });
check(asGroup(2).demand.a === 600 && asGroup(2).demand.b === 0.4 && asGroup(3).demand.a === 480 && asGroup(4).demand.b === 0.5, "each group gets its own route's demand at the reveal");
anon = get({ token: PAGE, action: "challenge", "class": "R" }).challenge;
check(anon.routes[0].demand.a === 640 && anon.routes[2].demand.b === 0.25 && anon.routes[0].board[0].fares.join() === "680,690", "the general view gets every demand and the fares at the reveal");
check(post({ token: ADMIN, action: "challenge_reset", "class": "R" }).removed === 5, "the reset removes the class's five flights");
check(post({ token: ADMIN, action: "challenge_set", "class": "R", settings: { flights: 3, routes: [three.routes[1]] } }).challenge.settings.routes.length === 1 && asGroup(3).told.p0 === 550 && asGroup(3).route === 0, "back to one route: every group prices it");

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
