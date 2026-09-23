/* ===== LAB UI, HELP, XP ===== */
const TOUR_BY = Object.fromEntries(TOURS.map(t => [t.id, t]));
const GUIDE_BY = Object.fromEntries(GUIDES.map(g => [g.id, g]));
const SETUP_BY = Object.fromEntries(SETUP.map(s => [s.id, s]));
function rich(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); }
function plain(s) { return String(s).replace(/\*\*/g, ""); }

/* ---------- XP ---------- */
function xpInfo() {
  let xp = 0;
  for (const k in S.qs) xp += 10 * Math.min(S.qs[k].c || 0, 3);
  xp += 50 * Object.keys(S.done).length + 30 * Object.keys(S.guides || {}).length + 25 * Object.keys(S.tours || {}).length + 15 * Object.keys(S.setup || {}).length + 20 * S.mocks.length;
  const per = 250;
  return { xp: xp, lvl: Math.floor(xp / per) + 1, into: xp % per, per: per };
}
function setupCount() { return SETUP.filter(s => S.setup[s.id]).length; }

/* ---------- context for Help ---------- */
let CTX = { label: "Home screen", detail: "", problems: [] };
function setCtx(label, detail, problems) { CTX = { label: label, detail: detail || "", problems: problems || [] }; paintFab(); }
function paintFab() { const f = $("#fab"); if (f) f.setAttribute("aria-label", "Help about: " + CTX.label); }

