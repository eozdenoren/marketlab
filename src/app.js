/* Marketplace Laboratory page: state, storage, the four tabs. Depends on
   MarketLab (engine.js) and MLChart (chart.js). */
(function () {
  "use strict";
  var M = MarketLab, CH = MLChart;
  var CONFIG = window.MARKETLAB_CONFIG || {};
  var ENDPOINT = (CONFIG.endpoint || "").trim(), TOKEN = CONFIG.token || "";

  var QUESTIONS = [
    { id: "q1", title: "1. Who really pays a tax?",
      prompt: "Use the default market. Put a tax of 20 per unit on sellers, then remove it and put the same tax on buyers. For both cases report the market price, the price buyers actually pay, the price sellers actually receive, the quantity traded and the tax revenue. Who bears the tax in each case, and why does it make no difference who hands the money to the government?" },
    { id: "q2", title: "2. Elasticity and the burden of a tax",
      prompt: "Change the supply table so that sellers' costs run from 0 to 200 (Pmax = 200) and apply a tax of 20 on sellers. Report how much of the tax buyers pay and how much sellers absorb, and the two elasticities shown at the bottom of the Outcomes table. Then build a market in which buyers bear at least three quarters of a tax of 20, report its specification (the supply and demand rows) and explain why it works." },
    { id: "q3", title: "3. Tax rates, revenue and deadweight loss",
      prompt: "On the default market, record the tax revenue and the deadweight loss for taxes on sellers of 10, 20, 40, 50 and 60 per unit (pin each one). Which tax raises the most revenue? Describe how the deadweight loss changes as the tax doubles, and explain the pattern using the shape of the loss on the chart." },
    { id: "q4", title: "4. Rent control",
      prompt: "On the default market set a price ceiling of 40 and pin the outcome under each rationing rule: efficient, random lottery and inefficient. Report the shortage, producer surplus, consumer surplus and the deadweight loss under each rule. Explain why consumer surplus depends on who gets the flats, say which rule you think describes real rent control best, and use the Winners and losers tab to say who would support the policy." },
    { id: "q5", title: "5. A subsidy",
      prompt: "On the default market give sellers a subsidy of 20 per unit (a tax on sellers of minus 20). Report the market price, what buyers pay and sellers receive, the quantity, the cost to the government, the gains to buyers and to sellers, and the deadweight loss. Buyers and sellers are both better off, so why does the subsidy lower total surplus, and who ultimately pays for it?" },
    { id: "q6", title: "6. Pollution: the tax or permit cap that puts the market right",
      prompt: "On the Externalities tab, keep the harm of 20 per unit and pin the market with no policy. Then find the tax on sellers that brings the deadweight loss to zero and pin it; try the same tax on buyers, and a permit cap instead. Report who bears the harm before any policy, how the right tax relates to the harm, and whether the cap does the same job. Who gains and who loses from the policy?" },
    { id: "own", title: "Your own experiments",
      prompt: "Anything you tried beyond the questions above. Give each column a label and a note saying what it shows, and write here what you learned from it." }];
  var EXT_QUESTION = 5;
  function sectionOf(entry) { for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].title === entry.question) return QUESTIONS[i].id; return "own"; }
  var RULES = [["efficient", "Efficient: highest values (or lowest costs) are served first"],
               ["random", "Random lottery: everyone willing has the same chance"],
               ["inefficient", "Inefficient: lowest values (or highest costs) are served first"]];
  var CONTROLS = [["none", "None"], ["ceiling", "Price ceiling"], ["floor", "Price floor"], ["quota", "Quota (cap on quantity traded)"]];
  var CONTROL_VALUE_LABEL = { ceiling: "Ceiling price", floor: "Floor price", quota: "Quota (units)" };
  var RENTS = [["sellers", "Sellers (licences given away)"], ["government", "Government (licences auctioned)"]];
  var DEFAULT_LAB = { supply: [["North", 100, 0, 100]], demand: [["West", 100, 0, 100]] };
  var DEFAULT_EXT = { supply: [["Factories", 100, 0, 100]], demand: [["Customers", 100, 0, 100]], harm: 20 };
  var STORY = "Widget factories on the shore of a lake sell to customers across the country. Every unit they make leaves sludge in the water, and the fishing families downstream lose a fixed amount for each one. Nobody in the market pays for that loss, so neither the price nor the quantity takes it into account. Set the harm per unit, see what the market does and who gains and who loses, then look for the policy that makes the market count the fishing families too.";

  // ---- utilities --------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function fmt(x, d, signed) {
    if (x == null || (typeof x === "number" && isNaN(x))) return "–";
    if (d === undefined) d = 1;
    if (Math.abs(x) < 5e-10) x = 0;
    var s = Math.abs(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
    return (x < 0 ? "-" : (signed ? "+" : "")) + s;
  }
  function pct(x) { return x == null || isNaN(x) ? "–" : Math.round(100 * x) + "%"; }
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
  function timeStr(ts) { var dt = new Date(ts); return dt.toTimeString().slice(0, 8); }
  function uid() { return Math.random().toString(16).slice(2, 10); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }

  // ---- state ----------------------------------------------------------------------
  var S = { classCode: "", group: null, lab: null, ext: null, book: [], notes: "", answers: {}, tab: "lab", lastQ: {},
            inner: { lab: "outcomes", ext: "outcomes" }, hidden: { lab: {}, ext: {} }, lastSaved: null, lastError: "", pinMsg: {} };
  function freshPolicy() { return { cost_shock: 0, benefit_boost: 0, tax_supply: 0, tax_demand: 0, control: "none", control_value: 0, rationing: "efficient", rent_to: "sellers", regional: {} }; }
  function freshLab() { return { supply: clone(DEFAULT_LAB.supply), demand: clone(DEFAULT_LAB.demand), policy: freshPolicy() }; }
  function freshExt() { return { supply: clone(DEFAULT_EXT.supply), demand: clone(DEFAULT_EXT.demand), harm: DEFAULT_EXT.harm, tax_supply: 0, tax_demand: 0, cap: 0 }; }
  function groupKey() { return S.group ? "Group " + S.group.number : "_"; }
  function groupPin() { return S.group && S.group.pin ? String(S.group.pin) : ""; }
  function groupNames() { return S.group && S.group.names ? S.group.names : ""; }
  function storeKey() { return "marketlab:" + S.classCode + ":" + groupKey(); }
  function saveLocal() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({ lab: S.lab, ext: S.ext, book: S.book, notes: S.notes, answers: S.answers, group: S.group, tab: S.tab === "assign" ? "book" : S.tab, lastQ: S.lastQ }));
      localStorage.setItem("marketlab:" + S.classCode + ":last", S.group ? JSON.stringify(S.group) : "");
    } catch (e) { /* storage full or disabled: the page still works */ }
  }
  function loadStored(key) { try { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function mergeStored(d) {
    if (!d) return;
    if (d.lab) S.lab = d.lab; if (d.ext) S.ext = d.ext;
    var have = {}; S.book.forEach(function (e) { have[e.id] = true; });
    (d.book || []).forEach(function (e) { if (!have[e.id]) S.book.push(e); });
    if (!S.notes && d.notes) S.notes = d.notes;
    Object.keys(d.answers || {}).forEach(function (k) { if (!S.answers[k]) S.answers[k] = d.answers[k]; });
    if (d.tab) S.tab = d.tab === "assign" ? "book" : d.tab;
    if (d.lastQ && typeof d.lastQ === "object") S.lastQ = d.lastQ;
  }

  // ---- class record (save queue) --------------------------------------------------
  var queue = loadStored("marketlab:queue") || [], flushing = false, retryTimer = null;
  function persistQueue() { try { localStorage.setItem("marketlab:queue", JSON.stringify(queue)); } catch (e) {} }
  function record(question, finding, state) {
    state = state || {};
    state["class"] = S.classCode; state.names = groupNames();
    return { ts: Date.now() / 1000, group: groupKey(), question: question, finding: finding || "", state: state, pin: groupPin() };
  }
  function enqueue(rec) { if (!S.group) return; queue.push(rec); persistQueue(); S.pinRejected = false; flush(); renderStatus(); }
  function flush() {
    if (!ENDPOINT || flushing || !queue.length || S.pinRejected) return;
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
  function groupUrl(group) {
    return ENDPOINT + (ENDPOINT.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(TOKEN) + "&class=" + encodeURIComponent(S.classCode) +
           "&group=" + encodeURIComponent("Group " + group.number) + "&pin=" + encodeURIComponent(group.pin || "");
  }
  function fetchGroupRecords(cb) {
    if (!ENDPOINT || !S.group) { cb(null); return; }
    fetch(groupUrl(S.group)).then(function (r) { return r.json(); }).then(function (j) { cb(j && j.ok ? j.records : null); }).catch(function () { cb(null); });
  }
  function checkPin(group, cb) {
    // cb(status, records, names): "ok" | "new" | "bad" | "unknown" (no endpoint or no network)
    if (!ENDPOINT) { cb("unknown", null, ""); return; }
    fetch(groupUrl(group) + "&action=check").then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok && j.status === "new") cb("new", null, "");
        else if (j && j.ok) cb("ok", j.records || null, j.names || "");
        else if (j && /pin/.test(j.error || "")) cb("bad", null, "");
        else cb("unknown", null, "");
      })
      .catch(function () { cb("unknown", null, ""); });
  }
  function registerGroup(group, cb) {
    // cb("registered" | "taken" | "error")
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                      body: JSON.stringify({ token: TOKEN, action: "register", "class": S.classCode, group: "Group " + group.number, pin: group.pin, names: group.names || "" }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb(j && j.ok ? "registered" : (j && j.error === "taken" ? "taken" : "error")); })
      .catch(function () { cb("error"); });
  }
  function restoreFromRecords(recs) {
    if (!recs || !recs.length) return;
    recs.sort(function (a, b) { return a.ts - b.ts; });
    var entries = {}, order = [], notes = "", answers = null;
    recs.forEach(function (f) {
      var st = f.state || {}, lbk = st.labbook;
      if (!lbk) return;
      if (lbk.kind === "notes") { notes = f.finding || ""; return; }
      if (lbk.kind === "answers") { answers = st.answers || {}; return; }
      if (lbk.kind === "class") return;
      if (lbk.deleted) { delete entries[lbk.id]; return; }
      if (!entries[lbk.id]) order.push(lbk.id);
      var sw = {}; Object.keys(st).forEach(function (k) { if (k !== "labbook") sw[k] = st[k]; });
      entries[lbk.id] = { id: lbk.id, ts: f.ts, tab: lbk.tab || "lab", label: lbk.label || "", question: f.question || "", note: f.finding || "",
                          measures: lbk.measures || {}, baseline: lbk.baseline || {}, state: sw };
    });
    var have = {}; S.book.forEach(function (e) { have[e.id] = true; });
    order.forEach(function (id) { if (entries[id] && !have[id]) S.book.push(entries[id]); });
    if (!S.notes && notes) S.notes = notes;
    if (answers) Object.keys(answers).forEach(function (k) { if (!S.answers[k]) S.answers[k] = answers[k]; });
  }
  function renderStatus() {
    var el = $("footer-status");
    var parts = [];
    if (S.classCode) parts.push("Class " + esc(S.classCode));
    if (S.group) parts.push(esc(groupKey()));
    if (!ENDPOINT) parts.push("Offline copy: nothing is sent to the class record");
    else if (S.pinRejected) parts.push('<span class="err">The class record refused the group number and PIN; press Change above and enter them again</span>');
    else if (S.lastError && queue.length) parts.push('<span class="err">Could not reach the class record (' + esc(S.lastError) + '); ' + queue.length + ' saved on this laptop, retrying</span>');
    else if (queue.length) parts.push("Saving…");
    else if (S.lastSaved) parts.push("Saved to the class record at " + timeStr(S.lastSaved));
    el.innerHTML = parts.join(" · ");
    ["book-status"].forEach(function (id) {
      var s = $(id); if (!s) return;
      if (!ENDPOINT) s.textContent = "Offline copy: your work is kept on this laptop only.";
      else if (S.pinRejected) { s.textContent = "The class record refused the group number and PIN; press Change at the top and enter them again."; s.className = "status err"; }
      else if (S.lastError && queue.length) { s.textContent = "Could not reach the class record; your work is kept on this laptop and will be sent again."; s.className = "status err"; }
      else if (queue.length) { s.textContent = "Saving…"; s.className = "status"; }
      else if (S.lastSaved) { s.textContent = "Saved to the class record at " + timeStr(S.lastSaved) + "."; s.className = "status"; }
      else s.textContent = "";
    });
  }

  // ---- group panel -------------------------------------------------------------------
  function renderGroup() {
    var el = $("group-panel");
    if (S.group && !S.editingGroup) {
      el.innerHTML = '<div class="group-line"><div><b>Your group:</b> ' + esc(groupKey()) + (groupNames() ? " · " + esc(groupNames()) : "") +
                     (S.classCode ? " · Class " + esc(S.classCode) : "") + '</div><button type="button" id="group-change">Change</button></div>';
      $("group-change").onclick = function () { S.editingGroup = true; renderGroup(); };
      return;
    }
    var needPin = !!ENDPOINT;
    el.innerHTML = '<form id="group-form" class="group-form' + (needPin ? " with-pin" : "") + '">' +
      '<div><label for="group-number">Group number</label><input type="number" id="group-number" min="1" max="999" step="1" placeholder="12" value="' + (S.group ? S.group.number : "") + '"></div>' +
      (needPin ? '<div><label for="group-pin">PIN</label><input type="text" id="group-pin" inputmode="numeric" maxlength="4" placeholder="4 digits" autocomplete="off" value="' + esc(groupPin()) + '"></div>' : "") +
      '<div><label for="group-names">Names of the group members (optional)</label><input type="text" id="group-names" placeholder="Ana Lopes, Bo Chen, Chidi Okafor" value="' + esc(groupNames()) + '"></div>' +
      '<div><button type="submit" class="primary" id="group-save" style="width:100%">Save</button></div></form>' +
      '<div class="caption" style="margin-top:6px">' + (S.classCode ? "Class " + esc(S.classCode) + ". " : "") + (needPin ? "The first time your group uses its number in this class you will be asked to choose a PIN." : "") + '</div>' +
      '<div id="group-error" class="error" hidden></div>';
    $("group-form").onsubmit = function (ev) {
      ev.preventDefault();
      var n = parseInt($("group-number").value, 10), pin = needPin ? ($("group-pin").value || "").trim() : "";
      var errEl = $("group-error");
      if (!(n > 0)) { errEl.textContent = "Please enter your group number."; errEl.hidden = false; return; }
      if (needPin && !/^\d{4}$/.test(pin)) { errEl.textContent = "Please enter the four-digit PIN of your group."; errEl.hidden = false; return; }
      var names = $("group-names").value.split(/[,;\n]|\band\b|&/).map(function (s) { return s.trim(); }).filter(Boolean).join(", ");
      var candidate = { number: n, names: names, pin: pin }, prev = S.group;
      var finish = function (recs, knownNames) {
        if (!candidate.names && knownNames) candidate.names = knownNames;
        S.group = candidate; S.editingGroup = false; S.pinRejected = false;
        if (!prev || prev.number !== n) {
          var stored = loadStored(storeKey());
          if (stored) { var keepLab = S.lab, keepExt = S.ext; mergeStored(stored); S.lab = keepLab; S.ext = keepExt; }
        }
        if (recs) restoreFromRecords(recs);
        saveLocal(); renderGroup(); renderLab(); renderExt(); renderBook(); renderStatus(); flush();
      };
      if (!needPin) { finish(null, ""); return; }
      $("group-save").disabled = true; $("group-save").textContent = "Checking…";
      checkPin(candidate, function (status, recs, knownNames) {
        if (status === "bad") {
          $("group-save").disabled = false; $("group-save").textContent = "Save";
          errEl.textContent = "Group " + n + " is already registered in this class with a different PIN. Check your PIN, or ask the instructor to reset the group."; errEl.hidden = false;
          return;
        }
        if (status === "new") { renderRegister(candidate, finish); return; }
        finish(recs, knownNames);
      });
    };
  }
  function renderRegister(candidate, finish) {
    var el = $("group-panel");
    el.innerHTML = '<div class="info"><b>Group ' + candidate.number + '</b> is not registered in class ' + esc(S.classCode) + ' yet. ' +
      'If that is your group number, choose a four-digit PIN for your group and confirm it. Everyone in the group will use this number and PIN; ' +
      'write it down. If the number is wrong, go back.</div>' +
      '<form id="register-form" class="group-form with-pin">' +
      '<div><label>Group number</label><div style="font-size:1.6rem;font-weight:600;padding:2px 0">' + candidate.number + '</div></div>' +
      '<div><label for="reg-pin">PIN</label><input type="text" id="reg-pin" inputmode="numeric" maxlength="4" autocomplete="off" value="' + esc(candidate.pin) + '"></div>' +
      '<div><label for="reg-pin2">Confirm PIN</label><input type="text" id="reg-pin2" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="same 4 digits"></div>' +
      '<div><button type="submit" class="primary" id="reg-save" style="width:100%">Register Group ' + candidate.number + '</button></div></form>' +
      '<div class="row" style="margin-top:6px"><button type="button" id="reg-back" class="small">Back</button></div>' +
      '<div id="reg-error" class="error" hidden></div>';
    $("reg-back").onclick = function () { renderGroup(); };
    $("register-form").onsubmit = function (ev) {
      ev.preventDefault();
      var p1 = ($("reg-pin").value || "").trim(), p2 = ($("reg-pin2").value || "").trim(), errEl = $("reg-error");
      if (!/^\d{4}$/.test(p1)) { errEl.textContent = "The PIN must be four digits."; errEl.hidden = false; return; }
      if (p1 !== p2) { errEl.textContent = "The two PINs differ; type the same four digits twice."; errEl.hidden = false; return; }
      candidate.pin = p1;
      $("reg-save").disabled = true; $("reg-save").textContent = "Registering…";
      registerGroup(candidate, function (status) {
        if (status === "registered") { finish(null, ""); return; }
        $("reg-save").disabled = false; $("reg-save").textContent = "Register Group " + candidate.number;
        errEl.textContent = status === "taken" ? "Someone has just registered this group number. If it is yours, ask the instructor to reset it."
                                               : "Could not reach the class record. Check the wifi and try again.";
        errEl.hidden = false;
      });
    };
  }

  // ---- tabs -------------------------------------------------------------------------
  function showTab(name) {
    S.tab = name;
    ["lab", "ext", "book"].forEach(function (t) { $("tab-" + t).hidden = t !== name; });
    Array.prototype.forEach.call($("main-tabs").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
    if (name === "book") renderBook();
    saveLocal();
  }

  // ---- shared pieces ----------------------------------------------------------------
  function rowsToMarket(sup, dem) {
    var ok = function (r) { var q = num(r[1], 0); return q > 0; };
    var fix = function (r) { return [String(r[0] || "").trim(), num(r[1], 0), num(r[2], 0), isNaN(parseFloat(r[3])) ? num(r[2], 0) : num(r[3], 0)]; };
    return M.buildMarket(sup.map(fix).filter(ok), dem.map(fix).filter(ok));
  }
  function specTable(id, rows, side) {
    var h = '<table class="grid spec" id="' + id + '"><thead><tr><th>Region</th><th class="num">Quantity</th><th class="num">Pmin</th><th class="num">Pmax</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      h += '<tr data-i="' + i + '"><td><input type="text" value="' + esc(r[0]) + '" aria-label="Region"></td>' +
           '<td><input type="number" value="' + esc(r[1]) + '" min="0" step="10" aria-label="Quantity"></td>' +
           '<td><input type="number" value="' + esc(r[2]) + '" step="10" aria-label="Pmin"></td>' +
           '<td><input type="number" value="' + esc(r[3]) + '" step="10" aria-label="Pmax"></td>' +
           '<td class="remove"><button type="button" class="small" title="Remove this row" aria-label="Remove row">✕</button></td></tr>';
    });
    return h + '</tbody></table><button type="button" class="small add-row" data-table="' + id + '">+ Add a row</button>';
  }
  function readSpec(id) {
    var rows = [];
    Array.prototype.forEach.call($(id).querySelectorAll("tbody tr"), function (tr) {
      var ins = tr.querySelectorAll("input");
      rows.push([ins[0].value, num(ins[1].value, 0), num(ins[2].value, 0), num(ins[3].value, 0)]);
    });
    return rows;
  }
  function bindSpec(container, id, get, set, after) {
    container.addEventListener("change", function (ev) {
      var t = ev.target; if (!t.closest || !t.closest("#" + id)) return;
      set(readSpec(id)); after();
    });
    container.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t.classList.contains("add-row") && t.getAttribute("data-table") === id) { var rows = get(); rows.push(["", 0, 0, 0]); set(rows); after(true); }
      else if (t.closest && t.closest("#" + id) && t.tagName === "BUTTON") { var tr = t.closest("tr"); var rows2 = readSpec(id); rows2.splice(+tr.getAttribute("data-i"), 1); set(rows2); after(true); }
    });
  }
  function metric(label, value, base, opts) {
    opts = opts || {};
    var d = base == null ? null : value - base, cls = "";
    var delta = "";
    if (d != null && Math.abs(d) > 5e-10) {
      cls = (d > 0 ? "up" : "down") + (opts.inverse ? " inverse" : "");
      delta = '<div class="delta ' + cls + '">' + (d > 0 ? "↑ " : "↓ ") + fmt(d, opts.decimals, true) + '</div>';
    }
    return '<div class="metric"><div class="label">' + esc(label) + (opts.help ? ' <span title="' + esc(opts.help) + '">ⓘ</span>' : "") + '</div><div class="value">' + fmt(value, opts.decimals) + '</div>' + delta + '</div>';
  }
  function table3(rows, head) {
    var h = '<table class="grid"><thead><tr><th></th><th class="num">' + esc(head[0]) + '</th><th class="num">' + esc(head[1]) + '</th><th class="num">' + esc(head[2]) + '</th></tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr><td>' + esc(r[0]) + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td class="num">' + r[3] + '</td></tr>'; });
    return h + '</tbody></table>';
  }
  function innerTabs(which, items) {
    return '<div class="tabs inner" data-which="' + which + '">' + items.map(function (it) {
      return '<button type="button" data-inner="' + it[0] + '" class="' + (S.inner[which] === it[0] ? "active" : "") + '">' + esc(it[1]) + '</button>';
    }).join("") + '</div>';
  }
  function groupLabel(g) {
    var kind = g.side === M.DEMAND ? { kept: "buyers who keep buying", lost: "buyers who no longer buy", "new": "buyers who newly buy" }[g.kind]
                                   : { kept: "sellers who keep selling", lost: "sellers who stop selling", "new": "new sellers" }[g.kind];
    return g.region + ": " + kind;
  }
  function winnersHtml(out, base, groups, extra) {
    var order = { demand: 0, supply: 1 }, ko = { kept: 0, lost: 1, "new": 2 };
    groups = groups.slice().sort(function (a, b) { return (order[a.side] - order[b.side]) || (a.region < b.region ? -1 : a.region > b.region ? 1 : 0) || (ko[a.kind] - ko[b.kind]); });
    var rows = groups.map(function (g) { return [groupLabel(g), fmt(g.mass), fmt(g.average, 1, true), fmt(g.change, 1, true)]; });
    var bars = groups.map(function (g) { return [groupLabel(g), g.change]; });
    var gov = out.government_revenue - base.government_revenue;
    if (Math.abs(gov) > 1e-9) { rows.push(["Government (tax, permit and licence revenue)", "", "", fmt(gov, 1, true)]); bars.push(["Government", gov]); }
    (extra || []).forEach(function (x) { if (Math.abs(x[1]) > 1e-9) { rows.push([x[0], "", "", fmt(x[1], 1, true)]); bars.push([x[0], x[1]]); } });
    var total = groups.reduce(function (a, g) { return a + g.change; }, 0) + gov + (extra || []).reduce(function (a, x) { return a + x[1]; }, 0);
    rows.push(["Everyone together", "", "", fmt(total, 1, true)]);
    if (!groups.length && Math.abs(gov) < 1e-9 && !(extra || []).some(function (x) { return Math.abs(x[1]) > 1e-9; }))
      return '<p class="caption">Nothing has changed yet. Run an experiment to see who gains and who loses.</p>';
    var h = CH.winnersHtml(bars) + '<table class="grid"><thead><tr><th>Who</th><th class="num">How many</th><th class="num">Each, on average</th><th class="num">Total</th></tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr><td>' + esc(r[0]) + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td class="num">' + r[3] + '</td></tr>'; });
    return h + '</tbody></table><p class="caption">Compared with the baseline market. Under a random lottery the counts are expected numbers: every willing trader faces the same odds.</p>';
  }
  function uniformPrice(out, side) {
    var vals = out.regions.filter(function (r) { return r.side === side && r.quantity > 0; }).map(function (r) { return r.net_price; });
    if (!vals.length) return null;
    for (var i = 1; i < vals.length; i++) if (Math.abs(vals[i] - vals[0]) >= 1e-9) return null;
    return vals[0];
  }
  function pinPanel(which, suggestion, qIndex) {
    var dis = S.group ? "" : " disabled";
    return '<div class="panel"><div class="pin"><div><label for="' + which + '-pin-label">Label for the lab book</label><input type="text" id="' + which + '-pin-label" placeholder="' + esc(suggestion) + '" title="Leave blank to use the suggested label."></div>' +
      '<div><label for="' + which + '-pin-q">Lab book section</label><select id="' + which + '-pin-q">' + QUESTIONS.map(function (q, i) { return '<option value="' + i + '"' + ((S.lastQ[which] ? S.lastQ[which] === q.title : i === qIndex) ? " selected" : "") + '>' + esc(q.title) + '</option>'; }).join("") + '</select></div>' +
      '<div><button type="button" class="primary" id="' + which + '-pin" style="width:100%"' + dis + '>Pin to lab book</button></div></div>' +
      (S.group ? "" : '<p class="caption">Enter your group number at the top of the page to pin experiments.</p>') +
      (S.pinMsg[which] ? '<div class="success">' + esc(S.pinMsg[which]) + '</div>' : "") + '</div>';
  }
  function doPin(which, suggestion, measures, baseline, state) {
    var labelEl = $(which + "-pin-label"), label = (labelEl.value || "").trim() || suggestion;
    var q = QUESTIONS[+$(which + "-pin-q").value] || QUESTIONS[QUESTIONS.length - 1];
    var entry = { id: uid(), ts: Date.now() / 1000, tab: which === "lab" ? "lab" : "externality", label: label, question: q.title, note: "", measures: measures, baseline: baseline, state: state };
    S.book.push(entry); labelEl.value = ""; S.lastQ[which] = q.title;
    S.pinMsg[which] = "Pinned as '" + label + "' under '" + q.title + "'. Open the Lab book tab to see it.";
    saveLocal(); enqueue(entryRecord(entry, false));
    return entry;
  }
  function entryRecord(e, deleted) {
    var st = clone(e.state || {});
    st.labbook = { id: e.id, label: e.label, tab: e.tab, measures: e.measures, baseline: e.baseline, deleted: !!deleted };
    return record(e.question, e.note, st);
  }

  // ---- Laboratory tab -------------------------------------------------------------------
  function buildLab() {
    var p = S.lab.policy;
    $("tab-lab").innerHTML =
      '<div class="row between"><p class="caption" style="margin:0">Build a market from linear segments, run experiments, and read off prices, quantities, surplus, and who wins and who loses.</p>' +
      '<div class="row"><button type="button" id="lab-reset-market">Reset market</button><button type="button" id="lab-reset-exp">Reset experiments</button></div></div>' +
      '<details class="panel" open id="lab-spec-panel"><summary>Market specification</summary><p class="caption">Each row is a segment: a Quantity of units whose values (buyers) or costs (sellers) are spread evenly from Pmin to Pmax. Pmin = Pmax makes a block of identical units. Rows with the same region name belong to one region; a new name makes a new region. Change a number and press Enter or click elsewhere.</p>' +
      '<div class="cols"><div><b>Supply</b> <span class="caption">(sellers, costs from Pmin to Pmax)</span><div id="lab-supply-wrap"></div></div><div><b>Demand</b> <span class="caption">(buyers, values from Pmin to Pmax)</span><div id="lab-demand-wrap"></div></div></div></details>' +
      '<details class="panel" id="lab-regional-panel"><summary>Regional experiments</summary><p class="caption">One row per region. Capacity scales a region\'s quantities. A tax on an importing region is a tariff; a tax on an exporting demand region is an export tariff. A cap limits how much a supply region may sell (an import quota); 0 means no cap.</p><div id="lab-regional"></div></details>' +
      '<div class="cols-4-8"><div>' +
      '<details class="panel" open><summary>Global experiments</summary><div class="cols">' +
      '<div><label for="lab-cost">Cost shock (all sellers)</label><input type="number" id="lab-cost" step="5" value="' + p.cost_shock + '" title="Raises every seller\'s cost by this amount. Negative for a cost saving."></div>' +
      '<div><label for="lab-boost">Benefit boost (all buyers)</label><input type="number" id="lab-boost" step="5" value="' + p.benefit_boost + '" title="Raises every buyer\'s value by this amount. Negative for a demand slump."></div>' +
      '<div><label for="lab-tax-s">Tax on sellers (per unit)</label><input type="number" id="lab-tax-s" step="5" value="' + p.tax_supply + '" title="Sellers keep the price minus the tax. Negative for a subsidy."></div>' +
      '<div><label for="lab-tax-d">Tax on buyers (per unit)</label><input type="number" id="lab-tax-d" step="5" value="' + p.tax_demand + '" title="Buyers pay the price plus the tax. Negative for a subsidy."></div></div></details>' +
      '<details class="panel" open><summary>Price and quantity controls</summary>' +
      '<div class="cols"><div><label for="lab-control">Market control</label><select id="lab-control">' + CONTROLS.map(function (c) { return '<option value="' + c[0] + '"' + (p.control === c[0] ? " selected" : "") + '>' + c[1] + '</option>'; }).join("") + '</select></div>' +
      '<div id="lab-control-value-wrap"><label for="lab-control-value" id="lab-control-value-label">Ceiling price</label><input type="number" id="lab-control-value" min="0" step="5" value="' + p.control_value + '"></div></div>' +
      '<label style="margin-top:10px">Rationing rule when a control leaves some willing traders out</label><div class="radio" id="lab-rationing">' +
      RULES.map(function (r) { return '<label><input type="radio" name="lab-rationing" value="' + r[0] + '"' + (p.rationing === r[0] ? " checked" : "") + '> ' + r[1] + '</label>'; }).join("") + '</div>' +
      '<div id="lab-rent-wrap"><label style="margin-top:10px">Who collects the quota rent</label><div class="radio row" id="lab-rent">' +
      RENTS.map(function (r) { return '<label><input type="radio" name="lab-rent" value="' + r[0] + '"' + (p.rent_to === r[0] ? " checked" : "") + '> ' + r[1] + '</label>'; }).join("") + '</div></div></details>' +
      '</div><div id="lab-results"></div></div><div id="lab-pin-wrap"></div>';
    $("lab-supply-wrap").innerHTML = specTable("lab-supply", S.lab.supply, M.SUPPLY);
    $("lab-demand-wrap").innerHTML = specTable("lab-demand", S.lab.demand, M.DEMAND);
    var tab = $("tab-lab");
    bindSpec(tab, "lab-supply", function () { return S.lab.supply; }, function (r) { S.lab.supply = r; }, function (rebuild) { if (rebuild) $("lab-supply-wrap").innerHTML = specTable("lab-supply", S.lab.supply, M.SUPPLY); renderLab(); });
    bindSpec(tab, "lab-demand", function () { return S.lab.demand; }, function (r) { S.lab.demand = r; }, function (rebuild) { if (rebuild) $("lab-demand-wrap").innerHTML = specTable("lab-demand", S.lab.demand, M.DEMAND); renderLab(); });
    $("lab-reset-market").onclick = function () { S.lab = freshLab(); buildLab(); renderLab(); };
    $("lab-reset-exp").onclick = function () { S.lab.policy = freshPolicy(); buildLab(); renderLab(); };
    ["lab-cost", "lab-boost", "lab-tax-s", "lab-tax-d", "lab-control-value"].forEach(function (id) { $(id).addEventListener("change", readLabInputs); });
    $("lab-control").addEventListener("change", readLabInputs);
    $("lab-rationing").addEventListener("change", readLabInputs);
    $("lab-rent").addEventListener("change", readLabInputs);
    tab.addEventListener("change", function (ev) { if (ev.target.closest && ev.target.closest("#lab-regional")) readRegional(); });
    tab.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t.id === "lab-pin") { var r = computeLab(); if (r.err) return; doPin("lab", M.describeLab(r.policy), M.measuresLab(r.out), M.measuresLab(r.base), labState(r)); renderLab(); }
      else if (t.classList.contains("legend-item") && t.closest("#lab-results")) { var n = t.getAttribute("data-name"); S.hidden.lab[n] = !(S.hidden.lab[n] !== undefined ? S.hidden.lab[n] : t.classList.contains("off")); renderLab(); }
      else if (t.getAttribute && t.getAttribute("data-inner") && t.closest("#lab-results")) { S.inner.lab = t.getAttribute("data-inner"); renderLab(); }
    });
  }
  function readLabInputs() {
    var p = S.lab.policy;
    p.cost_shock = num($("lab-cost").value, 0); p.benefit_boost = num($("lab-boost").value, 0);
    p.tax_supply = num($("lab-tax-s").value, 0); p.tax_demand = num($("lab-tax-d").value, 0);
    p.control = $("lab-control").value; p.control_value = num($("lab-control-value").value, 0);
    var r = document.querySelector('input[name="lab-rationing"]:checked'); p.rationing = r ? r.value : "efficient";
    var t = document.querySelector('input[name="lab-rent"]:checked'); p.rent_to = t ? t.value : "sellers";
    renderLab();
  }
  function regionNames() { var m = rowsToMarket(S.lab.supply, S.lab.demand); return { supply: m.regions.filter(function (r) { return r.side === M.SUPPLY; }).map(function (r) { return r.name; }), demand: m.regions.filter(function (r) { return r.side === M.DEMAND; }).map(function (r) { return r.name; }) }; }
  function renderRegional(names) {
    var h = "";
    [[M.SUPPLY, "Supply regions"], [M.DEMAND, "Demand regions"]].forEach(function (side) {
      h += '<p style="margin:8px 0 4px"><b>' + side[1] + '</b></p>';
      var list = names[side[0]];
      if (!list.length) { h += '<p class="caption">No regions yet.</p>'; return; }
      var shock = side[0] === M.SUPPLY ? "Cost shock" : "Benefit boost";
      h += '<table class="grid"><thead><tr><th>Region</th><th class="num">Capacity %</th><th class="num">' + shock + '</th><th class="num">Tax per unit</th>' + (side[0] === M.SUPPLY ? '<th class="num">Cap on sales</th>' : "") + '</tr></thead><tbody>';
      list.forEach(function (n) {
        var rp = S.lab.policy.regional[n] || { scale: 100, shift: 0, tax: 0, cap: 0 };
        h += '<tr data-region="' + esc(n) + '" data-side="' + side[0] + '"><td>' + esc(n) + '</td><td><input type="number" data-f="scale" value="' + rp.scale + '" min="0" step="10" aria-label="Capacity % ' + esc(n) + '"></td>' +
             '<td><input type="number" data-f="shift" value="' + rp.shift + '" step="5" aria-label="' + shock + ' ' + esc(n) + '"></td><td><input type="number" data-f="tax" value="' + rp.tax + '" step="5" aria-label="Tax per unit ' + esc(n) + '"></td>' +
             (side[0] === M.SUPPLY ? '<td><input type="number" data-f="cap" value="' + rp.cap + '" min="0" step="10" aria-label="Cap on sales ' + esc(n) + '"></td>' : "") + '</tr>';
      });
      h += '</tbody></table>';
    });
    $("lab-regional").innerHTML = h;
  }
  function readRegional() {
    Array.prototype.forEach.call($("lab-regional").querySelectorAll("tr[data-region]"), function (tr) {
      var n = tr.getAttribute("data-region"), rp = { scale: 100, shift: 0, tax: 0, cap: 0 };
      Array.prototype.forEach.call(tr.querySelectorAll("input"), function (inp) { rp[inp.getAttribute("data-f")] = num(inp.value, rp[inp.getAttribute("data-f")]); });
      S.lab.policy.regional[n] = rp;
    });
    renderLab(false);
  }
  function labPolicy(names) {
    var p = S.lab.policy, regional = {};
    names.supply.concat(names.demand).forEach(function (n) {
      var rp = S.lab.policy.regional[n]; if (!rp) return;
      regional[n] = { scale: num(rp.scale, 100) / 100, shift: num(rp.shift, 0), tax: num(rp.tax, 0), cap: (names.supply.indexOf(n) >= 0 && num(rp.cap, 0) > 0) ? num(rp.cap, 0) : null };
    });
    return M.defaultPolicy({ cost_shock: p.cost_shock, benefit_boost: p.benefit_boost, tax_supply: p.tax_supply, tax_demand: p.tax_demand,
                             control: p.control, control_value: p.control !== "none" ? p.control_value : null, rationing: p.rationing, rent_to: p.rent_to, regional: regional });
  }
  function computeLab() {
    var market = rowsToMarket(S.lab.supply, S.lab.demand), names = regionNames(), policy = labPolicy(names);
    try {
      var out = M.solve(market, policy), base = M.solve(market, {}), bench = M.solve(market, M.stripped(policy), false);
      return { market: market, names: names, policy: policy, out: out, base: base, bench: bench, groups: M.compare(base, out) };
    } catch (e) { return { err: e.message, names: names, policy: policy }; }
  }
  function labState(r) {
    var p = r.policy, regional = { supply: {}, demand: {} };
    r.names.supply.forEach(function (n) { var rp = M.regionPolicy(p, n); regional.supply[n] = { scale: rp.scale, shift: rp.shift, tax: rp.tax, cap: rp.cap }; });
    r.names.demand.forEach(function (n) { var rp = M.regionPolicy(p, n); regional.demand[n] = { scale: rp.scale, shift: rp.shift, tax: rp.tax, cap: rp.cap }; });
    return { page: "lab", supply: clone(S.lab.supply), demand: clone(S.lab.demand),
             policy: { cost_shock: p.cost_shock, benefit_boost: p.benefit_boost, tax_supply: p.tax_supply, tax_demand: p.tax_demand, control: p.control, control_value: p.control_value, rationing: p.rationing, rent_to: p.rent_to, regional: regional },
             outcome: { price: r.out.price, quantity: r.out.quantity, consumer_surplus: r.out.consumer_surplus, producer_surplus: r.out.producer_surplus, tax_revenue: r.out.tax_revenue, licence_rent: r.out.licence_rent, total_surplus: r.out.total_surplus, deadweight_loss: r.out.deadweight_loss } };
  }
  function renderLab(withRegional) {
    if (!$("lab-results")) return;
    var r = computeLab();
    if (withRegional !== false) renderRegional(r.names);
    var p = S.lab.policy;
    $("lab-control-value-wrap").hidden = p.control === "none";
    $("lab-control-value-label").textContent = CONTROL_VALUE_LABEL[p.control] || "Value";
    var anyCap = r.names.supply.some(function (n) { return S.lab.policy.regional[n] && num(S.lab.policy.regional[n].cap, 0) > 0; });
    $("lab-rent-wrap").hidden = !(p.control === "quota" || anyCap);
    var el = $("lab-results");
    if (r.err) { el.innerHTML = '<div class="error">' + esc(r.err) + '</div>'; $("lab-pin-wrap").innerHTML = pinPanel("lab", M.describeLab(r.policy), 0); return; }
    var out = r.out, base = r.base, bench = r.bench;
    var h = '<div class="metrics">' + metric("Market price", out.price, base.price) + metric("Quantity traded", out.quantity, base.quantity) +
            metric("Total surplus", out.total_surplus, base.total_surplus, { decimals: 0 }) +
            metric("Deadweight loss", out.deadweight_loss, null, { decimals: 0, help: "Total surplus lost relative to the efficient outcome with the same costs, values and capacity." }) + '</div>';
    var fig = CH.marketFigure(r.market, r.policy, out, bench), rend = CH.render(fig, S.hidden.lab);
    h += rend.svg + CH.legendHtml(rend.legend);
    if (out.flags.no_trade) h += '<div class="error">No trade: one side of the market is empty.</div>';
    if (out.flags.indeterminate_price) h += '<div class="info">Any price between ' + fmt(out.flags.price_interval[0]) + ' and ' + fmt(out.flags.price_interval[1]) + ' clears the market; the midpoint is shown.</div>';
    if (r.policy.control !== "none" && !out.control_binding && out.quantity > 0) h += '<p class="caption">The ' + (r.policy.control === "quota" ? "quota" : r.policy.control) + ' does not bind at these settings.</p>';
    if (out.control_binding && out.rationed_side) {
      var side = out.rationed_side === M.DEMAND ? "buyers" : "sellers", willing = out.quantity + out.shortage, rule = r.policy.rationing, how;
      if (rule === "random") how = "each willing " + side.slice(0, -1) + " trades with probability " + pct(willing ? out.quantity / willing : 0);
      else if (rule === "efficient") how = "the " + side + " who value the trade most are served";
      else how = "the " + side + " who value the trade least are served";
      var lead = out.rationed_side === M.DEMAND ? "Shortage: " + fmt(willing) + " buyers want to buy at this price but only " + fmt(out.quantity) + " units are offered"
                                                 : "Excess supply: " + fmt(willing) + " sellers want to sell at this price but buyers take only " + fmt(out.quantity) + " units";
      var split = out.rationing_loss > 1e-9 ? " Deadweight loss " + fmt(out.deadweight_loss, 0) + ": " + fmt(out.deadweight_loss - out.rationing_loss, 0) + " from lost trades and " + fmt(out.rationing_loss, 0) + " from giving the units to the wrong people." : "";
      h += '<div class="note">' + esc(lead) + '. Rationing: ' + esc(how) + '.' + esc(split) + '</div>';
    }
    out.regions.forEach(function (rg) {
      if (rg.capped && rg.willing > rg.quantity + 1e-9) {
        var how2 = r.policy.rent_to === "government" ? "licences are auctioned, so the lowest-cost sellers buy them and the government keeps the rent"
                 : r.policy.rationing === "random" ? "licences are handed out by lottery, each willing seller sells with probability " + pct(rg.quantity / rg.willing)
                 : r.policy.rationing === "efficient" ? "licences go to the lowest-cost sellers" : "licences go to the highest-cost sellers willing at this price";
        h += '<div class="note">' + esc(rg.name) + ' is capped at ' + fmt(rg.quantity) + ' although ' + fmt(rg.willing) + ' would sell at this price; ' + esc(how2) + '.</div>';
      }
    });
    h += innerTabs("lab", [["outcomes", "Outcomes"], ["regions", "By region"], ["winners", "Winners and losers"]]);
    if (S.inner.lab === "outcomes") h += labOutcomes(r);
    else if (S.inner.lab === "regions") h += regionTable(out, base);
    else h += winnersHtml(out, base, r.groups);
    el.innerHTML = h;
    $("lab-pin-wrap").innerHTML = pinPanel("lab", M.describeLab(r.policy), 0);
    saveLocal();
  }
  function labOutcomes(r) {
    var out = r.out, base = r.base, rows = [["Market price", base.price, out.price]];
    var bp0 = uniformPrice(base, M.DEMAND), bp1 = uniformPrice(out, M.DEMAND), sp0 = uniformPrice(base, M.SUPPLY), sp1 = uniformPrice(out, M.SUPPLY);
    if (bp1 != null && bp0 != null && (Math.abs(bp1 - out.price) > 1e-9 || Math.abs(bp0 - base.price) > 1e-9)) rows.push(["Buyers pay (with tax)", bp0, bp1]);
    if (sp1 != null && sp0 != null && (Math.abs(sp1 - out.price) > 1e-9 || Math.abs(sp0 - base.price) > 1e-9)) rows.push(["Sellers receive (after tax)", sp0, sp1]);
    rows.push(["Quantity traded", base.quantity, out.quantity]);
    if (out.control_binding && out.shortage > 1e-9) rows.push([out.rationed_side === M.DEMAND ? "Shortage (excess demand)" : "Excess supply", 0, out.shortage]);
    rows.push(["Consumer surplus", base.consumer_surplus, out.consumer_surplus], ["Producer surplus", base.producer_surplus, out.producer_surplus]);
    if (Math.abs(out.tax_revenue) > 1e-9 || Math.abs(base.tax_revenue) > 1e-9) rows.push(["Tax revenue", base.tax_revenue, out.tax_revenue]);
    if (Math.abs(out.licence_rent) > 1e-9) rows.push(["Licence rent (government)", base.licence_rent, out.licence_rent]);
    rows.push(["Total surplus", base.total_surplus, out.total_surplus], ["Deadweight loss", base.deadweight_loss, out.deadweight_loss]);
    if (out.rationing_loss > 1e-9) rows.push(["  of which caused by the rationing rule", 0, out.rationing_loss]);
    var t = rows.map(function (x) { return [x[0], fmt(x[1]), fmt(x[2]), fmt(x[2] - x[1], 1, true)]; });
    t.push(["Demand elasticity at the outcome", fmt(base.elasticity_demand, 2), fmt(out.elasticity_demand, 2), ""]);
    t.push(["Supply elasticity at the outcome", fmt(base.elasticity_supply, 2), fmt(out.elasticity_supply, 2), ""]);
    var h = table3(t, ["Baseline", "Experiment", "Change"]);
    if (r.policy.cost_shock) h += '<p class="caption">Pass-through of the cost shock to the market price: ' + pct((out.price - base.price) / r.policy.cost_shock) + '.</p>';
    if (r.policy.benefit_boost) h += '<p class="caption">Share of the benefit boost showing up in the price: ' + pct((out.price - base.price) / r.policy.benefit_boost) + '.</p>';
    return h;
  }
  function regionTable(out, base) {
    var regs = out.regions.filter(function (r) { return r.willing > 0 || r.quantity > 0 || base.regions.some(function (b) { return b.name === r.name && b.quantity > 0; }); });
    if (!regs.length) return '<p class="caption">No regions with units.</p>';
    var anyRent = out.regions.some(function (x) { return x.rent; });
    var idx = ["Side", "Quantity", "Market share", "Surplus (profit or consumer surplus)", "Change in surplus", "Share of total surplus", "Price received / paid", "Tax paid"];
    if (anyRent) idx.push("Licence rent to government");
    if (out.rationed_side) idx.push("Willing at this price");
    var cols = regs.map(function (r) {
      var b = base.regions.filter(function (x) { return x.name === r.name; })[0];
      var c = [r.side.charAt(0).toUpperCase() + r.side.slice(1), fmt(r.quantity), pct(out.quantity > 0 ? r.quantity / out.quantity : 0), fmt(r.surplus),
               fmt(r.surplus - (b ? b.surplus : 0), 1, true), pct(out.total_surplus > 0 ? r.surplus / out.total_surplus : 0), fmt(r.net_price), fmt(r.tax)];
      if (anyRent) c.push(fmt(r.rent));
      if (out.rationed_side) c.push(fmt(r.willing));
      return c;
    });
    var h = '<table class="grid"><thead><tr><th></th>' + regs.map(function (r) { return '<th class="num">' + esc(r.name) + '</th>'; }).join("") + '</tr></thead><tbody>';
    idx.forEach(function (name, i) { h += '<tr><td>' + esc(name) + '</td>' + cols.map(function (c) { return '<td class="num">' + c[i] + '</td>'; }).join("") + '</tr>'; });
    return h + '</tbody></table>';
  }

  // ---- Externalities tab ------------------------------------------------------------
  function buildExt() {
    var e = S.ext;
    $("tab-ext").innerHTML =
      '<div class="row between"><p class="caption" style="margin:0">A market whose trades affect people outside it. Find the social optimum, then the policy that gets the market there.</p>' +
      '<div class="row"><button type="button" id="ext-reset-all">Reset everything</button><button type="button" id="ext-reset-pol">Reset policies</button></div></div>' +
      '<div class="note">' + esc(STORY) + '</div>' +
      '<details class="panel" id="ext-spec-panel"><summary>Market specification</summary><p class="caption">Each row is a segment: a Quantity of units whose values (buyers) or costs (sellers) are spread evenly from Pmin to Pmax. The default is the laboratory\'s market: 100 units over prices 0 to 100 on each side.</p>' +
      '<div class="cols"><div><b>Supply</b><div id="ext-supply-wrap"></div></div><div><b>Demand</b><div id="ext-demand-wrap"></div></div></div></details>' +
      '<div class="cols-4-8"><div>' +
      '<details class="panel" open><summary>The externality</summary><label for="ext-harm">Harm to third parties per unit traded</label><input type="number" id="ext-harm" step="5" value="' + e.harm + '" title="What each unit traded costs people outside the market. A negative number is a benefit to outsiders: a positive externality."></details>' +
      '<details class="panel" open><summary>Policy experiments</summary>' +
      '<label for="ext-tax-s">Tax on sellers (per unit)</label><input type="number" id="ext-tax-s" step="5" value="' + e.tax_supply + '" title="Sellers keep the price minus the tax. Negative for a subsidy.">' +
      '<label for="ext-tax-d">Tax on buyers (per unit)</label><input type="number" id="ext-tax-d" step="5" value="' + e.tax_demand + '" title="Buyers pay the price plus the tax. Negative for a subsidy.">' +
      '<label for="ext-cap">Permit cap on units traded (0 = no cap)</label><input type="number" id="ext-cap" min="0" step="5" value="' + e.cap + '" title="Only this many units may be traded. Permits are auctioned, so the lowest-cost sellers buy them and the government keeps the proceeds."></details>' +
      '</div><div id="ext-results"></div></div><div id="ext-pin-wrap"></div>';
    $("ext-supply-wrap").innerHTML = specTable("ext-supply", S.ext.supply, M.SUPPLY);
    $("ext-demand-wrap").innerHTML = specTable("ext-demand", S.ext.demand, M.DEMAND);
    var tab = $("tab-ext");
    bindSpec(tab, "ext-supply", function () { return S.ext.supply; }, function (r) { S.ext.supply = r; }, function (rb) { if (rb) $("ext-supply-wrap").innerHTML = specTable("ext-supply", S.ext.supply, M.SUPPLY); renderExt(); });
    bindSpec(tab, "ext-demand", function () { return S.ext.demand; }, function (r) { S.ext.demand = r; }, function (rb) { if (rb) $("ext-demand-wrap").innerHTML = specTable("ext-demand", S.ext.demand, M.DEMAND); renderExt(); });
    $("ext-reset-all").onclick = function () { S.ext = freshExt(); buildExt(); renderExt(); };
    $("ext-reset-pol").onclick = function () { S.ext.tax_supply = 0; S.ext.tax_demand = 0; S.ext.cap = 0; buildExt(); renderExt(); };
    ["ext-harm", "ext-tax-s", "ext-tax-d", "ext-cap"].forEach(function (id) { $(id).addEventListener("change", readExtInputs); });
    tab.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t.id === "ext-pin") { var r = computeExt(); if (r.err) return; doPin("ext", M.describeExt(r.policy, r.harm), M.measuresSocial(r.soc), M.measuresSocial(r.base), extState(r)); renderExt(); }
      else if (t.classList.contains("legend-item") && t.closest("#ext-results")) { var n = t.getAttribute("data-name"); S.hidden.ext[n] = !(S.hidden.ext[n] !== undefined ? S.hidden.ext[n] : t.classList.contains("off")); renderExt(); }
      else if (t.getAttribute && t.getAttribute("data-inner") && t.closest("#ext-results")) { S.inner.ext = t.getAttribute("data-inner"); renderExt(); }
    });
  }
  function readExtInputs() {
    S.ext.harm = num($("ext-harm").value, 0); S.ext.tax_supply = num($("ext-tax-s").value, 0); S.ext.tax_demand = num($("ext-tax-d").value, 0); S.ext.cap = num($("ext-cap").value, 0);
    renderExt();
  }
  function extPolicy() {
    var cap = num(S.ext.cap, 0);
    return M.defaultPolicy({ tax_supply: num(S.ext.tax_supply, 0), tax_demand: num(S.ext.tax_demand, 0), control: cap > 0 ? "quota" : "none", control_value: cap > 0 ? cap : null, rent_to: "government" });
  }
  function computeExt() {
    var market = rowsToMarket(S.ext.supply, S.ext.demand), policy = extPolicy(), harm = num(S.ext.harm, 0);
    try { var soc = M.solveSocial(market, policy, harm), base = M.solveSocial(market, {}, harm); return { market: market, policy: policy, harm: harm, soc: soc, base: base }; }
    catch (e) { return { err: e.message, policy: policy, harm: harm }; }
  }
  function extState(r) {
    var o = r.soc.out;
    return { page: "externality", supply: clone(S.ext.supply), demand: clone(S.ext.demand),
             policy: { harm: r.harm, tax_supply: r.policy.tax_supply, tax_demand: r.policy.tax_demand, cap: r.policy.control_value },
             outcome: { price: o.price, quantity: o.quantity, consumer_surplus: o.consumer_surplus, producer_surplus: o.producer_surplus, government_revenue: o.government_revenue,
                        third_party: r.soc.third_party, social_surplus: r.soc.social_surplus, opt_quantity: r.soc.opt_quantity, deadweight_loss: r.soc.deadweight_loss } };
  }
  function renderExt() {
    if (!$("ext-results")) return;
    var r = computeExt(), el = $("ext-results");
    if (r.err) { el.innerHTML = '<div class="error">' + esc(r.err) + '</div>'; $("ext-pin-wrap").innerHTML = pinPanel("ext", M.describeExt(r.policy, r.harm), EXT_QUESTION); return; }
    var soc = r.soc, out = soc.out, base = r.base;
    var h = '<div class="metrics">' + metric("Market price", out.price, base.out.price) + metric("Quantity traded", out.quantity, base.out.quantity) +
            metric("Socially optimal quantity", soc.opt_quantity, null, { help: "The quantity that makes everyone together, third parties included, best off: where the gap between buyers' values and sellers' costs equals the harm per unit." }) +
            metric("Deadweight loss", soc.deadweight_loss, base.deadweight_loss, { decimals: 0, inverse: true, help: "Social surplus lost relative to the social optimum. The loss can be positive before any policy: the market itself gets the quantity wrong." }) + '</div>';
    var fig = CH.externalityFigure(r.market, r.policy, soc), rend = CH.render(fig, S.hidden.ext);
    h += rend.svg + CH.legendHtml(rend.legend) + '<p class="caption">Click "Harm to third parties" in the legend to shade what the outsiders bear.</p>';
    if (out.flags.no_trade) h += '<div class="error">No trade: one side of the market is empty.</div>';
    if (out.flags.indeterminate_price) h += '<div class="info">Any price between ' + fmt(out.flags.price_interval[0]) + ' and ' + fmt(out.flags.price_interval[1]) + ' clears the market; the midpoint is shown.</div>';
    if (r.policy.control === "quota" && !out.control_binding && out.quantity > 0) h += '<p class="caption">The permit cap does not bind at these settings.</p>';
    h += innerTabs("ext", [["outcomes", "Outcomes"], ["winners", "Winners and losers"]]);
    if (S.inner.ext === "outcomes") h += extOutcomes(r);
    else h += winnersHtml(out, base.out, M.compare(base.out, out), [["People outside the market (third parties)", soc.third_party - base.third_party]]);
    el.innerHTML = h;
    $("ext-pin-wrap").innerHTML = pinPanel("ext", M.describeExt(r.policy, r.harm), EXT_QUESTION);
    saveLocal();
  }
  function extOutcomes(r) {
    var soc = r.soc, out = soc.out, base = r.base, b = base.out, harm = r.harm, rows = [["Market price", b.price, out.price]];
    var bp0 = uniformPrice(b, M.DEMAND), bp1 = uniformPrice(out, M.DEMAND), sp0 = uniformPrice(b, M.SUPPLY), sp1 = uniformPrice(out, M.SUPPLY);
    if (bp1 != null && bp0 != null && (Math.abs(bp1 - out.price) > 1e-9 || Math.abs(bp0 - b.price) > 1e-9)) rows.push(["Buyers pay (with tax)", bp0, bp1]);
    if (sp1 != null && sp0 != null && (Math.abs(sp1 - out.price) > 1e-9 || Math.abs(sp0 - b.price) > 1e-9)) rows.push(["Sellers receive (after tax)", sp0, sp1]);
    rows.push(["Quantity traded", b.quantity, out.quantity], ["Socially optimal quantity", base.opt_quantity, soc.opt_quantity],
              ["Consumer surplus", b.consumer_surplus, out.consumer_surplus], ["Producer surplus", b.producer_surplus, out.producer_surplus]);
    if (Math.abs(out.tax_revenue) > 1e-9 || Math.abs(b.tax_revenue) > 1e-9) rows.push([Math.min(out.tax_revenue, b.tax_revenue) < -1e-9 ? "Tax revenue (negative: subsidy paid)" : "Tax revenue", b.tax_revenue, out.tax_revenue]);
    if (Math.abs(out.licence_rent) > 1e-9 || Math.abs(b.licence_rent) > 1e-9) rows.push(["Permit revenue (government)", b.licence_rent, out.licence_rent]);
    rows.push(["Buyers, sellers and government together", base.private_surplus, soc.private_surplus]);
    if (harm >= 0) rows.push(["Harm to third parties", -base.third_party, -soc.third_party]); else rows.push(["Benefit to third parties", base.third_party, soc.third_party]);
    rows.push(["Social surplus (everyone, third parties included)", base.social_surplus, soc.social_surplus], ["Deadweight loss (against the social optimum)", base.deadweight_loss, soc.deadweight_loss]);
    return table3(rows.map(function (x) { return [x[0], fmt(x[1]), fmt(x[2]), fmt(x[2] - x[1], 1, true)]; }), ["Baseline (no policy)", "Experiment", "Change"]) +
           '<p class="caption">Baseline: the market with the externality and no policy. Social surplus is what buyers, sellers and the government get, less the harm to third parties.</p>';
  }

  // ---- Lab book tab ------------------------------------------------------------------
  function sameMarket(a, b) {
    return ["Market price", "Quantity traded"].every(function (k) { return a[k] != null && b[k] != null && Math.abs(a[k] - b[k]) <= 1e-6; });
  }
  function baselineName(e) {
    if (e.tab !== "externality") return "Baseline";
    var h = +(((e.state || {}).policy || {}).harm || 0);
    return "Baseline, " + (h >= 0 ? "harm " : "benefit ") + M.num(Math.abs(h));
  }
  function cell(x) { return x == null ? "–" : (typeof x === "string" ? x : fmt(x)); }
  function bookTable(entries) {
    var cols = [], foot = [], seen = {}, bases = {};
    entries.forEach(function (e) { var k = e.tab + "|" + baselineName(e); if (!bases[k]) { bases[k] = e.baseline; cols.push([baselineName(e), e.baseline, ""]); } });
    entries.forEach(function (e) {
      var label = (e.label || "Experiment").trim(), n = (seen[label] || 0) + 1; seen[label] = n; if (n > 1) label += " (" + n + ")";
      var base = bases[e.tab + "|" + baselineName(e)];
      if (!sameMarket(e.baseline, base)) { foot.push("† " + label + " was run on a different market; its own baseline has price " + cell(e.baseline["Market price"]) + " and quantity " + cell(e.baseline["Quantity traded"]) + "."); label += " †"; }
      cols.push([label, e.measures, e.note || ""]);
    });
    var rows = M.MEASURES.filter(function (m) { return cols.some(function (c) { return c[1][m] != null; }); });
    var h = '<div class="labbook-wrap"><table class="grid labbook"><thead><tr><th></th>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join("") + '</tr></thead><tbody>';
    rows.forEach(function (m) { h += '<tr><td>' + esc(m) + '</td>' + cols.map(function (c) { return '<td class="num">' + cell(c[1][m]) + '</td>'; }).join("") + '</tr>'; });
    h += '<tr><td>Note</td>' + cols.map(function (c) { return '<td class="note-cell">' + esc(c[2]) + '</td>'; }).join("") + '</tr></tbody></table></div>';
    foot.forEach(function (f) { h += '<p class="caption">' + esc(f) + '</p>'; });
    return h;
  }
  var saveAnswers = debounce(function () { enqueue(record("Assignment answers", "", { answers: clone(S.answers), labbook: { id: "answers", kind: "answers" } })); }, 1200);
  function editRows(entries) {
    var h = '<div class="edit-grid head"><div>Label</div><div>Section</div><div>Note</div><div></div></div>';
    entries.forEach(function (e) {
      h += '<div class="edit-grid" data-id="' + e.id + '"><input type="text" data-f="label" value="' + esc(e.label) + '" aria-label="Label">' +
           '<select data-f="question" aria-label="Section">' + QUESTIONS.map(function (q) { return '<option' + (q.title === e.question ? " selected" : "") + '>' + esc(q.title) + '</option>'; }).join("") + '</select>' +
           '<input type="text" data-f="note" value="' + esc(e.note) + '" placeholder="What does this column show?" aria-label="Note">' +
           '<button type="button" class="small remove-entry">Remove</button></div>';
    });
    return h;
  }
  function renderBook() {
    var el = $("tab-book"), who = S.group ? groupKey() + (groupNames() ? " \u00b7 " + groupNames() : "") : "";
    var h = '<p><b>Lab book' + (who ? " of " + esc(who) : "") + '</b></p>' +
            '<p class="caption">One section per question: the experiments you pinned for it, side by side with their baseline, and your answer. ' +
            'Pin from the Laboratory or Externalities tab; move a column to another section with its Section dropdown. Everything is saved as you go.</p>';
    if (!S.group) h += '<div class="info">Enter your group number at the top of the page to pin experiments and write answers.</div>';
    QUESTIONS.forEach(function (q) {
      var mine = S.book.filter(function (e) { return sectionOf(e) === q.id; });
      var answered = (S.answers[q.id] || "").trim().length > 0;
      h += '<section class="qsection" data-q="' + q.id + '"><h2>' + esc(q.title) + ' <span class="badge">' + mine.length + ' pinned' + (answered ? " \u00b7 answered" : "") + '</span></h2>' +
           '<details class="prompt"' + (mine.length || answered ? "" : " open") + '><summary>' + (q.id === "own" ? "About this section" : "The question") + '</summary><p>' + esc(q.prompt) + '</p></details>';
      if (mine.length) h += bookTable(mine) + '<details class="panel" open><summary>Labels, sections and notes</summary>' + editRows(mine) + '</details>';
      else h += '<p class="caption">Nothing pinned here yet.</p>';
      h += '<label for="ans-' + q.id + '">' + (q.id === "own" ? "What you learned from your own experiments" : "Your answer") + '</label>' +
           '<textarea id="ans-' + q.id + '" data-q="' + q.id + '" style="min-height:120px" placeholder="Numbers from the lab book, then the reasoning."' + (S.group ? "" : " disabled") + '>' + esc(S.answers[q.id] || "") + '</textarea></section>';
    });
    h += '<label for="book-notes">Notes for the debrief</label><textarea id="book-notes" placeholder="What surprised you? What would you ask the class? (Click outside the box to save.)"' + (S.group ? "" : " disabled") + '>' + esc(S.notes) + '</textarea>' +
         '<div id="book-status" class="status"></div>';
    el.innerHTML = h;
    el.querySelectorAll(".edit-grid[data-id]").forEach(function (row) {
      var id = row.getAttribute("data-id"), e = S.book.filter(function (x) { return x.id === id; })[0];
      row.addEventListener("change", function (ev) {
        var f = ev.target.getAttribute("data-f"); if (!f) return;
        if (f === "label") { var v = ev.target.value.trim(); if (v) e.label = v; } else e[f] = ev.target.value;
        saveLocal(); enqueue(entryRecord(e, false)); renderBook();
      });
      row.querySelector(".remove-entry").onclick = function () { S.book = S.book.filter(function (x) { return x.id !== id; }); saveLocal(); enqueue(entryRecord(e, true)); renderBook(); };
    });
    el.querySelectorAll("textarea[data-q]").forEach(function (ta) {
      var upd = function () { S.answers[ta.getAttribute("data-q")] = ta.value; saveLocal(); saveAnswers(); };
      ta.addEventListener("input", upd); ta.addEventListener("change", upd);
    });
    $("book-notes").addEventListener("change", function () { S.notes = $("book-notes").value; saveLocal(); enqueue(record("Notes for the debrief", S.notes, { labbook: { id: "notes", kind: "notes" } })); renderStatus(); });
    renderStatus();
  }

  // ---- loading a recorded state (instructor links) ------------------------------------
  function applyState(st) {
    if (!st) return;
    if (st.page === "externality") {
      S.ext = freshExt(); S.ext.supply = st.supply || S.ext.supply; S.ext.demand = st.demand || S.ext.demand;
      var p = st.policy || {}; S.ext.harm = num(p.harm, 0); S.ext.tax_supply = num(p.tax_supply, 0); S.ext.tax_demand = num(p.tax_demand, 0); S.ext.cap = num(p.cap, 0);
      buildExt(); renderExt(); showTab("ext"); $("hint").textContent = "Loaded into the Externalities tab."; $("hint").hidden = false;
    } else {
      S.lab = freshLab(); S.lab.supply = st.supply || S.lab.supply; S.lab.demand = st.demand || S.lab.demand;
      var q = st.policy || {}, pol = S.lab.policy;
      pol.cost_shock = num(q.cost_shock, 0); pol.benefit_boost = num(q.benefit_boost, 0); pol.tax_supply = num(q.tax_supply, 0); pol.tax_demand = num(q.tax_demand, 0);
      pol.control = q.control || "none"; pol.control_value = num(q.control_value, 0); pol.rationing = q.rationing || "efficient"; pol.rent_to = q.rent_to || "sellers";
      pol.regional = {};
      ["supply", "demand"].forEach(function (side) { Object.keys((q.regional || {})[side] || {}).forEach(function (n) { var rp = q.regional[side][n]; pol.regional[n] = { scale: 100 * num(rp.scale, 1), shift: num(rp.shift, 0), tax: num(rp.tax, 0), cap: num(rp.cap, 0) }; }); });
      buildLab(); renderLab(); showTab("lab"); $("hint").textContent = "Loaded into the Laboratory tab."; $("hint").hidden = false;
    }
  }
  function stateFromHash() {
    var m = /#state=([A-Za-z0-9_\-]+)/.exec(location.hash || "");
    if (!m) return null;
    try { var b64 = m[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(b64)))); } catch (e) { return null; }
  }

  // ---- init ----------------------------------------------------------------------------
  function init() {
    var qs = new URLSearchParams(location.search);
    S.classCode = (qs.get("class") || "").trim();
    S.lab = freshLab(); S.ext = freshExt();
    var last = loadStored("marketlab:" + S.classCode + ":last");
    if (last && last.number) S.group = last;
    mergeStored(loadStored(storeKey()));
    if (!S.lab.policy) S.lab = freshLab();
    buildLab(); buildExt();
    renderGroup(); renderLab(); renderExt(); renderBook();
    Array.prototype.forEach.call($("main-tabs").querySelectorAll("button"), function (b) { b.onclick = function () { showTab(b.getAttribute("data-tab")); }; });
    var st = stateFromHash();
    if (st) applyState(st); else showTab(S.tab || "lab");
    window.addEventListener("hashchange", function () { var s2 = stateFromHash(); if (s2) applyState(s2); });
    renderStatus(); flush();
    setInterval(flush, 30000);
  }
  document.addEventListener("DOMContentLoaded", init);
  window.MarketLabApp = { state: S, applyState: applyState };
})();
