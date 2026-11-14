/* Pricing Laboratory page: the group panel (the same sign-in as the Marketplace Laboratory, against the pricing
   script) and the Challenge and Mocha tabs. Depends on PricingCore (pricing_core.js) and the bids in mocha_data.js.
   ?projector=1 is projector mode: no group, the leaderboard and the reveal for every group.
   There is no lab book here (removed 14 November 2026): the only things a group sends to the class record are its
   registration and its flights. What a student tries on the Mocha tab stays in the browser. */
(function () {
  "use strict";
  var C = PricingCore, esc = C.esc, fmt = C.fmt, money = C.money;
  var CONFIG = window.PRICINGLAB_CONFIG || {};
  var ENDPOINT = (CONFIG.endpoint || "").trim(), TOKEN = CONFIG.token || "";
  var DATA = window.MOCHA_DATA || { streams: [], last: { label: "", bids: [] }, cost: 15, year: "" };
  var CLASSES = (CONFIG.classes || []).map(function (c) { return String(c).trim().toUpperCase(); }).filter(Boolean);
  function normalizeClass(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!CLASSES.length) return s;
    var up = s.toUpperCase().replace(/\s+/g, "");
    for (var i = 0; i < CLASSES.length; i++) if (up.indexOf(CLASSES[i]) === 0) return CLASSES[i];
    return null;
  }
  function classLink(code) { return location.origin + location.pathname + "?class=" + encodeURIComponent(code); }
  var PHASE_LABEL = { setup: "Not open yet", open: "Open", closed: "Closed", revealed: "Demand revealed", round2: "Demand revealed" };   // "round2" is a phase older pages could set: it now reads as revealed

  // ---- utilities -----------------------------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
  function pct(x) { return x == null || isNaN(x) ? "–" : (x >= 0 ? "+" : "-") + Math.round(1000 * Math.abs(x)) / 10 + "%"; }
  function metric(label, value, opts) {
    opts = opts || {};
    var v = typeof value === "number" ? (opts.money ? money(value, opts.decimals) : fmt(value, opts.decimals)) : esc(value);
    return '<div class="metric"><div class="label">' + esc(label) + '</div><div class="value">' + v + '</div>' + (opts.sub ? '<div class="caption">' + esc(opts.sub) + '</div>' : "") + '</div>';
  }

  // ---- state ----------------------------------------------------------------------------------------------------
  var S = { classCode: "", rawClass: "", classInvalid: false, projector: false, group: null, editingGroup: false,
            tab: "challenge", challenge: null, challengeJson: "", flying: false, flyError: "", howOpen: null,
            mocha: { dataset: "", cost: DATA.cost || 15, price: "", dropZero: false, above: "", showLine: false, inner: "pricing", fourth: false } };
  function groupKey() { return S.group ? "Group " + S.group.number : (S.projector ? "Projector" : "_"); }
  function groupPin() { return S.group && S.group.pin ? String(S.group.pin) : ""; }
  function groupNames() { return S.group && S.group.names ? S.group.names : ""; }
  function storeKey() { return "pricinglab:" + S.classCode + ":" + groupKey(); }
  function saveLocal() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({ group: S.group, tab: S.tab, mocha: S.mocha }));
      if (!S.projector) localStorage.setItem("pricinglab:" + S.classCode + ":last", S.group ? JSON.stringify(S.group) : "");
    } catch (e) {}
  }
  function loadStored(key) { try { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function mergeStored(d) {
    if (!d) return;
    if (d.tab) S.tab = d.tab;
    if (d.mocha && typeof d.mocha === "object") Object.keys(d.mocha).forEach(function (k) { S.mocha[k] = d.mocha[k]; });
  }

  // ---- class record: the sign-in ------------------------------------------------------------------------------
  function apiUrl(params) {
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return ENDPOINT + (ENDPOINT.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(TOKEN) + "&" + qs;
  }
  function groupParams(group) { return { "class": S.classCode, group: "Group " + group.number, pin: group.pin || "" }; }
  function checkPin(group, cb) {      // cb(status, answer): "ok" | "new" | "bad" | "unknown"
    if (!ENDPOINT) { cb("unknown", null); return; }
    var p = groupParams(group); p.action = "check";
    fetch(apiUrl(p)).then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok && j.status === "new") cb("new", j);
        else if (j && j.ok) cb("ok", j);
        else if (j && /pin/.test(j.error || "")) cb("bad", j);
        else cb("unknown", null);
      })
      .catch(function () { cb("unknown", null); });
  }
  function registerGroup(group, cb) {
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                      body: JSON.stringify({ token: TOKEN, action: "register", "class": S.classCode, group: "Group " + group.number, pin: group.pin, names: group.names || "" }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb(j && j.ok ? "registered" : (j && j.error === "taken" ? "taken" : "error")); })
      .catch(function () { cb("error"); });
  }
  function renderStatus() {
    var parts = [];
    if (S.classCode) parts.push("Class " + esc(S.classCode));
    if (S.group) parts.push(esc(groupKey()));
    if (S.projector) parts.push("Projector");
    else if (!ENDPOINT) parts.push("Offline copy: the challenge needs the class record");
    $("footer-status").innerHTML = parts.join(" · ");
  }

  // ---- group panel ---------------------------------------------------------------------------------------------
  function renderGroup() {
    var el = $("group-panel");
    if (S.projector) {
      el.innerHTML = '<div class="group-line"><div><b>Projector</b>' + (S.classCode ? " · Class " + esc(S.classCode) : "") + ' · the leaderboard and the reveal for every group</div></div>';
      return;
    }
    if (S.classInvalid) {
      var shown = CLASSES.filter(function (c) { return !/TEST/.test(c); });
      el.innerHTML = '<div class="error" style="margin:0 0 8px 0"><b>' + (S.rawClass ? 'This address has the class code “' + esc(S.rawClass) + '”, which is not one of this term’s classes.' : 'This address has no class code.') + '</b> ' +
        'Your group cannot sign in here. Open the Pricing Laboratory with the link for your class:</div>' +
        '<div class="row" style="flex-wrap:wrap;gap:8px">' + shown.map(function (c) { return '<a class="button" href="' + esc(classLink(c)) + '">' + esc(c) + '</a>'; }).join("") + '</div>';
      return;
    }
    if (S.group && !S.editingGroup) {
      el.innerHTML = '<div class="group-line"><div><b>Your group:</b> ' + esc(groupKey()) + (groupNames() ? " · " + esc(groupNames()) : "") + (S.classCode ? " · Class " + esc(S.classCode) : "") + '</div><button type="button" id="group-change">Change</button></div>';
      $("group-change").onclick = function () { S.editingGroup = true; renderGroup(); };
      return;
    }
    var needPin = !!ENDPOINT;
    el.innerHTML = '<form id="group-form" class="group-form' + (needPin ? " with-pin" : "") + '">' +
      '<div><label for="group-number">Group number</label><input type="number" id="group-number" min="1" max="999" step="1" placeholder="12" value="' + (S.group ? S.group.number : "") + '"></div>' +
      (needPin ? '<div><label for="group-pin">PIN</label><input type="text" id="group-pin" inputmode="numeric" maxlength="4" placeholder="4 digits" autocomplete="off" value="' + esc(groupPin()) + '"></div>' : "") +
      '<div><label for="group-names">Names of the group members (optional)</label><input type="text" id="group-names" placeholder="Ana Lopes, Bo Chen, Chidi Okafor" value="' + esc(groupNames()) + '"></div>' +
      '<div><button type="submit" class="primary" id="group-save" style="width:100%">Save</button></div></form>' +
      '<div class="caption" style="margin-top:6px">' + (S.classCode ? "Class " + esc(S.classCode) + ". " : "") + (needPin ? "The same group number and PIN as in the Marketplace Laboratory." : "") + '</div>' +
      '<div id="group-error" class="error" hidden></div>';
    $("group-form").onsubmit = function (ev) {
      ev.preventDefault();
      var n = parseInt($("group-number").value, 10), pin = needPin ? ($("group-pin").value || "").trim() : "", errEl = $("group-error");
      if (!(n > 0)) { errEl.textContent = "Please enter your group number."; errEl.hidden = false; return; }
      if (needPin && !/^\d{4}$/.test(pin)) { errEl.textContent = "Please enter the four-digit PIN of your group."; errEl.hidden = false; return; }
      var names = $("group-names").value.split(/[,;\n]|\band\b|&/).map(function (s) { return s.trim(); }).filter(Boolean).join(", ");
      var candidate = { number: n, names: names, pin: pin }, prev = S.group;
      var finish = function (j) {
        if (!candidate.names && j && j.names) candidate.names = j.names;
        S.group = candidate; S.editingGroup = false;
        if (!prev || prev.number !== n) mergeStored(loadStored(storeKey()));
        if (j && j.challenge) setChallenge(j.challenge);
        saveLocal(); renderGroup(); renderChallenge(); renderMocha(); renderStatus();
        loadChallenge(true);
      };
      if (!needPin) { finish(null); return; }
      $("group-save").disabled = true; $("group-save").textContent = "Checking…";
      checkPin(candidate, function (status, j) {
        if (status === "bad") {
          $("group-save").disabled = false; $("group-save").textContent = "Save";
          errEl.textContent = "Group " + n + " is registered in this class with a different PIN. Check your PIN, or ask the instructor to reset the group."; errEl.hidden = false; return;
        }
        if (status === "new") { renderRegister(candidate, finish); return; }
        finish(j);
      });
    };
  }
  function renderRegister(candidate, finish) {
    var el = $("group-panel");
    el.innerHTML = '<div class="info"><b>Group ' + candidate.number + '</b> is not registered in class ' + esc(S.classCode) + ' yet (neither here nor in the Marketplace Laboratory). ' +
      'If that is your group number, choose a four-digit PIN for your group and confirm it. If the number is wrong, go back.</div>' +
      '<form id="register-form" class="group-form with-pin">' +
      '<div><label>Group number</label><div style="font-size:1.6rem;font-weight:600;padding:2px 0">' + candidate.number + '</div></div>' +
      '<div><label for="reg-pin">PIN</label><input type="text" id="reg-pin" inputmode="numeric" maxlength="4" autocomplete="off" value="' + esc(candidate.pin) + '"></div>' +
      '<div><label for="reg-pin2">Confirm PIN</label><input type="text" id="reg-pin2" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="same 4 digits"></div>' +
      '<div><button type="submit" class="primary" id="reg-save" style="width:100%">Register Group ' + candidate.number + '</button></div></form>' +
      '<div class="row" style="margin-top:6px"><button type="button" id="reg-back" class="small">Back</button></div><div id="reg-error" class="error" hidden></div>';
    $("reg-back").onclick = function () { renderGroup(); };
    $("register-form").onsubmit = function (ev) {
      ev.preventDefault();
      var p1 = ($("reg-pin").value || "").trim(), p2 = ($("reg-pin2").value || "").trim(), errEl = $("reg-error");
      if (!/^\d{4}$/.test(p1)) { errEl.textContent = "The PIN must be four digits."; errEl.hidden = false; return; }
      if (p1 !== p2) { errEl.textContent = "The two PINs differ; type the same four digits twice."; errEl.hidden = false; return; }
      candidate.pin = p1;
      $("reg-save").disabled = true; $("reg-save").textContent = "Registering…";
      registerGroup(candidate, function (status) {
        if (status === "registered") { finish(null); return; }
        $("reg-save").disabled = false; $("reg-save").textContent = "Register Group " + candidate.number;
        errEl.textContent = status === "taken" ? "Someone has just registered this group number. If it is yours, ask the instructor to reset it." : "Could not reach the class record. Check the wifi and try again.";
        errEl.hidden = false;
      });
    };
  }

  // ---- tabs ------------------------------------------------------------------------------------------------------
  var TABS = ["challenge", "mocha"];
  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = "challenge";      // an address or a browser that remembers the old Lab book tab
    S.tab = name;
    TABS.forEach(function (t) { $("tab-" + t).hidden = t !== name; });
    Array.prototype.forEach.call($("main-tabs").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
    if (name === "challenge") loadChallenge(false);
    saveLocal(); schedulePoll();
  }

  // ---- the challenge --------------------------------------------------------------------------------------------
  var pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!ENDPOINT || S.classInvalid || !S.classCode) return;
    var ms = S.projector ? 4000 : (S.tab === "challenge" ? 5000 : 20000);
    pollTimer = setTimeout(function () { loadChallenge(false, schedulePoll); }, ms);
  }
  function setChallenge(ch) {
    var js = JSON.stringify(ch);
    if (js === S.challengeJson) return false;
    S.challenge = ch; S.challengeJson = js; return true;
  }
  var loading = false;
  function loadChallenge(force, cb) {
    if (!ENDPOINT || S.classInvalid || !S.classCode || loading) { if (cb) cb(); return; }
    loading = true;
    var p = { action: "challenge", "class": S.classCode };
    if (S.group && !S.projector) { p.group = "Group " + S.group.number; p.pin = S.group.pin || ""; }
    fetch(apiUrl(p)).then(function (r) { return r.json(); })
      .then(function (j) { loading = false; if (j && j.ok && j.challenge && (setChallenge(j.challenge) || force)) renderChallenge(); if (cb) cb(); })
      .catch(function () { loading = false; if (cb) cb(); });
  }
  function fly(seats) {
    if (!ENDPOINT || !S.group || S.flying) return;
    S.flying = true; S.flyError = ""; renderChallenge();
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                      body: JSON.stringify({ token: TOKEN, action: "fly", "class": S.classCode, group: "Group " + S.group.number, pin: S.group.pin || "", seats: seats }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        S.flying = false;
        if (j && j.challenge) setChallenge(j.challenge);
        if (!j || !j.ok) S.flyError = flyErrorText(j && j.error);
        renderChallenge();
      })
      .catch(function (err) { S.flying = false; S.flyError = "Could not reach the class record (" + String(err && err.message || err) + "). Check the wifi and try again."; renderChallenge(); });
  }
  // The script's reasons for refusing a flight, as sentences. A script from before version 5 expects a fare.
  function flyErrorText(e) {
    e = String(e || "no answer from the class record");
    if (/fare must be/.test(e)) return "The class's script is an older version that cannot take seats. Please tell the instructor.";
    if (/bad pin/.test(e)) return "The class record refused the group number and PIN; press Change at the top and enter them again.";
    return e.charAt(0).toUpperCase() + e.slice(1) + ".";
  }
  function demandOf(ch) { return ch && ch.demand && ch.told ? { a: ch.demand.a, b: ch.demand.b, mc: ch.told.mc, seats: ch.told.seats } : null; }

  // ---- what a team is told: a few plain sentences, the facts WeezyJet gave the teams as a list, and how the
  // challenge works as a second list that folds away once the team has flown (S.howOpen remembers a team that
  // opens or closes it itself). The route is new, so the airline has one trial flight to go on: one point on the
  // demand, nothing about the slope. What it does know is said outright: more seats take a lower fare, and
  // everyone on a flight pays the same fare.
  var AIRLINE = "WeezyJet";
  function numWord(n) { return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] || fmt(n); }
  function nFlights(n) { return numWord(n) + (n === 1 ? " flight" : " flights"); }
  // "London–Anchorage" -> "between London and Anchorage"; any other label -> "on the ... route".
  function routePhrase(label) {
    label = String(label || "London–Anchorage");
    var parts = label.split(/\s*[–—-]\s*/);
    return parts.length === 2 && parts[0] && parts[1] ? 'between <b>' + esc(parts[0]) + ' and ' + esc(parts[1]) + '</b>' : 'on the <b>' + esc(label) + '</b> route';
  }
  var KNOWS = 'does not know the exact demand, but it knows that the more seats it sells on a flight, the lower the fare has to be. It sells only one type of ticket, so all passengers on a flight pay the same fare. ';
  function factsList(t) {
    return '<ul class="facts"><li>The plane has <b>' + fmt(t.seats) + ' seats</b>.</li>' +
      '<li>The trial flight sold <b>' + fmt(t.q0) + ' seats</b> at a fare of <b>' + money(t.p0) + '</b>, so ' + fmt(t.seats - t.q0) + ' seats flew empty.</li>' +
      '<li>Each passenger costs <b>' + money(t.mc) + '</b> (fuel, catering, airport fees). The plane and the crew cost the same however many fly.</li>' +
      '<li>After passenger costs, the trial flight made <b>' + money(C.statusQuoProfit(t)) + '</b>.</li></ul>';
  }
  // t: the team's route, or null for the class as a whole (the numbers are then in the table of routes).
  function rules(flights, t, nroutes, open) {
    var nf = nFlights(flights), items = [
      (t ? 'Your team runs' : 'Each team runs') + ' the next <b>' + nf + '</b>' + (t ? '' : ' on one route') + '. Before each flight, choose <b>how many seats to sell</b>' + (t ? ' (1 to ' + fmt(t.seats) + ')' : ', up to the plane\'s seats') + '.',
      'After the flight you see the fare at which they sold: the highest fare at which that many people buy.',
      'Demand is the same every week. Anything more you learn about it, you learn from your own flights.',
      '<b>Score:</b> the profit of your ' + nf + ' minus ' + (flights === 1 ? '' : numWord(flights) + ' times ') + 'the trial flight\'s profit. Every flight counts.',
      nroutes > 1 ? (t ? 'Your class is split across ' + numWord(nroutes) + ' routes with different numbers. On your route, the team with the highest score wins.' : 'On each route, the team with the highest score wins.') : 'The team with the highest score wins.'];
    return '<details class="how" id="how"' + (open ? " open" : "") + '><summary>How the challenge works</summary><ul>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></details>';
  }
  function howOpen(byDefault) { return S.howOpen == null ? byDefault : S.howOpen; }
  // nroutes: how many routes the class runs; with more than one, the team competes on its own route only.
  function briefing(t, nroutes, flown) {
    return '<div class="briefing"><p class="story">' + AIRLINE + ' has just opened the only direct flight ' + routePhrase(t.label) + '. The flight operates once a week. ' + AIRLINE + ' ' + KNOWS +
      'So far it has run one trial flight. It isn\'t sure its fare is right, so it has asked consulting teams to run its next flights. It gave the teams the following information:</p>' +
      factsList(t) + rules(t.flights, t, nroutes, howOpen(!flown)) + '</div>';
  }
  // d (the demand) is given once it is revealed: the team's most profitable flight is then marked and each flight
  // is set against the best number of seats. During the challenge nothing may tell a team it has found the best.
  function flightsTable(flights, t, d) {
    if (!flights || !flights.length) return '<p class="caption">No flights yet.</p>';
    var best = d ? C.bestSeats(d) : null, bestF = null;
    if (d) flights.forEach(function (f) { if (!bestF || f.profit > bestF.profit) bestF = f; });
    var h = '<div class="wide"><table class="grid flights"><thead><tr><th>Flight</th><th class="num">Seats sold</th><th class="num">Fare</th><th class="num opt">Revenue</th><th class="num opt">Cost</th><th class="num">Profit</th><th class="num">Against the trial flight</th>' + (d ? '<th class="num">Seats off the best</th>' : "") + '</tr></thead><tbody>';
    var total = 0;
    flights.forEach(function (f) {
      total += f.gain;
      var cost = t.mc * f.passengers;
      h += '<tr><td>' + f.n + '</td><td class="num' + (f === bestF && flights.length > 1 ? " best" : "") + '">' + fmt(f.passengers) + (f.passengers >= t.seats ? ' <span class="caption">(full)</span>' : "") + '</td><td class="num">' + C.fareText(f.fare) + '</td>' +
           '<td class="num opt">' + money(f.profit + cost) + '</td><td class="num opt">' + money(cost) + '</td><td class="num">' + money(f.profit) + '</td><td class="num">' + money(f.gain, 0, true) + '</td>' +
           (d ? '<td class="num">' + fmt(f.passengers - best.seats, 0, true) + '</td>' : "") + '</tr>';
    });
    h += '<tr><td><b>Total</b></td><td></td><td></td><td class="opt"></td><td class="opt"></td><td></td><td class="num"><b>' + money(total, 0, true) + '</b></td>' + (d ? "<td></td>" : "") + '</tr></tbody></table></div>';
    return h;
  }
  // v: {board, told} (the challenge itself, or one route of the class view); compact: short headings, for the
  // boards side by side. The board never lists what a team flew, not even after the reveal: the flights are the
  // dots on the profit chart, and the flight by flight record is on the instructor's page.
  function boardTable(v, phase, compact) {
    var b = v.board || [];
    if (!b.length) return '<p class="caption">No flights flown yet on this route.</p>';
    var me = groupKey();
    var h = '<table class="grid board"><thead><tr><th class="rank">#</th><th>Group</th><th class="num">Flights</th><th class="num">' + (compact ? 'Score' : 'Score: profit over the trial flight') + '</th></tr></thead><tbody>';
    b.forEach(function (g, i) {
      h += '<tr' + (g.group === me ? ' class="me"' : "") + '><td class="rank">' + (i + 1) + '</td><td>' + esc(g.group) + '</td><td class="num">' + g.n + (v.told ? " / " + v.told.flights : "") + '</td><td class="num">' + money(g.gain, 0, true) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }
  function boardTitle(ch) { return "Leaderboard" + (ch.nroutes > 1 && ch.told ? ": " + esc(ch.told.label) : ""); }
  // Every flight on a board as a dot for the profit chart (a script from before version 5 lists fares only).
  function teamDots(board, d) {
    var dots = [];
    (board || []).forEach(function (g) {
      var sold = g.sold || (g.fares || []).map(function (f) { return Math.round(d.a - d.b * f); });
      sold.forEach(function (q) { if (q >= 1) dots.push({ seats: q, profit: C.profitSelling(d, q), name: "Flights flown", title: g.group + ": " + fmt(q) + " seats" }); });
    });
    return dots;
  }
  // The two sentences every reveal starts with (the slides' picture of a route's card shows them).
  // short: for a route's card on the projector, where three cards stand side by side.
  function demandLine(d, short) {
    return '<p class="reveal-line">To sell Q seats, the fare is <b>' + C.inverseText(d) + '</b>: nobody flies above <b>' + money(C.chokePrice(d)) + '</b>' +
      (short ? '.' : ', and each extra seat lowers the fare by ' + C.fareText(1 / d.b) + ' for everyone.') + '</p>';
  }
  function fullPlaneText(t, d, best, sq, short) {
    var full = C.fullPlane(d);
    if (best.seats >= full.seats) return 'The best is a full plane.';
    if (short) return 'A full plane (' + fmt(full.seats) + ' seats at ' + C.fareText(full.fare) + ') makes ' + money(full.profit) + '.';
    return 'A full plane (' + fmt(full.seats) + ' seats) needs a fare of ' + C.fareText(full.fare) + ' and makes ' + money(full.profit) + ', ' + money(Math.abs(sq - full.profit)) + (full.profit < sq ? ' less' : ' more') + ' than the trial flight.';
  }
  function revealSection(ch) {
    var t = ch.told, d = demandOf(ch), best = C.bestSeats(d), sq = C.statusQuoProfit(t);
    var mine = S.projector ? null : (ch.mine || []), bestF = null;
    (mine || []).forEach(function (f) { if (!bestF || f.profit > bestF.profit) bestF = f; });
    var dots = mine ? mine.map(function (f) { return { seats: f.passengers, profit: f.profit, name: "Your flights", title: "Flight " + f.n + ": " + fmt(f.passengers) + " seats at " + C.fareText(f.fare) }; }) : teamDots(ch.board, d);
    var step = best.seats > 25 ? 25 : 1;
    var h = '<h2>The demand on your route</h2>' + demandLine(d) +
      '<div class="metrics">' + metric("Best: seats to sell", best.seats, { sub: best.seats >= t.seats ? "a full plane" : fmt(t.seats - best.seats) + " seats left empty" }) +
      metric("at a fare of", C.fareText(best.fare)) + metric("Profit a flight", best.profit, { money: true, sub: money(best.profit - sq) + " more than the trial flight" }) +
      (bestF ? metric("Your best flight", fmt(bestF.passengers) + " seats", { sub: money(bestF.profit) + (bestF.profit < best.profit ? ", " + money(best.profit - bestF.profit) + " short of the best" : ", the best there is") }) : "") + '</div>' +
      '<p class="reveal-line">' + fullPlaneText(t, d, best, sq) + ' ' + step + ' seat' + (step > 1 ? 's' : '') + ' too many or too few costs ' + money(best.profit - C.profitSelling(d, best.seats - step)) + ' a flight.</p>';
    if (mine && mine.length) {
      var first = mine[0], ln = C.lineThrough(t.p0, t.q0, first.fare, first.passengers);
      if (ln) h += '<p class="reveal-line">Two points give a line. The trial flight (' + fmt(t.q0) + ' seats at ' + C.fareText(t.p0) + ') and your first flight (' + fmt(first.passengers) + ' seats at ' + C.fareText(first.fare) + ') give fare = ' + C.inverseText(ln) +
                   (Math.abs(ln.a - d.a) < 1 && Math.abs(ln.b - d.b) < 0.01 ? ': the demand itself.' : '.') + '</p>';
    }
    h += '<div class="cols"><div>' + C.profitChartHtml(d, { seats: t.q0, profit: sq }, dots, { r: mine ? undefined : 4 }) + '</div><div>' + C.demandChartHtml(t, d, 360) + '</div></div>';
    if (mine) h += '<h2>Your flights</h2>' + flightsTable(mine, t, d);
    h += '<h2>' + boardTitle(ch) + '</h2>' + boardTable(ch, ch.phase);
    return h;
  }
  // ---- the class as a whole, when it runs several routes: for the projector and for a page with no group yet.
  // The story, a table of the routes and a board per route; at the reveal each route's demand, best seats and
  // profit curve with its flights, then every team by its share of the gain its route allowed.
  function routesTable(R) {
    return '<div class="wide"><table class="grid routes"><thead><tr><th>Route</th><th class="num">Seats on the plane</th><th class="num">Cost per passenger</th><th class="num">Trial flight: seats sold</th><th class="num">at a fare of</th><th class="num">and it made</th></tr></thead><tbody>' +
      R.map(function (v) { var t = v.told; return '<tr><td>' + esc(t.label) + '</td><td class="num">' + fmt(t.seats) + '</td><td class="num">' + money(t.mc) + '</td><td class="num">' + fmt(t.q0) + '</td><td class="num">' + money(t.p0) + '</td><td class="num">' + money(C.statusQuoProfit(t)) + '</td></tr>'; }).join("") +
      '</tbody></table></div><p class="caption" style="margin:4px 0 0">The cost per passenger is fuel, catering and airport fees; the plane and the crew cost the same however many fly.</p>';
  }
  function classBriefing(ch) {
    var R = ch.routes, fl = R[0].told.flights;
    return '<div class="briefing"><p class="story">' + AIRLINE + ' has just opened ' + numWord(R.length) + ' new routes, each the only direct flight between its two cities and each flown once a week. On each route it ' + KNOWS +
      'So far it has run one trial flight on each route. It isn\'t sure its fares are right, so it has asked consulting teams to run its next flights. It gave the teams the following information:</p>' +
      routesTable(R) + rules(fl, null, R.length, howOpen(ch.phase === "setup")) + '</div>';
  }
  function routeReveal(v) {
    var t = v.told, d = demandOf(v), best = C.bestSeats(d), sq = C.statusQuoProfit(t);
    return demandLine(d, true) +
      '<p class="reveal-line">Best: <b>' + fmt(best.seats) + ' seats at ' + C.fareText(best.fare) + '</b>, <b>' + money(best.profit) + '</b> a flight, ' + money(best.profit - sq) + ' more than the trial flight. ' + fullPlaneText(t, d, best, sq, true) + '</p>' +
      C.profitChartHtml(d, { seats: t.q0, profit: sq }, teamDots(v.board, d), { r: 4, h: 300 }) + C.demandChartHtml(t, d, 280);
  }
  function overallTable(ch) {
    var rows = [], fl = ch.routes[0].told.flights;
    ch.routes.forEach(function (v) {
      var d = demandOf(v); if (!d) return;
      var possible = (C.bestSeats(d).profit - C.statusQuoProfit(v.told)) * v.told.flights;
      (v.board || []).forEach(function (g) { rows.push({ group: g.group, label: v.told.label, n: g.n, gain: g.gain, possible: possible, share: possible > 0 ? g.gain / possible : 0 }); });
    });
    if (!rows.length) return "";
    rows.sort(function (x, y) { return y.share - x.share || x.group.localeCompare(y.group, undefined, { numeric: true }); });
    return '<h2>Every team: share of the gain its route allowed</h2><p class="caption">The routes differ, so the scores are set against what the best number of seats would have earned over ' + fl + ' flights on each route.</p>' +
      '<div class="wide"><table class="grid board overall"><thead><tr><th class="rank">#</th><th>Group</th><th>Route</th><th class="num">Flights</th><th class="num">Score</th><th class="num">Best possible</th><th class="num">Share</th></tr></thead><tbody>' +
      rows.map(function (r, i) { return '<tr' + (r.group === groupKey() ? ' class="me"' : "") + '><td class="rank">' + (i + 1) + '</td><td>' + esc(r.group) + '</td><td>' + esc(r.label) + '</td><td class="num">' + r.n + ' / ' + fl + '</td><td class="num">' + money(r.gain, 0, true) + '</td><td class="num">' + money(r.possible) + '</td><td class="num">' + fmt(100 * r.share) + '%</td></tr>'; }).join("") +
      '</tbody></table></div>';
  }
  function classSection(ch) {
    var R = ch.routes, revealed = ch.phase === "revealed" || ch.phase === "round2", h = classBriefing(ch);
    if (!S.projector && !S.group) h += '<div class="info">Enter your group number at the top of the page to see your own route and fly.</div>';
    else if (!S.projector) h += '<div class="info">Reading your group\'s route…</div>';
    if (ch.phase === "setup") h += '<div class="info">The challenge has not opened yet. Read the brief and agree how you will choose your seats.</div>';
    if (ch.phase === "closed") h += '<div class="info">The challenge is closed. The demand is revealed next.</div>';
    if (ch.phase === "open" || ch.phase === "closed")
      h += '<h2>Leaderboards</h2><div class="routes-grid">' + R.map(function (v) { return '<div class="route-card"><h3>' + esc(v.told.label) + '</h3>' + boardTable(v, ch.phase, true) + '</div>'; }).join("") + '</div>';
    if (revealed)
      h += '<h2>The demands the teams were facing</h2><div class="routes-grid">' +
           R.map(function (v) { return '<div class="route-card"><h3>' + esc(v.told.label) + '</h3>' + routeReveal(v) + '<h4>Leaderboard</h4>' + boardTable(v, ch.phase, true) + '</div>'; }).join("") + '</div>' + overallTable(ch);
    return h;
  }
  function renderChallenge() {
    var el = $("tab-challenge"), ch = S.challenge, box = $("seats"), typed = box ? { v: box.value, f: document.activeElement === box } : null;
    var h = "";
    if (!S.classCode || S.classInvalid) h = '<div class="info">The challenge runs in class, under your class\'s link.</div>';
    else if (!ENDPOINT) h = '<div class="info">Offline copy: the challenge needs the class record.</div>';
    else if (!ch) h = '<p class="caption">Reading the challenge…</p>';
    else if (!ch.told && !(ch.routes && ch.routes.length)) h = '<div class="info">The challenge is not set up for class ' + esc(S.classCode) + ' yet. The instructor opens it in class.</div>';
    else if (!ch.told) h += '<h2 style="margin-top:4px">The WeezyJet challenge <span class="phase ' + esc(ch.phase) + '">' + esc(PHASE_LABEL[ch.phase] || ch.phase) + '</span></h2>' + classSection(ch);
    else {
      var t = ch.told, mine = ch.mine || [], badge = '<span class="phase ' + esc(ch.phase) + '">' + esc(PHASE_LABEL[ch.phase] || ch.phase) + '</span>';
      h += '<h2 style="margin-top:4px">' + (ch.nroutes > 1 || S.group ? 'Your route: ' + esc(t.label) : 'The WeezyJet challenge') + ' ' + badge + '</h2>' + briefing(t, ch.nroutes || 1, mine.length > 0 || ch.phase !== "setup" && S.projector);
      if (ch.phase === "setup") h += '<div class="info">The challenge has not opened yet. Read the brief and agree how you will choose your seats.</div>';
      if (ch.phase === "open" && !S.projector) {
        if (!S.group) h += '<div class="info">Enter your group number at the top of the page to fly.</div>';
        else {
          var left = t.flights - mine.length, last = mine[mine.length - 1];
          if (left > 0) {
            h += '<div class="panel"><form id="fly-form" class="fare-form" novalidate><div><label for="seats">Seats to sell on flight ' + (mine.length + 1) + ' of ' + t.flights + '</label><input type="number" id="seats" min="1" max="' + t.seats + '" step="1" inputmode="numeric" placeholder="1 to ' + fmt(t.seats) + '"' + (S.flying ? " disabled" : "") + '></div>' +
                 '<div><button type="submit" class="primary" id="fly" style="width:100%"' + (S.flying ? " disabled" : "") + '>' + (S.flying ? "Flying…" : "Fly") + '</button></div></form>' +
                 (S.flyError ? '<div class="error">' + esc(S.flyError) + '</div>' : (last ? '<p class="caption" id="last-flight" style="margin:8px 0 0">Flight ' + last.n + ': to sell ' + fmt(last.passengers) + ' seats the fare was ' + C.fareText(last.fare) + '.</p>' : "")) + '</div>';
          } else h += '<div class="success">All ' + t.flights + ' flights flown. Wait for the instructor to reveal the demand.</div>';
          if (mine.length) h += '<h2>Your flights</h2>' + flightsTable(mine, t, null);
        }
        h += '<details class="panel" open><summary>' + boardTitle(ch) + '</summary>' + boardTable(ch, ch.phase) + '</details>';
      }
      if (ch.phase === "open" && S.projector) h += '<h2>Leaderboard</h2>' + boardTable(ch, ch.phase);
      if (ch.phase === "closed") {
        h += '<div class="info">The challenge is closed. The demand is revealed next.</div>';
        if (!S.projector && S.group) h += '<h2>Your flights</h2>' + flightsTable(mine, t, null);
        h += '<h2>' + boardTitle(ch) + '</h2>' + boardTable(ch, ch.phase);
      }
      if (ch.phase === "revealed" || ch.phase === "round2") h += revealSection(ch);
    }
    el.innerHTML = h;
    bindChallenge(ch);
    if ($("seats") && typed) { $("seats").value = typed.v; if (typed.f) $("seats").focus(); }
  }
  function bindChallenge(ch) {
    var how = $("how");
    if (how) how.querySelector("summary").addEventListener("click", function () { S.howOpen = !how.open; });   // the click comes before the fold
    if ($("fly-form")) $("fly-form").onsubmit = function (ev) {
      ev.preventDefault();
      var v = Number($("seats").value), top = ch.told.seats;
      if ($("seats").value === "" || isNaN(v) || v !== Math.round(v) || v < 1 || v > top) { S.flyError = "Type the seats to sell: a whole number from 1 to " + fmt(top) + "."; renderChallenge(); return; }
      fly(v);
    };
  }

  // ---- Mocha --------------------------------------------------------------------------------------------------------
  function datasets() {
    var out = [], mine = DATA.streams.filter(function (s) { return s.code === S.classCode; })[0];
    if (mine) out.push({ key: "mine", label: "Your stream (" + mine.label + ", " + mine.bids.length + " bids)", bids: mine.bids, year: DATA.year });
    DATA.streams.forEach(function (s) { if (!mine || s.code !== mine.code) out.push({ key: s.code, label: s.label + ", " + DATA.year + " (" + s.bids.length + " bids)", bids: s.bids, year: DATA.year }); });
    if (DATA.streams.length > 1) out.push({ key: "all", label: "All " + DATA.streams.length + " streams, " + DATA.year + " (" + DATA.streams.reduce(function (n, s) { return n + s.bids.length; }, 0) + " bids)", bids: [].concat.apply([], DATA.streams.map(function (s) { return s.bids; })), year: DATA.year });
    if (DATA.last && DATA.last.bids.length) out.push({ key: "last", label: "Last year (" + DATA.last.label + ", " + DATA.last.bids.length + " bids)", bids: DATA.last.bids, year: DATA.last.label });
    return out;
  }
  function cleaningText(m) {
    var parts = []; if (m.dropZero) parts.push("£0 bids ignored"); if (m.above !== "" && !isNaN(parseFloat(m.above))) parts.push("bids above £" + fmt(parseFloat(m.above)) + " ignored");
    return parts.length ? parts.join(", ") : "none";
  }
  function computeMocha() {
    var sets = datasets(); if (!sets.length) return null;
    var ds = sets.filter(function (s) { return s.key === S.mocha.dataset; })[0] || sets[0];
    var m = S.mocha, mc = num(m.cost, 15), opts = { dropZero: !!m.dropZero, above: m.above === "" ? null : parseFloat(m.above) };
    var bids = C.clean(ds.bids, opts), price = m.price === "" ? null : num(m.price, null);
    if (price == null) { price = Math.round(C.median(bids) || 0); m.price = String(price); }
    var best = C.bestPrice(bids, mc), line = C.fitLine(bids), lp = C.linePricing(line, bids, mc);
    return { sets: sets, ds: ds, mc: mc, opts: opts, bids: bids, price: price, buyers: C.buyersAt(bids, price), profit: C.profitAtPrice(bids, price, mc), best: best, line: line, lp: lp };
  }
  function buildMocha() {
    var el = $("tab-mocha");
    if (!datasets().length) { el.innerHTML = '<div class="info">No bids are built into this copy of the page.</div>'; return; }
    // One panel: the price first, then the data it is tried on; the bids to ignore are folded away until used.
    el.innerHTML = '<p class="caption" style="margin:0 0 6px">Each bid is the most one student said they would pay for ' + esc(DATA.item || "Mocha") + ' in Session 1. At a price, everyone whose bid is at least the price buys.</p>' +
      '<div class="cols-5-7"><div><div class="panel">' +
      '<label for="mo-price" style="margin-top:0">Your price (£)</label><input type="number" id="mo-price" step="1" min="0" style="font-size:1.3rem">' +
      '<label for="mo-data">Bids</label><select id="mo-data"></select>' +
      '<label for="mo-cost">Cost per ' + esc(DATA.item || "Mocha") + ' (£)</label><input type="number" id="mo-cost" step="1" min="0">' +
      '<div class="radio" style="margin-top:10px"><label><input type="checkbox" id="mo-line"> Show the straight line fitted to the bids, and the price MR = MC gives on it</label></div>' +
      '<details class="how" id="mo-ignore"' + (S.mocha.dropZero || S.mocha.above !== "" ? " open" : "") + '><summary>Ignore some bids</summary>' +
      '<div class="radio"><label><input type="checkbox" id="mo-zero"> Bids of £0</label></div>' +
      '<div class="row"><label for="mo-above" style="margin:0">Bids above £</label><input type="number" id="mo-above" step="1" min="0" placeholder="none" style="width:110px"></div></details>' +
      '</div></div><div id="mo-results"></div></div>';
    $("mo-data").onchange = function () { S.mocha.dataset = this.value; S.mocha.price = ""; renderMocha(); };
    ["mo-cost", "mo-above", "mo-price"].forEach(function (id) { $(id).addEventListener("change", readMocha); });
    $("mo-zero").addEventListener("change", readMocha); $("mo-line").addEventListener("change", readMocha);
    el.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t.getAttribute && t.getAttribute("data-inner")) { S.mocha.inner = t.getAttribute("data-inner"); renderMocha(); }
      else if (t.id === "mo-fourth") { S.mocha.fourth = t.checked; renderMocha(); }
    });
  }
  function readMocha() {
    var m = S.mocha;
    m.cost = num($("mo-cost").value, 15); m.above = $("mo-above").value === "" ? "" : String(num($("mo-above").value, "")); m.price = $("mo-price").value;
    m.dropZero = $("mo-zero").checked; m.showLine = $("mo-line").checked;
    renderMocha();
  }
  function demandChart(r) {
    var sched = C.schedule(r.bids), pts = [], top = sched.length - 1;
    for (var k = top; k >= 1; k--) { pts.push([sched[k][1], k]); pts.push([sched[k][1], k - 1]); }
    pts.push([sched[0][1], 0]);
    var n = r.bids.length, pmax = Math.max(top, r.line ? r.line.a : 0) * 1.08;
    var lines = [{ pts: pts, color: C.COLORS.red, width: 2.5, name: "Demand: buyers at each price" }];
    if (S.mocha.showLine && r.line) lines.push({ pts: [[0, r.line.a], [r.line.a / r.line.b, 0]], color: C.COLORS.purple, width: 2, dash: "dash", name: "Fitted line P = " + fmt(r.line.a, 1) + " − " + fmt(r.line.b, 2) + " Q" });
    var markers = [{ x: r.buyers, y: r.price, color: C.COLORS.black, name: "Your price", title: "Price " + money(r.price) + ": " + r.buyers + " buyers" },
                   { x: r.best.buyers, y: r.best.price, color: C.COLORS.green, hollow: true, name: "Best price on these bids", label: money(r.best.price), title: "Best price " + money(r.best.price) + ": " + r.best.buyers + " buyers, profit " + money(r.best.profit) }];
    if (S.mocha.showLine && r.lp) markers.push({ x: r.lp.buyers, y: r.lp.price, color: C.COLORS.purple, hollow: true, name: "The line's price (MR = MC)", title: "Line's price " + money(r.lp.price, 2) + ": " + r.lp.buyers + " buyers" });
    return C.chart({ title: "Demand from the bids", h: 380, x: { max: n * 1.04, label: "Buyers (bids at least the price)" }, y: { max: pmax, label: "Price (£)" }, lines: lines,
                     hlines: [{ y: r.mc, label: "cost", color: C.COLORS.grey }], markers: markers });
  }
  function profitChartMocha(r) {
    var top = Math.ceil(Math.max.apply(null, r.bids)), pts = [];
    for (var p = 0; p <= top; p++) pts.push([p, C.profitAtPrice(r.bids, p, r.mc)]);
    var ymin = Math.min(0, pts[0][1]), ymax = Math.max(r.best.profit, 1) * 1.1;
    var markers = [{ x: r.price, y: r.profit, color: C.COLORS.black, name: "Your price" }, { x: r.best.price, y: r.best.profit, color: C.COLORS.green, hollow: true, name: "Best price", label: money(r.best.price) }];
    if (S.mocha.showLine && r.lp) markers.push({ x: r.lp.price, y: r.lp.profit, color: C.COLORS.purple, hollow: true, name: "The line's price" });
    return C.chart({ title: "Profit against the price", h: 380, x: { max: top, label: "Price (£)" }, y: { min: ymin, max: ymax, label: "Profit (£)" },
                     lines: [{ pts: pts, color: C.COLORS.blue, width: 2.5, name: "Profit at each price" }], vlines: [{ x: r.mc, label: "cost", color: C.COLORS.grey }], markers: markers });
  }
  function histChart(r) {
    var bins = C.histogram(r.bids, 5), ymax = Math.max.apply(null, bins.map(function (b) { return b.n; })) * 1.15;
    return C.chart({ title: "Histogram of the bids", h: 240, x: { max: bins[bins.length - 1].hi, label: "Bid (£)" }, y: { max: ymax, label: "Students" },
                     bars: bins.map(function (b) { return { x0: b.lo, x1: b.hi, y: b.n, color: C.COLORS.blue, title: "£" + b.lo + " to £" + b.hi + ": " + b.n }; }), legend: false });
  }
  function segmentsPanel(r) {
    var sets = DATA.streams.map(function (s) { return { name: s.label + " (" + DATA.year + ")", bids: C.clean(s.bids, r.opts) }; });
    if (S.mocha.fourth && DATA.last && DATA.last.bids.length) sets.push({ name: "Last year (" + DATA.last.label + ")", bids: C.clean(DATA.last.bids, r.opts) });
    var seg = C.segmentation(sets, r.mc);
    var h = '<p class="caption">One price for every market against a price per market, at a cost of ' + money(r.mc) + ' with the bids ignored as set (' + esc(cleaningText(S.mocha)) + ').</p>' +
      '<div class="radio"><label><input type="checkbox" id="mo-fourth"' + (S.mocha.fourth ? " checked" : "") + '> Add last year\'s bids as a fourth market</label></div>' +
      '<table class="grid"><thead><tr><th>Market</th><th class="num">Bids</th><th class="num">Own best price</th><th class="num">Buyers</th><th class="num">Profit</th><th class="num">At one price for all (' + money(seg.uniform.price) + ')</th><th class="num">Profit</th></tr></thead><tbody>';
    sets.forEach(function (s, i) {
      var sp = seg.separate[i], u = seg.uniform.per[i];
      h += '<tr><td>' + esc(s.name) + '</td><td class="num">' + s.bids.length + '</td><td class="num">' + money(sp.price) + '</td><td class="num">' + sp.buyers + '</td><td class="num">' + money(sp.profit) + '</td><td class="num">' + u.buyers + ' buyers</td><td class="num">' + money(u.profit) + '</td></tr>';
    });
    h += '<tr><td><b>Total</b></td><td class="num">' + sets.reduce(function (n, s) { return n + s.bids.length; }, 0) + '</td><td></td><td></td><td class="num"><b>' + money(seg.total) + '</b></td><td></td><td class="num"><b>' + money(seg.uniform.profit) + '</b></td></tr></tbody></table>' +
      '<p><b>Gain from a price per market: ' + money(seg.gain) + ' (' + pct(seg.gainPct) + ')</b> over the best single price.</p>';
    return { html: h, seg: seg, names: sets.map(function (s) { return s.name; }) };
  }
  function renderMocha() {
    if (!$("mo-results")) return;
    var r = computeMocha(); if (!r) return;
    var m = S.mocha, sel = $("mo-data");
    sel.innerHTML = r.sets.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === r.ds.key ? " selected" : "") + '>' + esc(s.label) + '</option>'; }).join("");
    $("mo-cost").value = r.mc; $("mo-price").value = r.price; $("mo-zero").checked = !!m.dropZero; $("mo-above").value = m.above; $("mo-line").checked = !!m.showLine;
    var el = $("mo-results"), n = r.bids.length;
    var h = '<div class="metrics">' + metric("Buyers at " + money(r.price), r.buyers, { sub: n ? Math.round(100 * r.buyers / n) + "% of " + n + " bids" : "" }) + metric("Revenue", r.price * r.buyers, { money: true }) +
            metric("Cost", r.mc * r.buyers, { money: true }) + metric("Profit", r.profit, { money: true, sub: r.best.profit > 0 ? Math.round(100 * r.profit / r.best.profit) + "% of the best" : "" }) + '</div>';
    h += '<div class="tabs inner"><button type="button" data-inner="pricing" class="' + (m.inner === "pricing" ? "active" : "") + '">Pricing</button><button type="button" data-inner="bids" class="' + (m.inner === "bids" ? "active" : "") + '">The bids</button>' +
         (DATA.streams.length > 1 ? '<button type="button" data-inner="segments" class="' + (m.inner === "segments" ? "active" : "") + '">Three streams</button>' : "") + '</div>';
    if (m.inner === "pricing") {
      h += demandChart(r) + '<p class="reveal-line">Best price on these bids: <b>' + money(r.best.price) + '</b>, ' + r.best.buyers + ' buyers, profit <b>' + money(r.best.profit) + '</b>. With every bid known there is nothing to estimate: try every price and keep the best.</p>';
      if (m.showLine) {
        if (r.line && r.lp) h += '<p class="reveal-line">The straight line fitted to the demand schedule: <b>P = ' + fmt(r.line.a, 2) + ' − ' + fmt(r.line.b, 3) + ' Q</b>. Its marginal revenue is ' + fmt(r.line.a, 2) + ' − ' + fmt(2 * r.line.b, 3) + ' Q; MR = MC at Q = ' + fmt(r.lp.lineQ, 1) +
                                 ', so the line says price <b>' + money(r.lp.price, 2) + '</b>, the same as (' + fmt(r.line.a, 2) + ' + ' + fmt(r.mc) + ') / 2. On the actual bids that price sells ' + r.lp.buyers + ' and earns <b>' + money(r.lp.profit, 2) + '</b>' +
                                 (r.best.profit > 0 ? ', ' + Math.round(100 * r.lp.profit / r.best.profit) + '% of the best' : "") + '.</p>';
        else h += '<p class="caption">No line can be fitted to these bids.</p>';
      }
      h += profitChartMocha(r);
    } else if (m.inner === "bids") {
      var sorted = r.bids.slice().sort(function (x, y) { return y - x; });
      h += histChart(r) + '<p class="caption">' + n + ' bids counted (' + esc(cleaningText(m)) + '); median ' + money(C.median(r.bids)) + ', highest ' + money(sorted[0]) + ', ' + sorted.filter(function (v) { return v === sorted[0]; }).length + ' at the highest.</p>' +
           '<details class="panel"><summary>The demand schedule</summary><div class="labbook-wrap"><table class="grid"><thead><tr><th class="num">Price</th><th class="num">Buyers</th><th class="num">Revenue</th><th class="num">Profit at cost ' + money(r.mc) + '</th></tr></thead><tbody>' +
           C.schedule(r.bids).slice().reverse().map(function (pq) { return '<tr><td class="num">' + money(pq[0]) + '</td><td class="num">' + pq[1] + '</td><td class="num">' + money(pq[0] * pq[1]) + '</td><td class="num">' + money((pq[0] - r.mc) * pq[1]) + '</td></tr>'; }).join("") + '</tbody></table></div></details>';
    } else h += segmentsPanel(r).html;
    el.innerHTML = h;
    saveLocal();
  }
  // ---- init -----------------------------------------------------------------------------------------------------
  function init() {
    var qs = new URLSearchParams(location.search);
    S.rawClass = (qs.get("class") || "").trim();
    S.projector = qs.get("projector") === "1";
    if (S.projector) document.body.classList.add("projector");
    var cls = normalizeClass(S.rawClass);
    S.classInvalid = cls === null && !S.projector;
    S.classCode = cls === null ? S.rawClass : cls;
    if (cls && cls !== S.rawClass && window.history && history.replaceState) { qs.set("class", cls); history.replaceState(null, "", location.pathname + "?" + qs.toString() + location.hash); }
    var last = (S.projector || S.classInvalid) ? null : loadStored("pricinglab:" + S.classCode + ":last");
    if (last && last.number) S.group = last;
    mergeStored(loadStored(storeKey()));
    buildMocha();
    try { localStorage.removeItem("pricinglab:queue"); } catch (e) {}      // what an older page still had to send to the lab book
    renderGroup(); renderChallenge(); renderMocha();
    Array.prototype.forEach.call($("main-tabs").querySelectorAll("button"), function (b) { b.onclick = function () { showTab(b.getAttribute("data-tab")); }; });
    showTab(qs.get("tab") || S.tab || "challenge");
    renderStatus();
    loadChallenge(true);
  }
  document.addEventListener("DOMContentLoaded", init);
  window.PricingLabApp = { state: S, render: renderChallenge };
})();