/* ---------- screen mock renderer ---------- */
function mockInner(r) {
  switch (r.t) {
    case "bar": return r.items.map(x => "<span>" + esc(x) + "</span>").join("");
    case "nav": return r.groups.map(g => (g[0] ? '<b class="mg">' + esc(g[0]) + "</b>" : "") + g[1].map(x => '<span class="mi">' + esc(x) + "</span>").join("")).join("");
    case "icons": return r.items.map(x => '<span class="mi c">' + esc(x) + "</span>").join("");
    case "cmd": return r.items.map(x => '<span class="mb">' + esc(x) + "</span>").join("");
    case "btn": return '<span class="mb wide">' + esc(r.label) + "</span>";
    case "input": return '<span class="minp">' + esc(r.label) + "</span>";
    case "title": return '<b class="mt">' + esc(r.h) + "</b>";
    case "text": return '<span class="mx">' + esc(r.h) + "</span>";
    case "header": return '<b class="mt">' + esc(r.h) + '</b><span class="mx">' + esc(r.s) + '</span><span class="mhf">' + r.fields.map(f => "<span><i>" + esc(f[0]) + ":</i> " + esc(f[1]) + "</span>").join("") + "</span>";
    case "bpf": return '<span class="mbpf">' + r.stages.map((s, k) => '<span class="' + (k < r.active ? "d" : k === r.active ? "a" : "") + '">' + esc(s) + "</span>").join("") + "</span>";
    case "tabs": return r.items.map((x, k) => '<span class="mtab' + (k === r.active ? " a" : "") + '">' + esc(x) + "</span>").join("");
    case "fields": return '<b class="mg">' + esc(r.h) + "</b>" + r.items.map(f => '<span class="mf"><i>' + esc(f[0]) + (f[2] ? ' <em>*</em>' : "") + "</i><span>" + esc(f[1]) + "</span></span>").join("");
    case "timeline": return '<b class="mg">Timeline <span class="mplus">+</span></b>' + r.items.map(f => '<span class="mtl"><i>' + esc(f[0]) + "</i>" + esc(f[1]) + "</span>").join("");
    case "chart": return '<span class="mx">' + esc(r.label) + '</span><span class="mch"><i style="height:80%"></i><i style="height:55%"></i><i style="height:38%"></i><i style="height:20%"></i></span>';
    case "list": return '<b class="mg">' + esc(r.h) + "</b>" + r.items.map(x => '<span class="mi">' + esc(x) + "</span>").join("");
    case "panel": return '<b class="mg">' + esc(r.h) + "</b>" + r.items.map(x => '<span class="ml">' + esc(x) + "</span>").join("");
    case "grid": return (r.cap ? '<span class="mx cap">' + esc(r.cap) + "</span>" : "") + '<table class="mgrid"><tr>' + r.cols.map(c => "<th>" + esc(c) + "</th>").join("") + "</tr>" + r.rows.map(row => "<tr>" + row.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") + "</table>";
    default: return "";
  }
}
/* opts: mode explore|quiz|show, hl: region id, cur: region id, marks: {id: "ok"|"bad"} */
function renderMock(tour, opts) {
  opts = opts || {};
  const pins = tour.regions.filter(r => r.pin);
  let h = '<div class="mock" role="group" aria-label="' + esc(tour.title) + ' screen">';
  tour.regions.forEach(r => {
    const pi = pins.indexOf(r);
    const cls = ["mr", "t-" + r.t];
    if (opts.hl === r.id || opts.cur === r.id) cls.push("hl");
    if (opts.marks && opts.marks[r.id]) cls.push(opts.marks[r.id]);
    const clickable = opts.mode === "quiz" || (opts.mode === "explore" && r.pin);
    h += '<div class="' + cls.join(" ") + '" style="left:' + r.x + "%;top:" + (r.y / 1.2).toFixed(2) + "%;width:" + r.w + "%;height:" + (r.h / 1.2).toFixed(2) + '%"' +
      (clickable ? ' data-act="treg" data-r="' + r.id + '" role="button" tabindex="0" aria-label="' + esc(r.pin ? r.pin.n : r.id) + '"' : "") + ">" + mockInner(r) +
      (opts.mode === "explore" && r.pin ? '<span class="pin' + (opts.cur === r.id ? " on" : "") + '">' + (pi + 1) + "</span>" : "") + "</div>";
  });
  return h + "</div>";
}

/* ---------- screen tours ---------- */
let TOUR = null;
function openTour(id) {
  closeOverlaysQuiet();
  const t = TOUR_BY[id];
  TOUR = { id: id, mode: "explore", i: 0, qi: 0, marks: {}, ans: [], quiz: shuffle(t.quiz) };
  showSheet(""); paintTour();
}
function paintTour(keep) {
  const t = TOUR_BY[TOUR.id]; const pins = t.regions.filter(r => r.pin);
  let h = '<div style="--lc:var(--s)">' + head("Screen tour, " + t.app, t.title) + '<section class="s-body">';
  h += '<div class="chips" style="margin:0 0 12px"><button class="chip' + (TOUR.mode === "explore" ? " on" : "") + '" data-act="tmode" data-m="explore">1. Explore</button><button class="chip' + (TOUR.mode === "quiz" ? " on" : "") + '" data-act="tmode" data-m="quiz">2. Find it quiz</button></div>';
  if (TOUR.mode === "explore") {
    const cur = pins[TOUR.i];
    setCtx("Screen tour: " + t.title + ", part " + (TOUR.i + 1) + " of " + pins.length + " (" + cur.pin.n + ")", cur.pin.d);
    h += renderMock(t, { mode: "explore", cur: cur.id });
    h += '<div class="tpanel"><span class="tnum">' + (TOUR.i + 1) + '</span><div><b>' + esc(cur.pin.n) + "</b><p>" + esc(cur.pin.d) + "</p>" + (cur.pin.tip ? '<p class="muted">' + esc(cur.pin.tip) + "</p>" : "") + "</div></div>";
    h += '<div class="row2"><button class="btn ghost" data-act="tprev"' + (TOUR.i === 0 ? " disabled" : "") + '>Previous</button>' +
      (TOUR.i < pins.length - 1 ? '<button class="btn lc" data-act="tnext">Next part (' + (TOUR.i + 2) + "/" + pins.length + ")</button>" : '<button class="btn lc" data-act="tmode" data-m="quiz">Start the quiz</button>') + "</div>";
    h += '<p class="muted small">Tap any numbered part on the screen. ' + esc(MOCK_NOTE) + "</p>";
  } else {
    const n = TOUR.quiz.length;
    if (TOUR.qi >= n) {
      const right = TOUR.ans.filter(Boolean).length;
      h += '<div class="result"><div class="score">' + right + "/" + n + "</div><p>" + (right === n ? "You know this screen." : "Explore again, then retry the quiz.") + "</p></div>";
      h += '<button class="btn wide lc" data-act="tourdone">' + (S.tours[TOUR.id] ? "Done" : "Mark tour complete") + '</button><button class="btn wide ghost" data-act="tretry">Retry the quiz</button>';
      setCtx("Screen tour quiz finished: " + t.title, "");
    } else {
      const q = TOUR.quiz[TOUR.qi]; const answered = TOUR.ans.length > TOUR.qi;
      setCtx("Screen tour quiz: " + t.title + ". Question: " + q.p, "");
      h += '<div class="qprompt"><span class="qmeta">Question ' + (TOUR.qi + 1) + " of " + n + "</span><b>Tap where you would click: " + esc(q.p) + "</b></div>";
      h += renderMock(t, { mode: answered ? "show" : "quiz", marks: TOUR.marks });
      if (answered) {
        const ok = TOUR.ans[TOUR.qi];
        h += '<p class="why"><b class="' + (ok ? "okc" : "badc") + '">' + (ok ? "Right." : "Not quite. The right spot is outlined in green.") + "</b> " + esc(q.w || "") + "</p>";
        h += '<button class="btn wide lc" data-act="tqnext">' + (TOUR.qi === n - 1 ? "See result" : "Next question") + "</button>";
      }
    }
  }
  setSheet(h + "</section></div>", keep);
}
function tourRegion(rid) {
  if (!TOUR) return;
  const t = TOUR_BY[TOUR.id];
  if (TOUR.mode === "explore") {
    const pins = t.regions.filter(r => r.pin); const k = pins.findIndex(r => r.id === rid);
    if (k >= 0) { TOUR.i = k; paintTour(true); }
    return;
  }
  const q = TOUR.quiz[TOUR.qi]; if (!q || TOUR.ans.length > TOUR.qi) return;
  const ok = rid === q.r;
  TOUR.marks = {}; TOUR.marks[q.r] = "ok"; if (!ok) TOUR.marks[rid] = "bad";
  TOUR.ans.push(ok); recordAnswer("tour:" + TOUR.id + ":" + q.r, ok); paintTour(true);
}

/* ---------- setup player ---------- */
let SET = null;
function openSetup(i) {
  closeOverlaysQuiet();
  if (i == null) { i = SETUP.findIndex(s => !S.setup[s.id]); if (i < 0) i = 0; }
  SET = { i: i, ans: {}, pres: {} };
  showSheet(""); paintSetup();
}
function paintSetup(keep) {
  const st = SETUP[SET.i]; const n = SETUP.length;
  if (!SET.pres[st.id]) SET.pres[st.id] = present(Object.assign({ id: "setup:" + st.id }, st.q));
  setCtx("Setup step " + (SET.i + 1) + " of " + n + ": " + st.title, st.steps.map(plain).join(" "), st.problems);
  let h = '<div style="--lc:var(--f)">' + head("Get set up, step " + (SET.i + 1) + " of " + n, st.title) + '<section class="s-body">';
  h += '<div class="progress"><i style="width:' + Math.round(setupCount() / n * 100) + '%;background:var(--f)"></i></div>';
  h += '<p class="lead">' + esc(st.why) + "</p>";
  h += '<h3 class="sec">Do this</h3><ol class="lab">' + st.steps.map(s => "<li>" + rich(s) + "</li>").join("") + "</ol>";
  if (st.link) h += '<a class="btn wide lc" href="' + esc(st.link.u) + '" target="_blank" rel="noopener noreferrer">' + esc(st.link.t) + " ↗</a>";
  if (st.tour) h += '<button class="btn wide ghost" data-act="tour" data-id="' + st.tour + '">Open the screen tour: ' + esc(TOUR_BY[st.tour].title) + "</button>";
  h += '<div class="world" style="--lc:var(--f)"><h3>You should see</h3><p>' + esc(st.see) + "</p></div>";
  h += problemsHtml(st.problems);
  h += '<h3 class="sec" style="margin-top:20px">Checkpoint</h3>' + qCard(SET.pres[st.id], SET.ans[st.id], "sq", 0);
  h += '<div class="row2"><button class="btn ghost" data-act="help">I\'m stuck</button><button class="btn lc" data-act="setnext"' + (SET.ans[st.id] == null ? " disabled" : "") + ">" + (SET.i === n - 1 ? "Finish setup" : "Done, next step") + "</button></div>";
  if (SET.ans[st.id] == null) h += '<p class="muted small">Answer the checkpoint to continue.</p>';
  h += '<div class="stepdots">' + SETUP.map((s, k) => '<button class="sd' + (S.setup[s.id] ? " ok" : "") + (k === SET.i ? " on" : "") + '" data-act="setgo" data-i="' + k + '" aria-label="Step ' + (k + 1) + '">' + (k + 1) + "</button>").join("") + "</div>";
  setSheet(h + "</section></div>", keep);
}
function problemsHtml(list) {
  if (!list || !list.length) return "";
  return '<details class="probs"><summary>If it doesn\'t work (' + list.length + ")</summary>" + list.map(p => "<div><b>" + esc(p[0]) + "</b><p>" + esc(p[1]) + "</p></div>").join("") + "</details>";
}

/* ---------- how-to guide player ---------- */
let G = null;
function openGuide(id) {
  closeOverlaysQuiet();
  const g = GUIDE_BY[id];
  G = { id: id, ticks: {}, show: -1, qs: g.quiz.map((q, k) => present(Object.assign({ id: "guide:" + id + ":" + k }, q))), ans: {}, cur: 0 };
  showSheet(""); paintGuide();
}
function paintGuide(keep) {
  const g = GUIDE_BY[G.id]; const done = g.steps.filter((s, k) => G.ticks[k]).length;
  const curStep = g.steps[Math.min(G.cur, g.steps.length - 1)];
  setCtx("How-to guide: " + g.title + " (" + g.where + "), step " + (G.cur + 1) + " of " + g.steps.length, plain(curStep.t), g.problems);
  let h = '<div style="--lc:var(--s)">' + head("How-to, " + g.where, g.title) + '<section class="s-body">';
  h += '<p class="lead">' + esc(g.goal) + '</p><div class="chips" style="margin:8px 0 14px"><span class="chip">' + esc(g.where) + '</span><span class="chip">About ' + g.mins + ' min</span>' + (g.lesson ? '<button class="chip" data-act="open" data-id="' + g.lesson + '">Lesson ' + g.lesson + "</button>" : "") + "</div>";
  h += '<div class="progress"><i style="width:' + Math.round(done / g.steps.length * 100) + '%;background:var(--s)"></i></div>';
  g.steps.forEach((s, k) => {
    const on = !!G.ticks[k];
    h += '<div class="gstep' + (on ? " ok" : "") + (k === G.cur ? " cur" : "") + '"><div class="gtop"><button class="gtick" data-act="gtick" data-i="' + k + '" aria-pressed="' + on + '" aria-label="Mark step ' + (k + 1) + ' done">' + (on ? "✓" : k + 1) + '</button><p>' + rich(s.t) + "</p></div>";
    h += '<div class="gacts">' + (s.see ? '<button class="chip" data-act="gshow" data-i="' + k + '">' + (G.show === k ? "Hide screen" : "Show me where") + "</button>" : "") + '<button class="chip" data-act="gstuck" data-i="' + k + '">Stuck here?</button></div>';
    if (G.show === k && s.see) h += '<div class="gmock">' + renderMock(TOUR_BY[s.see[0]], { mode: "show", hl: s.see[1] }) + '<p class="muted small">' + esc(TOUR_BY[s.see[0]].title) + ". The outlined part is where to click. " + esc(MOCK_NOTE) + "</p></div>";
    h += "</div>";
  });
  h += '<div class="world" style="--lc:var(--s)"><h3>Result</h3><p>' + esc(g.result) + "</p></div>";
  h += problemsHtml(g.problems);
  h += '<h3 class="sec" style="margin-top:20px">Quiz</h3>' + G.qs.map((it, k) => qCard(it, G.ans[k], "gq", k, "Question " + (k + 1) + " of " + G.qs.length)).join("");
  const allQ = Object.keys(G.ans).length >= G.qs.length;
  h += '<button class="btn wide lc" data-act="guidedone"' + (allQ ? "" : " disabled") + ">" + (S.guides[G.id] ? "Completed, back to Lab" : "Mark guide complete") + "</button>";
  if (!allQ) h += '<p class="muted small">Answer the quiz to complete the guide.</p>';
  setSheet(h + "</section></div>", keep);
}

/* ---------- LAB TAB ---------- */
function viewLab() {
  setCtx("Lab tab (setup, screen tours, how-to guides)", "");
  const sc = setupCount(); const n = SETUP.length;
  let h = '<section class="panel" style="--lc:var(--f)"><h2>Get set up</h2><p>Your own Dynamics 365 trial in 10 guided steps, each with a checkpoint question.</p>';
  h += '<div class="progress" style="margin-top:12px"><i style="width:' + Math.round(sc / n * 100) + '%;background:var(--f)"></i></div><p class="muted small">' + sc + " of " + n + " steps done</p>";
  h += '<div class="stepdots">' + SETUP.map((s, k) => '<button class="sd' + (S.setup[s.id] ? " ok" : "") + '" data-act="setupat" data-i="' + k + '" aria-label="' + esc(s.title) + '">' + (k + 1) + "</button>").join("") + "</div>";
  h += '<button class="btn wide lc" data-act="setup">' + (sc === 0 ? "Start setup" : sc < n ? "Continue setup" : "Review setup") + "</button></section>";
  h += '<section class="panel" style="--lc:var(--s)"><h2>Screen tours</h2><p>Tap through each real screen, then find the right button in a quiz.</p><div class="acts">' +
    TOURS.map(t => act(S.tours[t.id] ? "✅" : "🖥️", t.title, t.app + ", " + t.regions.filter(r => r.pin).length + " parts, " + t.quiz.length + "-question quiz", "tour", 'data-id="' + t.id + '"', "var(--s)")).join("") + "</div></section>";
  const gd = GUIDES.filter(g => S.guides[g.id]).length;
  h += '<section class="panel" style="--lc:var(--s)"><h2>How-to guides</h2><p>' + gd + " of " + GUIDES.length + ' done. Step by step, with “show me where” screens and a quiz.</p><input class="inp" id="gfilter" type="search" placeholder="Search guides, e.g. quote, role, column" aria-label="Search guides" style="margin-top:12px">';
  GUIDE_CATS.forEach((c, ci) => {
    const list = GUIDES.filter(g => g.cat === ci); if (!list.length) return;
    h += '<h3 class="gcat">' + esc(c) + '</h3><div class="acts">' + list.map(g => '<button class="act gitem" data-act="guide" data-id="' + g.id + '" data-s="' + esc((g.title + " " + g.where + " " + c).toLowerCase()) + '" style="--lc:var(--s)"><span class="ai" aria-hidden="true">' + (S.guides[g.id] ? "✅" : "📘") + "</span><span><b>" + esc(g.title) + "</b><small>" + esc(g.where) + ", " + g.steps.length + " steps, " + g.mins + " min</small></span></button>").join("") + "</div>";
  });
  h += "</section>";
  h += '<section class="panel"><h2>Stuck on a real screen?</h2><p>Tap the Help button, describe what you see, and send a screenshot of your Dynamics 365 screen. The coach will tell you what to click.</p><button class="btn wide" data-act="help">Open Help</button></section>';
  return h;
}

/* ---------- glossary (practice tab) ---------- */
function glossaryHtml() {
  const all = [];
  Object.keys(DECKS).forEach(k => DECKS[k].cards.forEach(c => all.push([c[0], c[1], DECKS[k].name])));
  all.sort((a, b) => a[0].localeCompare(b[0]));
  return '<section class="panel"><h2>Glossary</h2><p>' + all.length + ' terms. Type to search.</p><input class="inp" id="gloss" type="search" placeholder="Search a term, e.g. lookup" aria-label="Search glossary" style="margin-top:12px"><dl class="gloss">' +
    all.map(t => '<div data-s="' + esc((t[0] + " " + t[1]).toLowerCase()) + '"><dt>' + esc(t[0]) + '</dt><dd>' + esc(t[1]) + ' <small class="muted">' + esc(t[2]) + "</small></dd></div>").join("") + "</dl></section>";
}

/* ---------- lesson gates ---------- */
function gateHtml(step) {
  if (!P || !P.gates || !P.gates[step]) return "";
  return '<h3 class="sec" style="margin-top:22px">Checkpoint</h3>' + qCard(P.gates[step], P.gans[step], "gate", step);
}
function gateOpen(step) { return !P || !P.gates || !P.gates[step] || P.gans[step] != null; }

/* ===== HELP ===== */
const HELP = { img: null, imgURL: "", caps: null, copied: false };
function helpIndex() {
  return "Guides: " + GUIDES.map(g => g.id + " " + g.title).join("; ") + ". Tours: " + TOURS.map(t => t.id + " " + t.title).join("; ") + ". Lessons: " + LESSONS.map(l => l.id + " " + l.title).join("; ") + ". Setup steps: " + SETUP.map((s, k) => "setup" + (k + 1) + " " + s.title).join("; ") + ".";
}
function coachRules() {
  return "You are Parth's patient Dynamics 365 trainer and support desk inside his study app. About Parth: Customer Success Manager with 10+ years in FMCG/CPG distribution software (SFA, DMS, ERP integrations), a complete beginner in Dynamics 365, learning functional (not technical) consulting. Goal: pass AB-210 (Dynamics 365 Sales AI Consultant, successor to the retired MB-280), later MB-230, and move into D365 CE functional consulting. He uses a free 30-day Dynamics 365 Sales trial. " +
    "How to answer: very simple English, short sentences, under 170 words unless asked for more. When he is stuck on a screen, give numbered click-by-click steps naming the exact button or menu, and say what he should see after each step. If a screenshot is attached, first say in one line which screen it shows, then guide him. Microsoft renames buttons often: if something may look different, say what to look for instead. If you can't tell from his message, ask for a screenshot. Use one FMCG or SFA example only when it helps. Functional side only, no code. If you are unsure a detail is current in 2026, say so. " +
    "To point him to something in the app, write its code in double square brackets, for example [[H11]], [[T3]], [[F2]] or [[setup3]], on its own line. App index: " + helpIndex() + " Plain text: short paragraphs, dashes or numbers for lists, no headings or tables.";
}
function helpChips() {
  const c = [];
  if (/Setup|How-to|tour/i.test(CTX.label)) c.push("I'm stuck on this step");
  c.push("Explain this in simpler words");
  c.push("I see an error message");
  c.push("Quiz me on this");
  return c;
}
function openHelp(prefill, autoSend) {
  const h = $("#help"); h.hidden = false; document.body.classList.add("locked");
  paintHelp();
  if (!HELP.caps && COACH.status === "ready" && COACH.sample && COACH.sample.limits) {
    COACH.sample.limits().then(c => { HELP.caps = c; if (!$("#help").hidden) paintHelp(); }).catch(() => { HELP.caps = null; });
  }
  if (prefill) {
    if (autoSend && COACH.status === "ready") coachSend(prefill);
    else { const t = $("#helpbox"); if (t) { t.value = prefill; t.focus(); } }
  }
}
function closeHelp() { $("#help").hidden = true; if ($("#sheet").hidden) document.body.classList.remove("locked"); }
function linkTokens(html) {
  return html.replace(/\[\[(H\d{1,2}|T\d|[FSAI]\d|setup\d{1,2})\]\]/g, (m, id) => {
    let label = id;
    if (GUIDE_BY[id]) label = "Guide: " + GUIDE_BY[id].title;
    else if (TOUR_BY[id]) label = "Tour: " + TOUR_BY[id].title;
    else if (LESSON[id]) label = "Lesson: " + LESSON[id].title;
    else if (/^setup/.test(id)) { const k = +id.slice(5) - 1; if (!SETUP[k]) return m; label = "Setup step " + (k + 1) + ": " + SETUP[k].title; }
    else return m;
    return '<button class="chip jump" data-act="jump" data-id="' + id + '">' + esc(label) + " ›</button>";
  });
}
function helpLogHtml() {
  return COACH.turns.map(t => '<div class="msg ' + (t.role === "user" ? "me" : "bot") + '">' + (t.role === "user" ? esc(t.show || t.content) : linkTokens(mdLite(t.content))) + "</div>").join("") +
    (COACH.busy ? '<div class="msg bot" id="live">' + (COACH.live ? linkTokens(mdLite(COACH.live)) : '<span class="think">Thinking…</span>') + "</div>" : "");
}
function paintHelp() {
  const el = $("#help"); if (!el || el.hidden) return;
  let h = '<div class="sheet-in"><header class="s-head"><button class="icon" data-act="closehelp" aria-label="Close help">✕</button><div class="grow"><small>Help and questions</small><h2>Ask your trainer</h2></div></header><section class="s-body">';
  h += '<div class="ctx"><small>You are on</small><b>' + esc(CTX.label) + "</b></div>";
  if (COACH.status === "loading") h += '<p class="muted" style="margin-top:12px">Connecting…</p>';
  else if (COACH.status === "off") {
    h += '<p class="notice" style="margin-top:12px">The AI trainer is not switched on for this site yet (the server needs a free Gemini API key, see README). Meanwhile:</p>';
    if (CTX.problems && CTX.problems.length) h += '<h3 class="sec">Common fixes here</h3>' + CTX.problems.map(p => '<div class="world"><h3>' + esc(p[0]) + "</h3><p>" + esc(p[1]) + "</p></div>").join("");
    const q = "I'm learning Dynamics 365 Sales (beginner, functional side). I'm on: " + CTX.label + ". " + (CTX.detail ? "Details: " + CTX.detail + ". " : "") + "My question: ";
    h += '<h3 class="sec" style="margin-top:16px">Ask in a Claude chat</h3><p class="muted small">Copy this, paste it into a chat with Claude, and add your question (you can attach a screenshot there).</p><textarea class="inp" id="copyq" rows="4" readonly>' + esc(q) + '</textarea><button class="btn wide" data-act="copyq">' + (HELP.copied ? "Copied" : "Copy") + "</button>";
  } else {
    if (!COACH.turns.length) h += '<p class="muted small" style="margin-top:10px">Describe what you see, or send a screenshot of your Dynamics 365 screen.</p>';
    h += '<div class="chips">' + helpChips().map((c, k) => '<button class="chip" data-act="hchip" data-t="' + esc(c) + '">' + esc(c) + "</button>").join("") + "</div>";
    h += '<div class="log" id="log">' + helpLogHtml() + "</div>";
    if (COACH.err) h += '<p class="errline">' + esc(COACH.err) + "</p>";
    const canImg = !!(HELP.caps && HELP.caps.images);
    if (HELP.img) h += '<div class="imgprev">' + (HELP.imgURL ? '<img src="' + HELP.imgURL + '" alt="Your screenshot">' : '<span class="chip">📷 ' + esc(HELP.img.name || "screenshot") + "</span>") + '<button class="chip" data-act="noimg">Remove screenshot</button></div>';
    h += '<div class="composer help">' + (canImg ? '<label class="icon photo" aria-label="Attach a screenshot"><input type="file" id="shot" accept="' + esc((HELP.caps.images.mediaTypes || ["image/png", "image/jpeg"]).join(",")) + '" data-chg="shot" hidden>📷</label>' : "") +
      '<textarea id="helpbox" rows="1" placeholder="What are you stuck on?" aria-label="Your question"></textarea>' + (COACH.busy ? '<button class="btn" data-act="coachstop">Stop</button>' : '<button class="btn" data-act="coachsend">Send</button>') + "</div>";
    if (!canImg && HELP.caps) h += '<p class="muted small">Screenshots aren\'t available in this view. Describe the screen in words.</p>';
  }
  h += "</section></div>";
  const keepVal = $("#helpbox") ? $("#helpbox").value : "";
  el.innerHTML = h;
  const tb = $("#helpbox"); if (tb && keepVal) tb.value = keepVal;
  const log = $("#log"); if (log && log.lastElementChild) log.lastElementChild.scrollIntoView({ block: "end" });
}
function jumpTo(id) {
  closeHelp();
  if (GUIDE_BY[id]) openGuide(id);
  else if (TOUR_BY[id]) openTour(id);
  else if (LESSON[id]) { closeOverlaysQuiet(); openLesson(id); }
  else if (/^setup/.test(id)) openSetup(+id.slice(5) - 1);
}
async function coachSend(text) {
  text = String(text || "").trim();
  if (!text || COACH.busy || COACH.status !== "ready") return;
  const img = HELP.img;
  const ctxLine = "\n\n[Where I am in the study app: " + CTX.label + (CTX.detail ? ". What this step says: " + CTX.detail : "") + "]";
  COACH.turns.push({ role: "user", content: text + (img ? " (I attached a screenshot of my screen.)" : ""), show: text + (img ? "  📷 screenshot" : "") });
  COACH.busy = true; COACH.live = ""; COACH.err = ""; COACH.ctl = new AbortController();
  HELP.img = null; HELP.imgURL = "";
  paintHelp();
  const hist = COACH.turns.slice(-12).map((t, k, arr) => ({ role: t.role, content: k === arr.length - 1 ? t.content + ctxLine + (img ? "\nThe attached image is a screenshot of my screen. Tell me where I am and exactly what to click next." : "") : t.content }));
  const opts = { system: coachRules(), signal: COACH.ctl.signal, onText: ({ text }) => { COACH.live = text; const el = $("#live"); if (el) el.innerHTML = linkTokens(mdLite(text)); } };
  if (img) opts.images = [img];
  try {
    const res = await COACH.sample(hist, opts);
    COACH.turns.push({ role: "assistant", content: res.text });
    touch(); save();
  } catch (e) {
    const code = e && e.code;
    if (e && e.text) COACH.turns.push({ role: "assistant", content: e.text });
    if (code !== "cancelled") {
      if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) COACH.status = "off";
      else if (code === "images_unavailable" || code === "image_rejected") COACH.err = "That screenshot couldn't be sent. Try a PNG or JPG, or describe the screen in words.";
      else COACH.err = coachErr(code);
    }
  } finally {
    COACH.busy = false; COACH.live = ""; COACH.ctl = null; paintHelp();
  }
}
function pickShot(file) {
  if (!file) return;
  const lim = HELP.caps && HELP.caps.images;
  if (lim && lim.maxInputBytes && file.size > lim.maxInputBytes) { COACH.err = "That image is too large. Crop it or send a smaller screenshot."; paintHelp(); return; }
  HELP.img = file; COACH.err = ""; HELP.imgURL = "";
  try {
    const fr = new FileReader();
    fr.onload = () => { if (HELP.img === file) { HELP.imgURL = String(fr.result || ""); paintHelp(); } };
    fr.readAsDataURL(file);
  } catch (e) { }
  paintHelp();
}
