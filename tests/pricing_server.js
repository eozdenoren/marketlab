/* Serves backend/Pricing.gs over HTTP for the browser test: the real script in a node vm against fake sheets, with a
   fake Marketplace Laboratory sheet holding the groups in the seed file. Prints the port and the tokens as JSON.
       node tests/pricing_server.js <seed.json> [port]
   seed.json: {"marketlab_groups": [["CM03AUT26A", "Group 12", "1234", "Ana, Bo", "2026-11-09T10:00:00Z"], ...],
               "password": "Sesame-42"} */
"use strict";
var http = require("http"), path = require("path"), url = require("url"), fs = require("fs");
var F = require("./fake_sheets.js");
var seed = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), port = Number(process.argv[3] || 0);
var own = new F.FakeBook(), marketlab = new F.FakeBook();
marketlab.insertSheet("groups").rows = [["class", "group", "pin", "names", "registered"]].concat((seed.marketlab_groups || []).map(function (r) { return r.map(F.sheetValue); }));
var script = F.load(path.join(__dirname, "..", "backend", "Pricing.gs"), { active: own, books: { "MARKET-ID": marketlab }, props: { MARKETLAB_SHEET: "MARKET-ID", INSTRUCTOR_PASSWORD: seed.password || "Sesame-42" } });
var server = http.createServer(function (req, res) {
  var headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { res.writeHead(204, headers); res.end(); return; }
  var u = url.parse(req.url, true);
  if (u.pathname === "/_sheets") { res.writeHead(200, headers); res.end(JSON.stringify({ own: own.sheets, marketlab: marketlab.sheets }, function (k, v) { return v instanceof F.FakeSheet ? v.rows : v; })); return; }
  if (req.method === "GET") { res.writeHead(200, headers); res.end(JSON.stringify(script.get(u.query))); return; }
  var body = "";
  req.on("data", function (c) { body += c; });
  req.on("end", function () {
    var out;
    try { out = script.ctx.doPost({ postData: { contents: body } }); } catch (e) { out = { ok: false, error: String(e) }; }
    res.writeHead(200, headers); res.end(JSON.stringify(out));
  });
});
server.listen(port, "127.0.0.1", function () {
  console.log(JSON.stringify({ port: server.address().port, token: script.TOKEN, admin_token: script.ADMIN_TOKEN, password: seed.password || "Sesame-42" }));
});
