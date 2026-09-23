"use strict";
/* ===== helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LESSON = Object.fromEntries(LESSONS.map(l => [l.id, l]));
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function dkey(d = new Date()) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function parseKey(k) { const p = String(k).split("-").map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); }
function dayDiff(a, b) { return Math.round((parseKey(dkey(b)) - parseKey(dkey(a))) / 86400000); }
function fmtDate(d) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "link"; } }
function allQuestions() { return QUESTIONS.concat(S.extra || []); }
function qById(id) { return allQuestions().find(q => q.id === id); }

/* ===== state & saving ===== */
const LS_KEY = "d365route.v1";
function freshState() {
  return { v: 2, done: {}, qs: {}, cards: {}, tasks: {}, days: {}, mocks: [], extra: [], guides: {}, tours: {}, setup: {}, notes: {}, voice: true, rate: 1, theme: "auto", exams: { "210": "2026-11-12", "730": "2026-11-26" } };
}
function mergeState(s) {
  const b = freshState();
  if (!s || typeof s !== "object") return b;
  for (const k of Object.keys(b)) {
    if (s[k] !== undefined && s[k] !== null && typeof s[k] === typeof b[k] && Array.isArray(s[k]) === Array.isArray(b[k])) b[k] = s[k];
  }
  const oldPlan = !(s.v >= 2);
  b.exams = Object.assign(freshState().exams, (!oldPlan && s.exams && typeof s.exams === "object") ? s.exams : {});
  if (oldPlan) b.tasks = {};
  b.v = 2;
  return b;
}
function combine(a, b) { /* merge two progress states without losing either side */
  const o = mergeState(b);
  for (const k of Object.keys(a.done)) if (!o.done[k]) o.done[k] = a.done[k];
  for (const k of Object.keys(a.qs)) if (!o.qs[k] || (a.qs[k].n || 0) > (o.qs[k].n || 0)) o.qs[k] = a.qs[k];
  for (const k of Object.keys(a.cards)) o.cards[k] = Math.max(o.cards[k] || 0, a.cards[k] || 0);
  for (const k of Object.keys(a.tasks)) if (a.tasks[k]) o.tasks[k] = true;
  ["guides", "tours", "setup", "notes"].forEach(f => { for (const k of Object.keys(a[f] || {})) if (!o[f][k]) o[f][k] = a[f][k]; });
  for (const k of Object.keys(a.days)) o.days[k] = 1;
  const seen = new Set(o.mocks.map(m => m.x + m.at + m.s));
  a.mocks.forEach(m => { if (!seen.has(m.x + m.at + m.s)) o.mocks.push(m); });
  const ids = new Set(o.extra.map(q => q.id));
  a.extra.forEach(q => { if (!ids.has(q.id)) o.extra.push(q); });
  return o;
}
function hasProgress(s) { return Object.keys(s.done).length + Object.keys(s.qs).length + Object.keys(s.cards).length + Object.keys(s.tasks).length + Object.keys(s.setup || {}).length + Object.keys(s.guides || {}).length > 0; }
let S = freshState();
const store = { mode: "memory", ref: null, writing: false, dirty: false, timer: null };
function loadLocal() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) S = mergeState(JSON.parse(raw)); store.mode = "device"; }
  catch (e) { store.mode = "memory"; }
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { }
  clearTimeout(store.timer);
  store.timer = setTimeout(flush, 1200);
}
async function flush() {
  if (!store.ref) return;
  if (store.writing) { store.dirty = true; return; }
  store.writing = true;
  try { await store.ref.set({ json: JSON.stringify(S), at: Date.now() }); }
  catch (e) {
    if (e && ["revoked", "not_granted", "invalid_argument", "capability_disabled", "capability_removed"].includes(e.code)) { store.ref = null; store.mode = "device"; paintSync(); }
  } finally {
    store.writing = false;
    if (store.dirty) { store.dirty = false; flush(); }
  }
}
async function connectCloud() {
  try {
    if (!window.claude || typeof window.claude.use !== "function") return;
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    const ref = db.doc("data/users/" + uid + "/progress");
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      try { S = combine(S, JSON.parse(d.json)); } catch (e) { }
    }
    store.ref = ref; store.mode = "cloud";
    if (hasProgress(S)) flush();
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { }
    applyTheme(); paintSync();
    if (!$("#sheet").hidden) return; /* don't disturb an open lesson */
    render();
  } catch (e) { /* stay on device storage */ }
}
function touch() {
  S.days[dkey()] = 1;
  const keys = Object.keys(S.days).sort();
  while (keys.length > 150) delete S.days[keys.shift()];
}
function streak() {
  let n = 0; const d = new Date();
  if (!S.days[dkey(d)]) d.setDate(d.getDate() - 1);
  while (S.days[dkey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function recordAnswer(id, ok) {
  const r = S.qs[id] || { n: 0, c: 0, last: 0 };
  r.n += 1; r.c += ok ? 1 : 0; r.last = ok ? 1 : 0;
  S.qs[id] = r; touch(); save();
}

/* ===== plan maths ===== */
const START = new Date(PLAN_START[0], PLAN_START[1], PLAN_START[2]);
function weekIndex() { const d = dayDiff(START, new Date()); return Math.max(0, Math.min(WEEKS.length - 1, Math.floor(d / 7))); }
function weekRange(i) { const a = new Date(START); a.setDate(a.getDate() + i * 7); const b = new Date(a); b.setDate(b.getDate() + 6); return fmtDate(a) + " to " + fmtDate(b); }
function daysTo(k) { if (!k) return null; return dayDiff(new Date(), parseKey(k)); }
function bestMock(x) { const m = S.mocks.filter(m => m.x === x); return m.length ? Math.max(...m.map(m => m.s)) : null; }
function nextStop() {
  for (const id of ROUTE) {
    if (EXAM_STOPS[id]) { if (bestMock(EXAM_STOPS[id].exam) == null) return id; continue; }
    if (!S.done[id]) return id;
  }
  return null;
}

/* ===== speech ===== */
function speechOK() { return typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined"; }
let VOICE = null;
function pickVoice() {
  if (VOICE || !speechOK()) return VOICE;
  try {
    const vs = speechSynthesis.getVoices() || [];
    VOICE = vs.find(v => /en[-_]IN/i.test(v.lang)) || vs.find(v => /en[-_]GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  } catch (e) { VOICE = null; }
  return VOICE;
}
if (speechOK()) { try { speechSynthesis.addEventListener("voiceschanged", () => { VOICE = null; }); } catch (e) { } }
function stopSpeech() { try { if (speechOK()) speechSynthesis.cancel(); } catch (e) { } }
function speak(text, onDone) {
  let finished = false;
  const fin = () => { if (finished) return; finished = true; clearTimeout(safety); if (onDone) onDone(); };
  const safety = setTimeout(fin, readMs(text) * 2 + 2500);
  if (!(S.voice && speechOK())) { clearTimeout(safety); setTimeout(fin, readMs(text)); return; }
  try {
    stopSpeech();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-IN";
    u.rate = S.rate; u.onend = fin; u.onerror = fin;
    speechSynthesis.speak(u);
  } catch (e) { setTimeout(fin, readMs(text)); }
}
function readMs(t) { return Math.max(3500, (t.length * 58) / S.rate); }

/* ===== chrome ===== */
function applyTheme() { if (S.theme === "light" || S.theme === "dark") document.documentElement.setAttribute("data-theme", S.theme); else document.documentElement.removeAttribute("data-theme"); }
function paintSync() {
  const el = $("#sync"); if (!el) return;
  const t = store.mode === "cloud" ? "Progress saved to your account" : store.mode === "device" ? "Progress saved on this device" : "Progress not saved in this view";
  el.className = "sync " + store.mode; el.innerHTML = "<i></i>"; el.title = t; el.setAttribute("aria-label", t); el.setAttribute("role", "img");
}
function paintHeader() { const s = streak(); const x = xpInfo(); const el = $("#streak"); if (el) { el.textContent = "Lv " + x.lvl + (s ? "  🔥 " + s : ""); el.title = x.xp + " XP" + (s ? ", " + s + "-day streak" : ""); } paintSync(); }
let toastT = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
/* Every study screen opens inside the course player: content, then lecture navigation and tabs,
 * with a "Course content" sidebar (desktop) or drawer (phone). The chrome is built once and kept
 * while you move between items, so the sidebar keeps its scroll position. */
function showSheet(html) {
  const sh = $("#sheet");
  if (sh.hidden || !$("#pmain")) {
    sh.innerHTML = '<div class="player">' + playerTop() + '<div class="p-body"><div class="p-main" id="pmain"><div class="sheet-in"></div><div class="p-extra" id="pextra"></div></div><aside class="p-side" id="pside" aria-label="Course content"></aside></div></div>';
    sh.hidden = false; document.body.classList.add("locked", "insheet");
  }
  if (!wideScreen()) document.body.classList.remove("cc-t");
  setSheet(html);
}
function setSheet(html, keepScroll) {
  const sh = $("#sheet"), main = $("#pmain"); const y1 = sh.scrollTop, y2 = main.scrollTop;
  $("#pmain > .sheet-in").innerHTML = html;
  paintCourse();
  sh.scrollTop = keepScroll ? y1 : 0; main.scrollTop = keepScroll ? y2 : 0;
}
function closeSheet() {
  stopSpeech();
  if (P) { clearTimeout(P.timer); P = null; }
  if (M && M.tick) clearInterval(M.tick);
  D = null; M = null; F = null; SIM = null; G = null; TOUR = null; SET = null;
  PC.last = null;
  const sh = $("#sheet"); sh.hidden = true; sh.innerHTML = ""; document.body.classList.remove("locked", "insheet");
  if (!wideScreen()) document.body.classList.remove("cc-t");
  render();
}
function head(small, title) {
  return '<header class="s-head"><button class="icon" data-act="close" aria-label="Close">✕</button><div class="grow"><small>' + esc(small) + "</small><h2>" + esc(title) + '</h2></div><button class="icon cc-btn" data-act="curr" aria-label="Course content">☰</button><button class="hbtn" data-act="help" aria-label="Help">? Help</button></header>';
}

/* ===== COURSE PLAYER (Udemy-style chrome) ===== */
const PC = { last: null, tab: "overview", open: new Set(), reveal: false };
function wideScreen() { return window.matchMedia("(min-width: 1024px)").matches; }
function curItem() { if (P) return "L:" + P.id; if (M) return "X:" + M.x; if (TOUR) return "T:" + TOUR.id; if (G) return "G:" + G.id; if (SET) return "setup"; return ""; }
function fmtMins(m) { return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60 ? (m % 60) + "m" : "") : m + "m"; }
function courseSections() {
  const secs = [{ key: "start", title: "Get started", items: [{ key: "setup", icon: "🛠️", title: "Set up your own Dynamics 365 trial", meta: SETUP.length + " steps", mins: 45, done: setupCount() === SETUP.length, act: 'data-act="setup"' }] }];
  let sec = null;
  ROUTE.forEach(id => {
    if (EXAM_STOPS[id]) {
      const x = EXAM_STOPS[id].exam; const ex = EXAMS[x];
      sec.items.push({ key: "X:" + x, icon: "📝", title: ex.code + " mock exam", meta: ex.mock + " questions", mins: ex.mins, done: bestMock(x) != null, act: 'data-act="mock" data-exam="' + x + '"' });
      return;
    }
    const L = LESSON[id];
    if (!sec || sec.line !== L.line) { sec = { key: "line" + L.line, line: L.line, title: LINES[L.line].name, items: [] }; secs.push(sec); }
    sec.items.push({ key: "L:" + id, icon: "▶", title: L.title, meta: L.scenes.length + " scenes", mins: L.mins, done: !!S.done[id], act: 'data-act="open" data-id="' + id + '"' });
  });
  secs.push({ key: "tours", title: "Screen tours", items: TOURS.map(t => ({ key: "T:" + t.id, icon: "🖥️", title: t.title, meta: t.app, done: !!S.tours[t.id], act: 'data-act="tour" data-id="' + t.id + '"' })) });
  secs.push({ key: "guides", title: "How-to guides", items: GUIDES.map(g => ({ key: "G:" + g.id, icon: "📘", title: g.title, meta: g.steps.length + " steps", mins: g.mins, done: !!S.guides[g.id], act: 'data-act="guide" data-id="' + g.id + '"' })) });
  return secs;
}
function playerTop() {
  const ex = EXAMS["210"];
  return '<header class="p-top"><button class="p-back" data-act="close" aria-label="Back to your dashboard">✕</button><span class="p-brand">Route to D365</span><span class="p-course">' + esc(ex.code + ": " + ex.name) + '</span><span class="p-prog" id="pprog"></span><button class="p-btn" data-act="help">? Ask the trainer</button><button class="p-btn" data-act="curr">Course content</button></header>';
}
function paintCourse() {
  const side = $("#pside"); if (!side) return;
  const secs = courseSections(); const all = secs.flatMap(s => s.items); const cur = curItem();
  if (cur !== PC.last) {
    PC.last = cur; PC.tab = "overview"; PC.reveal = true;
    const s = secs.find(s => s.items.some(i => i.key === cur)); if (s) PC.open.add(s.key);
  }
  const y = side.scrollTop;
  side.innerHTML = '<div class="cs-head"><h2>Course content</h2><button class="icon cs-x" data-act="curr" aria-label="Hide course content">✕</button></div>' + secs.map((s, si) => {
    const n = s.items.filter(i => i.done).length; const mins = s.items.reduce((a, i) => a + (i.mins || 0), 0);
    return '<details class="cs-sec" data-sec="' + s.key + '"' + (PC.open.has(s.key) ? " open" : "") + '><summary><b>Section ' + (si + 1) + ": " + esc(s.title) + "</b><small>" + n + " / " + s.items.length + (mins ? " | " + fmtMins(mins) : "") + "</small></summary>" +
      s.items.map((it, k) => '<button class="cs-item' + (it.key === cur ? " on" : "") + (it.done ? " done" : "") + '" ' + it.act + (it.key === cur ? ' aria-current="true"' : "") + '><span class="cs-tick" aria-hidden="true"></span><span class="cs-t"><span>' + (k + 1) + ". " + esc(it.title) + (it.done ? '<span class="sr">, completed</span>' : "") + "</span><small>" + it.icon + " " + esc(it.meta) + (it.mins ? " · " + it.mins + " min" : "") + "</small></span></button>").join("") + "</details>";
  }).join("");
  side.scrollTop = y;
  if (PC.reveal) { PC.reveal = false; const on = side.querySelector(".cs-item.on"); if (on) on.scrollIntoView({ block: "nearest" }); }
  const done = all.filter(i => i.done).length; const pct = all.length ? done / all.length : 0;
  const pr = $("#pprog");
  if (pr) pr.innerHTML = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + (pct * 94.25).toFixed(1) + ' 94.25" transform="rotate(-90 18 18)"/></svg><span>' + done + " of " + all.length + " complete</span>";
  paintExtra(all, cur);
}
function paintExtra(all, cur) {
  const ex = $("#pextra"); if (!ex) return;
  if (!all) { all = courseSections().flatMap(s => s.items); cur = curItem(); }
  const i = all.findIndex(it => it.key === cur);
  if (i < 0) { ex.innerHTML = ""; return; }
  const prev = all[i - 1], next = all[i + 1];
  let h = '<nav class="p-nav" aria-label="Lecture navigation">' + (prev ? '<button class="btn ghost small" ' + prev.act + '><span>‹ Previous</span><small>' + esc(prev.title) + "</small></button>" : "<span></span>") +
    (next ? '<button class="btn small" ' + next.act + '><span>Next ›</span><small>' + esc(next.title) + "</small></button>" : "") + "</nav>";
  if (P) h += lessonTabs(LESSON[P.id]);
  ex.innerHTML = h;
}
function lessonTabs(L) {
  const tabs = [["overview", "Overview"], ["notes", "Notes"], ["resources", "Resources"], ["qa", "Ask the trainer"]];
  let pane = "";
  if (PC.tab === "notes") {
    pane = '<label class="fld"><span>Your notes for this lecture, saved in this browser</span><textarea class="pnote" id="pnote" data-id="' + L.id + '" rows="7" placeholder="Type your notes here…">' + esc(S.notes[L.id] || "") + '</textarea></label><p class="muted small" id="pnotesaved" aria-live="polite"></p>';
  } else if (PC.tab === "resources") {
    const gs = GUIDES.filter(g => g.lesson === L.id);
    pane = '<div class="links">' + L.links.map(linkHtml).join("") + "</div>" +
      (gs.length ? '<h3 class="sec" style="margin-top:20px">Step-by-step guides</h3><div class="acts">' + gs.map(g => act(S.guides[g.id] ? "✅" : "📘", g.title, g.where + ", " + g.steps.length + " steps", "guide", 'data-id="' + g.id + '"', "var(--s)")).join("") + "</div>" : "");
  } else if (PC.tab === "qa") {
    pane = '<p class="muted">Ask the AI trainer anything about this lecture. It knows which lecture you are on.</p><div class="chips">' +
      ["Explain this lecture in simpler words", "Give me a real FMCG example of this", "Quiz me with 3 questions on this lecture", "What do people get wrong about this in the exam?"].map(q => '<button class="chip" data-act="askl" data-t="' + esc(q) + '">' + esc(q) + "</button>").join("") + "</div>";
  } else {
    pane = '<p class="muted">' + esc(LINES[L.line].name) + " · Station " + L.id + " · " + L.mins + " min · " + L.scenes.length + " animated scenes with checkpoint questions</p>" +
      '<div class="learn"><h3>What you\'ll learn</h3><ul>' + L.keys.map(k => "<li>" + esc(k) + "</li>").join("") + "</ul></div>";
  }
  return '<div class="p-tabs" role="tablist" aria-label="About this lecture">' + tabs.map(t => '<button role="tab" data-act="ptab" data-t="' + t[0] + '" aria-selected="' + (PC.tab === t[0]) + '">' + t[1] + "</button>").join("") + '</div><div class="p-pane" role="tabpanel">' + pane + "</div>";
}

/* ===== ROUTE (home) ===== */
let TAB = "route";
function render() {
  const v = $("#view");
  v.dataset.tab = TAB; /* lets the desktop CSS lay out each tab differently */
  if (TAB === "route") v.innerHTML = viewRoute();
  else if (TAB === "practice") v.innerHTML = viewPractice();
  else if (TAB === "lab") v.innerHTML = viewLab();
  else v.innerHTML = viewPlan();
  if (TAB === "route") setCtx("Home: route map and today's plan", ""); else if (TAB === "practice") setCtx("Practice tab (drills, flashcards, mocks, glossary)", ""); else if (TAB === "plan") setCtx("Plan tab (8-week schedule and exams)", "");
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === TAB ? "page" : "false"));
  paintHeader();
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
function examChip(x) {
  const n = daysTo(S.exams[x]); const code = EXAMS[x].code;
  if (n == null) return "";
  return '<span class="chip">' + esc(code) + (n > 0 ? " in " + n + " days" : n === 0 ? " today" : ": date passed") + "</span>";
}
function viewRoute() {
  const nx = nextStop(); const wi = weekIndex(); const wk = WEEKS[wi];
  let h = '<section class="today"><p class="hello">' + greeting() + ', Parth</p><h1>Week ' + (wi + 1) + " of 8: " + esc(wk.focus) + "</h1>";
  const xi = xpInfo();
  h += '<div class="xp"><span>Level ' + xi.lvl + '</span><div class="bar"><i class="good" style="width:' + Math.round(xi.into / xi.per * 100) + '%"></i></div><span>' + xi.xp + " XP</span></div>";
  const sc = setupCount();
  if (sc < SETUP.length) h += '<div class="next" style="--lc:var(--f)"><small>' + (sc === 0 ? "Start here" : "Keep going") + '</small><b>Get set up: your own Dynamics 365</b><span class="meta">' + sc + " of " + SETUP.length + ' guided steps done, about 45 minutes</span><button class="btn lc" data-act="setup">' + (sc === 0 ? "Start setup" : "Continue setup") + "</button></div>";
  if (nx && EXAM_STOPS[nx]) {
    const ex = EXAMS[EXAM_STOPS[nx].exam];
    h += '<div class="next" style="--lc:var(--x)"><small>Next stop</small><b>' + esc(ex.code) + ' mock exam</b><span class="meta">' + ex.mock + " questions, " + ex.mins + ' minutes</span><button class="btn" data-act="mock" data-exam="' + EXAM_STOPS[nx].exam + '">Start mock exam</button></div>';
  } else if (nx) {
    const L = LESSON[nx]; const ln = LINES[L.line];
    h += '<div class="next" style="--lc:' + ln.color + '"><small>Next stop on the ' + esc(ln.name) + "</small><b>" + esc(L.title) + '</b><span class="meta">' + L.scenes.length + " animated scenes, about " + L.mins + ' min</span><button class="btn lc" data-act="open" data-id="' + nx + '">▶ Play lesson</button></div>';
  } else {
    h += '<div class="next" style="--lc:var(--ok)"><small>Route complete</small><b>Every station done</b><span class="meta">Keep drilling weak spots until exam day.</span><button class="btn" data-act="drill" data-f="weak">Drill weak spots</button></div>';
  }
  h += '<div class="chips">' + examChip("210") + "</div></section>";
  h += '<section class="route" aria-label="Your route map">';
  let last = null;
  ROUTE.forEach((id, idx) => {
    if (EXAM_STOPS[id]) {
      const E = EXAM_STOPS[id]; const ex = EXAMS[E.exam]; const best = bestMock(E.exam);
      h += '<button class="stop exam ' + (best != null ? "done " : "") + (nx === id ? "here " : "") + (idx === ROUTE.length - 1 ? "last" : "") + '" style="--lc:var(--x)" data-act="mock" data-exam="' + E.exam + '"><span class="rail"><span class="node sq"></span></span><span class="lbl"><b>' + esc(ex.code) + ' exam stop</b><small>' + (best != null ? "Best mock score: " + best + " / 1000" : esc(E.sub)) + "</small></span></button>";
      last = null; return;
    }
    const L = LESSON[id]; const ln = LINES[L.line]; const done = !!S.done[id];
    if (L.line !== last) {
      h += '<div class="line-head" style="--lc:' + ln.color + '"><span class="badge">' + L.line + '</span><div><h2>' + esc(ln.name) + "</h2><p>" + esc(ln.when) + ": " + esc(ln.blurb) + "</p></div></div>";
      last = L.line;
    }
    h += '<button class="stop ' + (done ? "done " : "") + (nx === id ? "here" : "") + '" style="--lc:' + ln.color + '" data-act="open" data-id="' + id + '"><span class="rail"><span class="node"></span></span><span class="lbl"><b>' + esc(L.title) + "</b><small>" + id + ", " + L.mins + " min" + (done ? ", done" : "") + (nx === id ? ", you are here" : "") + "</small></span></button>";
  });
  h += "</section>";
  return h;
}

/* ===== LESSON PLAYER ===== */
let P = null;
function present(q) {
  const opts = shuffle(q.o.map((t, i) => ({ t: t, ok: i === q.a })));
  return { id: q.id, q: q.q, opts: opts, w: q.w, x: q.x, d: q.d };
}
function openLesson(id, step) {
  stopSpeech();
  const qs = shuffle(QUESTIONS.filter(q => q.l === id)).slice(0, 4).map(present);
  const pool = shuffle(QUESTIONS.filter(q => q.l === id));
  P = { id: id, step: step || 0, scene: 0, playing: false, timer: null, qset: qs, ans: {}, stamped: false, gates: [pool[0], pool[1 % pool.length], pool[2 % pool.length]].map(q => q ? present(q) : null), gans: {} };
  showSheet(""); paintPlayer();
}
function paintPlayer(keep) {
  const L = LESSON[P.id]; const ln = LINES[L.line];
  const steps = ["Watch", "Learn", "Try", "Check"];
  setCtx("Lesson " + L.id + ": " + L.title + ", stage " + steps[P.step], "Key ideas: " + L.keys.join(" "), []);
  let h = '<div style="--lc:' + ln.color + '">' + head(ln.name + ", station " + L.id, L.title);
  h += '<nav class="p-bpf" aria-label="Lesson stages">' + steps.map((s, i) => '<button class="cv ' + (i < P.step ? "done " : "") + (i === P.step ? "on" : "") + '" data-act="pstep" data-i="' + i + '"' + (i === P.step ? ' aria-current="step"' : "") + ">" + s + "</button>").join("") + "</nav>";
  h += '<section class="s-body">' + (P.stamped ? stampView(L) : [stepWatch, stepLearn, stepTry, stepCheck][P.step](L)) + "</section></div>";
  setSheet(h, keep);
  if (P.step === 0 && !P.stamped) mountScene();
}
function stepWatch(L) {
  return '<div class="stage" id="stage"></div><p class="caption" id="caption" aria-live="polite"></p>' +
    '<div class="controls"><button class="icon" data-act="prev" aria-label="Previous scene">◀</button><button class="play" id="playbtn" data-act="toggleplay">' + playLabel() + '</button><button class="icon" data-act="next" aria-label="Next scene">▶</button></div>' +
    '<div class="dots">' + L.scenes.map((_, i) => '<button class="dt" data-act="goscene" data-i="' + i + '" aria-label="Scene ' + (i + 1) + '"></button>').join("") + "</div>" +
    '<div class="voicebar"><label class="sw"><input type="checkbox" id="voice" data-chg="voice" ' + (S.voice ? "checked" : "") + (speechOK() ? "" : " disabled") + "> Voice narration</label>" +
    '<button class="chip" data-act="rate">Speed ' + S.rate + "×</button></div>" +
    (speechOK() ? "" : '<p class="muted" style="margin-top:8px;font-size:14px">This browser has no voice, so scenes advance on a timer.</p>') +
    gateHtml(0) + '<button class="btn wide lc" data-act="pstep" data-i="1"' + (gateOpen(0) ? "" : " disabled") + '>Next: key ideas</button>' + (gateOpen(0) ? "" : '<p class="muted small">Answer the checkpoint to continue.</p>');
}
function renderScene(sc) {
  let i = 0;
  const rv = (cls) => 'class="rv' + (cls ? " " + cls : "") + '" style="--i:' + (i++) + '"';
  switch (sc.t) {
    case "flow":
      return '<ol class="v-flow">' + sc.nodes.map(n => "<li " + rv() + '><span class="dot"></span><span class="fl">' + esc(n) + "</span></li>").join("") + "</ol>";
    case "split": {
      const col = (c, alt) => '<div class="col' + (alt ? " alt" : "") + '"><h4 ' + rv() + ">" + esc(c.h) + "</h4><ul>" + c.items.map(x => "<li " + rv() + ">" + esc(x) + "</li>").join("") + "</ul></div>";
      return '<div class="v-split">' + col(sc.left, false) + col(sc.right, true) + "</div>";
    }
    case "tree":
      return '<div class="v-tree"><div ' + rv("root") + ">" + esc(sc.root) + '</div><div class="kids">' + sc.kids.map(k => "<div " + rv("kid") + ">" + esc(k[0]) + (k[1] ? "<small>" + esc(k[1]) + "</small>" : "") + "</div>").join("") + "</div></div>";
    case "grid": {
      const hl = sc.hl || {};
      const cell = (tag, v, ci, ri) => "<" + tag + ((hl.col === ci || (ri != null && hl.row === ri)) ? ' class="hl"' : "") + ">" + esc(v) + "</" + tag + ">";
      return '<figure class="v-grid"><figcaption ' + rv() + ">" + esc(sc.label) + "</figcaption><table><thead><tr " + rv() + ">" + sc.cols.map((c, ci) => cell("th", c, ci)).join("") + "</tr></thead><tbody>" + sc.rows.map((r, ri) => "<tr " + rv() + ">" + r.map((v, ci) => cell("td", v, ci, ri)).join("") + "</tr>").join("") + "</tbody></table></figure>";
    }
    case "tiles":
      return '<div class="v-tiles">' + sc.items.map(t => "<div " + rv("tile") + '><span class="ic" aria-hidden="true">' + esc(t[0]) + "</span><span>" + esc(t[1]) + "</span></div>").join("") + "</div>";
    case "levels": {
      const items = sc.items; let inner = "";
      const opens = items.map((it, k) => k === items.length - 1 ? "<div " + rv("lv core") + ">" + esc(it) : "<div " + rv("lv") + "><b>" + esc(it) + "</b>");
      inner = opens.join("") + items.map(() => "</div>").join("");
      return '<div class="v-levels">' + inner + "</div>";
    }
    case "chat":
      return '<div class="v-chat">' + sc.lines.map(l => "<div " + rv("b " + l[0]) + '><span class="who">' + (l[0] === "you" ? "You" : l[0] === "ai" ? "Copilot" : "📄 Document") + "</span>" + esc(l[1]) + "</div>").join("") + "</div>";
    case "bpf":
      return '<div class="v-bpf"><div class="chevs">' + sc.stages.map((s, k) => "<span " + rv(k < sc.active ? "done" : k === sc.active ? "on" : "") + ">" + esc(s) + "</span>").join("") + "</div><div " + rv("fly") + "><b>" + esc(sc.stages[sc.active]) + " stage</b>" + sc.steps.map(st => '<div class="step"><span class="box"></span>' + esc(st) + '<span class="req">required</span></div>').join("") + "</div></div>";
    case "funnel": {
      const n = sc.bars.length;
      return '<div class="v-funnel">' + sc.bars.map((b, k) => '<div class="rv fb" style="--i:' + k + ';width:' + (100 - k * (62 / Math.max(1, n - 1))).toFixed(1) + '%"><span>' + esc(b[0]) + "</span><span>" + esc(b[1]) + "</span></div>").join("") + "</div>";
    }
    case "layers": {
      const n = sc.items.length;
      return '<div class="v-layers">' + sc.items.map((t, k) => '<div class="rv ly' + (k === n - 1 ? " base" : "") + '" style="--i:' + (n - 1 - k) + '">' + esc(t) + "</div>").join("") + "</div>";
    }
    default: return "";
  }
}
function mountScene() {
  const L = LESSON[P.id]; const sc = L.scenes[P.scene]; const st = $("#stage"); if (!st) return;
  st.className = "stage"; st.innerHTML = renderScene(sc);
  $("#caption").textContent = sc.s;
  document.querySelectorAll(".dots .dt").forEach((d, i) => { d.classList.toggle("on", i === P.scene); d.classList.toggle("seen", i < P.scene); d.setAttribute("aria-current", i === P.scene ? "true" : "false"); });
  void st.offsetWidth; st.classList.add("go");
  if (P.playing) narrate();
}
function narrate() {
  clearTimeout(P.timer);
  const L = LESSON[P.id]; const sc = L.scenes[P.scene]; const myScene = P.scene; const myId = P.id;
  speak(sc.s, () => {
    if (!P || !P.playing || P.id !== myId || P.scene !== myScene || P.step !== 0) return;
    P.timer = setTimeout(advance, 800);
  });
}
function advance() {
  if (!P) return;
  const L = LESSON[P.id];
  if (P.scene < L.scenes.length - 1) { P.scene++; mountScene(); }
  else { P.playing = false; P.endReached = true; updPlay(); touch(); save(); toast("Watched. Next: key ideas."); }
}
function playLabel() { if (!P) return ""; if (P.playing) return "❚❚ Pause"; if (P.endReached) return "↺ Replay"; return S.voice && speechOK() ? "▶ Play with voice" : "▶ Play"; }
function updPlay() { const b = $("#playbtn"); if (b) b.textContent = playLabel(); }
function stepLearn(L) {
  return '<h3 class="sec">Key ideas</h3><ul class="keys">' + L.keys.map(k => "<li>" + esc(k) + "</li>").join("") + "</ul>" +
    '<div class="world"><h3>In your world</h3><p>' + esc(L.world) + "</p></div>" +
    '<div class="row2"><button class="btn ghost" data-act="speakkeys">🔈 Read aloud</button><button class="btn ghost" data-act="explain" data-id="' + L.id + '">Explain simpler</button></div>' +
    gateHtml(1) + '<button class="btn wide lc" data-act="pstep" data-i="2"' + (gateOpen(1) ? "" : " disabled") + '>Next: try it</button>';
}
function linkHtml(k) {
  let u, t, kind;
  if (k.yt) { u = "https://www.youtube.com/results?search_query=" + encodeURIComponent(k.yt); t = "Videos: " + k.yt; kind = "YouTube search"; }
  else if (k.learn) { u = "https://learn.microsoft.com/en-us/search/?terms=" + encodeURIComponent(k.learn); t = "Read: " + k.learn; kind = "Microsoft Learn search"; }
  else { u = k.u; t = k.t; kind = hostOf(k.u); }
  return '<a class="lnk" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer"><span><b>' + esc(t) + "</b><small>" + esc(kind) + '</small></span><span aria-hidden="true">↗</span></a>';
}
function stepTry(L) {
  return '<h3 class="sec">Try it in your trial</h3><ol class="lab">' + L.lab.map(s => "<li>" + esc(s) + "</li>").join("") + "</ol>" +
    (L.line === "S" || L.line === "F" ? '<button class="btn wide ghost" data-act="sim">No trial yet? Use the Sales Hub simulator</button>' : "") +
    '<h3 class="sec" style="margin-top:22px">Watch and read more</h3><div class="links">' + L.links.map(linkHtml).join("") + "</div>" +
    (L.line === "F" || L.line === "S" ? '<h3 class="sec" style="margin-top:22px">Step-by-step guides for this lesson</h3><div class="acts">' + GUIDES.filter(g => g.lesson === L.id).map(g => act(S.guides[g.id] ? "✅" : "📘", g.title, g.where + ", " + g.steps.length + " steps", "guide", 'data-id="' + g.id + '"', "var(--s)")).join("") + "</div>" : "") +
    gateHtml(2) + '<button class="btn wide lc" data-act="pstep" data-i="3"' + (gateOpen(2) ? "" : " disabled") + '>Next: check yourself</button>';
}
function qCard(item, chosen, ctx, qi, meta) {
  const answered = chosen != null;
  const picked = answered && chosen >= 0 ? item.opts[chosen] : null;
  let h = '<div class="qcard">' + (meta ? '<span class="qmeta">' + esc(meta) + "</span>" : "") + '<p class="qtext">' + esc(item.q) + "</p>";
  item.opts.forEach((o, oi) => {
    let cls = "opt";
    if (answered) { if (o.ok) cls += " right"; else if (oi === chosen) cls += " wrong"; }
    h += '<button class="' + cls + '" data-act="ans" data-ctx="' + ctx + '" data-qi="' + qi + '" data-oi="' + oi + '"' + (answered ? " disabled" : "") + ">" + esc(o.t) + "</button>";
  });
  if (answered) {
    const ok = !!(picked && picked.ok);
    h += '<p class="why"><b class="' + (ok ? "okc" : "badc") + '">' + (ok ? "Right." : picked ? "Not quite." : "Not answered.") + "</b> " + esc(item.w || "") + "</p>";
    if (!ok) h += '<div class="qfoot"><button class="chip" data-act="askwhy" data-ctx="' + ctx + '" data-qi="' + qi + '">Ask the coach why</button></div>';
  }
  return h + "</div>";
}
function stepCheck(L) {
  const qs = P.qset; const n = Object.keys(P.ans).length;
  let h = '<h3 class="sec">Quick check</h3>';
  if (!qs.length) h += '<p class="muted">No questions for this station yet.</p>';
  qs.forEach((it, qi) => { h += qCard(it, P.ans[qi], "pq", qi, "Question " + (qi + 1) + " of " + qs.length); });
  if (n >= qs.length) {
    const right = qs.filter((it, qi) => it.opts[P.ans[qi]].ok).length;
    h += '<p style="font-weight:700;margin-top:4px">' + right + " of " + qs.length + " right." + (right < qs.length ? " Replay the scenes for anything you missed." : "") + "</p>";
    h += '<button class="btn wide lc" data-act="complete">' + (S.done[L.id] ? "Done, back to the route" : "Complete station") + "</button>";
  } else h += '<p class="muted">Answer all ' + qs.length + " to complete the station.</p>";
  return h;
}
function nextLessonAfter(id) { const i = ROUTE.indexOf(id); return i >= 0 && i < ROUTE.length - 1 ? ROUTE[i + 1] : null; }
function stampView(L) {
  const nx = nextLessonAfter(L.id);
  let btn = "";
  if (nx && EXAM_STOPS[nx]) btn = '<button class="btn wide" data-act="mock" data-exam="' + EXAM_STOPS[nx].exam + '">Next stop: ' + esc(EXAMS[EXAM_STOPS[nx].exam].code) + " mock exam</button>";
  else if (nx) btn = '<button class="btn wide lc" data-act="open" data-id="' + nx + '">Next station: ' + esc(LESSON[nx].title) + "</button>";
  return '<div class="stamp"><div class="big" aria-hidden="true">✓</div><h3>Station complete</h3><p>' + esc(L.title) + " is stamped on your route.</p></div>" + btn + '<button class="btn wide ghost" data-act="close">Back to the route</button>';
}

/* ===== DRILL ===== */
let D = null;
function drillPool(f) {
  const all = allQuestions();
  if (f === "730") return all.filter(q => q.x === "730");
  if (f === "210") return all.filter(q => q.x === "210" && q.d !== "P");
  if (f === "P") return all.filter(q => q.d === "P" || (q.l && q.l[0] === "F"));
  if (f === "fresh") return (S.extra || []).slice();
  if (f === "weak") {
    const weak = all.filter(q => S.qs[q.id] && (S.qs[q.id].last === 0 || S.qs[q.id].c / S.qs[q.id].n < 0.6));
    if (weak.length >= 6) return weak;
    const unseen = all.filter(q => !S.qs[q.id]);
    return weak.concat(shuffle(unseen).slice(0, 10 - weak.length));
  }
  if (f && f.length === 2) return all.filter(q => q.d === f);
  return all;
}
const DRILL_NAMES = { "730": "AB-730 drill", "210": "AB-210 drill", P: "Platform basics drill", weak: "Weak spots drill", fresh: "Fresh AI questions" };
function startDrill(f) {
  const pool = drillPool(f);
  if (!pool.length) { toast(f === "fresh" ? "Make new questions in the Coach tab first." : "Nothing to drill yet."); return; }
  D = { f: f, title: DRILL_NAMES[f] || "Drill", items: shuffle(pool).slice(0, 10).map(present), i: 0, ans: {} };
  showSheet(""); paintDrill();
}
function paintDrill() {
  const n = D.items.length;
  let h = head("Practice", D.title) + '<section class="s-body">';
  if (D.i >= n) {
    const right = D.items.filter((it, k) => it.opts[D.ans[k]] && it.opts[D.ans[k]].ok).length;
    h += '<div class="result"><div class="score">' + right + "/" + n + "</div><p>" + (right / n >= 0.8 ? "Strong. Exam-ready pace." : right / n >= 0.6 ? "Close. Replay the stations behind the misses." : "Keep going: replay the lessons, then drill again.") + "</p></div>";
    h += '<button class="btn wide" data-act="drill" data-f="' + esc(D.f) + '">Drill 10 more</button><button class="btn wide ghost" data-act="close">Done</button>';
  } else {
    const it = D.items[D.i]; const dom = domName(it.d);
    h += '<div class="progress"><i style="width:' + Math.round(D.i / n * 100) + '%"></i></div>';
    h += qCard(it, D.ans[D.i], "drill", D.i, "Question " + (D.i + 1) + " of " + n + (dom ? ", " + dom : ""));
    if (D.ans[D.i] != null) h += '<button class="btn wide" data-act="dnext">' + (D.i === n - 1 ? "See result" : "Next question") + "</button>";
  }
  setSheet(h + "</section>");
}
function domName(id) { for (const x of ["730", "210"]) { const d = DOMAINS[x].find(d => d.id === id); if (d) return d.n; } return ""; }

/* ===== MOCK EXAM ===== */
let M = null;
function startMock(x) {
  const ex = EXAMS[x];
  const pool = allQuestions().filter(q => q.x === x && !q.ai);
  M = { x: x, items: shuffle(pool).slice(0, ex.mock).map(present), i: 0, ans: {}, end: Date.now() + ex.mins * 60000, done: false, tick: null };
  showSheet(""); paintMock();
  M.tick = setInterval(() => {
    if (!M || M.done) return;
    const left = M.end - Date.now();
    const t = $("#mtimer"); if (t) t.textContent = fmtLeft(left);
    if (left <= 0) submitMock();
  }, 1000);
}
function fmtLeft(ms) { ms = Math.max(0, ms); const m = Math.floor(ms / 60000); const s = Math.floor(ms % 60000 / 1000); return m + ":" + String(s).padStart(2, "0"); }
function paintMock(keep) {
  const ex = EXAMS[M.x]; const n = M.items.length;
  let h = head("Mock exam, " + n + " questions", ex.code + " " + ex.name) + '<section class="s-body">';
  if (M.done) {
    const right = M.items.filter((it, k) => M.ans[k] != null && it.opts[M.ans[k]].ok).length;
    const score = Math.round(right / n * 1000);
    h += '<div class="result"><div class="score">' + score + '</div><p>Estimated score out of 1000. Pass mark is 700. You got ' + right + " of " + n + ".</p></div>";
    h += '<h3 class="sec">By skill area</h3>' + domainBars(M.x, M.items.map((it, k) => ({ d: it.d, ok: M.ans[k] != null && it.opts[M.ans[k]].ok })));
    h += '<h3 class="sec" style="margin-top:20px">Review</h3><div class="review">' + M.items.map((it, k) => qCard(it, M.ans[k] == null ? -1 : M.ans[k], "mrev", k, (M.ans[k] == null ? "Not answered. " : "") + domName(it.d))).join("") + "</div>";
    h += '<button class="btn wide" data-act="mock" data-exam="' + M.x + '">Take another mock</button><button class="btn wide ghost" data-act="close">Done</button>';
  } else {
    const it = M.items[M.i]; const answered = Object.keys(M.ans).length;
    h += '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Question ' + (M.i + 1) + " of " + n + '</span><span>Time left <span class="timer" id="mtimer">' + fmtLeft(M.end - Date.now()) + "</span></span></div>";
    h += '<div class="progress"><i style="width:' + Math.round(answered / n * 100) + '%"></i></div>';
    h += '<div class="qcard"><p class="qtext">' + esc(it.q) + "</p>" + it.opts.map((o, oi) => '<button class="opt' + (M.ans[M.i] === oi ? " pick" : "") + '" data-act="mpick" data-oi="' + oi + '">' + esc(o.t) + "</button>").join("") + "</div>";
    h += '<div class="row2"><button class="btn ghost" data-act="mprev"' + (M.i === 0 ? " disabled" : "") + '>Previous</button><button class="btn" data-act="mnext">' + (M.i === n - 1 ? "Review and submit" : "Next") + "</button></div>";
    h += '<p class="muted" style="margin-top:14px;font-size:14px">' + answered + " of " + n + ' answered. No feedback until you submit, like the real exam.</p><button class="btn wide ghost" data-act="msubmit">Submit now</button>';
  }
  setSheet(h + "</section>", keep);
}
function submitMock() {
  if (!M || M.done) return;
  M.done = true; clearInterval(M.tick);
  const n = M.items.length;
  const right = M.items.filter((it, k) => M.ans[k] != null && it.opts[M.ans[k]].ok).length;
  M.items.forEach((it, k) => { if (M.ans[k] != null) { const r = S.qs[it.id] || { n: 0, c: 0, last: 0 }; const ok = it.opts[M.ans[k]].ok; r.n++; r.c += ok ? 1 : 0; r.last = ok ? 1 : 0; S.qs[it.id] = r; } });
  S.mocks.push({ x: M.x, s: Math.round(right / n * 1000), at: dkey() });
  if (S.mocks.length > 30) S.mocks = S.mocks.slice(-30);
  touch(); save(); paintMock();
}

/* ===== readiness ===== */
function domainStats(x) {
  return DOMAINS[x].map(d => {
    const qs = allQuestions().filter(q => q.x === x && q.d === d.id);
    const seen = qs.filter(q => S.qs[q.id]);
    const right = seen.filter(q => S.qs[q.id].last === 1).length;
    return { d: d, total: qs.length, seen: seen.length, pct: seen.length ? Math.round(right / seen.length * 100) : null };
  });
}
function domainBars(x, results) {
  return DOMAINS[x].map(d => {
    let pct = null, meta = "";
    if (results) {
      const r = results.filter(z => z.d === d.id); if (!r.length) return "";
      pct = Math.round(r.filter(z => z.ok).length / r.length * 100); meta = pct + "% of " + r.length;
    } else {
      const st = domainStats(x).find(s => s.d.id === d.id);
      pct = st.pct; meta = st.pct == null ? "not started" : st.pct + "% right, " + st.seen + "/" + st.total + " seen";
    }
    const cls = pct == null ? "" : pct >= 75 ? "good" : pct >= 55 ? "mid" : "low";
    return '<div class="dom"><div class="dom-top"><b>' + esc(d.n) + " <small class=\"muted\">(" + esc(d.w) + ")</small></b><span>" + esc(meta) + '</span></div><div class="bar"><i class="' + cls + '" style="width:' + (pct || 0) + '%"></i></div></div>';
  }).join("");
}

/* ===== PRACTICE TAB ===== */
function viewPractice() {
  const fresh = (S.extra || []).length;
  let h = '<section class="panel"><h2>Drill</h2><p>10 questions with instant feedback and a reason for every answer.</p><div class="acts">' +
    act("🎯", "AB-730 drill", "Copilot, prompts, meetings, agents", "drill", 'data-f="730"', "var(--a)") +
    act("🏆", "AB-210 drill", "Sales, agents, AI features, extensions", "drill", 'data-f="210"', "var(--i)") +
    act("🧱", "Platform basics", "Dataverse, apps, logic, security", "drill", 'data-f="P"', "var(--f)") +
    act("🩹", "Weak spots", "Questions you missed, plus new ones", "drill", 'data-f="weak"', "var(--bad)") +
    (fresh ? act("✨", "Fresh AI questions", fresh + " questions made by the coach", "drill", 'data-f="fresh"', "var(--s)") : "") +
    "</div></section>";
  h += '<section class="panel"><h2>Flashcards</h2><p>Tap to flip. Cards you miss come back first.</p><div class="acts">' +
    Object.keys(DECKS).map(k => act("🃏", DECKS[k].name, DECKS[k].cards.length + " cards, " + deckKnown(k) + " known", "cards", 'data-deck="' + k + '"', LINES[k] ? LINES[k].color : "var(--ink)")).join("") + "</div></section>";
  h += '<section class="panel"><h2>Hands-on</h2><p>Practise the lead-to-cash clicks before you open the real trial.</p><div class="acts">' +
    act("🖥️", "Sales Hub simulator", "Qualify a lead, run the process, quote, order, invoice", "sim", "", "var(--s)") + "</div></section>";
  h += '<section class="panel"><h2>Mock exams</h2><p>Timed, no feedback until you submit, scored out of 1000.</p><div class="acts">' +
    ["730", "210"].map(x => { const b = bestMock(x); return act("⏱️", EXAMS[x].code + " mock", EXAMS[x].mock + " questions, " + EXAMS[x].mins + " min" + (b != null ? ", best " + b : ""), "mock", 'data-exam="' + x + '"', x === "730" ? "var(--a)" : "var(--i)"); }).join("") + "</div></section>";
  h += '<section class="panel" style="--lc:var(--i)"><h2>AB-210 readiness</h2>' + domainBars("210") + "</section>";
  if (COACH.status === "ready") {
    const opts = DOMAINS["210"].filter(d => d.id !== "P").map(d => [d.id, "AB-210: " + d.n]).concat(DOMAINS["730"].map(d => [d.id, "AB-730: " + d.n]));
    h += '<section class="panel" style="--lc:var(--s)"><h2>Make new practice questions</h2><p>The trainer writes 5 fresh exam-style questions and adds them to your drills.</p>' +
      '<label class="fld" style="margin-top:12px"><span>Skill area</span><select id="gendom" class="inp">' + opts.map(o => '<option value="' + o[0] + '">' + esc(o[1]) + "</option>").join("") + "</select></label>" +
      '<button class="btn wide" data-act="gen"' + (COACH.gen ? " disabled" : "") + ">" + (COACH.gen ? "Writing questions…" : "Write 5 questions") + "</button>" +
      (COACH.genMsg ? '<p style="margin-top:10px;font-size:14px;font-weight:600">' + esc(COACH.genMsg) + "</p>" : "") + "</section>";
  }
  h += glossaryHtml();
  h += '<section class="panel" style="--lc:var(--a)"><h2>AB-730 readiness (optional)</h2>' + domainBars("730") + "</section>";
  return h;
}
function act(icon, title, sub, a, attrs, color) {
  return '<button class="act" style="--lc:' + color + '" data-act="' + a + '" ' + attrs + '><span class="ai" aria-hidden="true">' + icon + "</span><span><b>" + esc(title) + "</b><small>" + esc(sub) + "</small></span></button>";
}
function deckKnown(k) { return DECKS[k].cards.filter((c, i) => (S.cards[k + i] || 0) >= 2).length; }

/* ===== FLASHCARDS ===== */
let F = null;
function startCards(k) {
  const cards = DECKS[k].cards.map((c, i) => ({ id: k + i, f: c[0], b: c[1], box: S.cards[k + i] || 0 }));
  const order = shuffle(cards).sort((a, b) => a.box - b.box).slice(0, 12);
  F = { k: k, cards: order, i: 0, flip: false, got: 0 };
  showSheet(""); paintCards();
}
function paintCards() {
  const deck = DECKS[F.k]; const color = LINES[F.k] ? LINES[F.k].color : "var(--ink)";
  let h = '<div style="--lc:' + color + '">' + head("Flashcards", deck.name) + '<section class="s-body">';
  if (F.i >= F.cards.length) {
    h += '<div class="result"><div class="score">' + F.got + "/" + F.cards.length + "</div><p>Cards you knew. Missed ones come back first next time.</p></div>";
    h += '<button class="btn wide lc" data-act="cards" data-deck="' + F.k + '">Another round</button><button class="btn wide ghost" data-act="close">Done</button>';
  } else {
    const c = F.cards[F.i];
    h += '<div class="progress"><i style="width:' + Math.round(F.i / F.cards.length * 100) + '%"></i></div>';
    h += '<div class="fc' + (F.flip ? " flip" : "") + '" data-act="flip" role="button" tabindex="0" aria-label="Flip card"><div class="fc-in"><div class="fc-face"><small>Card ' + (F.i + 1) + " of " + F.cards.length + "</small><b>" + esc(c.f) + '</b><small>Tap to flip</small></div><div class="fc-face back"><span>' + esc(c.b) + "</span></div></div></div>";
    h += F.flip ? '<div class="row2"><button class="btn ghost" data-act="cardagain">Again</button><button class="btn lc" data-act="cardgot">Got it</button></div>' : '<button class="btn wide lc" data-act="flip">Show answer</button>';
    h += '<button class="btn wide ghost" data-act="cardsay">🔈 Hear it</button>';
  }
  setSheet(h + "</section></div>");
}

/* ===== SALES HUB SIMULATOR ===== */
let SIM = null;
const SIM_TASKS = ["Qualify the lead", "Finish the Develop stage", "Add products", "Create and activate a quote", "Create the order", "Create the invoice"];
function startSim() {
  SIM = { step: 0, budget: "", time: "", need: "", stake: false, sol: "", prod: "pro", qty: 25, lines: [], quote: "", closeOpp: true, won: false, dialog: "", err: "", note: "Fill in the budget and purchase timeframe, then select Qualify." };
  showSheet(""); paintSim();
}
const PRODS = { basic: ["Route Planner Basic", 6000], pro: ["Route Planner Pro", 12000] };
function inr(n) { return "₹" + Number(n).toLocaleString("en-IN"); }
function simTotal() { return SIM.lines.reduce((a, l) => a + l.q * PRODS[l.p][1], 0); }
function sel(id, opts, val) { return '<select id="' + id + '" data-chg="sim">' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === val ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>"; }
function paintSim(keep) {
  let h = '<div style="--lc:var(--s)">' + head("Practice", "Sales Hub simulator") + '<section class="s-body">';
  h += '<ul class="checks">' + SIM_TASKS.map((t, k) => '<li class="' + (k < SIM.step ? "ok" : k === SIM.step ? "now" : "") + '"><i>' + (k < SIM.step ? "✓" : k + 1) + "</i>" + esc(t) + "</li>").join("") + "</ul>";
  h += '<div class="sim"><div class="sim-bar"><span>Dynamics 365 · Sales Hub</span><span>Practice</span></div>';
  const s = SIM.step;
  if (s === 0) {
    h += '<div class="sim-cmd"><button data-act="simsave">Save</button><button class="hot" data-act="simqual">Qualify</button><button data-act="simdisq">Disqualify</button></div>';
    h += '<div class="sim-rec"><small>Lead · Open</small><h3>25 route planner licences</h3></div><div class="sim-form">' +
      '<div class="fld"><span>Name</span><div class="v">Rahul Mehta</div></div><div class="fld"><span>Company</span><div class="v">Sunrise Foods</div></div>' +
      '<label class="fld req"><span>Budget amount</span>' + sel("simbudget", [["", "Select…"], ["5", "₹5 lakh"], ["15", "₹15 lakh"]], SIM.budget) + "</label>" +
      '<label class="fld req"><span>Purchase timeframe</span>' + sel("simtime", [["", "Select…"], ["q", "This quarter"], ["nq", "Next quarter"], ["y", "This year"]], SIM.time) + "</label></div>";
    if (SIM.dialog === "qual") h += '<div class="sim-dialog"><h4>Qualify lead</h4><p style="font-size:14px;margin-bottom:6px">Create these records:</p><label><input type="checkbox" checked disabled> Account: Sunrise Foods</label><label><input type="checkbox" checked disabled> Contact: Rahul Mehta</label><label><input type="checkbox" checked disabled> Opportunity</label><div class="row2"><button class="btn ghost small" data-act="simcancel">Cancel</button><button class="btn small" data-act="simqualok">Qualify</button></div></div>';
  } else if (s === 1 || s === 2) {
    const stages = ["Qualify", "Develop", "Propose", "Close"]; const on = s === 1 ? 1 : 2;
    h += '<div class="sim-cmd"><button data-act="simsave">Save</button>' + (s === 1 ? '<button class="hot" data-act="simnextstage">Next stage</button>' : '<button class="hot" data-act="simquote"' + (SIM.lines.length ? "" : " disabled") + ">Create quote</button>") + "</div>";
    h += '<div class="sim-rec"><small>Opportunity · Sunrise Foods</small><h3>25 route planner licences</h3></div>';
    h += '<div class="v-bpf" style="padding:6px 14px"><div class="chevs">' + stages.map((t, k) => '<span class="' + (k < on ? "done" : k === on ? "on" : "") + '">' + t + "</span>").join("") + "</div></div><div class=\"sim-form\">";
    if (s === 1) {
      h += '<label class="fld req"><span>Customer need</span>' + sel("simneed", [["", "Select…"], ["beat", "Beat planning for 25 reps"], ["tbd", "Not sure yet"]], SIM.need) + "</label>" +
        '<label class="sw" style="font-size:15px"><input type="checkbox" id="simstake" data-chg="sim"' + (SIM.stake ? " checked" : "") + "> Stakeholders identified (required)</label>" +
        '<label class="fld req"><span>Proposed solution</span>' + sel("simsol", [["", "Select…"], ["pro", "Route Planner Pro"], ["basic", "Route Planner Basic"]], SIM.sol) + "</label>";
    } else {
      h += '<div class="fld"><span>Price list</span><div class="v">INR Distributor 2026</div></div>' +
        '<label class="fld"><span>Product</span>' + sel("simprod", [["pro", "Route Planner Pro, ₹12,000 per licence"], ["basic", "Route Planner Basic, ₹6,000 per licence"]], SIM.prod) + "</label>" +
        '<label class="fld"><span>Quantity</span><input id="simqty" type="number" min="1" max="999" value="' + SIM.qty + '" data-chg="sim"></label>' +
        '<button class="btn small ghost" data-act="simadd">Add product</button>' +
        (SIM.lines.length ? '<div class="lines">' + SIM.lines.map(l => "<div><span>" + esc(PRODS[l.p][0]) + " × " + l.q + "</span><b>" + inr(l.q * PRODS[l.p][1]) + "</b></div>").join("") + "<div><span>Est. revenue (system calculated)</span><b>" + inr(simTotal()) + "</b></div></div>" : "");
    }
    h += "</div>";
  } else if (s === 3) {
    h += '<div class="sim-cmd">' + (SIM.quote === "Draft" ? '<button class="hot" data-act="simactivate">Activate quote</button>' : '<button class="hot" data-act="simorder">Create order</button><button data-act="simrevise">Revise</button>') + "</div>";
    h += '<div class="sim-rec"><small>Quote · ' + esc(SIM.quote) + "</small><h3>Quote for Sunrise Foods</h3></div><div class=\"sim-form\"><div class=\"lines\">" + SIM.lines.map(l => "<div><span>" + esc(PRODS[l.p][0]) + " × " + l.q + "</span><b>" + inr(l.q * PRODS[l.p][1]) + "</b></div>").join("") + "<div><span>Total</span><b>" + inr(simTotal()) + "</b></div></div></div>";
    if (SIM.dialog === "order") h += '<div class="sim-dialog"><h4>Create order</h4><label><input type="checkbox" checked disabled> Close the quote as won</label><label><input type="checkbox" id="simclose" data-chg="sim"' + (SIM.closeOpp ? " checked" : "") + "> Also close the opportunity as won</label><div class=\"row2\"><button class=\"btn ghost small\" data-act=\"simcancel\">Cancel</button><button class=\"btn small\" data-act=\"simorderok\">Create order</button></div></div>";
  } else if (s === 4) {
    h += '<div class="sim-cmd"><button class="hot" data-act="siminvoice">Create invoice</button></div><div class="sim-rec"><small>Order · Active</small><h3>Order for Sunrise Foods</h3></div><div class="sim-form"><div class="fld"><span>Total</span><div class="v">' + inr(simTotal()) + "</div></div></div>";
  } else {
    h += '<div class="sim-rec"><small>Invoice · Created</small><h3>Invoice for Sunrise Foods</h3></div><div class="sim-form"><div class="lines"><div><span>Lead</span><b>Qualified</b></div><div><span>Opportunity</span><b>' + (SIM.won ? "Won" : "Open") + "</b></div><div><span>Quote</span><b>Won</b></div><div><span>Order</span><b>Created</b></div><div><span>Invoice</span><b>" + inr(simTotal()) + "</b></div></div></div>";
  }
  h += (SIM.err ? '<div class="sim-err">' + esc(SIM.err) + "</div>" : "") + "</div>";
  h += '<div class="sim-note">' + esc(SIM.note) + "</div>";
  if (s >= 5) h += '<button class="btn wide lc" data-act="sim">Run it again</button><button class="btn wide ghost" data-act="close">Done</button>';
  setSheet(h + "</section></div>", keep);
}
function simAct(a) {
  SIM.err = "";
  if (a === "simsave") { SIM.note = "Saved. In a real project, auditing would record who changed what."; }
  else if (a === "simdisq") { SIM.note = "Disqualify keeps the lead with a reason such as Lost or No longer interested. For this run, qualify it instead."; }
  else if (a === "simqual") {
    if (!SIM.budget || !SIM.time) { SIM.err = "Budget amount and Purchase timeframe are required first."; SIM.note = "This is a business rule making fields required. You configure rules like this without code."; }
    else { SIM.dialog = "qual"; SIM.note = "The qualify dialog decides which records are created. Admins set this in the lead qualification experience."; }
  }
  else if (a === "simcancel") { SIM.dialog = ""; }
  else if (a === "simqualok") { SIM.dialog = ""; SIM.step = 1; SIM.note = "Lead is now Qualified. D365 created the account Sunrise Foods, the contact Rahul Mehta and an opportunity. The business process flow moved to Develop. Fill its required steps."; }
  else if (a === "simnextstage") {
    if (!SIM.need || !SIM.stake || !SIM.sol) { SIM.err = "Required steps are missing in the Develop stage."; SIM.note = "Required steps in a business process flow block the next stage. That is how you enforce a sales process without code."; }
    else { SIM.step = 2; SIM.prod = SIM.sol; SIM.note = "Now in Propose. Add products from the INR price list. Est. revenue is system calculated from product lines."; }
  }
  else if (a === "simadd") {
    const qi = $("#simqty"); if (qi) SIM.qty = qi.value;
    const q = Math.max(1, Math.min(999, parseInt(SIM.qty, 10) || 1));
    SIM.lines.push({ p: SIM.prod, q: q });
    SIM.note = "Added. Each opportunity product uses the price list item price for that product and unit.";
  }
  else if (a === "simquote") { SIM.step = 3; SIM.quote = "Draft"; SIM.note = "Quote created as Draft, with the products copied from the opportunity. Activate it before sending it to the customer."; }
  else if (a === "simactivate") { SIM.quote = "Active"; SIM.note = "Quote is Active and can be sent. To change an active quote you revise it, which creates a new version."; }
  else if (a === "simrevise") { SIM.quote = "Draft"; SIM.note = "Revised: a new draft version of the quote was created. Activate it again."; }
  else if (a === "simorder") { SIM.dialog = "order"; }
  else if (a === "simorderok") { SIM.dialog = ""; SIM.step = 4; SIM.won = SIM.closeOpp; SIM.note = "Creating the order closed the quote as won." + (SIM.closeOpp ? " The opportunity is closed as won too, so actual revenue is recorded." : " The opportunity is still open."); }
  else if (a === "siminvoice") {
    SIM.step = 5; touch(); save();
    SIM.note = "Lead to cash complete. As a consultant you would configure the business process flow, status reasons, the product catalog and qualification settings, and often send invoices from ERP through an integration.";
  }
  paintSim(true);
}

/* ===== COACH ===== */
const COACH = { status: "loading", sample: null, turns: [], busy: false, live: "", err: "", ctl: null, gen: false, genMsg: "" };
async function coachInit() {
  try {
    if (!window.claude || typeof window.claude.use !== "function") { COACH.status = "off"; }
    else { const s = await window.claude.use("sample"); COACH.sample = s; COACH.status = s ? "ready" : "off"; }
  } catch (e) { COACH.status = "off"; }
  if (TAB === "practice" && $("#sheet").hidden) render();
  paintHelp();
}
function mdLite(t) {
  const lines = String(t).split(/\n/); let out = "", inList = false;
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<b>$1</b>");
  lines.forEach(l => {
    const m = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) { if (!inList) { out += "<ul>"; inList = true; } out += "<li>" + inl(m[1]) + "</li>"; }
    else { if (inList) { out += "</ul>"; inList = false; } if (l.trim()) out += "<p>" + inl(l.replace(/^#+\s*/, "")) + "</p>"; }
  });
  if (inList) out += "</ul>";
  return out;
}
function coachErr(code) {
  if (code === "rate_limited") return "Too many questions at once. Wait a minute, then try again.";
  if (code === "session_expired") return "Your Claude session expired. Sign in again, then retry.";
  if (code === "refused") return "The coach couldn't answer that. Try asking it differently.";
  if (code === "prompt_too_large") return "That was too long. Try a shorter question.";
  if (code === "bad_code") return "Wrong access code. Send again and enter the right code.";
  if (code === "network") return "No connection to the server. Check your internet and try again.";
  return "The coach didn't answer this time. Try again in a moment.";
}
function goCoach(text) { openHelp(text, true); }
async function genQuestions(domId) {
  if (COACH.gen || COACH.status !== "ready") return;
  const x = domId[0] === "G" ? "730" : "210"; const dom = DOMAINS[x].find(d => d.id === domId); const ex = EXAMS[x];
  COACH.gen = true; COACH.genMsg = ""; if (TAB === "practice" && $("#sheet").hidden) render();
  const prompt = "Write 5 new multiple-choice practice questions for Microsoft exam " + ex.code + " (" + ex.name + "), skill area: " + dom.n + ". " +
    "Audience: a beginner functional consultant from FMCG distribution software. Scenario style, 4 options each, exactly one correct, plausible wrong options, no trick wording. Use only facts you are confident are current in 2026. " +
    'Reply with only a JSON array, like: [{"q":"question text","o":["option A","option B","option C","option D"],"a":0,"w":"one-sentence explanation of the right answer"}]';
  try {
    const arr = await COACH.sample.json(prompt);
    const good = (Array.isArray(arr) ? arr : []).filter(q => q && typeof q.q === "string" && Array.isArray(q.o) && q.o.length >= 3 && q.o.length <= 5 && q.o.every(o => typeof o === "string") && Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length).slice(0, 5);
    const stamp = Date.now();
    good.forEach((q, k) => S.extra.push({ id: "ai" + stamp + k, l: "", x: x, d: domId, q: q.q, o: q.o, a: q.a, w: typeof q.w === "string" ? q.w : "", ai: true }));
    if (S.extra.length > 60) S.extra = S.extra.slice(-60);
    save();
    COACH.genMsg = good.length ? good.length + (good.length === 1 ? " new question" : " new questions") + " added. Open Practice, then Fresh AI questions." : "The coach's questions came back malformed. Try again.";
  } catch (e) {
    COACH.genMsg = e && e.code === "invalid_json" ? "The coach's questions came back malformed. Try again." : coachErr(e && e.code);
    if (e && ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(e.code)) COACH.status = "off";
  } finally { COACH.gen = false; if (TAB === "practice" && $("#sheet").hidden) render(); }
}

/* ===== PLAN TAB ===== */
function viewPlan() {
  const wi = weekIndex();
  let h = '<div class="notice"><b>Heads-up on your friend\'s list:</b> MB-280 retired on 31 July 2026. Its official successor is AB-210. This plan takes you from zero to AB-210 first; AB-730 is optional afterwards. Start with the setup guide in the Lab tab.</div>';
  h += '<section class="panel"><h2>Your daily hour</h2><p>Same rhythm every weekday. Consistency beats long weekend sessions.</p><div class="routine"><div><b>15</b>min watch</div><div><b>15</b>min try it</div><div><b>20</b>min drill</div><div><b>10</b>min cards</div></div></section>';
  h += '<h2 class="h-sec">Eight-week route</h2>';
  WEEKS.forEach((w, i) => {
    const done = w.tasks.filter((t, j) => S.tasks["w" + i + "t" + j]).length;
    h += '<details class="week' + (i === wi ? " now" : "") + '"' + (i === wi ? " open" : "") + '><summary><span class="wk-n">' + (i + 1) + '</span><span class="wk-t"><b>' + esc(w.focus) + "</b><small>" + weekRange(i) + (i === wi ? ", this week" : "") + '</small></span><span class="wk-c">' + done + "/" + w.tasks.length + "</span></summary>";
    h += '<ul class="tasks">' + w.tasks.map((t, j) => '<li><label><input type="checkbox" data-chg="task" data-k="w' + i + "t" + j + '"' + (S.tasks["w" + i + "t" + j] ? " checked" : "") + "><span>" + esc(t) + "</span></label></li>").join("") + "</ul></details>";
  });
  h += '<h2 class="h-sec">Your exams</h2>';
  ["210", "730"].map(x => {
    const ex = EXAMS[x]; const n = daysTo(S.exams[x]); const b = bestMock(x);
    h += '<section class="exam"><h3>' + esc(ex.code) + '</h3><p class="sub">' + esc(ex.name) + "</p>" +
      '<div class="dates"><label for="ed' + x + '">Target date</label><input type="date" id="ed' + x + '" data-chg="examdate" data-x="' + x + '" value="' + esc(S.exams[x]) + '"><b>' + (n == null ? "" : n > 0 ? n + " days to go" : n === 0 ? "Today" : "Date passed") + "</b></div>" +
      (b != null ? '<p style="margin-top:8px;font-weight:700">Best mock score: ' + b + " / 1000</p>" : "") +
      '<ul class="notes">' + ex.notes.map(t => "<li>" + esc(t) + "</li>").join("") + "</ul>" +
      '<div class="w-list">' + DOMAINS[x].filter(d => d.id !== "P").map(d => "<div>" + esc(d.n) + "<span>" + esc(d.w) + "</span></div>").join("") + "</div>" +
      '<div class="links" style="margin-top:12px">' + ex.links.map(linkHtml).join("") + "</div></section>";
  });
  h += '<h2 class="h-sec">Useful links</h2><div class="links">' + RESOURCES.map(linkHtml).join("") + "</div>";
  h += '<h2 class="h-sec">Settings</h2><section class="panel">' +
    '<div class="setrow" style="border-top:0"><span>Voice narration in lessons</span><input type="checkbox" data-chg="voicedef"' + (S.voice ? " checked" : "") + (speechOK() ? "" : " disabled") + ' style="width:22px;height:22px"></div>' +
    '<div class="setrow"><span>Narration speed</span><select data-chg="rate">' + [0.9, 1, 1.15, 1.3].map(r => '<option value="' + r + '"' + (S.rate === r ? " selected" : "") + ">" + r + "×</option>").join("") + "</select></div>" +
    '<div class="setrow"><span>Theme</span><select data-chg="theme">' + [["auto", "Match device"], ["light", "Light"], ["dark", "Dark"]].map(t => '<option value="' + t[0] + '"' + (S.theme === t[0] ? " selected" : "") + ">" + t[1] + "</option>").join("") + "</select></div>" +
    '<div class="setrow"><span>Progress</span><span id="sync2" class="muted">' + (store.mode === "device" ? "Saved in this browser (use Export to back up)" : "Not saved in this browser") + "</span></div>" +
    '<div class="setrow"><span>Backup</span><span><button class="btn small ghost" data-act="export">Export</button> <label class="btn small ghost" style="cursor:pointer">Import<input type="file" accept="application/json" data-chg="import" hidden></label></span></div>' +
    '<div class="setrow"><span>Start over</span><button class="btn small ghost" data-act="reset">' + (resetArmed ? "Tap again to erase" : "Reset progress") + "</button></div></section>";
  return h;
}
let resetArmed = false, resetT = null;

/* ===== events ===== */
const ACT = {
  tab: b => { TAB = b.dataset.tab; render(); window.scrollTo(0, 0); },
  open: b => { closeOverlaysQuiet(); openLesson(b.dataset.id); },
  curr: () => document.body.classList.toggle("cc-t"),
  ptab: b => { PC.tab = b.dataset.t; paintExtra(); },
  askl: b => { const L = P && LESSON[P.id]; goCoach(b.dataset.t + (L ? " (Lecture " + L.id + ": " + L.title + ". Key ideas: " + L.keys.join(" ") + ")" : "")); },
  close: () => closeSheet(),
  pstep: b => {
    const i = +b.dataset.i; if (!P) return;
    if (P.step === 0 && i !== 0) { P.playing = false; clearTimeout(P.timer); stopSpeech(); }
    P.stamped = false; P.step = i; paintPlayer();
  },
  prev: () => { if (!P || P.scene === 0) return; stopSpeech(); clearTimeout(P.timer); P.scene--; mountScene(); updPlay(); },
  next: () => { if (!P) return; stopSpeech(); clearTimeout(P.timer); if (P.scene < LESSON[P.id].scenes.length - 1) { P.scene++; mountScene(); } else { P.playing = false; } updPlay(); },
  goscene: b => { if (!P) return; stopSpeech(); clearTimeout(P.timer); P.scene = +b.dataset.i; mountScene(); updPlay(); },
  toggleplay: () => {
    if (!P) return;
    if (P.playing) { P.playing = false; clearTimeout(P.timer); stopSpeech(); updPlay(); return; }
    if (P.endReached) { P.scene = 0; P.endReached = false; }
    P.playing = true; updPlay();
    mountScene();
  },
  rate: () => { const r = [0.9, 1, 1.15, 1.3]; S.rate = r[(r.indexOf(S.rate) + 1) % r.length] || 1; save(); const c = document.querySelector('[data-act="rate"]'); if (c) c.textContent = "Speed " + S.rate + "×"; },
  speakkeys: () => { if (!P) return; const L = LESSON[P.id]; if (!speechOK()) { toast("No voice available in this browser."); return; } const was = S.voice; S.voice = true; speak(L.keys.join(". ") + ". In your world: " + L.world, null); S.voice = was; },
  explain: b => { const L = LESSON[b.dataset.id]; goCoach("Explain the lesson ‘" + L.title + "’ to me in simpler words, with an FMCG or SFA example. Key ideas: " + L.keys.join(" ") + ""); },
  ans: b => {
    const ctx = b.dataset.ctx, qi = +b.dataset.qi, oi = +b.dataset.oi;
    if (ctx === "pq" && P) { if (P.ans[qi] != null) return; P.ans[qi] = oi; recordAnswer(P.qset[qi].id, P.qset[qi].opts[oi].ok); paintPlayer(true); }
    else if (ctx === "drill" && D) { if (D.ans[qi] != null) return; D.ans[qi] = oi; recordAnswer(D.items[qi].id, D.items[qi].opts[oi].ok); paintDrill(); }
    else if (ctx === "gate" && P) { if (P.gans[qi] != null) return; P.gans[qi] = oi; recordAnswer(P.gates[qi].id, P.gates[qi].opts[oi].ok); paintPlayer(true); }
    else if (ctx === "gq" && G) { if (G.ans[qi] != null) return; G.ans[qi] = oi; recordAnswer(G.qs[qi].id, G.qs[qi].opts[oi].ok); paintGuide(true); }
    else if (ctx === "sq" && SET) { const st = SETUP[SET.i]; if (SET.ans[st.id] != null) return; SET.ans[st.id] = oi; recordAnswer("setup:" + st.id, SET.pres[st.id].opts[oi].ok); paintSetup(true); }
  },
  askwhy: b => {
    const ctx = b.dataset.ctx, qi = +b.dataset.qi;
    const src = ctx === "pq" ? P && { it: P.qset[qi], a: P.ans[qi] } : ctx === "gate" ? P && { it: P.gates[qi], a: P.gans[qi] } : ctx === "gq" ? G && { it: G.qs[qi], a: G.ans[qi] } : ctx === "sq" ? SET && { it: SET.pres[SETUP[SET.i].id], a: SET.ans[SETUP[SET.i].id] } : ctx === "drill" ? D && { it: D.items[qi], a: D.ans[qi] } : M && { it: M.items[qi], a: M.ans[qi] };
    if (!src) return;
    const right = src.it.opts.find(o => o.ok); const mine = src.a != null && src.a >= 0 ? src.it.opts[src.a] : null;
    goCoach("I got this practice question wrong. Question: " + src.it.q + " I chose: " + (mine ? mine.t : "nothing, I skipped it") + ". The right answer is: " + right.t + ". Explain simply why, and how to remember it.");
  },
  complete: () => {
    if (!P) return; const L = LESSON[P.id];
    const first = !S.done[L.id];
    S.done[L.id] = dkey(); touch(); save();
    if (first) { P.stamped = true; paintPlayer(); } else closeSheet();
  },
  drill: b => { closeOverlaysQuiet(); startDrill(b.dataset.f); },
  dnext: () => { if (!D) return; D.i++; paintDrill(); },
  mock: b => { closeOverlaysQuiet(); startMock(b.dataset.exam); },
  mpick: b => { if (!M || M.done) return; M.ans[M.i] = +b.dataset.oi; paintMock(true); },
  mprev: () => { if (!M || M.i === 0) return; M.i--; paintMock(); },
  mnext: () => { if (!M) return; if (M.i < M.items.length - 1) { M.i++; paintMock(); } else submitMock(); },
  msubmit: () => submitMock(),
  cards: b => { closeOverlaysQuiet(); startCards(b.dataset.deck); },
  flip: () => { if (!F || F.i >= F.cards.length) return; F.flip = !F.flip; const el = document.querySelector(".fc"); if (el && F.flip) { el.classList.add("flip"); setTimeout(paintCards, 520); } else paintCards(); },
  cardagain: () => { if (!F) return; const c = F.cards[F.i]; S.cards[c.id] = 0; F.i++; F.flip = false; touch(); save(); paintCards(); },
  cardgot: () => { if (!F) return; const c = F.cards[F.i]; S.cards[c.id] = Math.min(3, (S.cards[c.id] || 0) + 1); F.got++; F.i++; F.flip = false; touch(); save(); paintCards(); },
  cardsay: () => { if (!F || F.i >= F.cards.length) return; const c = F.cards[F.i]; if (!speechOK()) { toast("No voice available in this browser."); return; } const was = S.voice; S.voice = true; speak(c.f + ". " + (F.flip ? c.b : ""), null); S.voice = was; },
  sim: () => { closeOverlaysQuiet(); startSim(); },
  coachsend: () => { const t = $("#helpbox"); if (t && t.value.trim()) { const v = t.value; t.value = ""; coachSend(v); } },
  help: () => openHelp(),
  closehelp: () => closeHelp(),
  hchip: b => coachSend(b.dataset.t),
  jump: b => jumpTo(b.dataset.id),
  noimg: () => { HELP.img = null; HELP.imgURL = ""; paintHelp(); },
  copyq: () => { const t = $("#copyq"); if (!t) return; const done = () => { HELP.copied = true; paintHelp(); setTimeout(() => { HELP.copied = false; paintHelp(); }, 2000); }; try { navigator.clipboard.writeText(t.value).then(done, () => { t.select(); toast("Selected. Copy it with your keyboard."); }); } catch (e) { t.select(); toast("Selected. Copy it with your keyboard."); } },
  tour: b => openTour(b.dataset.id),
  tmode: b => { if (!TOUR) return; TOUR.mode = b.dataset.m; if (TOUR.mode === "quiz" && TOUR.qi >= TOUR.quiz.length) { TOUR.qi = 0; TOUR.ans = []; TOUR.marks = {}; } paintTour(); },
  tprev: () => { if (TOUR && TOUR.i > 0) { TOUR.i--; paintTour(true); } },
  tnext: () => { if (TOUR) { TOUR.i++; paintTour(true); } },
  treg: b => tourRegion(b.dataset.r),
  tqnext: () => { if (!TOUR) return; TOUR.qi++; TOUR.marks = {}; paintTour(true); },
  tretry: () => { if (!TOUR) return; TOUR.qi = 0; TOUR.ans = []; TOUR.marks = {}; TOUR.quiz = shuffle(TOUR.quiz); paintTour(); },
  tourdone: () => { if (!TOUR) return; if (!S.tours[TOUR.id]) { S.tours[TOUR.id] = dkey(); touch(); save(); toast("Tour complete. +25 XP"); } closeSheet(); },
  setup: () => openSetup(),
  setupat: b => openSetup(+b.dataset.i),
  setgo: b => { if (!SET) return; SET.i = +b.dataset.i; paintSetup(); },
  setnext: () => {
    if (!SET) return; const st = SETUP[SET.i];
    if (!S.setup[st.id]) { S.setup[st.id] = dkey(); touch(); save(); }
    if (SET.i < SETUP.length - 1) { SET.i++; paintSetup(); }
    else { toast(setupCount() === SETUP.length ? "Setup complete. Well done." : "Last step done. Finish any skipped steps."); closeSheet(); }
  },
  guide: b => openGuide(b.dataset.id),
  gtick: b => { if (!G) return; const k = +b.dataset.i; G.ticks[k] = !G.ticks[k]; if (G.ticks[k]) { const g = GUIDE_BY[G.id]; let n = k + 1; while (n < g.steps.length && G.ticks[n]) n++; G.cur = Math.min(n, g.steps.length - 1); } else G.cur = k; paintGuide(true); },
  gshow: b => { if (!G) return; const k = +b.dataset.i; G.show = G.show === k ? -1 : k; G.cur = k; paintGuide(true); },
  gstuck: b => { if (!G) return; G.cur = +b.dataset.i; paintGuide(true); openHelp("I'm stuck on step " + (G.cur + 1) + ": " + plain(GUIDE_BY[G.id].steps[G.cur].t), false); },
  guidedone: () => { if (!G) return; if (!S.guides[G.id]) { S.guides[G.id] = dkey(); touch(); save(); toast("Guide complete. +30 XP"); } closeSheet(); },
  coachstop: () => { if (COACH.ctl) COACH.ctl.abort(); },
  gen: () => { const s = $("#gendom"); if (s) genQuestions(s.value); },
  export: () => {
    try {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
      const u = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = u; link.download = "d365-route-progress-" + dkey() + ".json"; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch (e) { toast("Export failed in this browser."); }
  },
  reset: () => {
    if (!resetArmed) { resetArmed = true; render(); clearTimeout(resetT); resetT = setTimeout(() => { resetArmed = false; if (TAB === "plan") render(); }, 4000); return; }
    resetArmed = false; const keep = { voice: S.voice, rate: S.rate, theme: S.theme, exams: S.exams };
    S = Object.assign(freshState(), keep); save(); flush(); render(); toast("Progress erased. Fresh start.");
  }
};
function closeOverlaysQuiet() { stopSpeech(); if (P) { clearTimeout(P.timer); P = null; } if (M && M.tick) clearInterval(M.tick); D = null; M = null; F = null; SIM = null; G = null; TOUR = null; SET = null; }
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.disabled) return;
  const a = b.dataset.act;
  if (a.startsWith("sim") && a !== "sim") { if (SIM) simAct(a); return; }
  if (ACT[a]) { e.preventDefault(); ACT[a](b, e); }
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".fc")) { e.preventDefault(); ACT.flip(); }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".mr[data-act]")) { e.preventDefault(); tourRegion(e.target.dataset.r); }
  if (e.key === "Enter" && !e.shiftKey && e.target.id === "helpbox") { e.preventDefault(); ACT.coachsend(); }
  if (e.key === "Escape") { if (!$("#help").hidden) closeHelp(); else if (!$("#sheet").hidden) closeSheet(); }
});
let noteT = null;
document.addEventListener("input", e => {
  const t = e.target; if (t.id !== "pnote") return;
  const id = t.dataset.id; const v = t.value.slice(0, 20000);
  if (v.trim()) S.notes[id] = v; else delete S.notes[id];
  clearTimeout(noteT); noteT = setTimeout(() => { save(); const m = $("#pnotesaved"); if (m) m.textContent = "Saved"; }, 600);
});
/* remember which "Course content" sections are expanded (toggle doesn't bubble, so listen in capture) */
document.addEventListener("toggle", e => {
  const d = e.target; if (!d.classList || !d.classList.contains("cs-sec")) return;
  if (d.open) PC.open.add(d.dataset.sec); else PC.open.delete(d.dataset.sec);
}, true);
document.addEventListener("change", e => {
  const t = e.target; const c = t.dataset && t.dataset.chg; if (!c) return;
  if (c === "voice" || c === "voicedef") { S.voice = t.checked; if (!S.voice) stopSpeech(); save(); }
  else if (c === "rate") { S.rate = parseFloat(t.value) || 1; save(); }
  else if (c === "theme") { S.theme = t.value; applyTheme(); save(); }
  else if (c === "task") { if (t.checked) S.tasks[t.dataset.k] = true; else delete S.tasks[t.dataset.k]; touch(); save(); const w = t.closest("details"); if (w) { const cnt = w.querySelector(".wk-c"); const all = w.querySelectorAll("input[type=checkbox]"); if (cnt) cnt.textContent = [...all].filter(x => x.checked).length + "/" + all.length; } }
  else if (c === "shot") { pickShot(t.files && t.files[0]); }
  else if (c === "import") {
    const f = t.files && t.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { try { S = combine(S, JSON.parse(String(fr.result))); save(); render(); toast("Progress imported."); } catch (e) { toast("That file isn't a progress backup."); } };
    fr.readAsText(f);
  }
  else if (c === "examdate") { if (t.value) { S.exams[t.dataset.x] = t.value; save(); render(); } }
  else if (c === "sim" && SIM) {
    if (t.id === "simbudget") SIM.budget = t.value;
    else if (t.id === "simtime") SIM.time = t.value;
    else if (t.id === "simneed") SIM.need = t.value;
    else if (t.id === "simstake") SIM.stake = t.checked;
    else if (t.id === "simsol") SIM.sol = t.value;
    else if (t.id === "simprod") SIM.prod = t.value;
    else if (t.id === "simqty") SIM.qty = t.value;
    else if (t.id === "simclose") SIM.closeOpp = t.checked;
  }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "helpbox") { t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; }
  if (t.id === "gloss" || t.id === "gfilter") {
    const q = t.value.trim().toLowerCase();
    const sel = t.id === "gloss" ? ".gloss > div" : ".gitem";
    document.querySelectorAll(sel).forEach(el => { el.hidden = q && !el.dataset.s.includes(q); });
    if (t.id === "gfilter") document.querySelectorAll(".gcat").forEach(h => { const box = h.nextElementSibling; h.hidden = box && ![...box.children].some(c => !c.hidden); });
  }
});

