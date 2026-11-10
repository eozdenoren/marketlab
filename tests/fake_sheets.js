/* A fake of the Apps Script services the two scripts use (SpreadsheetApp, LockService, ContentService,
   PropertiesService, CacheService), enough to run backend/Code.gs or backend/Pricing.gs in a node vm. Cells convert
   typed values the way Google Sheets does ("0001" becomes the number 1). Shared by the backend checks and the
   pricing test server. */
"use strict";
var fs = require("fs"), vm = require("vm");

function sheetValue(v) {
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return v;
}
function FakeSheet(name) { this.name = name; this.rows = []; }
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.appendRow = function (r) { this.rows.push(r.map(sheetValue)); };
FakeSheet.prototype.getDataRange = function () { var rows = this.rows; return { getValues: function () { return rows.map(function (r) { return r.slice(); }); } }; };
FakeSheet.prototype.deleteRow = function (i) { this.rows.splice(i - 1, 1); };
FakeSheet.prototype.getRange = function (r, c) {
  var self = this;
  return {
    setValue: function (v) { self.rows[r - 1][c - 1] = sheetValue(v); },
    setValues: function (vals) { vals.forEach(function (row, k) { self.rows[r - 1 + k] = row.map(sheetValue); }); }
  };
};
function FakeBook() { this.sheets = {}; }
FakeBook.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
FakeBook.prototype.insertSheet = function (n) { return (this.sheets[n] = new FakeSheet(n)); };

// load(path, {books: {id: FakeBook}, active: FakeBook, props: {}}) -> {ctx, get(params), post(data), TOKEN, ADMIN_TOKEN}
function load(path, env) {
  var props = env.props || {}, cache = {};
  var ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: function () { return env.active; },
                      openById: function (id) { if (!env.books || !env.books[id]) throw new Error("no such sheet " + id); return env.books[id]; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: function (s) { return { setMimeType: function () { return JSON.parse(s); } }; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined || props[k] === null ? null : props[k]; } }; } },
    CacheService: { getScriptCache: function () { return { get: function (k) { return cache[k] || null; }, put: function (k, v) { cache[k] = v; } }; } },
    Date: Date, JSON: JSON, String: String, Number: Number, Math: Math, Object: Object, Error: Error
  };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path, "utf8"), ctx);
  return { ctx: ctx, props: props,
           get: function (p) { return ctx.doGet({ parameter: p }); },
           post: function (d) { return ctx.doPost({ postData: { contents: JSON.stringify(d) } }); },
           TOKEN: vm.runInContext("TOKEN", ctx), ADMIN_TOKEN: vm.runInContext("ADMIN_TOKEN", ctx) };
}
module.exports = { FakeSheet: FakeSheet, FakeBook: FakeBook, sheetValue: sheetValue, load: load };
