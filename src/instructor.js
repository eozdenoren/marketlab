/* Marketplace Laboratory instructor page: the groups' lab books read straight from the class record (the Apps Script
   endpoint), with no server of its own. Sign in with the instructor password (or the admin token); the credential is
   sent to the script with every request and is kept in this browser only. Three views (Overview, By experiment, One
   group) and a set-up panel (class link and QR code, new classes, registered groups, the projector button). Depends on
   MarketLab (engine.js), MLBook (book.js), MLQR (qr.js) and the questions in questions.js. */
(function () {
  "use strict";
  var M = MarketLab, B = MLBook, esc = B.esc, fmt = B.fmt;
  var CONFIG = window.MARKETLAB_CONFIG || {};
  var ENDPOINT = (CONFIG.endpoint || "").trim();
  // the students' page: the configured address, else this page's own folder
  var APP_URL = (CONFIG.app_url || "").replace(/\/+$/, "") || location.href.replace(/[?#].*$/, "").replace(/\/[^\/]*$/, "");
  var CRED_KEY = "marketlab:instructor:cred", CLASS_KEY = "marketlab:instructor:class";
  var NO_CLASS = "(no class code)";
  var VIEWS = ["overview", "experiment", "group"];
  var DEFAULT_STATE = { page: "lab", supply: [["North", 100, 0, 100]], demand: [["West", 100, 0, 100]], policy: {} };

  var S = { cred: "", records: null, books: {}, created: {}, classes: [], cls: "", view: "overview", q: QUESTIONS[0].title, group: "",
            groups: {}, verified: {}, readAt: null, busy: false, error: "" };

  // ---- utilities ---------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function fmtTime(ts, withDate) {
    if (!ts) return "";
    var o = withDate === false ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
    o.timeZone = "Europe/London"; o.hour12 = false;
    return new Date(ts * 1000).toLocaleString("en-GB", o).replace(",", "");
  }
  function lastSaved(ts) {      // the time alone for today, with the date otherwise, so that an older group does not look more recent
    return fmtTime(ts).slice(0, 6) === fmtTime(Date.now() / 1000).slice(0, 6) ? fmtTime(ts, false) : fmtTime(ts);
  }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function csvCell(v) { var s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csv(rows) { return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n"; }
  function download(name, text, type) {
    var a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function b64url(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function classLink(cls) { return APP_URL + "/?class=" + encodeURIComponent(cls); }
  // the projector links: the class page with this market and these settings loaded, in projector mode (no group,
  // pins stay in that browser and nothing is sent to the class record)
  function projectorLink(state, cls) { return APP_URL + "/?class=" + encodeURIComponent(cls || "") + "&projector=1#state=" + b64url(state); }
  function cleanClassCode(text) { return String(text || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40); }
  function questionIndex(title) { for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].title === title) return i; return QUESTIONS.length - 1; }
  function ticks(n) { return n === 0 ? "" : (n <= 3 ? "✓".repeat(n) : "✓×" + n); }
  function selectOptions(values, current, labels) {
    return values.map(function (v, i) { return '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + '>' + esc(labels ? labels[i] : v) + '</option>'; }).join("");
  }

  // ---- the class record -------------------------------------------------------------
  function api(params) {
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(ENDPOINT + (ENDPOINT.indexOf("?") >= 0 ? "&" : "?") + qs).then(function (r) { return r.json(); });
  }
  function post(body) {
    return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function loadRecords(cb) {
    S.busy = true; renderTop();
    api({ token: S.cred }).then(function (j) {
      S.busy = false;
      if (!j || !j.ok) { cb(j && j.error ? j.error : "no answer from the class record"); return; }
      S.records = j.records || []; S.readAt = Date.now() / 1000; S.verified = {}; S.groups = {};
      Object.keys(S.created).forEach(function (code) {     // classes created in this session that the record may not show yet
        if (!S.records.some(function (f) { return ((f.state || {}).labbook || {}).kind === "class" && (f.state || {})["class"] === code; }))
          S.records.push(classRecord(code, S.created[code]));
      });
      rebuild(); cb(null);
    }).catch(function (err) { S.busy = false; cb(String(err && err.message || err)); });
  }
  function classRecord(code, ts) {
    return { ts: ts || Date.now() / 1000, group: "", question: "Class created", finding: code, state: { "class": code, labbook: { id: "class", kind: "class" } } };
  }

  // ---- lab books from the records (labbook.py: books_from_findings, known_classes, classes) ---------------------
  function booksFromFindings(findings) {
    var books = {};
    findings.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); }).forEach(function (f) {
      var state = f.state || {}, lbk = state.labbook;
      if (lbk && lbk.kind === "class") return;
      var cls = state["class"] || "", key = cls + "\u0000" + (f.group || "");
      var g = books[key];
      if (!g) g = books[key] = { "class": cls, group: f.group || "", names: "", entries: {}, order: [], notes: "", answers: {}, last: 0, other: [] };
      g.last = Math.max(g.last, f.ts || 0);
      if (state.names) g.names = state.names;
      if (!lbk) { g.other.push(f); return; }
      if (lbk.kind === "notes") { g.notes = f.finding || ""; return; }
      if (lbk.kind === "answers") { g.answers = state.answers || {}; return; }
      if (lbk.deleted) { delete g.entries[lbk.id]; return; }
      var sw = {}; Object.keys(state).forEach(function (k) { if (k !== "labbook") sw[k] = state[k]; });
      if (!g.entries[lbk.id]) g.order.push(lbk.id);
      g.entries[lbk.id] = { id: lbk.id, ts: f.ts || 0, tab: lbk.tab || "lab", label: lbk.label || "", question: f.question || "", note: f.finding || "",
                            measures: lbk.measures || {}, baseline: lbk.baseline || {}, state: sw };
    });
    return books;
  }
  function entriesOf(bk) { return bk.order.filter(function (id) { return bk.entries[id]; }).map(function (id) { return bk.entries[id]; }); }
  function rebuild() {
    S.books = booksFromFindings(S.records);
    var last = {};
    S.records.forEach(function (f) {
      var st = f.state || {}; if ((st.labbook || {}).kind === "class" && st["class"]) last[st["class"]] = Math.max(last[st["class"]] || 0, f.ts || 0);
    });
    Object.keys(S.books).forEach(function (k) { var bk = S.books[k]; last[bk["class"]] = Math.max(last[bk["class"]] || 0, bk.last); });
    S.classes = Object.keys(last).sort(function (a, b) { return last[b] - last[a]; });
    if (S.classes.indexOf(S.cls) < 0) S.cls = S.classes.length ? S.classes[0] : "";
  }
  function booksOf(cls) {
    return Object.keys(S.books).map(function (k) { return S.books[k]; }).filter(function (bk) { return bk["class"] === cls; })
                 .sort(function (a, b) { return b.last - a.last; });
  }

  // ---- verification (verify.py): recompute a pinned column from its saved settings --------------------------------
  function fixRows(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var q = parseFloat(r[1]); if (!(q > 0)) return;
      var lo = parseFloat(r[2]); if (isNaN(lo)) lo = 0;
      var hi = parseFloat(r[3]); if (isNaN(hi)) hi = lo;
      out.push([String(r[0] || "").trim(), q, lo, hi]);
    });
    return out;
  }
  function expectedMeasures(state) {
    var market = M.buildMarket(fixRows(state.supply), fixRows(state.demand));
    var sides = market.regions.map(function (r) { return r.side; });
    if (sides.indexOf(M.SUPPLY) < 0 || sides.indexOf(M.DEMAND) < 0) throw new Error("no usable market rows");
    var pol = state.policy || {}, policy;
    if (state.page === "externality") {
      var cap = +pol.cap || 0;
      policy = M.defaultPolicy({ tax_supply: +pol.tax_supply || 0, tax_demand: +pol.tax_demand || 0, control: cap > 0 ? "quota" : "none", control_value: cap > 0 ? cap : null, rent_to: "government" });
      return M.measuresSocial(M.solveSocial(market, policy, +pol.harm || 0));
    }
    var regional = {};
    ["supply", "demand"].forEach(function (side) {
      Object.keys((pol.regional || {})[side] || {}).forEach(function (name) {
        var rp = pol.regional[side][name] || {};
        regional[name] = { scale: rp.scale != null ? +rp.scale : 1, shift: +rp.shift || 0, tax: +rp.tax || 0, cap: rp.cap ? +rp.cap : null };
      });
    });
    var control = pol.control || "none";
    policy = M.defaultPolicy({ cost_shock: +pol.cost_shock || 0, benefit_boost: +pol.benefit_boost || 0, tax_supply: +pol.tax_supply || 0, tax_demand: +pol.tax_demand || 0,
                               control: control, control_value: control !== "none" ? (+pol.control_value || 0) : null,
                               rationing: pol.rationing || "efficient", rent_to: pol.rent_to || "sellers", regional: regional });
    return M.measuresLab(M.solve(market, policy));
  }
  function close(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    a = +a; b = +b; if (isNaN(a) || isNaN(b)) return false;
    return Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));
  }
  // {ok: true | false | null (cannot be recomputed), bad: [measure names]}
  function verifyEntry(e) {
    if (S.verified[e.id]) return S.verified[e.id];
    var res;
    try {
      var exp = expectedMeasures(e.state || {}), got = e.measures || {};
      var bad = M.MEASURES.concat(M.extraMeasures([got])).filter(function (m) { return !close(got[m], exp[m]); });
      res = { ok: !bad.length, bad: bad };
    } catch (err) { res = { ok: null, bad: [] }; }
    S.verified[e.id] = res;
    return res;
  }
  function verifiedCounts(entries) {
    var c = { ok: 0, bad: 0, unknown: 0 };
    entries.forEach(function (e) { var v = verifyEntry(e); if (v.ok === true) c.ok++; else if (v.ok === false) c.bad++; else c.unknown++; });
    return c;
  }
  function mark(e) { var v = verifyEntry(e); return v.ok === true ? "✓" : (v.ok === false ? "✗" : "?"); }
  function markClass(e) { var v = verifyEntry(e); return v.ok === true ? "ok" : (v.ok === false ? "bad" : "unk"); }

  // ---- sign-in and the top bar ---------------------------------------------------------
  function storedCred() { try { return localStorage.getItem(CRED_KEY) || sessionStorage.getItem(CRED_KEY) || ""; } catch (e) { return ""; } }
  function storeCred(cred, remember) {
    try { sessionStorage.setItem(CRED_KEY, cred); if (remember) localStorage.setItem(CRED_KEY, cred); else localStorage.removeItem(CRED_KEY); } catch (e) {}
  }
  function clearCred() { try { sessionStorage.removeItem(CRED_KEY); localStorage.removeItem(CRED_KEY); } catch (e) {} }
  function renderSignin(error) {
    $("main").hidden = true; $("topbar").innerHTML = "";
    if (!ENDPOINT) {
      $("signin").innerHTML = '<div class="error">This copy of the instructor page has no class record endpoint. Build it with <code>python3 build.py --config config.json</code>.</div>';
      return;
    }
    $("signin").innerHTML = '<div class="panel"><form id="signin-form" class="signin">' +
      '<div><label for="pw">Instructor password</label><input type="password" id="pw" autocomplete="current-password" autofocus></div>' +
      '<div><label class="check"><input type="checkbox" id="remember"> Remember on this computer</label></div>' +
      '<div><button type="submit" class="primary" id="signin-btn" style="width:100%">Sign in</button></div></form>' +
      '<p class="caption">The password is checked by the class record, which answers only to it. Leave "Remember" unticked on a shared computer; ' +
      'Sign out at the top right forgets it.</p><div id="signin-error" class="error"' + (error ? "" : " hidden") + '>' + esc(error || "") + '</div></div>';
    $("signin-form").onsubmit = function (ev) {
      ev.preventDefault();
      var pw = $("pw").value, remember = $("remember").checked, btn = $("signin-btn"), errEl = $("signin-error");
      if (!pw) { errEl.textContent = "Please type the password."; errEl.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Checking…";
      S.cred = pw;
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
    $("refresh").onclick = function () { loadRecords(function (err) { S.error = err || ""; render(); }); };
    $("signout").onclick = function () { clearCred(); S.cred = ""; S.records = null; renderSignin(); };
  }
  function start() {
    $("signin").innerHTML = ""; $("main").hidden = false;
    try { var c = localStorage.getItem(CLASS_KEY); if (c != null && S.classes.indexOf(c) >= 0) S.cls = c; } catch (e) {}
    render();
  }

  // ---- the page -----------------------------------------------------------------------
  function render() {
    renderTop();
    $("footer-status").textContent = S.records ? plural(S.records.length, "record") + " in the class record, read at " + fmtTime(S.readAt, false) + (S.error ? " · " + S.error : "") : "";
    renderClassBar();
    var books = booksOf(S.cls);
    renderSetup(S.cls, books);
    $("setup").open = !S.classes.length || !books.length || S.setupOpen;
    VIEWS.forEach(function (v) { $("view-" + v).hidden = v !== S.view; });
    Array.prototype.forEach.call($("views").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-view") === S.view); });
    if (!S.classes.length) {
      $("views").hidden = true;
      $("view-" + S.view).innerHTML = "";
      return;
    }
    $("views").hidden = false;
    if (!books.length) { $("view-" + S.view).innerHTML = '<div class="info">No group has pinned anything in this class yet.</div>'; return; }
    if (S.view === "overview") renderOverview(books, S.cls);
    else if (S.view === "experiment") renderByExperiment(books);
    else renderOneGroup(books);
  }
  // The projector button: the class page in a new tab with the default market, in projector mode (no group number,
  // the Pin button works, the pins stay in that browser, nothing is sent to the class record).
  function projectorButton(cls) {
    return '<div class="projector"><a class="button primary" id="projector-open" target="_blank" rel="noopener" href="' + esc(projectorLink(DEFAULT_STATE, cls)) + '">Open the class page on the projector</a>' +
           '<div class="caption">Default market, projector mode: pin anything, nothing goes to the record</div></div>';
  }
  function renderClassBar() {
    var el = $("class-bar");
    if (!S.classes.length) {
      el.innerHTML = '<div class="class-bar"><div class="info" style="margin:0;grid-column:1 / 3">No classes yet. Create one below: you get a link and a QR code for the slide, and the groups’ lab books appear here as they pin experiments.</div>' + projectorButton("") + '</div>';
      return;
    }
    var books = booksOf(S.cls), nPins = 0, last = 0;
    books.forEach(function (bk) { nPins += entriesOf(bk).length; last = Math.max(last, bk.last); });
    el.innerHTML = '<div class="class-bar"><div><label for="class-pick">Class</label><select id="class-pick">' +
      selectOptions(S.classes, S.cls, S.classes.map(function (c) { return c || NO_CLASS; })) + '</select></div>' +
      '<div class="summary">' + plural(books.length, "group") + ", " + plural(nPins, "pinned experiment") + (books.length ? ", last activity " + fmtTime(last) : "") +
      '. The class code is the one in the link the students opened; most recently active first.</div>' + projectorButton(S.cls) + '</div>';
    $("class-pick").onchange = function () { S.cls = this.value; S.group = ""; try { localStorage.setItem(CLASS_KEY, S.cls); } catch (e) {} render(); };
  }

  // ---- Overview ----------------------------------------------------------------------
  function labBooksCsv(books) {
    var rows = [["class", "time", "group", "members", "tab", "label", "question", "note"].concat(M.MEASURES).concat(["state"])];
    books.forEach(function (bk) {
      entriesOf(bk).forEach(function (e) {
        rows.push([bk["class"], fmtTime(e.ts), bk.group, bk.names, e.tab, e.label, e.question, e.note]
                  .concat(M.MEASURES.map(function (m) { return e.measures[m] == null ? "" : e.measures[m]; })).concat([JSON.stringify(e.state)]));
      });
      if (bk.notes) rows.push([bk["class"], fmtTime(bk.last), bk.group, bk.names, "", "Notes for the debrief", "", bk.notes].concat(M.MEASURES.map(function () { return ""; })).concat([""]));
    });
    return csv(rows);
  }
  function answersCsv(books) {
    var graded = QUESTIONS.filter(function (q) { return q.id !== "own"; });
    var rows = [["class", "group", "members", "pins", "last saved"].concat(QUESTIONS.map(function (q) { return q.title; })).concat(["debrief notes"])];
    books.forEach(function (bk) {
      rows.push([bk["class"], bk.group, bk.names, entriesOf(bk).length, fmtTime(bk.last)].concat(QUESTIONS.map(function (q) { return bk.answers[q.id] || ""; })).concat([bk.notes || ""]));
    });
    void graded;
    return csv(rows);
  }
  function renderOverview(books, cls) {
    var nq = QUESTIONS.length, graded = QUESTIONS.filter(function (q) { return q.id !== "own"; });
    var h = '<div class="wide"><table class="grid sticky"><thead><tr><th>Group</th><th>Members</th>';
    for (var i = 0; i < nq - 1; i++) h += '<th class="tick">' + (i + 1) + '</th>';
    h += '<th class="tick">Own</th><th class="num">Pins</th><th>Verified</th><th>Answered</th><th>Last saved</th><th>Debrief notes</th></tr></thead><tbody>';
    books.forEach(function (bk) {
      var entries = entriesOf(bk), counts = [];
      for (var k = 0; k < nq; k++) counts.push(0);
      entries.forEach(function (e) { counts[questionIndex(e.question)]++; });
      var answered = graded.filter(function (q) { return (bk.answers[q.id] || "").trim(); }).length;
      var c = verifiedCounts(entries);
      var verified = !entries.length ? "" : (!c.bad && !c.unknown ? "✓ all" : (c.bad ? "✗ " + c.bad + " differ" : "? " + c.unknown + " unclear"));
      var note = (bk.notes || "").trim().split(/\r?\n/)[0] || "";
      h += '<tr><td>' + esc(bk.group) + '</td><td>' + esc(bk.names) + '</td>' +
           counts.map(function (n) { return '<td class="tick">' + ticks(n) + '</td>'; }).join("") +
           '<td class="num">' + entries.length + '</td><td class="' + (c.bad ? "bad" : (c.unknown ? "unk" : "ok")) + '">' + verified + '</td>' +
           '<td>' + (answered ? answered + "/" + graded.length : "") + '</td><td>' + esc(lastSaved(bk.last)) + '</td>' +
           '<td>' + esc(note.length > 90 ? note.slice(0, 90) + "…" : note) + '</td></tr>';
    });
    h += '</tbody></table></div>' +
         '<p class="caption">One row per group; a tick per pinned experiment under its question number; Own is the group’s own experiments. ' +
         'Answered counts the questions with an answer. Verified: every pinned column recomputed from its saved settings matches the numbers the group’s page reported. ' +
         'The full debrief notes are in One group.</p>' +
         '<div class="row"><button type="button" id="csv-books">Download the lab books as CSV (one row per pinned column)</button>' +
         '<button type="button" id="csv-answers">Download the answers as CSV (one row per group)</button></div>';
    $("view-overview").innerHTML = h;
    var tag = cls || "no_class";
    $("csv-books").onclick = function () { download("lab_books_" + tag + ".csv", labBooksCsv(books)); };
    $("csv-answers").onclick = function () { download("answers_" + tag + ".csv", answersCsv(books)); };
  }

  // ---- By experiment -----------------------------------------------------------------------
  function linkButtons(items) {    // [[label, href]]
    return '<div class="links">' + items.map(function (it) { return '<a class="button" target="_blank" rel="noopener" href="' + esc(it[1]) + '" title="' + esc(it[0]) + '">' + esc(it[0]) + '</a>'; }).join("") + '</div>';
  }
  function renderByExperiment(books) {
    var titles = QUESTIONS.map(function (q) { return q.title; });
    if (titles.indexOf(S.q) < 0) S.q = titles[0];
    var h = '<label for="q-pick">Experiment</label><select id="q-pick">' + selectOptions(titles, S.q) + '</select>';
    var pins = [];
    books.forEach(function (bk) { entriesOf(bk).forEach(function (e) { if (e.question === S.q) pins.push([bk, e]); }); });
    var qid = QUESTIONS[titles.indexOf(S.q)].id;
    if (pins.length) {
      var measures = M.MEASURES.filter(function (m) { return pins.some(function (p) { return p[1].measures[m] != null; }); })
                      .concat(M.extraMeasures(pins.map(function (p) { return p[1].measures; })));
      var noted = pins.some(function (p) { return p[1].note; });
      h += '<div class="wide"><table class="grid sticky"><thead><tr><th>Group</th><th>Experiment</th><th>Verified</th>' +
           measures.map(function (m) { return '<th class="num">' + esc(m) + '</th>'; }).join("") + (noted ? "<th>Note</th>" : "") + '</tr></thead><tbody>';
      pins.forEach(function (p) {
        var bk = p[0], e = p[1], v = verifyEntry(e);
        h += '<tr><td>' + esc(bk.group) + '</td><td>' + esc(e.label) + '</td><td class="' + markClass(e) + '">' + mark(e) + (v.ok === false ? " " + esc(v.bad.join(", ")) : "") + '</td>' +
             measures.map(function (m) { return '<td class="num">' + B.cell(e.measures[m]) + '</td>'; }).join("") + (noted ? '<td>' + esc(e.note || "") + '</td>' : "") + '</tr>';
      });
      var groups = {}; pins.forEach(function (p) { groups[p[0].group] = 1; });
      h += '</tbody></table></div><p class="caption">' + plural(pins.length, "pinned column") + " across " + plural(Object.keys(groups).length, "group") +
           '. Rows that disagree with the rest are the ones to ask about.</p>' +
           '<div class="section-title">Open on the projector (the class page in a new tab, projector mode: change anything, pin, nothing is sent to the record)</div>' +
           linkButtons(pins.map(function (p) { return [p[0].group + ": " + p[1].label, projectorLink(p[1].state, p[0]["class"])]; }));
    } else {
      h += '<div class="info">No group has pinned anything under this question yet.</div>';
    }
    var answered = books.filter(function (bk) { return (bk.answers[qid] || "").trim(); });
    if (answered.length) {
      h += '<div class="section-title">Answers to this question</div>';
      answered.forEach(function (bk) {
        var n = entriesOf(bk).filter(function (e) { return e.question === S.q; }).length;
        h += '<div class="answer"><div class="who">' + esc(bk.group) + (bk.names ? " · " + esc(bk.names) : "") + ' <span class="badge">' + n + ' pinned here</span></div>' + esc(bk.answers[qid]) + '</div>';
      });
    }
    $("view-experiment").innerHTML = h;
    $("q-pick").onchange = function () { S.q = this.value; renderByExperiment(books); };
  }

  // ---- One group ------------------------------------------------------------------------
  function renderOneGroup(books) {
    var names = books.map(function (bk) { return bk.group || "(no group number)"; });
    if (!S.group || names.indexOf(S.group) < 0) S.group = names[0];
    var bk = books[names.indexOf(S.group)], entries = entriesOf(bk);
    var h = '<label for="g-pick">Group</label><select id="g-pick">' + selectOptions(names, S.group) + '</select>' +
            '<p class="caption">' + (bk.names ? esc(bk.names) + " · " : "") + "Last saved " + fmtTime(bk.last) + " · " + plural(entries.length, "pinned experiment") + '</p>';
    var byQ = {}, marks = {};
    entries.forEach(function (e) { var i = questionIndex(e.question); (byQ[i] = byQ[i] || []).push(e); marks[e.id] = '<span class="' + markClass(e) + '">' + mark(e) + '</span>'; });
    var nothing = [];
    QUESTIONS.forEach(function (q, i) {
      var mine = byQ[i] || [], answer = (bk.answers[q.id] || "").trim();
      if (!mine.length && !answer) { nothing.push(q.title); return; }
      h += '<div class="qblock"><h3>' + esc(q.title) + ' <span class="badge">' + mine.length + ' pinned</span></h3>';
      if (mine.length) {
        h += B.table(mine, { mark: marks });
        var bad = mine.filter(function (e) { return verifyEntry(e).ok === false; });
        if (bad.length) h += '<div class="error">Not matching the saved settings when recomputed: ' + esc(bad.map(function (e) { return e.label + " (" + verifyEntry(e).bad.join(", ") + ")"; }).join("; ")) + '</div>';
        h += '<p class="caption">Open on the projector (the class page in a new tab, projector mode):</p>' +
             linkButtons(mine.map(function (e) { return [e.label, projectorLink(e.state, bk["class"])]; }));
      } else {
        h += '<p class="caption">Nothing pinned under this question.</p>';
      }
      if (answer) h += '<div class="section-title">' + (q.id === "own" ? "What the group learned" : "Answer") + '</div><div class="answer">' + esc(answer) + '</div>';
      else if (q.id !== "own") h += '<p class="caption">No answer yet.</p>';
      h += '</div>';
    });
    if (nothing.length) h += '<p class="caption">Nothing yet under: ' + esc(nothing.join("; ")) + '.</p>';
    if (entries.length) {
      var c = verifiedCounts(entries);
      h += '<p class="caption">' + (c.bad ? c.bad + " of " + entries.length + " columns do not match their saved settings (marked ✗ above)."
            : (c.unknown ? plural(c.unknown, "column") + " could not be recomputed from the saved settings."
            : "All columns verified: recomputing each from its saved settings gives the numbers shown.")) + '</p>';
    }
    if (bk.notes) h += '<div class="section-title">Notes for the debrief</div><div class="answer">' + esc(bk.notes) + '</div>';
    bk.other.forEach(function (f) { h += '<p><i>' + esc(f.question || "") + '</i> · ' + fmtTime(f.ts || 0) + '<br>' + esc(f.finding || "") + '</p>'; });
    $("view-group").innerHTML = h;
    $("g-pick").onchange = function () { S.group = this.value; renderOneGroup(books); };
  }

  // ---- Class set-up ---------------------------------------------------------------------
  function qrPng(text, scale, border) {
    var m = MLQR.matrix(text), n = m.length, size = (n + 2 * border) * scale;
    var cv = document.createElement("canvas"); cv.width = size; cv.height = size;
    var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size); ctx.fillStyle = "#000";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) ctx.fillRect((c + border) * scale, (r + border) * scale, scale, scale);
    return cv.toDataURL("image/png");
  }
  function renderSetup(cls, books) {
    var h = "";
    if (cls) {
      var link = classLink(cls);
      h += '<div class="setup-grid"><div><p style="margin:4px 0 6px">Link for class <b>' + esc(cls) + '</b> (put it on the slide; one link and QR code per class):</p>' +
           '<div class="linkbox" id="class-link">' + esc(link) + '</div>' +
           '<div class="row" style="margin-top:8px"><button type="button" id="copy-link">Copy the link</button><span class="caption" id="copy-msg"></span></div>' +
           '<p class="caption">The code appears under the group box on the students’ page and is stamped on everything they pin, so classes never mix.</p></div>' +
           '<div>' + MLQR.svg(link, 200).replace("<svg ", '<svg class="qr" id="qr-svg" ') + '<button type="button" id="qr-download" style="width:200px;margin-top:8px">Download QR (PNG)</button></div></div><hr class="sep">';
    }
    h += '<form id="new-class" class="form-row"><div><label for="new-code">New class code</label><input type="text" id="new-code" placeholder="MIM-A-9Nov" autocomplete="off"></div>' +
         '<div><button type="submit" class="primary" style="width:100%">Create class</button></div></form>' +
         '<p class="caption">Letters, digits, dots, dashes; short enough to read off a slide.</p><div id="class-error" class="error" hidden></div>';
    if (cls) {
      h += '<hr class="sep"><div class="section-title">Registered groups and PINs for class ' + esc(cls) + '</div>' +
           '<p class="caption">A group chooses its own PIN the first time it uses its number in this class; after that the number and PIN must match. ' +
           'If a group registered the wrong number, reset that number here: the right group can then register it, and the group that was reset registers again with a new PIN. Pinned work is never lost.</p>' +
           '<div id="groups-box"><p class="caption">Reading the registered groups…</p></div>';
    }
    $("setup-body").innerHTML = h;
    $("setup").ontoggle = function () { S.setupOpen = $("setup").open; };
    if (cls) {
      $("copy-link").onclick = function () {
        var done = function () { $("copy-msg").textContent = "Copied."; setTimeout(function () { $("copy-msg").textContent = ""; }, 2000); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(classLink(cls)).then(done, function () { $("copy-msg").textContent = "Select the link and copy it."; });
        else $("copy-msg").textContent = "Select the link and copy it.";
      };
      $("qr-download").onclick = function () {
        var a = document.createElement("a"); a.href = qrPng(classLink(cls), 10, 2); a.download = "marketlab_" + cls + ".png";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      };
      renderGroups(cls);
    }
    $("new-class").onsubmit = function (ev) {
      ev.preventDefault();
      var code = cleanClassCode($("new-code").value), errEl = $("class-error");
      if (!code) { errEl.textContent = "Please type a short class code, for example MIM-A-9Nov."; errEl.hidden = false; return; }
      var btn = this.querySelector("button"); btn.disabled = true; btn.textContent = "Creating…";
      var rec = classRecord(code);
      post({ token: S.cred, records: [rec] }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || "no answer");
        S.created[code] = rec.ts; S.records.push(rec); rebuild(); S.cls = code; S.group = ""; S.setupOpen = true;
        try { localStorage.setItem(CLASS_KEY, code); } catch (e) {}
        render();
      }).catch(function (err) { btn.disabled = false; btn.textContent = "Create class"; errEl.textContent = "Could not save the class: " + String(err && err.message || err); errEl.hidden = false; });
    };
  }
  function renderGroups(cls, message) {    // message: html shown under the table after a redraw (the reset's outcome)
    var draw = function (groups) {
      var box = $("groups-box"); if (!box) return;
      if (!groups.length) { box.innerHTML = '<div class="info">No group has registered in this class yet.</div>' + (message || ""); return; }
      var h = '<div class="wide"><table class="grid"><thead><tr><th>Group</th><th>PIN</th><th>Members</th><th>Registered (UTC)</th></tr></thead><tbody>' +
              groups.map(function (g) { return '<tr><td>' + esc(g.group) + '</td><td>' + esc(g.pin) + '</td><td>' + esc(g.names || "") + '</td><td>' + esc(String(g.registered || "").slice(0, 16).replace("T", " ")) + '</td></tr>'; }).join("") +
              '</tbody></table></div><div class="form-row three" style="margin-top:8px"><div><button type="button" id="csv-groups" style="width:100%">Download the group list (CSV)</button></div>' +
              '<div><label for="reset-pick">Group to reset</label><select id="reset-pick">' + selectOptions(groups.map(function (g) { return g.group; }), "") + '</select></div>' +
              '<div><button type="button" id="reset-btn" style="width:100%">Reset this group’s registration</button></div></div><div id="reset-msg">' + (message || "") + '</div>';
      box.innerHTML = h;
      $("csv-groups").onclick = function () {
        download("groups_" + cls + ".csv", csv([["class", "group", "pin", "members", "registered"]].concat(groups.map(function (g) { return [cls, g.group, g.pin, g.names || "", g.registered || ""]; }))));
      };
      $("reset-btn").onclick = function () {
        var pick = $("reset-pick").value, msg = $("reset-msg");
        if (!window.confirm("Reset the registration of " + pick + " in class " + cls + "? Its pinned work is kept; it registers again with a new PIN.")) return;
        post({ token: S.cred, action: "reset", "class": cls, group: pick }).then(function (j) {
          if (!j || !j.ok) throw new Error((j && j.error) || "no answer");
          delete S.groups[cls];
          renderGroups(cls, '<div class="success">' + esc(pick) + ' can register again with a new PIN. Its pinned work is kept.</div>');
        }).catch(function (err) { msg.innerHTML = '<div class="error">Could not reset: ' + esc(String(err && err.message || err)) + '</div>'; });
      };
    };
    if (S.groups[cls]) { draw(S.groups[cls]); return; }
    api({ token: S.cred, action: "groups", "class": cls }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || "no answer");
      S.groups[cls] = j.groups || []; draw(S.groups[cls]);
    }).catch(function (err) { var box = $("groups-box"); if (box) box.innerHTML = '<div class="error">Could not read the registered groups: ' + esc(String(err && err.message || err)) + '</div>'; });
  }

  // ---- init -----------------------------------------------------------------------------
  function init() {
    Array.prototype.forEach.call($("views").querySelectorAll("button"), function (b) { b.onclick = function () { S.view = b.getAttribute("data-view"); render(); }; });
    var cred = storedCred();
    if (!cred || !ENDPOINT) { renderSignin(); return; }
    S.cred = cred;
    $("signin").innerHTML = '<p class="caption">Reading the class record…</p>';
    loadRecords(function (err) {
      if (err) { S.cred = ""; if (/bad token|locked/.test(err)) clearCred(); renderSignin(/bad token/.test(err) ? "The saved password is no longer accepted; sign in again." : "Could not reach the class record (" + err + ")."); return; }
      start();
    });
  }
  document.addEventListener("DOMContentLoaded", init);
  window.MarketLabInstructor = { state: S, booksFromFindings: booksFromFindings, verifyEntry: verifyEntry, projectorLink: projectorLink, classLink: classLink };
})();
