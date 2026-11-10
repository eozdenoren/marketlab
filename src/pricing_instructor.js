/* Pricing Laboratory instructor page: the challenge's controls and live leaderboard, and the groups' lab books, read
   straight from the pricing script (backend/Pricing.gs). Sign in with the instructor password (or the admin token);
   the credential goes to the script with every request and stays in this browser. Depends on PricingCore
   (pricing_core.js), MLQR (qr.js) and the questions in pricing_questions.js. */
(function () {
  "use strict";
  var C = PricingCore, esc = C.esc, fmt = C.fmt, money = C.money;
  var CONFIG = window.PRICINGLAB_CONFIG || {};
  var ENDPOINT = (CONFIG.endpoint || "").trim();
  var APP_URL = (CONFIG.app_url || "").replace(/\/+$/, "") || location.href.replace(/[?#].*$/, "").replace(/\/[^\/]*$/, "");
  var CLASSES = (CONFIG.classes || []).map(function (c) { return String(c).trim().toUpperCase(); }).filter(Boolean);
  var CRED_KEY = "pricinglab:instructor:cred", CLASS_KEY = "pricinglab:instructor:class";
  var VIEWS = ["challenge", "overview", "question", "group", "setup"];
  var PHASES = [["setup", "Not open yet"], ["open", "Round 1 open"], ["closed", "Round 1 closed"], ["revealed", "Demand revealed"], ["round2", "Round 2 open"]];
  // Three routes with round numbers: the hidden demand Q = a - b P, and last month's fare on it (its passengers
  // follow); the demand differs, so the answer differs from one stream to the next.
  var PRESETS = [
    { label: "London–Detroit", mc: 80, seats: 450, a: 640, b: 0.5, p0: 580, flights: 6 },
    { label: "London–Chicago", mc: 100, seats: 420, a: 600, b: 0.4, p0: 650, flights: 6 },
    { label: "London–Singapore", mc: 80, seats: 320, a: 480, b: 0.25, p0: 800, flights: 6 }];
  var S = { cred: "", records: null, books: {}, cls: "", view: "challenge", q: PQUESTIONS[0].title, group: "", challenge: null, readAt: null, busy: false, error: "", msg: "", form: null };

  function $(id) { return document.getElementById(id); }
  function fmtTime(ts, withDate) {
    if (!ts) return "";
    var o = withDate === false ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
    o.timeZone = "Europe/London"; o.hour12 = false;
    return new Date(ts * 1000).toLocaleString("en-GB", o).replace(",", "");
  }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function csvCell(v) { var s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csv(rows) { return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n"; }
  function download(name, text) {
    var a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function classLink(cls) { return APP_URL + "/pricing.html?class=" + encodeURIComponent(cls); }
  function projectorLink(cls) { return classLink(cls) + "&projector=1"; }
  function selectOptions(values, current, labels) { return values.map(function (v, i) { return '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + '>' + esc(labels ? labels[i] : v) + '</option>'; }).join(""); }
  function questionIndex(title) { for (var i = 0; i < PQUESTIONS.length; i++) if (PQUESTIONS[i].title === title) return i; return PQUESTIONS.length - 1; }
  function ticks(n) { return n === 0 ? "" : (n <= 3 ? "✓".repeat(n) : "✓×" + n); }

  // ---- the class record ------------------------------------------------------------------------------------------
  function api(params) {
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(ENDPOINT + (ENDPOINT.indexOf("?") >= 0 ? "&" : "?") + qs).then(function (r) { return r.json(); });
  }
  function post(body) { return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
  function loadRecords(cb) {
    S.busy = true; renderTop();
    api({ token: S.cred }).then(function (j) {
      S.busy = false;
      if (!j || !j.ok) { cb(j && j.error ? j.error : "no answer from the class record"); return; }
      S.records = j.records || []; S.readAt = Date.now() / 1000; rebuild(); cb(null);
    }).catch(function (err) { S.busy = false; cb(String(err && err.message || err)); });
  }
  function loadChallenge(cb) {
    if (!S.cls) { if (cb) cb(); return; }
    api({ token: S.cred, action: "challenge", "class": S.cls }).then(function (j) {
      if (j && j.ok) { S.challenge = j.challenge; S.defaults = j.defaults; }
      if (cb) cb(j && j.ok ? null : ((j && j.error) || "no answer"));
    }).catch(function (err) { if (cb) cb(String(err && err.message || err)); });
  }
  function booksFromRecords(records) {
    var books = {};
    records.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); }).forEach(function (f) {
      var state = f.state || {}, lbk = state.labbook, cls = state["class"] || "", key = cls + "\u0000" + (f.group || "");
      var g = books[key] || (books[key] = { "class": cls, group: f.group || "", names: "", entries: {}, order: [], notes: "", answers: {}, last: 0 });
      g.last = Math.max(g.last, f.ts || 0);
      if (state.names) g.names = state.names;
      if (!lbk) return;
      if (lbk.kind === "notes") { g.notes = f.finding || ""; return; }
      if (lbk.kind === "answers") { Object.keys(state.answers || {}).forEach(function (k) { if (String(state.answers[k] || "").trim()) g.answers[k] = state.answers[k]; }); return; }
      if (lbk.deleted) { delete g.entries[lbk.id]; return; }
      var sw = {}; Object.keys(state).forEach(function (k) { if (k !== "labbook") sw[k] = state[k]; });
      if (!g.entries[lbk.id]) g.order.push(lbk.id);
      g.entries[lbk.id] = { id: lbk.id, ts: f.ts || 0, tab: lbk.tab || "", label: lbk.label || "", question: f.question || "", note: f.finding || "", measures: lbk.measures || {}, state: sw };
    });
    return books;
  }
  function entriesOf(bk) { return bk.order.filter(function (id) { return bk.entries[id]; }).map(function (id) { return bk.entries[id]; }); }
  function rebuild() {
    S.books = booksFromRecords(S.records);
    var seen = {}; CLASSES.forEach(function (c) { seen[c] = true; });
    Object.keys(S.books).forEach(function (k) { if (S.books[k]["class"]) seen[S.books[k]["class"]] = true; });
    S.classes = Object.keys(seen);
    if (S.classes.indexOf(S.cls) < 0) S.cls = S.classes.length ? S.classes[0] : "";
  }
  function booksOf(cls) {
    return Object.keys(S.books).map(function (k) { return S.books[k]; }).filter(function (bk) { return bk["class"] === cls; })
                 .sort(function (a, b) { return a.group.localeCompare(b.group, undefined, { numeric: true }); });
  }

  // ---- sign-in and the top bar ---------------------------------------------------------------------------------
  function storedCred() { try { return localStorage.getItem(CRED_KEY) || sessionStorage.getItem(CRED_KEY) || ""; } catch (e) { return ""; } }
  function storeCred(cred, remember) { try { sessionStorage.setItem(CRED_KEY, cred); if (remember) localStorage.setItem(CRED_KEY, cred); else localStorage.removeItem(CRED_KEY); } catch (e) {} }
  function clearCred() { try { sessionStorage.removeItem(CRED_KEY); localStorage.removeItem(CRED_KEY); } catch (e) {} }
  function renderSignin(error) {
    $("main").hidden = true; $("topbar").innerHTML = "";
    if (!ENDPOINT) { $("signin").innerHTML = '<div class="error">This copy of the instructor page has no class record endpoint. Build it with <code>python3 build.py --config config.json</code> with a "pricing" section in the config.</div>'; return; }
    $("signin").innerHTML = '<div class="panel"><form id="signin-form" class="signin">' +
      '<div><label for="pw">Instructor password</label><input type="password" id="pw" autocomplete="current-password" autofocus></div>' +
      '<div><label class="check"><input type="checkbox" id="remember"> Remember on this computer</label></div>' +
      '<div><button type="submit" class="primary" id="signin-btn" style="width:100%">Sign in</button></div></form>' +
      '<p class="caption">The password of the Pricing Laboratory\'s script (its INSTRUCTOR_PASSWORD property). Leave "Remember" unticked on a shared computer.</p>' +
      '<div id="signin-error" class="error"' + (error ? "" : " hidden") + '>' + esc(error || "") + '</div></div>';
    $("signin-form").onsubmit = function (ev) {
      ev.preventDefault();
      var pw = $("pw").value, remember = $("remember").checked, btn = $("signin-btn"), errEl = $("signin-error");
      if (!pw) { errEl.textContent = "Please type the password."; errEl.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Checking…"; S.cred = pw;
      loadRecords(function (err) {
        if (err) {
          S.cred = ""; btn.disabled = false; btn.textContent = "Sign in";
          errEl.textContent = /bad token|locked/.test(err) ? (/locked/.test(err) ? "Too many wrong passwords; the class record refuses sign-ins for a while." : "Wrong password.") : "Could not reach the class record (" + err + ").";
          errEl.hidden = false; return;
        }
        storeCred(pw, remember); start();
      });
    };
  }
  function renderTop() {
    if (!S.cred) return;
    $("topbar").innerHTML = '<span class="caption" id="top-status">' + (S.busy ? "Reading the class record…" : (S.readAt ? "Read at " + fmtTime(S.readAt, false) : "")) + '</span>' +
      '<button type="button" id="refresh"' + (S.busy ? " disabled" : "") + '>Refresh</button><button type="button" id="signout">Sign out</button>';
    $("refresh").onclick = function () { loadRecords(function (err) { S.error = err || ""; loadChallenge(function () { render(); }); }); };
    $("signout").onclick = function () { clearCred(); S.cred = ""; S.records = null; clearTimeout(pollTimer); renderSignin(); };
  }
  function start() {
    $("signin").innerHTML = ""; $("main").hidden = false;
    try { var c = localStorage.getItem(CLASS_KEY); if (c != null && S.classes.indexOf(c) >= 0) S.cls = c; } catch (e) {}
    loadChallenge(function () { render(); schedulePoll(); });
  }
  var pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!S.cred) return;
    pollTimer = setTimeout(function () {
      if (S.view === "challenge" && S.challenge && (S.challenge.phase === "open" || S.challenge.phase === "closed")) loadChallenge(function () { renderChallenge(); schedulePoll(); });
      else schedulePoll();
    }, 5000);
  }

  // ---- the page -------------------------------------------------------------------------------------------------------
  function render() {
    renderTop();
    $("footer-status").textContent = S.records ? plural(S.records.length, "record") + " in the class record, read at " + fmtTime(S.readAt, false) + (S.error ? " · " + S.error : "") : "";
    renderClassBar();
    VIEWS.forEach(function (v) { $("view-" + v).hidden = v !== S.view; });
    Array.prototype.forEach.call($("views").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-view") === S.view); });
    if (S.view === "challenge") renderChallenge();
    else if (S.view === "overview") renderOverview(booksOf(S.cls));
    else if (S.view === "question") renderByQuestion(booksOf(S.cls));
    else if (S.view === "group") renderOneGroup(booksOf(S.cls));
    else renderSetup(S.cls);
  }
  function renderClassBar() {
    var el = $("class-bar"), books = booksOf(S.cls), nPins = 0;
    books.forEach(function (bk) { nPins += entriesOf(bk).length; });
    if (!S.classes.length) { el.innerHTML = '<div class="info" style="margin:0">No classes: put this term\'s class codes under "classes" in config.json and rebuild.</div>'; return; }
    el.innerHTML = '<div class="class-bar"><div><label for="class-pick">Class</label><select id="class-pick">' + selectOptions(S.classes, S.cls) + '</select></div>' +
      '<div class="summary">' + plural(books.length, "group") + " with lab books, " + plural(nPins, "pinned column") + (S.challenge ? "; challenge: " + esc(phaseLabel(S.challenge.phase)) + ", " + plural(S.challenge.flights.length, "flight") : "; no challenge set up") + '.</div>' +
      '<div class="projector"><a class="button primary" id="projector-open" target="_blank" rel="noopener" href="' + esc(projectorLink(S.cls)) + '">Open the projector page</a><div class="caption">The leaderboard while round 1 runs, the reveal afterwards; no group, nothing sent</div></div></div>';
    $("class-pick").onchange = function () { S.cls = this.value; S.group = ""; S.form = null; S.msg = ""; try { localStorage.setItem(CLASS_KEY, S.cls); } catch (e) {} loadChallenge(function () { render(); }); };
  }
  function phaseLabel(p) { for (var i = 0; i < PHASES.length; i++) if (PHASES[i][0] === p) return PHASES[i][1]; return p; }

  // ---- the challenge ------------------------------------------------------------------------------------------------
  // The form holds the demand (a, b) and last month's fare; the script stores last month's passengers q0 = a - b p0
  // and recovers a from them, exactly, since q0 is a whole number.
  function formValues() {
    var f = S.form; if (f) return f;
    var s = S.challenge ? S.challenge.settings : (S.defaults || PRESETS[0]);
    S.form = { label: s.label || "", mc: s.mc, seats: s.seats, a: s.a != null ? s.a : C.intercept(s), b: s.b, p0: s.p0, flights: s.flights };
    return S.form;
  }
  function derived(s) {
    var d = { a: C.intercept(s), b: s.b, mc: s.mc, seats: s.seats }, best = C.bestFare(d), sq = C.statusQuoProfit(s);
    var fill = Math.ceil((d.a - s.seats) / s.b);
    return { d: d, best: best, sq: sq, choke: C.chokePrice(d), fill: fill, fillProfit: C.profitAt(d, fill), up: C.bestFare({ a: d.a, b: d.b, mc: d.mc, seats: d.seats, scale: 1.4 }), dbl: C.bestFare({ a: d.a, b: d.b, mc: d.mc, seats: d.seats, scale: 2 }) };
  }
  // The demand line and the profit curve for a set of settings: what the students see at the reveal.
  function settingsCharts(s, v) {
    var d = v.d, curve = C.profitCurve(d);
    var demand = C.chart({ title: "The demand", h: 340, x: { max: Math.max(d.a, s.seats) * 1.05, label: "Passengers who want to fly" }, y: { max: v.choke * 1.05, label: "Fare (£)" },
                           lines: [{ pts: [[0, v.choke], [d.a, 0]], color: C.COLORS.red, width: 2.5, name: "Demand: Q = " + fmt(d.a) + " − " + s.b + " × fare" }],
                           hlines: [{ y: s.mc, label: "cost per passenger", color: C.COLORS.grey }], vlines: [{ x: s.seats, label: "capacity", color: C.COLORS.orange }],
                           markers: [{ x: s.q0, y: s.p0, color: C.COLORS.grey, hollow: true, name: "Last month", label: money(s.p0) + " / " + fmt(s.q0) },
                                     { x: v.best.passengers, y: v.best.fare, color: C.COLORS.green, name: "Best fare", label: money(v.best.fare) + " / " + fmt(v.best.passengers) }] });
    var profit = C.chart({ title: "Profit against the fare", h: 340, x: { max: v.choke, label: "Fare (£)" }, y: { min: Math.min(0, curve[0][1]), max: v.best.profit * 1.08, label: "Profit per flight (£)" },
                           lines: [{ pts: curve, color: C.COLORS.blue, width: 2.5, name: "Profit at each fare" }], hlines: [{ y: v.sq, label: "last month's profit", color: C.COLORS.grey }],
                           vlines: [{ x: v.fill, label: "plane full below " + money(v.fill), color: C.COLORS.orange }],
                           markers: [{ x: s.p0, y: v.sq, color: C.COLORS.grey, hollow: true, name: "Last month" }, { x: v.best.fare, y: v.best.profit, color: C.COLORS.green, name: "Best fare", label: money(v.best.fare) }] });
    return '<div>' + demand + '</div><div>' + profit + '</div>';
  }
  function renderChallenge() {
    var el = $("view-challenge"), ch = S.challenge, f = formValues(), flights = ch ? ch.flights : [], locked = flights.length > 0;
    var h = '<div class="qblock"><h3>Settings for class ' + esc(S.cls) + (ch ? ' <span class="phase ' + esc(ch.phase) + '">' + esc(phaseLabel(ch.phase)) + '</span>' : ' <span class="phase">not set up</span>') + '</h3>';
    h += '<div class="row" style="margin-bottom:6px"><label for="preset" style="margin:0">Preset</label><select id="preset"' + (locked ? " disabled" : "") + '><option value="">choose a route…</option>' + PRESETS.map(function (p, i) { return '<option value="' + i + '">' + esc(p.label) + ': demand Q = ' + p.a + ' − ' + p.b + ' P, cost ' + p.mc + ', capacity ' + p.seats + ', last month\'s fare ' + p.p0 + '</option>'; }).join("") + '</select></div>';
    h += '<p class="caption">The demand is hidden from the students; they are told the cost, the plane\'s capacity, last month\'s fare and the passengers it carried, which follow from the demand.</p>';
    h += '<form id="settings" class="cols" style="gap:10px 20px">' +
      ['label|Route (shown to students)|text', 'mc|Cost per passenger (£)|number', 'seats|Plane\'s capacity (seats)|number', 'flights|Flights in round 1|number',
       'a|Demand intercept a: passengers who want to fly at a fare of £0 (Q = a − b × fare)|number', 'b|Demand slope b: passengers lost per £1 on the fare|number', 'p0|Last month\'s fare (£), a point on that demand|number'].map(function (spec) {
        var parts = spec.split("|");
        return '<div><label for="f-' + parts[0] + '">' + esc(parts[1]) + '</label><input type="' + parts[2] + '" id="f-' + parts[0] + '" data-f="' + parts[0] + '" value="' + esc(f[parts[0]]) + '"' + (parts[2] === "number" ? ' step="any"' : "") + (locked ? " disabled" : "") + '></div>';
      }).join("") + '</form>';
    var q0 = +f.a - +f.b * +f.p0, s = { mc: +f.mc, seats: +f.seats, p0: +f.p0, q0: q0, b: +f.b, flights: +f.flights };
    var whole = Math.abs(q0 - Math.round(q0)) < 1e-9, ok = s.b > 0 && s.seats > 0 && +f.a > 0 && s.p0 > s.mc && q0 > 0 && q0 <= s.seats && whole;
    if (ok) {
      var v = derived(s);
      h += '<div class="note">Last month: ' + money(s.p0) + ' carried <b>' + fmt(q0) + ' passengers</b> (on the demand), a profit of ' + money(v.sq) + ' per flight; the students are told both. Hidden demand Q = ' + fmt(v.d.a) + ' − ' + s.b + ' P: nobody flies above ' + money(v.choke) + '. ' +
           '<b>Best fare ' + money(v.best.fare) + '</b>: ' + fmt(v.best.passengers) + ' passengers, profit ' + money(v.best.profit) + ', ' + money(v.best.profit - v.sq) + ' per flight over last month (' + money((v.best.profit - v.sq) * s.flights) + ' over ' + s.flights + ' flights). ' +
           'Filling the plane: fare ' + money(v.fill) + ', profit ' + money(v.fillProfit) + ' (' + money(v.fillProfit - v.sq) + '). ' +
           'Round 2: demand +40% → ' + money(v.up.fare) + ' with ' + fmt(v.up.passengers) + (v.up.capped ? " (full)" : "") + '; doubled → ' + money(v.dbl.fare) + ' with ' + fmt(v.dbl.passengers) + (v.dbl.capped ? " (full)" : "") + '.</div>' +
           '<div class="cols">' + settingsCharts(s, v) + '</div><p class="caption">The two charts the students see at the reveal, without the flights.</p>';
    } else h += '<div class="error">' + (!whole ? 'Last month\'s passengers, a − b × fare = ' + fmt(q0, 2) + ', must be a whole number: adjust the fare or the intercept.'
                                        : q0 > s.seats ? 'At last month\'s fare the demand (' + fmt(q0) + ') exceeds the seats; raise the fare or the seats.'
                                        : 'The intercept, the slope and the seats must be positive, the fare above the cost, and the demand at last month\'s fare positive.') + '</div>';
    h += '<div class="row">' + (locked ? '<span class="caption">Settings are locked while flights exist; reset the flights to change them.</span>' : '<button type="button" class="primary" id="save-settings"' + (ok ? "" : " disabled") + '>Save settings</button>') + '</div></div>';
    h += '<div class="qblock"><h3>Phase</h3><div class="row">' + PHASES.map(function (p) { return '<button type="button" data-phase="' + p[0] + '"' + (ch && ch.phase === p[0] ? ' class="primary"' : "") + (!ch ? " disabled" : "") + '>' + esc(p[1]) + '</button>'; }).join("") +
         '<button type="button" id="reset-flights"' + (!ch ? " disabled" : "") + ' style="margin-left:auto">Delete the flights and start over</button></div>' +
         '<p class="caption">Open round 1 when the groups have read the briefing; close it when time is up (unflown flights count as zero); Reveal sends the demand to every page; Round 2 unlocks the two scenarios. Settings are read when a flight is flown, so change them before opening.</p>' +
         (S.msg ? '<div class="' + (/Could not|refused|error/i.test(S.msg) ? "error" : "success") + '">' + esc(S.msg) + '</div>' : "") + '</div>';
    if (ch && flights.length) {
      var d = derived(ch.settings), byGroup = {};
      flights.forEach(function (fl) { var g = byGroup[fl.group] || (byGroup[fl.group] = { group: fl.group, n: 0, gain: 0, fares: [], flights: [] }); g.n++; g.gain += fl.gain; g.fares.push(fl.fare); g.flights.push(fl); });
      var board = Object.keys(byGroup).map(function (k) { return byGroup[k]; }).sort(function (x, y) { return y.gain - x.gain; });
      h += '<div class="qblock"><h3>Leaderboard: ' + plural(board.length, "group") + ', ' + plural(flights.length, "flight") + '</h3>' +
           '<div class="wide"><table class="grid board"><thead><tr><th class="rank">#</th><th>Group</th><th class="num">Flights</th><th class="num">Score</th><th>Fares</th><th class="num">Best fare flown</th></tr></thead><tbody>' +
           board.map(function (g, i) { var bf = g.flights.reduce(function (m, x) { return !m || x.profit > m.profit ? x : m; }, null); return '<tr><td class="rank">' + (i + 1) + '</td><td>' + esc(g.group) + '</td><td class="num">' + g.n + '</td><td class="num">' + money(g.gain, 0, true) + '</td><td class="num-note">' + g.fares.map(function (x) { return money(x); }).join(", ") + '</td><td class="num">' + money(bf.fare) + '</td></tr>'; }).join("") + '</tbody></table></div>';
      var curve = C.profitCurve(d.d), markers = [{ x: ch.settings.p0, y: d.sq, color: C.COLORS.grey, hollow: true, name: "Last month" }, { x: d.best.fare, y: d.best.profit, color: C.COLORS.green, name: "Best fare", label: money(d.best.fare) }];
      flights.forEach(function (fl) { markers.push({ x: fl.fare, y: fl.profit, color: C.COLORS.red, r: 4, name: "Flights", title: fl.group + " flight " + fl.n + ": " + money(fl.fare) }); });
      h += C.chart({ x: { max: d.choke, label: "Fare (£)" }, y: { min: Math.min(0, curve[0][1]), max: d.best.profit * 1.08, label: "Profit per flight (£)" }, lines: [{ pts: curve, color: C.COLORS.blue, width: 2.5, name: "Profit at each fare" }], hlines: [{ y: d.sq, label: "last month", color: C.COLORS.grey }], markers: markers }) +
           '<div class="row" style="margin-top:6px"><button type="button" id="csv-flights">Download the flights (CSV)</button></div></div>';
    }
    el.innerHTML = h;
    $("preset").onchange = function () { var p = PRESETS[+this.value]; if (!p) return; S.form = { label: p.label, mc: p.mc, seats: p.seats, a: p.a, b: p.b, p0: p.p0, flights: p.flights }; renderChallenge(); };
    Array.prototype.forEach.call(el.querySelectorAll("#settings input"), function (inp) { inp.addEventListener("change", function () { S.form[inp.getAttribute("data-f")] = inp.type === "number" ? inp.value : inp.value; renderChallenge(); }); });
    if ($("save-settings")) $("save-settings").onclick = function () {
      post({ token: S.cred, action: "challenge_set", "class": S.cls, settings: { label: f.label, mc: s.mc, seats: s.seats, p0: s.p0, q0: s.q0, b: s.b, flights: s.flights } })
        .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || "no answer"); S.challenge = j.challenge; S.form = null; S.msg = "Settings saved for " + S.cls + "."; render(); })
        .catch(function (err) { S.msg = "Could not save: " + String(err && err.message || err); renderChallenge(); });
    };
    Array.prototype.forEach.call(el.querySelectorAll("button[data-phase]"), function (b) {
      b.onclick = function () {
        var phase = b.getAttribute("data-phase");
        post({ token: S.cred, action: "challenge_phase", "class": S.cls, phase: phase })
          .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || "no answer"); S.challenge = j.challenge; S.msg = "Class " + S.cls + ": " + phaseLabel(phase) + "."; render(); schedulePoll(); })
          .catch(function (err) { S.msg = "Could not change the phase: " + String(err && err.message || err); renderChallenge(); });
      };
    });
    $("reset-flights").onclick = function () {
      if (!window.confirm("Delete every flight flown in class " + S.cls + " and put the challenge back to 'not open yet'? The groups' lab books are kept.")) return;
      post({ token: S.cred, action: "challenge_reset", "class": S.cls })
        .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || "no answer"); S.msg = plural(j.removed, "flight") + " deleted; the challenge is back to the start."; loadChallenge(function () { render(); }); })
        .catch(function (err) { S.msg = "Could not reset: " + String(err && err.message || err); renderChallenge(); });
    };
    if ($("csv-flights")) $("csv-flights").onclick = function () {
      download("flights_" + S.cls + ".csv", csv([["class", "time", "group", "flight", "fare", "passengers", "profit", "gain"]].concat(ch.flights.map(function (fl) { return [S.cls, fmtTime(fl.ts), fl.group, fl.n, fl.fare, fl.passengers, fl.profit, fl.gain]; }))));
    };
  }

  // ---- lab books ----------------------------------------------------------------------------------------------------
  function renderOverview(books) {
    var el = $("view-overview");
    if (!books.length) { el.innerHTML = '<div class="info">No group has pinned or written anything in this class yet.</div>'; return; }
    var graded = PQUESTIONS.filter(function (q) { return q.id !== "own"; });
    var h = '<div class="wide"><table class="grid sticky"><thead><tr><th>Group</th><th>Members</th>' + PQUESTIONS.map(function (q, i) { return '<th class="tick">' + (q.id === "own" ? "Own" : (i + 1)) + '</th>'; }).join("") + '<th class="num">Pins</th><th>Answered</th><th>Last saved</th><th>Debrief notes</th></tr></thead><tbody>';
    books.forEach(function (bk) {
      var entries = entriesOf(bk), counts = PQUESTIONS.map(function () { return 0; });
      entries.forEach(function (e) { counts[questionIndex(e.question)]++; });
      var answered = graded.filter(function (q) { return (bk.answers[q.id] || "").trim(); }).length, note = (bk.notes || "").trim().split(/\r?\n/)[0] || "";
      h += '<tr><td>' + esc(bk.group) + '</td><td>' + esc(bk.names) + '</td>' + counts.map(function (n) { return '<td class="tick">' + ticks(n) + '</td>'; }).join("") +
           '<td class="num">' + entries.length + '</td><td>' + (answered ? answered + "/" + graded.length : "") + '</td><td>' + esc(fmtTime(bk.last)) + '</td><td>' + esc(note.length > 90 ? note.slice(0, 90) + "…" : note) + '</td></tr>';
    });
    h += '</tbody></table></div><div class="row"><button type="button" id="csv-books">Download the lab books as CSV (one row per pinned column)</button><button type="button" id="csv-answers">Download the answers as CSV (one row per group)</button></div>';
    el.innerHTML = h;
    $("csv-books").onclick = function () {
      var keys = [], seen = {};
      books.forEach(function (bk) { entriesOf(bk).forEach(function (e) { Object.keys(e.measures).forEach(function (k) { if (!seen[k]) { seen[k] = true; keys.push(k); } }); }); });
      var rows = [["class", "time", "group", "members", "tab", "label", "question", "note"].concat(keys).concat(["state"])];
      books.forEach(function (bk) { entriesOf(bk).forEach(function (e) { rows.push([bk["class"], fmtTime(e.ts), bk.group, bk.names, e.tab, e.label, e.question, e.note].concat(keys.map(function (k) { return e.measures[k] == null ? "" : e.measures[k]; })).concat([JSON.stringify(e.state)])); }); });
      download("pricing_lab_books_" + S.cls + ".csv", csv(rows));
    };
    $("csv-answers").onclick = function () {
      var rows = [["class", "group", "members", "pins", "last saved"].concat(PQUESTIONS.map(function (q) { return q.title; })).concat(["debrief notes"])];
      books.forEach(function (bk) { rows.push([bk["class"], bk.group, bk.names, entriesOf(bk).length, fmtTime(bk.last)].concat(PQUESTIONS.map(function (q) { return bk.answers[q.id] || ""; })).concat([bk.notes || ""])); });
      download("pricing_answers_" + S.cls + ".csv", csv(rows));
    };
  }
  function renderByQuestion(books) {
    var el = $("view-question"), titles = PQUESTIONS.map(function (q) { return q.title; });
    if (titles.indexOf(S.q) < 0) S.q = titles[0];
    var qid = PQUESTIONS[titles.indexOf(S.q)].id, h = '<label for="q-pick">Question</label><select id="q-pick">' + selectOptions(titles, S.q) + '</select>';
    var pins = [];
    books.forEach(function (bk) { entriesOf(bk).forEach(function (e) { if (e.question === S.q) pins.push({ bk: bk, e: e }); }); });
    if (pins.length) h += C.bookTable(pins.map(function (p) { return { id: p.e.id, label: p.bk.group + ": " + p.e.label, measures: p.e.measures }; }), {}) + '<p class="caption">' + plural(pins.length, "pinned column") + '.</p>';
    else h += '<div class="info">No group has pinned anything under this question yet.</div>';
    var answered = books.filter(function (bk) { return (bk.answers[qid] || "").trim(); });
    if (answered.length) { h += '<div class="section-title">Answers</div>'; answered.forEach(function (bk) { h += '<div class="answer"><div class="who">' + esc(bk.group) + (bk.names ? " · " + esc(bk.names) : "") + '</div>' + esc(bk.answers[qid]) + '</div>'; }); }
    el.innerHTML = h;
    $("q-pick").onchange = function () { S.q = this.value; renderByQuestion(books); };
  }
  function renderOneGroup(books) {
    var el = $("view-group");
    if (!books.length) { el.innerHTML = '<div class="info">No group has pinned or written anything in this class yet.</div>'; return; }
    var names = books.map(function (bk) { return bk.group || "(no group number)"; });
    if (!S.group || names.indexOf(S.group) < 0) S.group = names[0];
    var bk = books[names.indexOf(S.group)], entries = entriesOf(bk);
    var h = '<label for="g-pick">Group</label><select id="g-pick">' + selectOptions(names, S.group) + '</select><p class="caption">' + (bk.names ? esc(bk.names) + " · " : "") + "Last saved " + fmtTime(bk.last) + " · " + plural(entries.length, "pinned column") + '</p>';
    var byQ = {}; entries.forEach(function (e) { var i = questionIndex(e.question); (byQ[i] = byQ[i] || []).push(e); });
    PQUESTIONS.forEach(function (q, i) {
      var mine = byQ[i] || [], answer = (bk.answers[q.id] || "").trim();
      if (!mine.length && !answer) return;
      h += '<div class="qblock"><h3>' + esc(q.title) + ' <span class="badge">' + mine.length + ' pinned</span></h3>' + (mine.length ? C.bookTable(mine, {}) : '<p class="caption">Nothing pinned under this question.</p>') +
           (answer ? '<div class="section-title">' + (q.id === "own" ? "What the group learned" : "Answer") + '</div><div class="answer">' + esc(answer) + '</div>' : '<p class="caption">No answer yet.</p>') + '</div>';
    });
    if (bk.notes) h += '<div class="section-title">Notes for the debrief</div><div class="answer">' + esc(bk.notes) + '</div>';
    el.innerHTML = h;
    $("g-pick").onchange = function () { S.group = this.value; renderOneGroup(books); };
  }
  function renderSetup(cls) {
    var el = $("view-setup");
    if (!cls) { el.innerHTML = ""; return; }
    var link = classLink(cls);
    el.innerHTML = '<div class="setup-grid"><div><p style="margin:4px 0 6px">Link for class <b>' + esc(cls) + '</b> (the Pricing Laboratory; the group number and PIN are the Marketplace Laboratory\'s):</p>' +
      '<div class="linkbox">' + esc(link) + '</div><div class="row" style="margin-top:8px"><button type="button" id="copy-link">Copy the link</button><span class="caption" id="copy-msg"></span></div>' +
      '<p class="caption">Projector: <span class="linkbox" style="display:inline">' + esc(projectorLink(cls)) + '</span></p></div>' +
      '<div>' + MLQR.svg(link, 200).replace("<svg ", '<svg class="qr" ') + '</div></div>';
    $("copy-link").onclick = function () {
      var done = function () { $("copy-msg").textContent = "Copied."; setTimeout(function () { $("copy-msg").textContent = ""; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { $("copy-msg").textContent = "Select the link and copy it."; });
      else $("copy-msg").textContent = "Select the link and copy it.";
    };
  }

  // ---- init -------------------------------------------------------------------------------------------------------------
  function init() {
    Array.prototype.forEach.call($("views").querySelectorAll("button"), function (b) { b.onclick = function () { S.view = b.getAttribute("data-view"); render(); }; });
    var cred = storedCred();
    if (!cred || !ENDPOINT) { renderSignin(); return; }
    S.cred = cred; $("signin").innerHTML = '<p class="caption">Reading the class record…</p>';
    loadRecords(function (err) {
      if (err) { S.cred = ""; if (/bad token|locked/.test(err)) clearCred(); renderSignin(/bad token/.test(err) ? "The saved password is no longer accepted; sign in again." : "Could not reach the class record (" + err + ")."); return; }
      start();
    });
  }
  document.addEventListener("DOMContentLoaded", init);
  window.PricingLabInstructor = { state: S, booksFromRecords: booksFromRecords, PRESETS: PRESETS };
})();
