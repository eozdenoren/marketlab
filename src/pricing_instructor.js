/* Pricing Laboratory instructor page: the challenge's controls and live leaderboard, read straight from the pricing
   script (backend/Pricing.gs), and the class's link and QR code. Sign in with the instructor password (or the admin
   token); the credential goes to the script with every request and stays in this browser. Depends on PricingCore
   (pricing_core.js) and MLQR (qr.js). There are no lab books here (removed 14 November 2026). */
(function () {
  "use strict";
  var C = PricingCore, esc = C.esc, fmt = C.fmt, money = C.money;
  var CONFIG = window.PRICINGLAB_CONFIG || {};
  var ENDPOINT = (CONFIG.endpoint || "").trim();
  var APP_URL = (CONFIG.app_url || "").replace(/\/+$/, "") || location.href.replace(/[?#].*$/, "").replace(/\/[^\/]*$/, "");
  var CLASSES = (CONFIG.classes || []).map(function (c) { return String(c).trim().toUpperCase(); }).filter(Boolean);
  var CRED_KEY = "pricinglab:instructor:cred", CLASS_KEY = "pricinglab:instructor:class";
  var VIEWS = ["challenge", "setup"];
  var PHASES = [["setup", "Not open yet"], ["open", "Open"], ["closed", "Closed"], ["revealed", "Demand revealed"]];
  // The instructor's steps, in order; each puts the class in the phase named.
  var STEPS = [["open", "1. Open the challenge"], ["closed", "2. Close the challenge"], ["revealed", "3. Reveal the demand"]];
  var NEEDS_VERSION = 5;      // the script version that takes seats; an older one would refuse the teams' flights
  // The routes and their hidden demands are not in this page (everyone can read its source): the script sends its
  // preset sets once the instructor has signed in. A class runs up to three routes at once; each group prices the
  // route its number gives it. This one route only stands in when the script sends no preset.
  var FALLBACK_ROUTE = { label: "London–Anchorage", mc: 80, seats: 500, a: 640, b: 0.5, p0: 480 };
  var S = { cred: "", classes: CLASSES.slice(), cls: "", view: "challenge", challenge: null, presets: [], groups: [], version: "", answered: false, openRoutes: {}, readAt: null, busy: false, error: "", msg: "", form: null };

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

  // ---- the class record ------------------------------------------------------------------------------------------
  function api(params) {
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(ENDPOINT + (ENDPOINT.indexOf("?") >= 0 ? "&" : "?") + qs).then(function (r) { return r.json(); });
  }
  function post(body) { return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
  // A script deployed before the routes sends one route's numbers beside `flights`: read that as one route.
  function withRoutes(ch) {
    if (ch && ch.settings && !ch.settings.routes) ch.settings = { flights: ch.settings.flights, routes: [ch.settings] };
    if (ch && !ch.flights) ch.flights = [];
    return ch;
  }
  // Reads the class's challenge. It is also the sign-in check: the script answers "bad token" or "locked" to a wrong
  // password, whatever the class (an empty class code is answered with no challenge).
  function loadChallenge(cb) {
    api({ token: S.cred, action: "challenge", "class": S.cls }).then(function (j) {
      if (j && j.ok) { S.challenge = withRoutes(j.challenge); S.presets = j.presets || []; S.groups = j.groups || []; S.version = j.version || ""; S.answered = true; S.readAt = Date.now() / 1000; }
      if (cb) cb(j && j.ok ? null : ((j && j.error) || "no answer"));
    }).catch(function (err) { if (cb) cb(String(err && err.message || err)); });
  }
  function pickClass() {
    try { var c = localStorage.getItem(CLASS_KEY); if (c != null && S.classes.indexOf(c) >= 0) S.cls = c; } catch (e) {}
    if (S.classes.indexOf(S.cls) < 0) S.cls = S.classes.length ? S.classes[0] : "";
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
      btn.disabled = true; btn.textContent = "Checking…"; S.cred = pw; pickClass();
      loadChallenge(function (err) {
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
    $("refresh").onclick = function () { S.busy = true; renderTop(); loadChallenge(function (err) { S.busy = false; S.error = err || ""; render(); }); };
    $("signout").onclick = function () { clearCred(); S.cred = ""; S.challenge = null; S.answered = false; clearTimeout(pollTimer); renderSignin(); };
  }
  function start() {
    $("signin").innerHTML = ""; $("main").hidden = false;
    render(); schedulePoll();
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
    $("footer-status").textContent = (S.readAt ? "Class record read at " + fmtTime(S.readAt, false) : "") + (S.error ? " · " + S.error : "") +
      (S.answered ? " · script version " + (S.version || "unknown (an old deployment)") : "");
    renderClassBar();
    VIEWS.forEach(function (v) { $("view-" + v).hidden = v !== S.view; });
    Array.prototype.forEach.call($("views").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-view") === S.view); });
    if (S.view === "challenge") renderChallenge();
    else renderSetup(S.cls);
  }
  function renderClassBar() {
    var el = $("class-bar");
    if (!S.classes.length) { el.innerHTML = '<div class="info" style="margin:0">No classes: put this term\'s class codes under "classes" in config.json and rebuild.</div>'; return; }
    el.innerHTML = '<div class="class-bar"><div><label for="class-pick">Class</label><select id="class-pick">' + selectOptions(S.classes, S.cls) + '</select></div>' +
      '<div class="summary">' + plural(S.groups.length, "registered group") + (S.challenge ? "; challenge: " + esc(phaseLabel(S.challenge.phase)) + ", " + plural(S.challenge.flights.length, "flight") : "; no challenge set up") + '.</div>' +
      '<div class="projector"><a class="button primary" id="projector-open" target="_blank" rel="noopener" href="' + esc(projectorLink(S.cls)) + '">Open the projector page</a><div class="caption">The leaderboards during the challenge, the reveal afterwards</div></div></div>';
    $("class-pick").onchange = function () { S.cls = this.value; S.form = null; S.msg = ""; try { localStorage.setItem(CLASS_KEY, S.cls); } catch (e) {} loadChallenge(function () { render(); }); };
  }
  function phaseLabel(p) { for (var i = 0; i < PHASES.length; i++) if (PHASES[i][0] === p) return PHASES[i][1]; return p === "round2" ? "Demand revealed" : p; }   // "round2": a phase older pages could set

  // ---- the challenge ------------------------------------------------------------------------------------------------
  // The form holds, per route, the demand (a, b) and the trial fare; the script stores the trial fare's passengers
  // q0 = a - b p0 and recovers a from them, exactly, since q0 is a whole number. `n` routes of the list are used.
  function routeForm(r) { return { label: r.label || "", mc: r.mc, seats: r.seats, a: r.a != null ? r.a : C.intercept(r), b: r.b, p0: r.p0 }; }
  // The preset suggested for a class: the sets in turn down the class list, so no two streams share a set.
  function suggestedPreset(cls) { var i = S.classes.indexOf(cls); return S.presets.length ? (i < 0 ? 0 : i) % S.presets.length : -1; }
  function formFromPreset(k) { var p = S.presets[k]; return { flights: 6, routes: p.routes.map(routeForm), n: p.routes.length, preset: String(k) }; }
  function formValues() {
    if (S.form) return S.form;
    var ch = S.challenge, k = suggestedPreset(S.cls);
    if (ch) S.form = { flights: ch.settings.flights, routes: ch.settings.routes.map(routeForm), n: ch.settings.routes.length, preset: "" };
    else S.form = k >= 0 ? formFromPreset(k) : { flights: 6, routes: [routeForm(FALLBACK_ROUTE)], n: 1, preset: "" };
    return S.form;
  }
  function derived(s) {
    var d = { a: C.intercept(s), b: s.b, mc: s.mc, seats: s.seats };
    return { d: d, best: C.bestSeats(d), sq: C.statusQuoProfit(s), choke: C.chokePrice(d), full: C.fullPlane(d) };
  }
  // One route of the form, checked: {ok, s (what the script stores), error}.
  function routeCheck(f) {
    var q0 = +f.a - +f.b * +f.p0, s = { label: String(f.label || ""), mc: +f.mc, seats: +f.seats, p0: +f.p0, q0: Math.round(q0), b: +f.b };
    var whole = Math.abs(q0 - Math.round(q0)) < 1e-9, ok = s.b > 0 && s.seats > 0 && +f.a > 0 && s.p0 > s.mc && q0 > 0 && q0 <= s.seats && whole;
    return { ok: ok, s: s, error: ok ? "" : (!whole ? 'The seats sold on a trial flight, a − b × fare = ' + fmt(q0, 2) + ', must be a whole number: adjust the fare or the intercept.'
                                           : q0 > s.seats ? 'At the trial flights\' fare the demand (' + fmt(q0) + ') exceeds the seats on the plane; raise the fare or the seats.'
                                           : 'The intercept, the slope and the seats must be positive, the trial flights\' fare above the cost, and the demand at that fare positive.') };
  }
  // The demand line and the profit curve of a route: what the students see at the reveal.
  function settingsCharts(s, v) {
    return C.demandChartHtml(s, v.d, 300) + C.profitChartHtml(v.d, { seats: s.q0, profit: v.sq }, [], { h: 300 });
  }
  function groupNumber(g) { var m = /(\d+)\s*$/.exec(String(g)); return m ? Number(m[1]) : 1; }
  function routeOf(group, n) { return ((groupNumber(group) - 1) % n + n) % n; }   // the script's rule (routeIndex)
  // The groups registered for the class that price route i when the class runs n routes.
  function teamsOf(i, n) {
    return S.groups.filter(function (g) { return routeOf(g, n) === i; }).sort(function (x, y) { return groupNumber(x) - groupNumber(y); });
  }
  // A route of the settings: its teams and what follows from its numbers, always in view; the numbers themselves
  // and the charts are folded away (open when the route has an error, or once the instructor has opened them).
  function routeCard(f, i, n, locked) {
    var chk = routeCheck(f), teams = teamsOf(i, n);
    var h = '<div class="route-card"><h3>' + (n > 1 ? 'Route ' + (i + 1) + ': ' : '') + esc(f.label || "(no name)") + '</h3>' +
      '<p class="caption" style="margin:0 0 4px">' + (n > 1 ? (teams.length ? plural(teams.length, "registered team") + ': ' + esc(teams.map(function (g) { return String(g).replace(/^Group\s*/, ""); }).join(", ")) + '.' : 'No registered group has a number for this route yet.')
                                                         : 'Every group flies this route.') + '</p>';
    var fields = ['label|Route (shown to students, as London–Place)|text', 'mc|Cost per passenger (£)|number', 'seats|Seats on the plane|number',
          'a|Demand intercept a: seats sold at a fare of £0 (Q = a − b × fare)|number', 'b|Demand slope b: seats lost per £1 on the fare|number', 'p0|The fare on the trial flights (£), a point on that demand|number'].map(function (spec) {
      var parts = spec.split("|"), id = 'f-' + parts[0] + '-' + i;
      return '<label for="' + id + '">' + esc(parts[1]) + '</label><input type="' + parts[2] + '" id="' + id + '" data-f="' + parts[0] + '" data-r="' + i + '" value="' + esc(f[parts[0]]) + '"' + (parts[2] === "number" ? ' step="any"' : "") + (locked ? " disabled" : "") + '>';
    }).join("");
    var charts = "";
    if (chk.ok) {
      var s = chk.s, v = derived(s), fl = +S.form.flights || 6;
      h += '<div class="note"><b>Told:</b> ' + fmt(s.seats) + ' seats, ' + money(s.mc) + ' a passenger; trial flights ' + fmt(s.q0) + ' seats at ' + money(s.p0) + ' (' + fmt(s.seats - s.q0) + ' empty), ' + money(v.sq) + ' a flight.<br>' +
           '<b>Hidden:</b> fare = ' + C.inverseText(v.d) + ' (Q = ' + fmt(v.d.a) + ' − ' + s.b + ' × fare).<br>' +
           '<b>Best: ' + fmt(v.best.seats) + ' seats at ' + C.fareText(v.best.fare) + '</b>, ' + money(v.best.profit) + ' a flight, ' + money(v.best.profit - v.sq, 0, true) + ' on a trial flight (' + money((v.best.profit - v.sq) * fl, 0, true) + ' over ' + fl + ' flights).<br>' +
           '<b>Full plane:</b> ' + C.fareText(v.full.fare) + ', ' + money(v.full.profit) + ' a flight (' + money(v.full.profit - v.sq, 0, true) + ').</div>';
      charts = settingsCharts(s, v);
    } else h += '<div class="error">' + chk.error + '</div>';
    return h + '<details class="how" data-route="' + i + '"' + (!chk.ok || S.openRoutes[i] ? " open" : "") + '><summary>The numbers and the charts</summary>' + fields + charts + '</details></div>';
  }
  // Each group's flights summed, best first.
  function boardOf(flights) {
    var by = {};
    flights.forEach(function (fl) { var g = by[fl.group] || (by[fl.group] = { group: fl.group, n: 0, gain: 0, fares: [], flights: [] }); g.n++; g.gain += fl.gain; g.fares.push(fl.fare); g.flights.push(fl); });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (x, y) { return y.gain - x.gain || groupNumber(x.group) - groupNumber(y.group); });
  }
  function leaderboards(ch) {
    var routes = ch.settings.routes, n = routes.length, flights = ch.flights, all = [];
    var h = '<div class="qblock"><h3>Leaderboard' + (n > 1 ? 's' : '') + ': ' + plural(boardOf(flights).length, "group") + ', ' + plural(flights.length, "flight") + '</h3><div class="routes-grid">';
    routes.forEach(function (r, i) {
      var mine = flights.filter(function (fl) { return (fl.route != null ? fl.route : routeOf(fl.group, n)) === i; }), board = boardOf(mine), d = derived(r);
      var possible = (d.best.profit - d.sq) * ch.settings.flights;
      board.forEach(function (g) { all.push({ group: g.group, label: r.label, n: g.n, gain: g.gain, possible: possible, share: possible > 0 ? g.gain / possible : 0 }); });
      h += '<div class="route-card"><h3>' + esc(r.label) + ' <span class="badge">' + plural(board.length, "team") + ', ' + plural(mine.length, "flight") + '</span></h3>';
      if (!mine.length) { h += '<p class="caption">No flights on this route yet.</p></div>'; return; }
      h += '<div class="wide"><table class="grid board"><thead><tr><th class="rank">#</th><th>Group</th><th class="num">Flights</th><th class="num">Score</th><th>Seats sold, flight by flight</th><th class="num">Best flown</th></tr></thead><tbody>' +
           board.map(function (g, k) { var bf = g.flights.reduce(function (m, x) { return !m || x.profit > m.profit ? x : m; }, null); return '<tr><td class="rank">' + (k + 1) + '</td><td>' + esc(g.group) + '</td><td class="num">' + g.n + '</td><td class="num">' + money(g.gain, 0, true) + '</td><td class="num-note">' + g.flights.map(function (x) { return fmt(x.passengers); }).join(", ") + '</td><td class="num">' + fmt(bf.passengers) + ' at ' + C.fareText(bf.fare) + '</td></tr>'; }).join("") + '</tbody></table></div>' +
           C.profitChartHtml(d.d, { seats: r.q0, profit: d.sq }, mine.map(function (fl) { return { seats: fl.passengers, profit: fl.profit, name: "Flights", title: fl.group + " flight " + fl.n + ": " + fmt(fl.passengers) + " seats at " + C.fareText(fl.fare) }; }), { r: 4, h: 300 }) + '</div>';
    });
    h += '</div>';
    if (n > 1 && all.length) {
      all.sort(function (x, y) { return y.share - x.share || groupNumber(x.group) - groupNumber(y.group); });
      h += '<h3 style="margin-top:10px">Every team: share of the gain its route allowed</h3><div class="wide"><table class="grid board overall"><thead><tr><th class="rank">#</th><th>Group</th><th>Route</th><th class="num">Flights</th><th class="num">Score</th><th class="num">Best possible</th><th class="num">Share</th></tr></thead><tbody>' +
           all.map(function (r, k) { return '<tr><td class="rank">' + (k + 1) + '</td><td>' + esc(r.group) + '</td><td>' + esc(r.label) + '</td><td class="num">' + r.n + '</td><td class="num">' + money(r.gain, 0, true) + '</td><td class="num">' + money(r.possible) + '</td><td class="num">' + fmt(100 * r.share) + '%</td></tr>'; }).join("") + '</tbody></table></div>';
    }
    return h + '<div class="row" style="margin-top:6px"><button type="button" id="csv-flights">Download the flights (CSV)</button></div></div>';
  }
  function renderChallenge() {
    var el = $("view-challenge"), ch = S.challenge, f = formValues(), flights = ch ? ch.flights : [], locked = flights.length > 0;
    var n = Math.max(1, Math.min(f.routes.length, +f.n || 1)), used = f.routes.slice(0, n), checks = used.map(routeCheck), sug = suggestedPreset(S.cls);
    var oldScript = S.answered && !(parseInt(S.version, 10) >= NEEDS_VERSION);
    var flOk = +f.flights >= 1 && +f.flights <= 12, ok = flOk && !oldScript && checks.every(function (c) { return c.ok; });
    var h = (oldScript ? '<div class="error" id="old-script"><b>The script that answered is an old deployment</b> (' + (S.version ? 'version ' + esc(S.version) : 'it sent no version number') + '): this page needs version ' + NEEDS_VERSION + ' or later, in which the teams choose the seats to sell. ' +
                         'In the Apps Script editor, check that the first line of the code says VERSION ' + NEEDS_VERSION + ' or later, then Deploy → Manage deployments → the pencil → Version: New version → Deploy. ' +
                         'If the version at the bottom of this page does not change after that, the deployment you updated is not the one this page uses: its address is <span class="linkbox" style="display:inline">' + esc(ENDPOINT) + '</span>. Settings cannot be saved until this is fixed.</div>' : '') +
            '<div class="qblock"><h3>Settings for class ' + esc(S.cls) + (ch ? ' <span class="phase ' + esc(ch.phase) + '">' + esc(phaseLabel(ch.phase)) + '</span>' : ' <span class="phase">not set up</span>') + '</h3>';
    h += '<div class="row" style="margin-bottom:6px;align-items:end">' +
         '<div><label for="preset">Preset</label><select id="preset"' + (locked || !S.presets.length ? " disabled" : "") + '><option value="">' + (S.presets.length ? "choose a set of routes…" : "the script sent no presets") + '</option>' +
         S.presets.map(function (p, i) { return '<option value="' + i + '"' + (f.preset === String(i) ? " selected" : "") + '>' + esc(p.name || ("Set " + (i + 1))) + ': ' + esc(p.routes.map(function (r) { return r.label; }).join(", ")) + (i === sug ? " (suggested for this class)" : "") + '</option>'; }).join("") + '</select></div>' +
         '<div><label for="f-n">Routes run at once</label><select id="f-n"' + (locked ? " disabled" : "") + '>' + f.routes.map(function (r, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === n ? " selected" : "") + '>' + (i + 1) + '</option>'; }).join("") + '</select></div>' +
         '<div><label for="f-flights">Flights per team</label><input type="number" id="f-flights" min="1" max="12" step="1" style="width:110px" value="' + esc(f.flights) + '"' + (locked ? " disabled" : "") + '></div></div>';
    h += '<p class="caption">' + (n > 1 ? n + ' contests at once: a group\'s route follows its number (Group 1 the first route, Group 2 the second, and so on), and it competes only with the groups on that route. '
                                        : 'One contest: every group flies the same route. ') +
         'The students are told the plane\'s seats, the cost per passenger and the trial flights (seats sold and fare): one point on the demand, nothing about its slope. Use a different set for each stream.</p>';
    h += '<div class="routes-grid" id="settings">' + used.map(function (r, i) { return routeCard(r, i, n, locked); }).join("") + '</div>';
    if (!flOk) h += '<div class="error">The flights per team must be between 1 and 12.</div>';
    h += '<div class="row">' + (locked ? '<span class="caption">Settings are locked while flights exist; reset the flights to change them.</span>' : '<button type="button" class="primary" id="save-settings"' + (ok ? "" : " disabled") + '>Save settings</button>') + '</div></div>';
    var cur = ch ? ch.phase : "", order = PHASES.map(function (p) { return p[0]; }), next = order[order.indexOf(cur) + 1];
    h += '<div class="qblock"><h3>Run the challenge' + (ch ? ' <span class="phase ' + esc(ch.phase) + '">Now: ' + esc(phaseLabel(ch.phase)) + '</span>' : '') + '</h3><div class="row">' +
         STEPS.map(function (p) { return '<button type="button" data-phase="' + p[0] + '"' + (ch && next === p[0] ? ' class="primary"' : "") + (!ch ? " disabled" : "") + '>' + esc(p[1]) + '</button>'; }).join("") +
         '<span style="margin-left:auto" class="row"><button type="button" class="small" data-phase="setup"' + (!ch ? " disabled" : "") + '>Back to not open</button>' +
         '<button type="button" id="reset-flights"' + (!ch ? " disabled" : "") + '>Delete the flights and start over</button></span></div>' +
         '<p class="caption">' + (!ch ? 'Save the settings first. ' : '') + 'Open the challenge when the groups have read their brief (each group then flies at its own pace); close it when time is up (flights not flown score nothing); reveal the demand, which sends it to every page and to the projector. The button for the next step is highlighted.</p>' +
         (S.msg ? '<div class="' + (/Could not|refused|error/i.test(S.msg) ? "error" : "success") + '">' + esc(S.msg) + '</div>' : "") + '</div>';
    if (ch && flights.length) h += leaderboards(ch);
    el.innerHTML = h;
    $("preset").onchange = function () { if (this.value === "" || !S.presets[+this.value]) return; var keep = S.form.flights; S.form = formFromPreset(+this.value); S.form.flights = keep; renderChallenge(); };
    $("f-n").onchange = function () { S.form.n = +this.value; renderChallenge(); };
    $("f-flights").addEventListener("change", function () { S.form.flights = this.value; renderChallenge(); });
    Array.prototype.forEach.call(el.querySelectorAll("details[data-route]"), function (dt) { dt.querySelector("summary").addEventListener("click", function () { S.openRoutes[dt.getAttribute("data-route")] = !dt.open; }); });
    Array.prototype.forEach.call(el.querySelectorAll("#settings input"), function (inp) { inp.addEventListener("change", function () { S.form.routes[+inp.getAttribute("data-r")][inp.getAttribute("data-f")] = inp.value; S.form.preset = ""; renderChallenge(); }); });
    if ($("save-settings")) $("save-settings").onclick = function () {
      post({ token: S.cred, action: "challenge_set", "class": S.cls, settings: { flights: +f.flights, routes: checks.map(function (c) { return c.s; }) } })
        .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || "no answer"); S.challenge = withRoutes(j.challenge); S.form = null; S.msg = "Settings saved for " + S.cls + "."; render(); })
        .catch(function (err) { S.msg = "Could not save: " + String(err && err.message || err); renderChallenge(); });
    };
    Array.prototype.forEach.call(el.querySelectorAll("button[data-phase]"), function (b) {
      b.onclick = function () {
        var phase = b.getAttribute("data-phase");
        post({ token: S.cred, action: "challenge_phase", "class": S.cls, phase: phase })
          .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || "no answer"); S.challenge = withRoutes(j.challenge); S.msg = "Class " + S.cls + ": " + phaseLabel(phase) + "."; render(); schedulePoll(); })
          .catch(function (err) { S.msg = "Could not change the phase: " + String(err && err.message || err); renderChallenge(); });
      };
    });
    $("reset-flights").onclick = function () {
      if (!window.confirm("Delete every flight flown in class " + S.cls + " and put the challenge back to 'not open yet'?")) return;
      post({ token: S.cred, action: "challenge_reset", "class": S.cls })
        .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || "no answer"); S.msg = plural(j.removed, "flight") + " deleted; the challenge is back to the start."; loadChallenge(function () { render(); }); })
        .catch(function (err) { S.msg = "Could not reset: " + String(err && err.message || err); renderChallenge(); });
    };
    if ($("csv-flights")) $("csv-flights").onclick = function () {
      var routes = ch.settings.routes;
      download("flights_" + S.cls + ".csv", csv([["class", "time", "group", "route", "flight", "seats sold", "fare", "profit", "against a trial flight"]].concat(ch.flights.map(function (fl) { var r = routes[fl.route != null ? fl.route : routeOf(fl.group, routes.length)]; return [S.cls, fmtTime(fl.ts), fl.group, r ? r.label : "", fl.n, fl.passengers, fl.fare, fl.profit, fl.gain]; }))));
    };
  }

  // ---- links and QR ----------------------------------------------------------------------------------------------
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
    S.cred = cred; pickClass(); $("signin").innerHTML = '<p class="caption">Reading the class record…</p>';
    loadChallenge(function (err) {
      if (err) { S.cred = ""; if (/bad token|locked/.test(err)) clearCred(); renderSignin(/bad token/.test(err) ? "The saved password is no longer accepted; sign in again." : "Could not reach the class record (" + err + ")."); return; }
      start();
    });
  }
  document.addEventListener("DOMContentLoaded", init);
  window.PricingLabInstructor = { state: S, render: function () { render(); } };
})();
