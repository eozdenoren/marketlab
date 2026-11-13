/* Pricing Laboratory page: the group panel (the same sign-in as the Marketplace Laboratory, against the pricing
   script), the Challenge, Mocha and Lab book tabs, local storage and the save queue. Depends on PricingCore
   (pricing_core.js), the questions in pricing_questions.js and the bids in mocha_data.js.
   ?projector=1 is projector mode: no group, the leaderboard and the reveal for every group, pins stay local. */
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
  var PHASE_LABEL = { setup: "Not open yet", open: "Round 1 open", closed: "Round 1 closed", revealed: "Demand revealed", round2: "Round 2 open" };
  var SCENARIOS = [["up", "Demand rises 40%", 1.4], ["double", "Demand doubles", 2]];

  // ---- utilities -----------------------------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
  function timeStr(ts) { return new Date(ts).toTimeString().slice(0, 8); }
  function uid() { return Math.random().toString(16).slice(2, 10); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function pct(x) { return x == null || isNaN(x) ? "–" : (x >= 0 ? "+" : "-") + Math.round(1000 * Math.abs(x)) / 10 + "%"; }
  function metric(label, value, opts) {
    opts = opts || {};
    var v = typeof value === "number" ? (opts.money ? money(value, opts.decimals) : fmt(value, opts.decimals)) : esc(value);
    return '<div class="metric"><div class="label">' + esc(label) + '</div><div class="value">' + v + '</div>' + (opts.sub ? '<div class="caption">' + esc(opts.sub) + '</div>' : "") + '</div>';
  }

  // ---- state ----------------------------------------------------------------------------------------------------
  var S = { classCode: "", rawClass: "", classInvalid: false, projector: false, group: null, editingGroup: false, book: [], notes: "", answers: {}, answersDirty: {},
            tab: "challenge", challenge: null, challengeJson: "", flying: false, flyError: "", lastQ: {}, pinMsg: {}, lastSaved: null, lastError: "",
            round2: { scenario: "up", trials: { up: [], "double": [] }, fare: { up: "", "double": "" } },
            mocha: { dataset: "", cost: DATA.cost || 15, price: "", dropZero: false, above: "", showLine: false, inner: "pricing", fourth: false } };
  function groupKey() { return S.group ? "Group " + S.group.number : (S.projector ? "Projector" : "_"); }
  function canPin() { return !!(S.group || S.projector); }
  function groupPin() { return S.group && S.group.pin ? String(S.group.pin) : ""; }
  function groupNames() { return S.group && S.group.names ? S.group.names : ""; }
  function storeKey() { return "pricinglab:" + S.classCode + ":" + groupKey(); }
  function saveLocal() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({ book: S.book, notes: S.notes, answers: S.answers, group: S.group, tab: S.tab, lastQ: S.lastQ, round2: S.round2, mocha: S.mocha }));
      if (!S.projector) localStorage.setItem("pricinglab:" + S.classCode + ":last", S.group ? JSON.stringify(S.group) : "");
    } catch (e) {}
  }
  function loadStored(key) { try { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function mergeStored(d) {
    if (!d) return;
    var have = {}; S.book.forEach(function (e) { have[e.id] = true; });
    (d.book || []).forEach(function (e) { if (!have[e.id]) S.book.push(e); });
    if (!S.notes && d.notes) S.notes = d.notes;
    Object.keys(d.answers || {}).forEach(function (k) { if (!S.answers[k]) S.answers[k] = d.answers[k]; });
    if (d.tab) S.tab = d.tab;
    if (d.lastQ && typeof d.lastQ === "object") S.lastQ = d.lastQ;
    if (d.round2 && d.round2.trials) S.round2 = d.round2;
    if (d.mocha && typeof d.mocha === "object") Object.keys(d.mocha).forEach(function (k) { S.mocha[k] = d.mocha[k]; });
  }

  // ---- class record (save queue) ---------------------------------------------------------------------------
  var queue = loadStored("pricinglab:queue") || [], flushing = false, retryTimer = null;
  function persistQueue() { try { localStorage.setItem("pricinglab:queue", JSON.stringify(queue)); } catch (e) {} }
  function record(question, finding, state) {
    state = state || {};
    state["class"] = S.classCode; state.names = groupNames();
    return { ts: Date.now() / 1000, group: groupKey(), question: question, finding: finding || "", state: state, pin: groupPin() };
  }
  function enqueue(rec) { if (!S.group || S.projector) return; queue.push(rec); persistQueue(); S.pinRejected = false; flush(); renderStatus(); }
  function flush() {
    if (!ENDPOINT || flushing || !queue.length || S.pinRejected || S.classInvalid) return;
    if (CLASSES.length && S.classCode) queue.forEach(function (r) {
      var st = r.state || (r.state = {}), fixed = normalizeClass(st["class"]);
      if (fixed !== st["class"]) st["class"] = fixed || S.classCode;
    });
    flushing = true;
    var batch = queue.slice(0, 20).map(function (r) { r.pin = groupPin(); return r; });
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: TOKEN, records: batch }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || "bad response");
        queue.splice(0, batch.length); persistQueue(); S.lastSaved = Date.now(); S.lastError = ""; flushing = false; renderStatus();
        if (queue.length) flush();
      })
      .catch(function (err) {
        flushing = false; S.lastError = String(err && err.message || err); renderStatus();
        if (/bad pin/.test(S.lastError)) { S.pinRejected = true; return; }
        clearTimeout(retryTimer); retryTimer = setTimeout(flush, 20000);
      });
  }
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
  function restoreFromRecords(recs) {
    if (!recs || !recs.length) return;
    recs.sort(function (a, b) { return a.ts - b.ts; });
    var entries = {}, order = [], notes = "", answers = {};
    recs.forEach(function (f) {
      var st = f.state || {}, lbk = st.labbook;
      if (!lbk) return;
      if (lbk.kind === "notes") { notes = f.finding || ""; return; }
      if (lbk.kind === "answers") { mergeAnswers(answers, st.answers); return; }
      if (lbk.deleted) { delete entries[lbk.id]; return; }
      if (!entries[lbk.id]) order.push(lbk.id);
      var sw = {}; Object.keys(st).forEach(function (k) { if (k !== "labbook") sw[k] = st[k]; });
      entries[lbk.id] = { id: lbk.id, ts: f.ts, tab: lbk.tab || "challenge", label: lbk.label || "", question: f.question || "", note: f.finding || "", measures: lbk.measures || {}, state: sw };
    });
    var have = {}; S.book.forEach(function (e) { have[e.id] = true; });
    order.forEach(function (id) { if (entries[id] && !have[id]) S.book.push(entries[id]); });
    if (!S.notes && notes) S.notes = notes;
    var pending = pendingAnswerKeys();
    Object.keys(answers).forEach(function (k) { if (!pending[k]) S.answers[k] = answers[k]; });
  }
  function mergeAnswers(into, add) { Object.keys(add || {}).forEach(function (k) { if (String(add[k] || "").trim()) into[k] = add[k]; }); return into; }
  function pendingAnswerKeys() {
    var keys = {};
    Object.keys(S.answersDirty).forEach(function (k) { keys[k] = true; });
    queue.forEach(function (r) { if (((r.state || {}).labbook || {}).kind === "answers") Object.keys((r.state || {}).answers || {}).forEach(function (k) { keys[k] = true; }); });
    return keys;
  }
  var lastSync = 0;
  function syncFromRecord(force) {
    if (!ENDPOINT || !S.group || S.projector) return;
    if (!force && Date.now() - lastSync < 15000) return;
    lastSync = Date.now();
    checkPin(S.group, function (status, j) {
      if (status !== "ok" || !j) return;
      restoreFromRecords(j.records || []); if (j.challenge) setChallenge(j.challenge); saveLocal();
      var focused = document.activeElement && document.activeElement.closest && document.activeElement.closest("#tab-book");
      if (!focused) renderBook();
      else Array.prototype.forEach.call($("tab-book").querySelectorAll("textarea[data-q]"), function (ta) { if (ta !== document.activeElement) ta.value = S.answers[ta.getAttribute("data-q")] || ""; });
    });
  }
  function renderStatus() {
    var el = $("footer-status"), parts = [];
    if (S.classCode) parts.push("Class " + esc(S.classCode));
    if (S.group) parts.push(esc(groupKey()));
    if (S.projector) parts.push("Projector: pins stay in this browser, nothing is sent to the class record");
    else if (!ENDPOINT) parts.push("Offline copy: nothing is sent to the class record");
    else if (S.pinRejected) parts.push('<span class="err">The class record refused the group number and PIN; press Change above and enter them again</span>');
    else if (S.lastError && queue.length) parts.push('<span class="err">Could not reach the class record (' + esc(S.lastError) + '); ' + queue.length + ' saved on this device, retrying</span>');
    else if (queue.length) parts.push("Saving…");
    else if (S.lastSaved) parts.push("Saved to the class record at " + timeStr(S.lastSaved));
    el.innerHTML = parts.join(" · ");
    var s = $("book-status"); if (!s) return;
    if (S.projector) s.textContent = "Projector: the pins stay in this browser; nothing is sent to the class record.";
    else if (!ENDPOINT) s.textContent = "Offline copy: your work is kept on this device only.";
    else if (S.pinRejected) { s.textContent = "The class record refused the group number and PIN; press Change at the top and enter them again."; s.className = "status err"; }
    else if (S.lastError && queue.length) { s.textContent = "Could not reach the class record; your work is kept on this device and will be sent again."; s.className = "status err"; }
    else if (queue.length) { s.textContent = "Saving…"; s.className = "status"; }
    else if (S.lastSaved) { s.textContent = "Saved to the class record at " + timeStr(S.lastSaved) + "."; s.className = "status"; }
    else s.textContent = "";
  }

  // ---- group panel ---------------------------------------------------------------------------------------------
  function renderGroup() {
    var el = $("group-panel");
    if (S.projector) {
      el.innerHTML = '<div class="group-line"><div><b>Projector</b>' + (S.classCode ? " · Class " + esc(S.classCode) : "") + ' · the leaderboard and the reveal for every group; pins stay in this browser</div>' +
                     '<button type="button" id="projector-clear">Clear the lab book</button></div>';
      $("projector-clear").onclick = function () { S.book = []; S.lastQ = {}; saveLocal(); renderBook(); renderStatus(); };
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
        S.group = candidate; S.editingGroup = false; S.pinRejected = false;
        if (!prev || prev.number !== n) mergeStored(loadStored(storeKey()));
        if (j) { restoreFromRecords(j.records || []); if (j.challenge) setChallenge(j.challenge); }
        saveLocal(); renderGroup(); renderChallenge(); renderMocha(); renderBook(); renderStatus(); flush();
        if (!j) loadChallenge(true);
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
  function showTab(name) {
    S.tab = name;
    ["challenge", "mocha", "book"].forEach(function (t) { $("tab-" + t).hidden = t !== name; });
    Array.prototype.forEach.call($("main-tabs").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
    if (name === "book") { renderBook(); syncFromRecord(false); }
    if (name === "challenge") loadChallenge(false);
    saveLocal(); schedulePoll();
  }

  // ---- pinning -----------------------------------------------------------------------------------------------------
  function pinPanel(which, suggestion, qid) {
    var wrap = $(which + "-pin-wrap"); if (!wrap) return;
    if (!$(which + "-pin")) {
      wrap.innerHTML = '<div class="panel"><div class="pin"><div><label for="' + which + '-pin-label">Label for the lab book</label><input type="text" id="' + which + '-pin-label" title="Leave blank to use the suggested label."></div>' +
        '<div><label for="' + which + '-pin-q">Lab book section</label><select id="' + which + '-pin-q">' + PQUESTIONS.map(function (q) { return '<option value="' + q.id + '">' + esc(q.title) + '</option>'; }).join("") + '</select></div>' +
        '<div><button type="button" class="primary" id="' + which + '-pin" style="width:100%">Pin to lab book</button></div></div><div id="' + which + '-pin-info"></div></div>';
    }
    $(which + "-pin-label").placeholder = suggestion;
    $(which + "-pin").disabled = !canPin();
    // the section follows the context (the round, the scenario) when that changes; otherwise the student's own choice stays
    var sel = $(which + "-pin-q");
    if (sel.getAttribute("data-last") !== qid) { sel.setAttribute("data-last", qid); sel.value = qid; }
    $(which + "-pin-info").innerHTML = (canPin() ? "" : '<p class="caption">Enter your group number at the top of the page to pin.</p>') + (S.pinMsg[which] ? '<div class="success">' + esc(S.pinMsg[which]) + '</div>' : "");
  }
  function doPin(which, suggestion, measures, state) {
    var labelEl = $(which + "-pin-label"), label = (labelEl.value || "").trim() || suggestion;
    var qid = $(which + "-pin-q").value, q = PQUESTIONS.filter(function (x) { return x.id === qid; })[0] || PQUESTIONS[PQUESTIONS.length - 1];
    var entry = { id: uid(), ts: Date.now() / 1000, tab: which, label: label, question: q.title, note: "", measures: measures, state: state };
    S.book.push(entry); labelEl.value = ""; S.lastQ[which] = q.id;
    S.pinMsg[which] = "Pinned as '" + label + "' under '" + q.title + "'. Open the Lab book tab to see it.";
    saveLocal(); enqueue(entryRecord(entry, false));
    return entry;
  }
  function entryRecord(e, deleted) {
    var st = clone(e.state || {});
    st.labbook = { id: e.id, label: e.label, tab: e.tab, measures: e.measures, deleted: !!deleted };
    return record(e.question, e.note, st);
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
  function fly(fare) {
    if (!ENDPOINT || !S.group || S.flying) return;
    S.flying = true; S.flyError = ""; renderChallenge();
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                      body: JSON.stringify({ token: TOKEN, action: "fly", "class": S.classCode, group: "Group " + S.group.number, pin: S.group.pin || "", fare: fare }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        S.flying = false;
        if (j && j.challenge) setChallenge(j.challenge);
        if (!j || !j.ok) S.flyError = (j && j.error) || "no answer from the class record";
        renderChallenge();
      })
      .catch(function (err) { S.flying = false; S.flyError = "Could not reach the class record (" + String(err && err.message || err) + "). Check the wifi and try again."; renderChallenge(); });
  }
  function demandOf(ch) { return ch && ch.demand && ch.told ? { a: ch.demand.a, b: ch.demand.b, mc: ch.told.mc, seats: ch.told.seats } : null; }
  // The briefing. The route is new, so the airline knows only the trial flights' average: one point, nothing about
  // the slope (older scripts also sent a fare range as t.history; it is ignored). The empty seats tempt a fare cut.
  var AIRLINE = "WeezyJet";
  function numWord(n) { return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] || fmt(n); }
  // "London–Anchorage" -> "between London and Anchorage"; any other label -> "on the ... route".
  function routePhrase(label) {
    label = String(label || "London–Anchorage");
    var parts = label.split(/\s*[–—-]\s*/);
    return parts.length === 2 && parts[0] && parts[1] ? 'between <b>' + esc(parts[0]) + ' and ' + esc(parts[1]) + '</b>' : 'on the <b>' + esc(label) + '</b> route';
  }
  function para(lead, body) { return '<p style="margin:0 0 8px"><b>' + lead + '</b> ' + body + '</p>'; }
  // nroutes: how many routes the class runs; with more than one, the group competes on its own route only.
  function briefing(t, nroutes) {
    var sq = (t.p0 - t.mc) * t.q0, empty = t.seats - t.q0, pct = Math.round(100 * empty / t.seats);
    var nf = numWord(t.flights) + (t.flights === 1 ? " flight" : " flights");
    return '<div class="briefing">' +
      para("The contest.", AIRLINE + ' has just opened the only direct flight ' + routePhrase(t.label) + '. The route is new and the airline isn\'t sure its fare is right, so it has invited consulting teams to compete for the pricing contract. ' +
           'Each team prices ' + nf + ', and the team whose fares make the most money wins.' +
           (nroutes > 1 ? ' Your class is split across ' + numWord(nroutes) + ' routes: you compete only with the teams pricing <b>' + esc(t.label) + '</b>, and the other routes have different numbers.' : '')) +
      para("What the airline knows.", 'Very little, because the route is new. So far it has run a few trial flights. A flight carried on average <b>' + fmt(t.q0) + ' passengers at ' + money(t.p0) + '</b>, ' +
           'so about <b>' + fmt(empty) + ' of the ' + fmt(t.seats) + ' seats flew empty</b> on every flight. Each passenger costs the airline <b>' + money(t.mc) + '</b> (fuel, catering, airport fees). ' +
           'The aircraft and the crew cost the same however many fly. At ' + money(t.p0) + ' a flight made ' + money(sq) + ' after passenger costs.') +
      para("Your brief.", 'You set the fare for each of the next <b>' + nf + '</b>, one at a time. After each flight you see how many passengers flew and what the flight made. ' +
           'Demand is steady: how many people want to fly depends only on the fare, the same way on every flight. Every flight counts. ' +
           'Your score is what your ' + nf + ' make minus what the trial fare of ' + money(t.p0) + ' would have made (' + money(sq) + ' a flight). ' +
           'The trial flights are all the airline can tell you. Anything more you learn about demand, you learn from your own flights.') +
      '<div class="metrics">' + metric("Cost per passenger", t.mc, { money: true }) + metric("Plane's capacity", t.seats, { sub: "seats; about " + fmt(empty) + " flew empty (" + pct + "%)" }) +
      metric("Trial fare", t.p0, { money: true, sub: "what the trial flights charged" }) +
      metric("Passengers per trial flight", t.q0, { sub: "on average; " + money(sq) + " a flight after passenger costs" }) + '</div></div>';
  }
  function flightsTable(flights, t, d) {
    if (!flights || !flights.length) return '<p class="caption">No flights yet.</p>';
    // The group's most profitable flight is marked only once the demand is revealed (d given): during the round a
    // green fare reads as "this is the best fare", which the group must not be told.
    var bestF = null; if (d) flights.forEach(function (f) { if (!bestF || f.profit > bestF.profit) bestF = f; });
    var h = '<div class="wide"><table class="grid flights"><thead><tr><th>Flight</th><th class="num">Fare</th><th class="num">Passengers</th><th class="num opt">Revenue</th><th class="num opt">Cost</th><th class="num">Profit</th><th class="num">Against the trial fare</th>' + (d ? '<th class="num">Off the best fare</th>' : "") + '</tr></thead><tbody>';
    var total = 0;
    flights.forEach(function (f) {
      total += f.gain;
      h += '<tr><td>' + f.n + '</td><td class="num' + (f === bestF && flights.length > 1 ? " best" : "") + '">' + money(f.fare) + '</td><td class="num">' + fmt(f.passengers) + (f.passengers >= t.seats ? ' <span class="caption">(full)</span>' : "") + '</td>' +
           '<td class="num opt">' + money(f.fare * f.passengers) + '</td><td class="num opt">' + money(t.mc * f.passengers) + '</td><td class="num">' + money(f.profit) + '</td><td class="num">' + money(f.gain, 0, true) + '</td>' +
           (d ? '<td class="num">' + money(f.fare - C.bestFare(d).fare, 0, true) + '</td>' : "") + '</tr>';
    });
    h += '<tr><td><b>Total</b></td><td></td><td></td><td class="opt"></td><td class="opt"></td><td></td><td class="num"><b>' + money(total, 0, true) + '</b></td>' + (d ? "<td></td>" : "") + '</tr></tbody></table></div>';
    return h;
  }
  // v: {board, told} (the challenge itself, or one route of the class view); compact: short headings, for the
  // boards side by side.
  function boardTable(v, phase, compact) {
    var b = v.board || [];
    if (!b.length) return '<p class="caption">No flights flown yet ' + (compact ? 'on this route.' : 'in class ' + esc(S.classCode) + '.') + '</p>';
    var revealed = phase === "revealed" || phase === "round2", me = groupKey();
    var h = '<table class="grid board"><thead><tr><th class="rank">#</th><th>Group</th><th class="num">Flights</th><th class="num">' + (compact ? 'Score' : 'Score: profit over the trial fare') + '</th>' + (revealed ? '<th>Fares</th>' : "") + '</tr></thead><tbody>';
    b.forEach(function (g, i) {
      h += '<tr' + (g.group === me ? ' class="me"' : "") + '><td class="rank">' + (i + 1) + '</td><td>' + esc(g.group) + '</td><td class="num">' + g.n + (v.told ? " / " + v.told.flights : "") + '</td><td class="num">' + money(g.gain, 0, true) + '</td>' +
           (revealed ? '<td class="num-note">' + (g.fares || []).map(function (f) { return money(f); }).join(", ") + '</td>' : "") + '</tr>';
    });
    return h + '</tbody></table>';
  }
  function boardTitle(ch) { return "Leaderboard" + (ch.nroutes > 1 && ch.told ? ": " + esc(ch.told.label) : ""); }
  function demandChartHtml(t, d, best, h) {
    var choke = C.chokePrice(d);
    return C.chart({ title: "The demand", h: h, x: { max: Math.max(d.a, t.seats) * 1.05, label: "Passengers who want to fly" }, y: { max: choke * 1.05, label: "Fare (£)" },
                     lines: [{ pts: [[0, choke], [d.a, 0]], color: C.COLORS.red, width: 2.5, name: "Demand: Q = " + fmt(d.a) + " − " + d.b + " × fare" }],
                     hlines: [{ y: t.mc, label: "cost per passenger", color: C.COLORS.grey }], vlines: [{ x: t.seats, label: "capacity", color: C.COLORS.orange }],
                     markers: [{ x: t.q0, y: t.p0, color: C.COLORS.grey, hollow: true, name: "The trial fare" }, { x: best.passengers, y: best.fare, color: C.COLORS.green, name: "Best fare", label: money(best.fare) + " / " + fmt(best.passengers) }] });
  }
  function revealSection(ch) {
    var t = ch.told, d = demandOf(ch), best = C.bestFare(d), sq = C.statusQuoProfit(t), choke = C.chokePrice(d);
    var fillFare = C.fillFare(d), fillProfit = C.profitAt(d, fillFare);
    var mine = S.projector ? null : (ch.mine || []), all = [];
    (ch.board || []).forEach(function (g) { (g.fares || []).forEach(function (f) { all.push({ group: g.group, fare: f }); }); });
    var flightDots = mine ? mine.map(function (f) { return { fare: f.fare, profit: f.profit, name: "Your flights", title: "Flight " + f.n + ": " + money(f.fare) + ", " + fmt(f.passengers) + " passengers" }; })
                          : all.map(function (f) { return { fare: f.fare, profit: C.profitAt(d, f.fare), name: "Flights flown", title: f.group + ": " + money(f.fare) }; });
    var profitChart = C.profitChartHtml(d, { fare: t.p0, profit: sq }, flightDots, { r: mine ? undefined : 4 });
    var demandChart = demandChartHtml(t, d, best, 360);
    var step = [50, 40, 20, 10].filter(function (x) { return Math.abs(d.b * x - Math.round(d.b * x)) < 1e-9; })[0] || 50;   // whole passengers lost
    var h = '<h2>The demand you were facing</h2>' +
      '<p class="reveal-line">At a fare of £P, <b>' + fmt(d.a) + ' − ' + d.b + ' × P</b> people want to fly: nobody above <b>' + money(choke) + '</b>, and every £1 on the fare loses <b>' + d.b + '</b> passengers (£10 loses ' + fmt(10 * d.b, Math.abs(10 * d.b - Math.round(10 * d.b)) < 1e-9 ? 0 : 1) + '). ' +
      'The trial fare of ' + money(t.p0) + ' with its ' + fmt(t.q0) + ' passengers is on that line.</p>' +
      '<p class="reveal-line">The best fare is <b>' + money(best.fare) + '</b>: ' + fmt(best.passengers) + ' passengers' + (best.capped ? " (every seat)" : "") + ' and a profit of <b>' + money(best.profit) + '</b> per flight, ' + money(best.profit - sq) + ' more than the trial fare earned, ' +
      money((best.profit - sq) * t.flights) + ' over ' + t.flights + ' flights. Filling the plane takes a fare of ' + money(fillFare) + ' and earns ' + money(fillProfit) + ', ' + money(sq - fillProfit) + ' less than the trial fare. ' +
      'A fare ' + money(step) + ' either side of the best costs ' + money(best.profit - C.profitAt(d, best.fare + step)) + ' a flight.</p>';
    if (mine && mine.length) {
      var first = mine[0], ln = C.lineThrough(t.p0, t.q0, first.fare, first.passengers);
      var dec = function (x, d) { return Number(x.toFixed(d)).toLocaleString("en-GB", { maximumFractionDigits: d }); };
      if (ln) h += '<p class="reveal-line">Your first flight, ' + money(first.fare) + ' with ' + fmt(first.passengers) + ' passengers, together with the trial flights\' average (' + money(t.p0) + ', ' + fmt(t.q0) + ') gives the line Q = ' + dec(ln.a, 1) + ' − ' + dec(ln.b, 3) + ' × P' +
                   (Math.abs(ln.a - d.a) < 1 && Math.abs(ln.b - d.b) < 0.01 ? ': the demand itself. Two points were enough.' : '.') + '</p>';
    }
    h += '<div class="cols"><div>' + profitChart + '</div><div>' + demandChart + '</div></div>';
    if (mine) h += '<h2>Your flights</h2>' + flightsTable(mine, t, d);
    h += '<h2>' + boardTitle(ch) + '</h2>' + boardTable(ch, ch.phase);
    if (!S.projector) h += '<div id="challenge-pin-wrap"></div>';
    return h;
  }
  // ---- the class as a whole, when it runs several routes: for the projector and for a page with no group yet.
  // The contest, a table of the routes and a board per route; at the reveal each route's demand, best fare and
  // profit curve with its flights, then every team by its share of the gain its route allowed.
  function routesTable(R) {
    return '<div class="wide"><table class="grid routes"><thead><tr><th>Route</th><th class="num">Cost per passenger</th><th class="num">Plane\'s capacity</th><th class="num">Trial fare</th><th class="num">Passengers per trial flight</th><th class="num">Seats empty</th><th class="num">A trial flight made</th></tr></thead><tbody>' +
      R.map(function (v) { var t = v.told; return '<tr><td>' + esc(t.label) + '</td><td class="num">' + money(t.mc) + '</td><td class="num">' + fmt(t.seats) + '</td><td class="num">' + money(t.p0) + '</td><td class="num">' + fmt(t.q0) + '</td><td class="num">' + fmt(t.seats - t.q0) + '</td><td class="num">' + money((t.p0 - t.mc) * t.q0) + '</td></tr>'; }).join("") +
      '</tbody></table></div>';
  }
  function classBriefing(ch) {
    var R = ch.routes, fl = R[0].told.flights, nf = numWord(fl) + (fl === 1 ? " flight" : " flights");
    return '<div class="briefing">' +
      para("The contest.", AIRLINE + ' has just opened ' + numWord(R.length) + ' new routes, each the only direct flight between its two cities. The routes are new and the airline isn\'t sure its fares are right, so it has invited consulting teams to compete for the pricing contracts. ' +
           'Each team is given one route and prices ' + nf + ' on it. On each route, the team whose fares make the most money wins.') +
      para("What the airline knows.", 'Very little, because the routes are new. So far it has run a few trial flights on each route. The table shows what a trial flight carried on average, how many seats flew empty and what the flight made after passenger costs. ' +
           'Each passenger costs the airline the amount shown (fuel, catering, airport fees). The aircraft and the crew cost the same however many fly.') +
      routesTable(R) +
      '<p style="margin:10px 0 0"><b>Your brief.</b> You set the fare for each of your ' + nf + ', one at a time. After each flight you see how many passengers flew and what the flight made. ' +
      'Demand is steady: on each route, how many people want to fly depends only on the fare, the same way on every flight. Every flight counts. ' +
      'Your score is what your ' + nf + ' make minus what the trial fare would have made. The trial flights are all the airline can tell you. Anything more you learn about demand, you learn from your own flights.</p></div>';
  }
  function routeReveal(v) {
    var t = v.told, d = demandOf(v), best = C.bestFare(d), sq = C.statusQuoProfit(t), fill = C.fillFare(d), dots = [];
    (v.board || []).forEach(function (g) { (g.fares || []).forEach(function (f) { dots.push({ fare: f, profit: C.profitAt(d, f), name: "Flights flown", title: g.group + ": " + money(f) }); }); });
    return '<p class="reveal-line">At a fare of £P, <b>' + fmt(d.a) + ' − ' + d.b + ' × P</b> people want to fly; nobody above ' + money(C.chokePrice(d)) + '.</p>' +
      '<p class="reveal-line">Best fare <b>' + money(best.fare) + '</b>: ' + fmt(best.passengers) + ' passengers' + (best.capped ? " (every seat)" : "") + ' and <b>' + money(best.profit) + '</b> a flight, ' + money(best.profit - sq) + ' more than the trial fare of ' + money(t.p0) + '. ' +
      'Filling the plane takes ' + money(fill) + ' and makes ' + money(C.profitAt(d, fill)) + '.</p>' +
      C.profitChartHtml(d, { fare: t.p0, profit: sq }, dots, { r: 4, h: 300 }) + demandChartHtml(t, d, best, 280);
  }
  function overallTable(ch) {
    var rows = [], fl = ch.routes[0].told.flights;
    ch.routes.forEach(function (v) {
      var d = demandOf(v); if (!d) return;
      var possible = (C.bestFare(d).profit - C.statusQuoProfit(v.told)) * v.told.flights;
      (v.board || []).forEach(function (g) { rows.push({ group: g.group, label: v.told.label, gain: g.gain, possible: possible, share: possible > 0 ? g.gain / possible : 0 }); });
    });
    if (!rows.length) return "";
    rows.sort(function (x, y) { return y.share - x.share || x.group.localeCompare(y.group, undefined, { numeric: true }); });
    return '<h2>Every team: share of the gain its route allowed</h2><p class="caption">A team\'s score as a share of what the best fare on all ' + numWord(fl) + ' flights would have scored on its route.</p>' +
      '<div class="wide"><table class="grid board overall"><thead><tr><th class="rank">#</th><th>Group</th><th>Route</th><th class="num">Score</th><th class="num">Best possible</th><th class="num">Share</th></tr></thead><tbody>' +
      rows.map(function (r, i) { return '<tr><td class="rank">' + (i + 1) + '</td><td>' + esc(r.group) + '</td><td>' + esc(r.label) + '</td><td class="num">' + money(r.gain, 0, true) + '</td><td class="num">' + money(r.possible) + '</td><td class="num">' + fmt(100 * r.share) + '%</td></tr>'; }).join("") +
      '</tbody></table></div>';
  }
  function classSection(ch) {
    var R = ch.routes, revealed = ch.phase === "revealed" || ch.phase === "round2", h = classBriefing(ch);
    if (!S.projector) h += '<div class="info">' + (S.group ? 'The page could not confirm your group\'s PIN, so it cannot show your route. Use Change at the top of the page to enter it again.'
                                                           : 'Enter your group number at the top of the page to see your route and its briefing.') + '</div>';
    if (ch.phase === "setup") h += '<div class="info">Round 1 has not opened yet. Read the briefing and agree how you will choose your fares.</div>';
    if (ch.phase === "closed") h += '<div class="info">Round 1 is closed. The demand is revealed next.</div>';
    if (ch.phase === "open" || ch.phase === "closed")
      h += '<h2>Leaderboards</h2><div class="routes-grid">' + R.map(function (v) { return '<div class="route-card"><h3>' + esc(v.told.label) + '</h3>' + boardTable(v, ch.phase, true) + '</div>'; }).join("") + '</div>';
    if (revealed)
      h += '<h2>The demands the teams were facing</h2><div class="routes-grid">' +
           R.map(function (v) { return '<div class="route-card"><h3>' + esc(v.told.label) + '</h3>' + routeReveal(v) + '<h4>Leaderboard</h4>' + boardTable(v, ch.phase, true) + '</div>'; }).join("") + '</div>' + overallTable(ch);
    return h;
  }
  function round2Section(ch) {
    var t = ch.told, d = demandOf(ch), sc = SCENARIOS.filter(function (s) { return s[0] === S.round2.scenario; })[0] || SCENARIOS[0];
    var dd = { a: d.a, b: d.b, mc: d.mc, seats: d.seats, scale: sc[2] }, trials = S.round2.trials[sc[0]] || [];
    var h = '<h2>Round 2: the market changes</h2><p class="caption">Two scenarios on the demand you now know, with the same ' + fmt(t.seats) + ' seats and ' + money(t.mc) + ' per passenger. Test any fares you like (nothing is scored), then pin the fare you recommend and say why in the lab book.</p>' +
      '<div class="scenarios">' + SCENARIOS.map(function (s) { return '<button type="button" data-scenario="' + s[0] + '" class="' + (s[0] === sc[0] ? "active" : "") + '">' + esc(s[1]) + '</button>'; }).join("") + '</div>' +
      '<p>' + (sc[0] === "up" ? 'At every fare, <b>40% more</b> people want to fly than in round 1.' : 'At every fare, <b>twice as many</b> people want to fly as in round 1.') +
      ' The plane still has ' + fmt(t.seats) + ' seats: nobody beyond that can be carried.</p>' +
      '<form id="r2-form" class="fare-form"><div><label for="r2-fare">Fare to test (£)</label><input type="number" id="r2-fare" min="0" step="1" inputmode="numeric" value="' + esc(S.round2.fare[sc[0]] || "") + '"></div><div><button type="submit" class="primary" style="width:100%">Test this fare</button></div></form>';
    if (trials.length) {
      h += '<table class="grid flights" style="margin-top:10px"><thead><tr><th class="num">Fare</th><th class="num">Want to fly</th><th class="num">Carried</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th></tr></thead><tbody>' +
        trials.map(function (r) { return '<tr><td class="num">' + money(r.fare) + '</td><td class="num">' + fmt(r.want) + '</td><td class="num">' + fmt(r.carried) + (r.carried >= t.seats ? ' <span class="caption">(full)</span>' : "") + '</td><td class="num">' + money(r.fare * r.carried) + '</td><td class="num">' + money(t.mc * r.carried) + '</td><td class="num">' + money(r.profit) + '</td></tr>'; }).join("") +
        '</tbody></table><div class="row" style="margin-top:6px"><button type="button" class="small" id="r2-clear">Clear these tests</button></div>';
    }
    h += '<div id="challenge-pin-wrap"></div>';
    void dd;
    return h;
  }
  function renderChallenge() {
    var el = $("tab-challenge"), ch = S.challenge, fareEl = $("fare"), typed = fareEl ? { v: fareEl.value, f: document.activeElement === fareEl } : null;
    var h = "";
    if (!S.classCode || S.classInvalid) h = '<div class="info">The challenge runs in class, under your class\'s link.</div>';
    else if (!ENDPOINT) h = '<div class="info">Offline copy: the challenge needs the class record.</div>';
    else if (!ch) h = '<p class="caption">Reading the challenge…</p>';
    else if (!ch.told && !(ch.routes && ch.routes.length)) h = '<div class="info">The challenge is not set up for class ' + esc(S.classCode) + ' yet. The instructor opens it in class.</div>';
    else if (!ch.told) h += '<h2 style="margin-top:4px">The pricing challenge <span class="phase ' + esc(ch.phase) + '">' + esc(PHASE_LABEL[ch.phase] || ch.phase) + '</span></h2>' + classSection(ch);
    else {
      var t = ch.told, badge = '<span class="phase ' + esc(ch.phase) + '">' + esc(PHASE_LABEL[ch.phase] || ch.phase) + '</span>';
      h += '<h2 style="margin-top:4px">The pricing challenge ' + badge + '</h2>' + briefing(t, ch.nroutes || 1);
      if (ch.phase === "setup") h += '<div class="info">Round 1 has not opened yet. Read the briefing and agree how you will choose your fares.</div>';
      if (ch.phase === "open" && !S.projector) {
        if (!S.group) h += '<div class="info">Enter your group number at the top of the page to fly.</div>';
        else {
          var mine = ch.mine || [], left = t.flights - mine.length;
          if (left > 0) {
            h += '<div class="panel"><form id="fare-form" class="fare-form"><div><label for="fare">Fare for flight ' + (mine.length + 1) + ' of ' + t.flights + ' (£, whole pounds)</label><input type="number" id="fare" min="0" step="1" inputmode="numeric" placeholder="' + t.p0 + '"' + (S.flying ? " disabled" : "") + '></div>' +
                 '<div><button type="submit" class="primary" id="fly" style="width:100%"' + (S.flying ? " disabled" : "") + '>' + (S.flying ? "Flying…" : "Fly") + '</button></div></form>' +
                 (S.flyError ? '<div class="error">' + esc(S.flyError) + '</div>' : "") + '</div>';
          } else h += '<div class="success">All ' + t.flights + ' flights flown. Wait for the instructor to close the round and reveal the demand.</div>';
          h += '<h2>Your flights</h2>' + flightsTable(mine, t, null);
        }
        h += '<details class="panel" open><summary>' + boardTitle(ch) + '</summary>' + boardTable(ch, ch.phase) + '</details>';
      }
      if (ch.phase === "open" && S.projector) h += '<h2>Leaderboard</h2>' + boardTable(ch, ch.phase);
      if (ch.phase === "closed") {
        h += '<div class="info">Round 1 is closed. The demand is revealed next.</div>';
        if (!S.projector && S.group) h += '<h2>Your flights</h2>' + flightsTable(ch.mine || [], t, null);
        h += '<h2>' + boardTitle(ch) + '</h2>' + boardTable(ch, ch.phase);
      }
      if (ch.phase === "revealed" || ch.phase === "round2") {
        if (ch.phase === "round2" && !S.projector) h += round2Section(ch) + '<details class="panel"><summary>Round 1: the reveal and the leaderboard</summary>' + revealSection(ch).replace('<div id="challenge-pin-wrap"></div>', "") + '</details>';
        else h += revealSection(ch);
      }
    }
    el.innerHTML = h;
    if (ch && ch.told && !S.projector) bindChallenge(ch);
    if ($("fare") && typed) { $("fare").value = typed.v; if (typed.f) $("fare").focus(); }
  }
  function bindChallenge(ch) {
    var t = ch.told, d = demandOf(ch);
    if ($("fare-form")) $("fare-form").onsubmit = function (ev) {
      ev.preventDefault();
      var v = parseFloat($("fare").value);
      if (isNaN(v) || v < 0) { S.flyError = "Type the fare in pounds."; renderChallenge(); return; }
      fly(Math.round(v));
    };
    Array.prototype.forEach.call(document.querySelectorAll("#tab-challenge .scenarios button"), function (b) { b.onclick = function () { S.round2.scenario = b.getAttribute("data-scenario"); saveLocal(); renderChallenge(); }; });
    if ($("r2-form")) $("r2-form").onsubmit = function (ev) {
      ev.preventDefault();
      var sc = SCENARIOS.filter(function (s) { return s[0] === S.round2.scenario; })[0], v = Math.round(parseFloat($("r2-fare").value));
      if (isNaN(v) || v < 0) return;
      var dd = { a: d.a, b: d.b, mc: d.mc, seats: d.seats, scale: sc[2] }, want = Math.max(0, Math.round(sc[2] * (d.a - d.b * v))), carried = C.passengersAt(dd, v);
      S.round2.trials[sc[0]].push({ fare: v, want: want, carried: carried, profit: (v - d.mc) * carried }); S.round2.fare[sc[0]] = String(v);
      saveLocal(); renderChallenge();
    };
    if ($("r2-clear")) $("r2-clear").onclick = function () { S.round2.trials[S.round2.scenario] = []; saveLocal(); renderChallenge(); };
    if ($("challenge-pin-wrap")) {
      var sc2 = SCENARIOS.filter(function (s) { return s[0] === S.round2.scenario; })[0], isR2 = ch.phase === "round2", qid = isR2 ? (sc2[0] === "up" ? "c2" : "c3") : "c1";
      var trials = S.round2.trials[sc2[0]] || [], last = trials[trials.length - 1];
      var suggestion = isR2 ? (last ? sc2[1] + ": fare " + money(last.fare) : sc2[1]) : "Round 1: my flights";
      pinPanel("challenge", suggestion, qid);
      $("challenge-pin").onclick = function () {
        var measures, state;
        if (isR2) {
          if (!last) { S.pinMsg.challenge = "Test a fare first; the pin records the last fare you tested."; pinPanel("challenge", suggestion, qid); return; }
          measures = { "Route": t.label, "Scenario": sc2[1], "Fare": last.fare, "Want to fly": last.want, "Carried": last.carried, "Plane full": last.carried >= t.seats ? "yes" : "no", "Revenue": last.fare * last.carried, "Cost": t.mc * last.carried, "Profit": last.profit };
          state = { page: "challenge", round: 2, scenario: sc2[0], fare: last.fare, told: t, demand: ch.demand };
        } else {
          var mine = ch.mine || [], bestF = null, total = 0; mine.forEach(function (f) { total += f.gain; if (!bestF || f.profit > bestF.profit) bestF = f; });
          var best = C.bestFare(d), sq = C.statusQuoProfit(t);
          measures = { "Route": t.label, "Scenario": "Round 1", "Flights flown": mine.length, "Best fare flown": bestF ? bestF.fare : null, "Passengers at it": bestF ? bestF.passengers : null, "Profit at it": bestF ? bestF.profit : null,
                       "Score: profit over the trial fare": total, "Best possible fare": best.fare, "Profit at the best fare": best.profit, "Possible score": (best.profit - sq) * t.flights };
          state = { page: "challenge", round: 1, flights: mine, told: t, demand: ch.demand };
        }
        doPin("challenge", suggestion, measures, state); pinPanel("challenge", suggestion, qid);
      };
    }
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
    el.innerHTML = '<p class="caption" style="margin:0 0 6px">Price ' + esc(DATA.item || "Mocha") + ' on real data: each bid is the most one student said they would pay in Session 1. At a price, everyone whose bid is at least the price buys.</p>' +
      '<div class="cols-5-7"><div>' +
      '<details class="panel" open><summary>Data and cost</summary>' +
      '<label for="mo-data">Bids</label><select id="mo-data"></select>' +
      '<label for="mo-cost">Cost per ' + esc(DATA.item || "Mocha") + ' (£)</label><input type="number" id="mo-cost" step="1" min="0">' +
      '<label style="margin-top:10px">Bids to ignore</label><div class="radio"><label><input type="checkbox" id="mo-zero"> Bids of £0</label></div>' +
      '<div class="row"><label for="mo-above" style="margin:0">Bids above £</label><input type="number" id="mo-above" step="1" min="0" placeholder="none" style="width:110px"></div></details>' +
      '<details class="panel" open><summary>Your price</summary><label for="mo-price">Price (£)</label><input type="number" id="mo-price" step="1" min="0" style="font-size:1.3rem">' +
      '<div class="radio" style="margin-top:8px"><label><input type="checkbox" id="mo-line"> Show the straight line fitted to the bids (and the price MR = MC gives on it)</label></div></details>' +
      '</div><div id="mo-results"></div></div><div id="mocha-pin-wrap"></div>';
    $("mo-data").onchange = function () { S.mocha.dataset = this.value; S.mocha.price = ""; renderMocha(); };
    ["mo-cost", "mo-above", "mo-price"].forEach(function (id) { $(id).addEventListener("change", readMocha); });
    $("mo-zero").addEventListener("change", readMocha); $("mo-line").addEventListener("change", readMocha);
    el.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t.getAttribute && t.getAttribute("data-inner")) { S.mocha.inner = t.getAttribute("data-inner"); renderMocha(); }
      else if (t.id === "mo-fourth") { S.mocha.fourth = t.checked; renderMocha(); }
      else if (t.id === "mocha-pin") pinMocha();
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
    var segInfo = null;
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
    } else { segInfo = segmentsPanel(r); h += segInfo.html; }
    el.innerHTML = h;
    S.mochaLast = { r: r, seg: segInfo };
    pinPanel("mocha", r.ds.label.replace(/ \(.*$/, "") + ": price " + money(r.price), "m1");
    saveLocal();
  }
  function pinMocha() {
    var L = S.mochaLast; if (!L) return;
    var r = L.r, m = S.mocha, suggestion = $("mocha-pin-label").placeholder;
    var measures = { "Bids": r.ds.label, "Cost per unit": r.mc, "Bids ignored": cleaningText(m), "Bids counted": r.bids.length, "Price": r.price, "Buyers": r.buyers, "Revenue": r.price * r.buyers, "Profit": r.profit,
                     "Best price on these bids": r.best.price, "Buyers at the best price": r.best.buyers, "Profit at the best price": r.best.profit };
    if (m.showLine && r.line && r.lp) { measures["Fitted line"] = "P = " + fmt(r.line.a, 2) + " − " + fmt(r.line.b, 3) + " Q"; measures["The line's price"] = C.round(r.lp.price, 2); measures["Buyers at the line's price"] = r.lp.buyers; measures["Profit at the line's price"] = C.round(r.lp.profit, 2); }
    if (L.seg) { measures["Markets"] = L.seg.names.join("; "); measures["One price for all"] = L.seg.seg.uniform.price; measures["Profit at one price"] = L.seg.seg.uniform.profit; measures["Profit with a price per market"] = L.seg.seg.total; measures["Gain from separate prices"] = L.seg.seg.gain; }
    doPin("mocha", suggestion, measures, { page: "mocha", dataset: r.ds.key, cost: r.mc, dropZero: !!m.dropZero, above: m.above, price: r.price, showLine: !!m.showLine, inner: m.inner, fourth: !!m.fourth });
    pinPanel("mocha", suggestion, "m1");
  }

  // ---- Lab book --------------------------------------------------------------------------------------------------
  var saveAnswers = debounce(function () {
    var changed = {};
    Object.keys(S.answersDirty).forEach(function (k) { changed[k] = S.answers[k] || ""; });
    S.answersDirty = {};
    if (Object.keys(changed).length) enqueue(record("Assignment answers", "", { answers: changed, labbook: { id: "answers", kind: "answers" } }));
  }, 1200);
  function renderBook() {
    var el = $("tab-book"); if (!el) return;
    var who = S.group ? groupKey() + (groupNames() ? " · " + groupNames() : "") : (S.projector ? "the projector" : "");
    var h = '<p><b>Lab book' + (who ? " of " + esc(who) : "") + '</b></p>' +
            '<p class="caption">One section per question: what you pinned for it and your answer. Pin from the Challenge or Mocha tab, choosing the section as you pin; the ✕ on a column removes it. Everything is saved as you go.</p>';
    if (!canPin()) h += '<div class="info">Enter your group number at the top of the page to pin and write answers.</div>';
    PQUESTIONS.forEach(function (q) {
      var mine = S.book.filter(function (e) { return psectionOf(e) === q.id; }), answered = (S.answers[q.id] || "").trim().length > 0;
      h += '<section class="qsection" data-q="' + q.id + '"><h2>' + esc(q.title) + ' <span class="badge">' + mine.length + ' pinned' + (answered ? " · answered" : "") + '</span></h2>' +
           '<details class="prompt"' + (mine.length || answered ? "" : " open") + '><summary>' + (q.id === "own" ? "About this section" : "The question") + '</summary><p>' + esc(q.prompt) + '</p></details>';
      h += mine.length ? C.bookTable(mine, { removable: true }) : '<p class="caption">Nothing pinned here yet.</p>';
      if (!S.projector) h += '<label for="ans-' + q.id + '">' + (q.id === "own" ? "What you learned from your own experiments" : "Your answer") + '</label>' +
           '<textarea id="ans-' + q.id + '" data-q="' + q.id + '" style="min-height:120px" placeholder="What you see in the table above, then the reasoning."' + (S.group ? "" : " disabled") + '>' + esc(S.answers[q.id] || "") + '</textarea>';
      h += '</section>';
    });
    if (!S.projector) h += '<label for="book-notes">Notes for the debrief</label><textarea id="book-notes" placeholder="What surprised you? What would you ask the class? (Click outside the box to save.)"' + (S.group ? "" : " disabled") + '>' + esc(S.notes) + '</textarea>';
    h += '<div id="book-status" class="status"></div>';
    el.innerHTML = h;
    el.querySelectorAll(".remove-entry").forEach(function (btn) {
      var id = btn.getAttribute("data-id"), e = S.book.filter(function (x) { return x.id === id; })[0];
      btn.onclick = function () {
        if (!e || !window.confirm("Remove '" + e.label + "' from your lab book?")) return;
        S.book = S.book.filter(function (x) { return x.id !== id; }); saveLocal(); enqueue(entryRecord(e, true)); renderBook();
      };
    });
    el.querySelectorAll("textarea[data-q]").forEach(function (ta) {
      var upd = function () { var k = ta.getAttribute("data-q"); if (S.answers[k] === ta.value) return; S.answers[k] = ta.value; S.answersDirty[k] = true; saveLocal(); saveAnswers(); };
      ta.addEventListener("input", upd); ta.addEventListener("change", upd);
    });
    if ($("book-notes")) $("book-notes").addEventListener("change", function () { S.notes = $("book-notes").value; saveLocal(); enqueue(record("Notes for the debrief", S.notes, { labbook: { id: "notes", kind: "notes" } })); renderStatus(); });
    renderStatus();
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
    renderGroup(); renderChallenge(); renderMocha(); renderBook();
    Array.prototype.forEach.call($("main-tabs").querySelectorAll("button"), function (b) { b.onclick = function () { showTab(b.getAttribute("data-tab")); }; });
    showTab(qs.get("tab") || S.tab || "challenge");
    renderStatus(); flush();
    if (S.group && !S.projector) syncFromRecord(true); else loadChallenge(true);
    setInterval(flush, 30000);
  }
  document.addEventListener("DOMContentLoaded", init);
  window.PricingLabApp = { state: S, render: renderChallenge };
})();
