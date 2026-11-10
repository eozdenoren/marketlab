/* Runs backend/Code.gs (the template, with its placeholder tokens) against a fake spreadsheet that converts typed
   values the way Google Sheets does ("0001" becomes the number 1), and checks the PIN handling and the "move" action.
       node tests/check_backend.js */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");
var src = fs.readFileSync(path.join(__dirname, "..", "backend", "Code.gs"), "utf8");
var failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log("FAIL:", msg); } }

function sheetValue(v) {                       // what a cell holds after a typed value arrives
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
var sheets = {};
var ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: function () { return { getSheetByName: function (n) { return sheets[n] || null; }, insertSheet: function (n) { return (sheets[n] = new FakeSheet(n)); } }; } },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: function (s) { return { setMimeType: function () { return JSON.parse(s); } }; } },
  PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; } }; } },
  CacheService: { getScriptCache: function () { var c = {}; return { get: function (k) { return c[k] || null; }, put: function (k, v) { c[k] = v; } }; } },
  Date: Date, JSON: JSON, String: String, Number: Number, Math: Math
};
vm.createContext(ctx); vm.runInContext(src, ctx);
var PAGE = vm.runInContext("TOKEN", ctx), ADMIN = vm.runInContext("ADMIN_TOKEN", ctx);
function post(d) { return ctx.doPost({ postData: { contents: JSON.stringify(d) } }); }
function get(p) { return ctx.doGet({ parameter: p }); }

// ---- PINs with leading zeros
check(post({ token: PAGE, action: "register", "class": "A", group: "Group 5", pin: "0001" }).ok, "register Group 5 with 0001");
check(sheets.groups.rows[1][2] === 1, "the fake sheet stores 0001 as the number 1, like Google Sheets");
var c = get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0001" });
check(c.ok && c.status === "ok", "sign-in with 0001 is accepted: " + JSON.stringify(c));
check(get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "1" }).error === "bad pin", "the PIN must still be typed as four digits");
var bad = get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0002" });
check(!bad.ok && bad.error === "bad pin", "a wrong PIN is still refused");
var s = post({ token: PAGE, records: [{ group: "Group 5", question: "q", finding: "f", pin: "0001", state: { "class": "A" } }] });
check(s.ok && s.n === 1, "a save with PIN 0001 is accepted: " + JSON.stringify(s));
post({ token: PAGE, action: "register", "class": "A", group: "Group 6", pin: "0420" });
check(get({ token: ADMIN, action: "groups", "class": "A" }).groups.filter(function (g) { return g.group === "Group 6"; })[0].pin === "0420", "the instructor's list shows 0420, not 420");

// ---- move
post({ token: PAGE, action: "register", "class": "", group: "Group 13", pin: "4321" });
post({ token: PAGE, action: "register", "class": "A-typo", group: "Group 5", pin: "0001" });
post({ token: PAGE, records: [{ group: "Group 13", question: "q1", finding: "x", pin: "4321", state: { "class": "", answers: { q1: "hello" } } },
                              { group: "Group 13", question: "q2", finding: "y", pin: "4321", state: { "class": "", labbook: { id: "p1" } } }] });
post({ token: PAGE, records: [{ group: "Group 5", question: "q3", finding: "z", pin: "0001", state: { "class": "A-typo" } }] });
var before = sheets.findings.rows.map(function (r) { return r[0]; });
var m = post({ token: ADMIN, action: "move", moves: [{ group: "Group 13", from: "", to: "A" }, { group: "Group 5", from: "A-typo", to: "A" }, { group: "Group 7", from: "", to: "A" }] });
check(m.ok, "move answers ok");
check(m.moves[0].records === 2 && m.moves[0].registration === "moved", "Group 13: two records and the registration moved: " + JSON.stringify(m.moves[0]));
check(m.moves[1].records === 1 && /dropped/.test(m.moves[1].registration), "Group 5: one record moved, duplicate registration dropped: " + JSON.stringify(m.moves[1]));
check(m.moves[2].records === 0 && m.moves[2].registration === "none", "a group with nothing to move: " + JSON.stringify(m.moves[2]));
check(JSON.stringify(sheets.findings.rows.map(function (r) { return r[0]; })) === JSON.stringify(before), "timestamps unchanged");
var g13 = get({ token: PAGE, action: "check", "class": "A", group: "Group 13", pin: "4321" });
check(g13.ok && g13.records.length === 2 && g13.records[0].state.answers.q1 === "hello", "Group 13 signs in under A and finds its work");
check(get({ token: PAGE, action: "check", "class": "", group: "Group 13", pin: "4321" }).status === "new", "nothing left under the empty code");
var g5 = get({ token: PAGE, action: "check", "class": "A", group: "Group 5", pin: "0001" });
check(g5.ok && g5.records.length === 2, "Group 5 has both its records under A");
check(!post({ token: PAGE, action: "move", moves: [{ group: "Group 5", from: "A", to: "B" }] }).moves, "the page token cannot move anything");

console.log("backend:", failures ? failures + " checks failed" : "OK");
process.exit(failures ? 1 : 0);
