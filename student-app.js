/* ============================================================
   STUDENT-APP.JS — loaded only by student.html (after shared.js).
   Practice sessions, mock tests, mistake bank, and the student's
   own progress dashboard. Everything here is scoped to STUDENT_UID
   (the signed-in student), set by the auth gate at the bottom.
   ============================================================ */
function typeset(){ if (window.MathJax && MathJax.typesetPromise) { MathJax.typesetPromise(); } }
function openModal(html){ document.getElementById('modalBody').innerHTML = html; document.getElementById('modalBg').classList.add('show'); typeset(); }
function closeModal(){ document.getElementById('modalBg').classList.remove('show'); }

const App = { student: DEFAULT_STUDENT, settings: DEFAULT_SETTINGS, questions: [], attempts: [], weaknesses: [] };
let session = null;

function typeset(){ if (window.MathJax && MathJax.typesetPromise) { MathJax.typesetPromise(); } }
function openModal(html){ document.getElementById('modalBody').innerHTML = html; document.getElementById('modalBg').classList.add('show'); typeset(); }
function closeModal(){ document.getElementById('modalBg').classList.remove('show'); }
document.getElementById('modalBg').addEventListener('click', e => { if (e.target.id === 'modalBg') closeModal(); });
function qOptions(q){
  const opts = [];
  ['a','b','c','d','e'].forEach(k => { const v = q['option_'+k] !== undefined ? q['option_'+k] : q['option'+k.toUpperCase()]; if (v) opts.push({ key: k.toUpperCase(), text: v }); });
  return opts;
}
function bandForSJT(accuracy){
  if (accuracy >= 90) return 1;
  if (accuracy >= 75) return 2;
  if (accuracy >= 55) return 3;
  return 4;
}
const SJT_BAND_LABEL = {
  1: 'Band 1 — Excellent', 2: 'Band 2 — Good', 3: 'Band 3 — Moderate', 4: 'Band 4 — Needs improvement'
};

/* ============================================================
   PLACEMENT SCORE
   ------------------------------------------------------------
   Mirrors the real UCAT's own scoring structure: Verbal
   Reasoning, Decision Making and Quantitative Reasoning are each
   scored 300–900, and the reported total is the sum of those
   three (900–2700). Situational Judgement is reported separately
   as a Band (1 best – 4 needs improvement) rather than on the
   900–2700 scale.

   Here, "placement score" = the student's personal-best (highest
   ever) practice score in each of VR/DM/QR, summed — not an
   average of every attempt — so it reflects how close their best
   demonstrated performance is to their target, and updates live
   as soon as a new best is set.
   ============================================================ */
/* Pulls one module's result out of an attempt, regardless of whether the
   attempt was a single-module session (module === m, top-level score/
   accuracy/sjtBand) or a combined mock ('ALL', with a moduleResults
   breakdown). This is what makes full mock attempts count toward the
   placement score instead of silently vanishing. */
function getModuleRecord(attempt, m){
  if (attempt.moduleResults && attempt.moduleResults[m]) return attempt.moduleResults[m];
  if (attempt.module === m) {
    if (m === 'SJT') return { accuracy: attempt.accuracy, band: attempt.sjtBand != null ? attempt.sjtBand : bandForSJT(attempt.accuracy) };
    return { accuracy: attempt.accuracy, score: attempt.score != null ? attempt.score : scaledScore(attempt.accuracy) };
  }
  return null;
}

async function computePlacementScore(){
  const attempts = await Data.getAttempts(STUDENT_UID); // sorted most-recent-first
  const bestByModule = {}, latestByModule = {};
  MODULES.forEach(m => {
    let best = null, latest = null;
    attempts.forEach(a => {
      const r = getModuleRecord(a, m);
      if (!r) return;
      if (latest === null) latest = r; // first hit is the most recent, since attempts are sorted desc
      if (m === 'SJT') { if (best === null || r.band < best.band) best = r; } // lower band = better
      else { if (best === null || r.score > best.score) best = r; }
    });
    bestByModule[m] = best;
    latestByModule[m] = latest;
  });
  const cognitive = ['VR','DM','QR'];
  const bestComposite = cognitive.every(m => bestByModule[m]) ? cognitive.reduce((s,m) => s + bestByModule[m].score, 0) : null;
  const latestComposite = cognitive.every(m => latestByModule[m]) ? cognitive.reduce((s,m) => s + latestByModule[m].score, 0) : null;
  return {
    bestByModule, latestByModule,
    totalPlacement: bestComposite, latestPlacement: latestComposite,
    sjtBand: bestByModule.SJT ? bestByModule.SJT.band : null,
    sjtLabel: bestByModule.SJT ? SJT_BAND_LABEL[bestByModule.SJT.band] : '',
    sjtLatestBand: latestByModule.SJT ? latestByModule.SJT.band : null,
    sjtLatestLabel: latestByModule.SJT ? SJT_BAND_LABEL[latestByModule.SJT.band] : ''
  };
}

function setActiveNav(hash){
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
}

/* ============================================================
   ROUTER
   ============================================================ */
async function router(){
  const hash = location.hash || '#/';
  const [path, qs] = hash.split('?');
  const params = new URLSearchParams(qs || '');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="empty">Loading…</div>';

  if (db) {
    App.student = await Data.getStudentProfile(STUDENT_UID);
    App.settings = await Data.getSettings();
  }

  if (path === '#/' ) { setActiveNav('#/practice'); app.innerHTML = viewLanding(); }
  else if (path === '#/practice') { setActiveNav('#/practice'); app.innerHTML = await viewPracticeSetup(); await onModuleChange(); }
  else if (path === '#/session') { setActiveNav('#/practice'); app.innerHTML = viewSession(); typeset(); startTimerLoop(); return; }
  else if (path === '#/results') { setActiveNav('#/dashboard'); app.innerHTML = await viewResults(params.get('id')); }
  else if (path === '#/dashboard') { setActiveNav('#/dashboard'); app.innerHTML = await viewDashboard(); drawDashboardCharts(); }
  else if (path === '#/mistakes') { setActiveNav('#/mistakes'); app.innerHTML = await viewMistakes(); }
  else { app.innerHTML = viewLanding(); }
  typeset();
}
window.addEventListener('hashchange', router);

/* ============================================================
   AUTH GATE — must resolve before anything else touches the DB.
   STUDENT_UID is used throughout this file wherever data needs to
   be scoped to the signed-in student.
   ============================================================ */
let STUDENT_UID = null;
window.addEventListener('DOMContentLoaded', async () => {
  const user = await Auth.requireRole('student');
  if (!user) return; // requireRole already redirected to login.html
  STUDENT_UID = user.uid;
  document.getElementById('signedInAs').textContent = user.email;
  document.getElementById('logoutBtn').addEventListener('click', async () => { await Auth.logout(); location.href = 'login.html'; });
  if (db) { await Data.seedIfEmpty(); }
  router();
  buildCalc();
});

/* ============================================================
   LANDING
   ============================================================ */
function viewLanding(){
  return `
  <section class="hero">
    <div class="eyebrow">Private UCAT preparation platform</div>
    <h1>Train smarter. Think faster.</h1>
    <p class="lead">Structured practice, intelligent feedback and targeted preparation for the UK UCAT — Verbal Reasoning, Decision Making, Quantitative Reasoning and Situational Judgement, all in one place.</p>
    <div class="hero-actions">
      <a href="#/practice" class="btn btn-primary">Start Practice</a>
      <a href="#/dashboard" class="btn btn-ghost">View Progress</a>
    </div>
    <div class="feature-row">
      <div class="card"><h3>Four modules</h3><p>Original, UCAT-style questions across VR, DM, QR and SJT — not copied official content.</p></div>
      <div class="card"><h3>Timed practice</h3><p>Learning, timed practice and full mock-test modes, with flagging and a review screen.</p></div>
      <div class="card"><h3>Weak-area detection</h3><p>Every session updates a per-topic accuracy and priority score, automatically surfacing what to practise next.</p></div>
      <div class="card"><h3>Coach dashboard</h3><p>A parent/admin view of the full question bank, analytics and Excel import/export.</p></div>
    </div>
  </section>`;
}

/* ============================================================
   PRACTICE SETUP
   ============================================================ */
async function viewPracticeSetup(){
  App.questions = await Data.getQuestions({ active: true });
  const topics = [...new Set(App.questions.map(q => q.topic))].sort();
  return `
  <h2>Set up a practice session</h2>
  <p>Choose a module and configure your session, or jump into a mock test.</p>
  <div class="grid cols-2">
    <div class="card">
      <h3>Custom practice</h3>
      <div class="field"><label>Module</label>
        <select id="cfgModule" onchange="onModuleChange()">${MODULES.map(m=>`<option value="${m}">${MODULE_NAMES[m]}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Topic (optional)</label>
        <select id="cfgTopic" onchange="updateAvailableCount()"><option value="">All topics</option>${topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Difficulty</label>
        <select id="cfgDifficulty" onchange="updateAvailableCount()"><option value="">All difficulties</option>${DIFFICULTIES.map(d=>`<option value="${d}">${d[0].toUpperCase()+d.slice(1)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Question source</label>
        <select id="cfgSource" onchange="updateAvailableCount()"><option value="all">All active questions</option><option value="incorrect">Previously incorrect only</option><option value="new">Unseen questions only</option></select>
      </div>
      <div class="field"><label>Number of questions</label>
        <input type="number" id="cfgCount" value="10" min="1" max="60" oninput="clampCfgCount()">
        <small id="cfgAvailableInfo" style="display:block; margin-top:5px; color:var(--ink-soft);">Checking available questions…</small>
      </div>
      <div class="field"><label>Mode</label>
        <select id="cfgMode"><option value="learning">Learning (untimed, explanations shown immediately)</option><option value="timed">Timed practice</option></select>
      </div>
      <button class="btn btn-primary" onclick="beginCustomSession()">Start practice</button>
    </div>
    <div class="card">
      <h3>Mock test</h3>
      <p>Simulated, timed test drawn randomly from the active question bank, at the exact question counts and section timings used by the real UCAT. Explanations are withheld until you finish.</p>
      <div class="field"><label>Test length</label>
        <select id="mockLength"><option value="diagnostic">Short diagnostic (${App.settings.diagnosticCounts.VR+App.settings.diagnosticCounts.DM+App.settings.diagnosticCounts.QR+App.settings.diagnosticCounts.SJT} questions)</option><option value="full">Full mock — official UCAT length (${App.settings.moduleQuestionCounts.VR+App.settings.moduleQuestionCounts.DM+App.settings.moduleQuestionCounts.QR+App.settings.moduleQuestionCounts.SJT} questions)</option></select>
      </div>
      <div class="field"><label>Module</label>
        <select id="mockModule">${MODULES.map(m=>`<option value="${m}">${MODULE_NAMES[m]}</option>`).join('')}<option value="ALL">All modules combined</option></select>
      </div>
      <button class="btn btn-primary" onclick="beginMockSession()">Start mock test</button>
      <div style="margin-top:12px; padding:10px 12px; background:var(--primary-tint); border-radius:8px; font-size:12.5px; color:var(--ink-soft);">
        <strong>Bank depth vs official UCAT length:</strong><br>
        ${MODULES.map(m => {
          const have = App.questions.filter(q=>q.module===m).length;
          const need = App.settings.moduleQuestionCounts[m];
          return `${m}: ${have}/${need} unique questions${have<need ? ' (a full mock will use all '+have+' available — never repeats)' : ' (enough for a full mock with zero repeats)'}`;
        }).join('<br>')}
      </div>
      <p class="disclaimer">Practice scores are estimates generated by this platform and are not official UCAT results.</p>
    </div>
  </div>`;
}

async function filterPool(module, topic, difficulty, source){
  let pool = App.questions.filter(q => q.module === module);
  if (topic) pool = pool.filter(q => q.topic === topic);
  if (difficulty) pool = pool.filter(q => q.difficulty === difficulty);
  if (source === 'incorrect') {
    const wrong = new Set((await Data.getResponses(STUDENT_UID, { incorrectOnly: true })).map(r => r.questionId));
    pool = pool.filter(q => wrong.has(q.id));
  } else if (source === 'new') {
    const seen = new Set((await Data.getResponses(STUDENT_UID, {})).map(r => r.questionId));
    pool = pool.filter(q => !seen.has(q.id));
  }
  return pool;
}
async function pickQuestions(module, topic, difficulty, count, source){
  let pool = await filterPool(module, topic, difficulty, source);
  pool = pool.sort(() => Math.random() - 0.5);
  return pool.slice(0, count);
}

/* ---------- available-question limiter for Custom practice ---------- */
function populateTopicsForModule(module){
  const sel = document.getElementById('cfgTopic');
  if (!sel) return;
  const current = sel.value;
  const topics = [...new Set(App.questions.filter(q => q.module === module).map(q => q.topic))].sort();
  sel.innerHTML = '<option value="">All topics</option>' + topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (topics.includes(current)) sel.value = current;
}
async function computeAvailableCount(){
  const module = document.getElementById('cfgModule').value;
  const topic = document.getElementById('cfgTopic').value;
  const difficulty = document.getElementById('cfgDifficulty').value;
  const source = document.getElementById('cfgSource').value;
  const pool = await filterPool(module, topic, difficulty, source);
  return pool.length;
}
async function updateAvailableCount(){
  const n = await computeAvailableCount();
  const info = document.getElementById('cfgAvailableInfo');
  const countInput = document.getElementById('cfgCount');
  if (info) {
    info.textContent = n === 0
      ? 'No questions available with these filters — try broadening your selection.'
      : `${n} question${n === 1 ? '' : 's'} available with these filters (max you can select).`;
    info.style.color = n === 0 ? 'var(--accent-red)' : 'var(--ink-soft)';
  }
  if (countInput) {
    countInput.max = Math.max(n, 1);
    countInput.dataset.available = n;
    if (n === 0) { countInput.value = 0; }
    else if (parseInt(countInput.value) > n || !countInput.value) { countInput.value = n; }
  }
}
function clampCfgCount(){
  const countInput = document.getElementById('cfgCount');
  if (!countInput) return;
  const max = parseInt(countInput.dataset.available || countInput.max) || 60;
  if (parseInt(countInput.value) > max) countInput.value = max;
}
async function onModuleChange(){
  populateTopicsForModule(document.getElementById('cfgModule').value);
  await updateAvailableCount();
}

async function beginCustomSession(){
  const module = document.getElementById('cfgModule').value;
  const topic = document.getElementById('cfgTopic').value;
  const difficulty = document.getElementById('cfgDifficulty').value;
  const source = document.getElementById('cfgSource').value;
  let count = parseInt(document.getElementById('cfgCount').value) || 10;
  const mode = document.getElementById('cfgMode').value;
  const available = await computeAvailableCount();
  if (available === 0) { alert('No questions match those filters yet. Try broadening your selection or add more via the admin question bank.'); return; }
  if (count > available) {
    count = available;
    alert(`Only ${available} question${available===1?'':'s'} are available with these filters — starting a session with ${available}.`);
  }
  const questions = await pickQuestions(module, topic, difficulty, count, source);
  if (!questions.length) { alert('No questions match those filters yet. Try broadening your selection or add more via the admin question bank.'); return; }
  const perQ = App.settings.moduleTiming[module] || 30;
  startSession({ mode, module, questions, totalSeconds: mode === 'timed' ? questions.length * perQ : null });
}

async function beginMockSession(){
  const length = document.getElementById('mockLength').value;
  const moduleSel = document.getElementById('mockModule').value;
  const counts = length === 'full' ? App.settings.moduleQuestionCounts : App.settings.diagnosticCounts;
  let questions = [];
  let totalSeconds = 0;
  const mods = moduleSel === 'ALL' ? MODULES : [moduleSel];
  for (const m of mods) {
    const n = Math.min(counts[m], App.questions.filter(q=>q.module===m).length);
    const picked = await pickQuestions(m, '', '', n, 'all');
    questions = questions.concat(picked);
    totalSeconds += n * (App.settings.moduleTiming[m] || 30);
  }
  questions = questions.sort(() => Math.random() - 0.5);
  if (!questions.length) { alert('Not enough active questions in the bank yet for a mock test.'); return; }
  startSession({ mode: 'mock', module: moduleSel === 'ALL' ? 'ALL' : moduleSel, questions, totalSeconds });
}

function startPriorityPractice(module, topic){
  (async () => {
    App.questions = await Data.getQuestions({ active: true });
    const questions = await pickQuestions(module, topic, '', 12, 'all');
    if (!questions.length) { alert('No active questions found for this topic yet.'); return; }
    startSession({ mode: 'timed', module, questions, totalSeconds: questions.length * (App.settings.moduleTiming[module]||30) });
  })();
}

function startSession(cfg){
  session = { ...cfg, answers:{}, flags:{}, timeSpent:{}, currentIndex:0, lastSwitch: Date.now(), finished:false, startedAt: Date.now() };
  location.hash = '#/session';
}

/* ============================================================
   SESSION RUNNER
   ------------------------------------------------------------
   NOTE ON THE FIX: previously, selectAnswer(), toggleFlag() and
   goTo() each re-triggered rendering by setting
   `location.hash = '#/session'`. Because the hash was ALREADY
   '#/session' while inside a session, that assignment is a no-op
   as far as the browser is concerned — no 'hashchange' event
   fires, so the router never re-ran and the screen never
   updated. That's why answers couldn't be selected and "Next"
   appeared to do nothing.

   Fix: while inside an active session, these actions now call
   renderSessionView() directly to update the DOM, instead of
   relying on a hash change that wouldn't fire.
   ============================================================ */
function renderSessionView(){
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = viewSession();
  typeset();
  startTimerLoop();
}
function accumulateTime(){
  if (!session) return;
  const cur = session.questions[session.currentIndex];
  const now = Date.now();
  session.timeSpent[cur.id] = (session.timeSpent[cur.id] || 0) + (now - session.lastSwitch);
  session.lastSwitch = now;
}
function goTo(i){
  if (!session) return;
  accumulateTime();
  session.currentIndex = Math.max(0, Math.min(session.questions.length - 1, i));
  renderSessionView();
}
function selectAnswer(key){
  if (!session) return;
  const q = session.questions[session.currentIndex];
  session.answers[q.id] = key;
  renderSessionView();
}
function toggleFlag(){
  if (!session) return;
  const q = session.questions[session.currentIndex];
  session.flags[q.id] = !session.flags[q.id];
  renderSessionView();
}
let timerHandle = null;
function startTimerLoop(){
  if (timerHandle) clearInterval(timerHandle);
  if (!session || !session.totalSeconds) return;
  timerHandle = setInterval(() => {
    const elapsed = (Date.now() - session.startedAt) / 1000;
    const remaining = session.totalSeconds - elapsed;
    const el = document.getElementById('sessionTimer');
    if (!el) { clearInterval(timerHandle); return; }
    el.textContent = fmtTime(remaining);
    el.classList.toggle('low', remaining < 60);
    if (remaining <= 0) { clearInterval(timerHandle); finishSession(); }
  }, 1000);
}
function viewSession(){
  if (!session) return `<div class="empty">No active session. <a href="#/practice">Start one</a>.</div>`;
  const q = session.questions[session.currentIndex];
  const opts = qOptions(q);
  const selected = session.answers[q.id];
  const showExplanation = session.mode === 'learning' && selected;
  const isQR = q.module === 'QR';
  const elapsed = session.totalSeconds ? (Date.now() - session.startedAt) / 1000 : 0;
  const remaining = session.totalSeconds ? session.totalSeconds - elapsed : null;

  let html = `<div class="session-header">
    <div><strong>${MODULE_NAMES[q.module] || q.module}</strong> &nbsp; <span class="badge badge-grey">${esc(q.question_type||q.questionType||'')}</span> &nbsp; <span class="badge badge-${q.difficulty==='advanced'?'red':q.difficulty==='standard'?'amber':'green'}">${q.difficulty}</span></div>
    <div class="session-meta">
      <span>Q${session.currentIndex+1} of ${session.questions.length}</span>
      ${session.totalSeconds ? `<span class="timer" id="sessionTimer">${fmtTime(remaining)}</span>` : `<span class="badge badge-blue">Untimed</span>`}
      <button class="flag-btn ${session.flags[q.id]?'flagged':''}" onclick="toggleFlag()">${session.flags[q.id] ? '★ Flagged' : '☆ Flag'}</button>
      ${isQR ? `<button class="btn btn-ghost btn-sm" onclick="toggleCalc()">Calculator</button>` : ''}
    </div>
  </div>
  <div class="progress-bar"><div style="width:${((session.currentIndex+1)/session.questions.length*100)}%"></div></div>
  <div class="card" style="margin-top:18px;">`;

  if (q.passage) html += `<div class="passage-box">${esc(q.passage)}</div>`;
  html += `<div class="question-text">${esc(q.question_text || q.questionText)}</div>`;
  if (q.data) html += `<div class="passage-box">${esc(q.data)}</div>`;
  html += `<div class="options">` + opts.map(o => {
    let cls = 'option' + (selected === o.key ? ' selected' : '');
    if (showExplanation) {
      if (o.key === q.correct_answer) cls += ' correct';
      else if (o.key === selected) cls += ' incorrect';
    }
    return `<div class="${cls}" onclick="${showExplanation?'':'selectAnswer(\''+o.key+'\')'}"><span class="key">${o.key}</span><span>${esc(o.text)}</span></div>`;
  }).join('') + `</div>`;

  if (showExplanation) {
    html += `<div class="explanation-box"><h4>Explanation</h4>${esc(q.explanation)}</div>`;
    if (q.technique_tip) html += `<div class="tip-box"><strong>Technique tip:</strong> ${esc(q.technique_tip)}</div>`;
  }

  html += `</div>
  <div class="session-footer">
    <div>
      <button class="btn btn-ghost" onclick="goTo(${session.currentIndex-1})" ${session.currentIndex===0?'disabled':''}>← Previous</button>
    </div>
    <div style="display:flex; gap:10px;">
      ${session.currentIndex < session.questions.length-1
        ? `<button class="btn btn-primary" onclick="goTo(${session.currentIndex+1})">Next →</button>`
        : `<button class="btn btn-primary" onclick="finishSession()">Finish session</button>`}
    </div>
  </div>`;
  return html;
}

async function finishSession(){
  if (!session || session.finished) return;
  accumulateTime();
  session.finished = true;
  if (timerHandle) clearInterval(timerHandle);
  const responses = session.questions.map(q => {
    const studentAnswer = session.answers[q.id] || null;
    const correct = studentAnswer === q.correct_answer;
    return {
      questionId: q.id, module: q.module, topic: q.topic, questionType: q.question_type || q.questionType,
      difficulty: q.difficulty, studentAnswer, correct, timeTaken: Math.round((session.timeSpent[q.id]||0)/1000),
      flagged: !!session.flags[q.id]
    };
  });
  const correctCount = responses.filter(r => r.correct).length;
  const accuracy = Math.round((correctCount / responses.length) * 100);
  const timeUsed = Math.round(responses.reduce((s,r)=>s+r.timeTaken,0));

  /* Per-module breakdown — computed for EVERY attempt, whether it's a
     single-module custom session or a combined mock covering several
     modules. This is what lets a full mock's VR/DM/QR/SJT results feed
     into the placement score and dashboards, instead of being invisible
     just because session.module is 'ALL'. */
  const moduleResults = {};
  MODULES.forEach(m => {
    const rs = responses.filter(r => r.module === m);
    if (!rs.length) return;
    const c = rs.filter(r=>r.correct).length;
    const acc = Math.round((c/rs.length)*100);
    if (m === 'SJT') moduleResults[m] = { correct:c, total:rs.length, accuracy:acc, band: bandForSJT(acc) };
    else moduleResults[m] = { correct:c, total:rs.length, accuracy:acc, score: scaledScore(acc) };
  });

  const attempt = {
    module: session.module, mode: session.mode, accuracy, moduleResults,
    timeUsed, questionsAttempted: responses.filter(r=>r.studentAnswer).length, questionsCorrect: correctCount,
    totalQuestions: responses.length,
    // score/sjtBand: only meaningful for single-module sessions; for 'ALL'
    // mock sessions, per-module figures live in moduleResults instead.
    score: session.module === 'SJT' ? null : scaledScore(accuracy),
    sjtBand: session.module === 'SJT' ? bandForSJT(accuracy) : (moduleResults.SJT ? moduleResults.SJT.band : null)
  };
  const id = await Data.saveAttempt(STUDENT_UID, attempt, responses);
  session.lastResponses = responses;
  session.lastAttemptId = id;
  location.hash = id ? ('#/results?id=' + id) : '#/results';
}

async function viewResults(attemptId){
  if (!session || !session.finished) return `<div class="empty">No completed session found. <a href="#/practice">Start a new one</a>.</div>`;
  const responses = session.lastResponses;
  const correctCount = responses.filter(r=>r.correct).length;
  const accuracy = Math.round(correctCount/responses.length*100);
  const isSJTOnly = session.module === 'SJT';
  const isMixed = session.module === 'ALL' && new Set(responses.map(r=>r.module)).size > 1;

  let scoreCardHtml;
  if (isSJTOnly) {
    const band = bandForSJT(accuracy);
    scoreCardHtml = `<div class="card"><div class="stat-num">Band ${band}</div><div class="stat-label">${esc(SJT_BAND_LABEL[band])}</div></div>`;
  } else if (isMixed) {
    scoreCardHtml = MODULES.filter(m => responses.some(r=>r.module===m)).map(m => {
      const rs = responses.filter(r=>r.module===m);
      const acc = Math.round(rs.filter(r=>r.correct).length/rs.length*100);
      const label = m === 'SJT' ? 'Band '+bandForSJT(acc) : scaledScore(acc);
      return `<div class="card"><div class="eyebrow">${m}</div><div class="stat-num" style="font-size:24px;">${label}</div><div class="stat-label">${acc}% accuracy</div></div>`;
    }).join('');
  } else {
    scoreCardHtml = `<div class="card"><div class="stat-num">${scaledScore(accuracy)}</div><div class="stat-label">Practice score</div></div>`;
  }

  let html = `<h2>Session results</h2>
  <div class="grid ${isMixed ? 'cols-4' : 'cols-4'}">
    <div class="card"><div class="stat-num">${accuracy}%</div><div class="stat-label">Overall accuracy</div></div>
    <div class="card"><div class="stat-num">${correctCount}/${responses.length}</div><div class="stat-label">Correct</div></div>
    ${isMixed ? '' : scoreCardHtml}
    <div class="card"><div class="stat-num">${fmtTime(responses.reduce((s,r)=>s+r.timeTaken,0))}</div><div class="stat-label">Time used</div></div>
  </div>
  ${isMixed ? `<h3 style="margin-top:18px;">By section</h3><div class="grid cols-4">${scoreCardHtml}</div>` : ''}
  <p class="disclaimer">${isSJTOnly ? 'Situational Judgement is reported as a Band 1–4 (never a 300–900 score), matching how the real UCAT scores SJT.' : 'Practice score is an estimate generated by this platform (300–900 scale) and is not an official UCAT score. SJT is always reported as a Band, not a score.'}</p>
  <div style="margin:20px 0; display:flex; gap:10px;">
    <a href="#/practice" class="btn btn-primary">Practice again</a>
    <a href="#/dashboard" class="btn btn-ghost">View progress</a>
  </div>
  <h3>Question review</h3>`;
  session.questions.forEach((q,i) => {
    const r = responses[i];
    const opts = qOptions(q);
    html += `<div class="card" style="margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span class="badge ${r.correct ? 'badge-green' : 'badge-red'}">${r.correct ? 'Correct' : 'Incorrect'}</span>
        <span class="badge badge-grey">${esc(q.topic)}</span>
      </div>
      ${q.passage ? `<div class="passage-box" style="max-height:140px;">${esc(q.passage)}</div>` : ''}
      <div class="question-text">${esc(q.question_text||q.questionText)}</div>
      <div class="options">${opts.map(o=>{
        let cls='option';
        if (o.key===q.correct_answer) cls+=' correct'; else if (o.key===r.studentAnswer) cls+=' incorrect';
        return `<div class="${cls}"><span class="key">${o.key}</span><span>${esc(o.text)}</span></div>`;
      }).join('')}</div>
      <div class="explanation-box"><h4>Explanation</h4>${esc(q.explanation)}</div>
      ${!r.correct ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="markMistake('${q.id}')">Add to My Mistakes</button>` : ''}
    </div>`;
  });
  return html;
}
function markMistake(qid){ alert('Saved — incorrect answers are automatically tracked in your Mistake Bank.'); }

/* ============================================================
   CALCULATOR
   ============================================================ */
function buildCalc(){
  const grid = document.getElementById('calcGrid');
  const keys = ['7','8','9','÷','4','5','6','×','1','2','3','−','0','.','=','+','C'];
  grid.innerHTML = keys.map(k => `<button onclick="calcPress('${k}')">${k}</button>`).join('');
}
let calcExpr = '';
function toggleCalc(){ document.getElementById('calc').classList.toggle('show'); }
function calcPress(k){
  const display = document.getElementById('calcDisplay');
  if (k === 'C') { calcExpr = ''; }
  else if (k === '=') { try { calcExpr = String(eval(calcExpr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-'))); } catch(e){ calcExpr = 'Error'; } }
  else { calcExpr += k; }
  display.value = calcExpr || '0';
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function viewDashboard(){
  App.attempts = await Data.getAttempts(STUDENT_UID);
  App.weaknesses = await Data.getWeaknesses(STUDENT_UID);
  const totalQ = App.attempts.reduce((s,a)=>s+(a.totalQuestions||0),0);
  const totalCorrect = App.attempts.reduce((s,a)=>s+(a.questionsCorrect||0),0);
  const overallAcc = totalQ ? Math.round(totalCorrect/totalQ*100) : 0;
  const totalTime = App.attempts.reduce((s,a)=>s+(a.timeUsed||0),0);
  const latest = App.attempts[0], prior = App.attempts[1];
  const improvement = latest && prior ? (latest.score - prior.score) : 0;
  const sorted = [...App.weaknesses].sort((a,b)=>a.accuracy-b.accuracy);
  const weakest = sorted.slice(0,5);
  const strongest = [...App.weaknesses].sort((a,b)=>b.accuracy-a.accuracy).slice(0,5);

  const moduleCards = MODULES.map(m => {
    const records = App.attempts.map(a => getModuleRecord(a, m)).filter(Boolean);
    const acc = records.length ? Math.round(records.reduce((s,r)=>s+r.accuracy,0)/records.length) : null;
    const display = !records.length ? '—' : (m === 'SJT' ? 'Band ' + bandForSJT(acc) : scaledScore(acc));
    return `<div class="card">
      <div class="eyebrow">${m}</div>
      <h3>${MODULE_NAMES[m]}</h3>
      <div class="stat-num">${display}</div>
      <div class="stat-label">${m==='SJT'?'Average band':'Practice score'}${acc!=null ? ' · '+acc+'% accuracy' : ''}</div>
      <div class="disclaimer" style="margin-top:8px; border:none; padding:0;">${m==='SJT'?'Estimated band, not official.':'Not an official UCAT score.'}</div>
    </div>`;
  }).join('');

  return `
  <h2>Progress dashboard — ${esc(App.student.name)}</h2>
  <div class="grid cols-4">
    <div class="card"><div class="stat-num">${totalQ}</div><div class="stat-label">Questions attempted</div></div>
    <div class="card"><div class="stat-num">${overallAcc}%</div><div class="stat-label">Overall accuracy</div></div>
    <div class="card"><div class="stat-num">${improvement>=0?'+':''}${improvement}</div><div class="stat-label">Score change (last 2 attempts)</div></div>
    <div class="card"><div class="stat-num">${fmtTime(totalTime)}</div><div class="stat-label">Total practice time</div></div>
  </div>
  <h3 style="margin-top:26px;">Module performance</h3>
  <div class="grid cols-4">${moduleCards}</div>

  <div class="grid cols-2" style="margin-top:26px;">
    <div class="card"><h3>Score over time</h3><canvas id="scoreChart" height="200"></canvas></div>
    <div class="card"><h3>Accuracy by module</h3><canvas id="accChart" height="200"></canvas></div>
  </div>

  <div class="grid cols-2" style="margin-top:20px;">
    <div class="card">
      <h3>Top weaknesses</h3>
      ${weakest.length ? weakest.map(w=>`<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--line);">
        <div><strong>${esc(w.topic)}</strong><div class="stat-label">${w.module} · ${w.accuracy}% accuracy</div></div>
        <button class="btn btn-sm btn-primary" onclick="startPriorityPractice('${w.module}','${esc(w.topic)}')">Practise</button>
      </div>`).join('') : '<div class="empty">Complete a session to see weak areas.</div>'}
    </div>
    <div class="card">
      <h3>Top strengths</h3>
      ${strongest.length ? strongest.map(w=>`<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--line);">
        <div><strong>${esc(w.topic)}</strong><div class="stat-label">${w.module}</div></div><span class="badge badge-green">${w.accuracy}%</span>
      </div>`).join('') : '<div class="empty">No data yet.</div>'}
    </div>
  </div>`;
}
function drawDashboardCharts(){
  const scoreEl = document.getElementById('scoreChart');
  const accEl = document.getElementById('accChart');
  if (!scoreEl || !window.Chart) return;
  const attempts = [...App.attempts].reverse();
  new Chart(scoreEl, { type:'line', data:{ labels: attempts.map((a,i)=>'#'+(i+1)), datasets:[{ label:'Practice score', data: attempts.map(a=>a.score), borderColor:'#1B5FD1', backgroundColor:'#EAF1FD', tension:.3, fill:true }] }, options:{ plugins:{legend:{display:false}}, scales:{y:{min:300,max:900}} } });
  const accByModule = MODULES.map(m => { const a = App.attempts.filter(x=>x.module===m); return a.length ? Math.round(a.reduce((s,x)=>s+x.accuracy,0)/a.length) : 0; });
  new Chart(accEl, { type:'bar', data:{ labels: MODULES, datasets:[{ label:'Accuracy %', data: accByModule, backgroundColor:['#1B5FD1','#0E9F6E','#C77F00','#D64545'] }] }, options:{ plugins:{legend:{display:false}}, scales:{y:{min:0,max:100}} } });
}

/* ============================================================
   MISTAKE BANK
   ============================================================ */
async function viewMistakes(){
  const incorrect = await Data.getResponses(STUDENT_UID, { incorrectOnly: true });
  const flagged = await Data.getResponses(STUDENT_UID, { flagged: true });
  const weaknesses = (await Data.getWeaknesses(STUDENT_UID)).sort((a,b)=>b.priority-a.priority).slice(0,8);
  return `
  <h2>Mistake bank &amp; priority practice</h2>
  <div class="grid cols-2">
    <div class="card">
      <h3>Today's priority practice</h3>
      <p>Topics ranked by how often you've gotten them wrong recently.</p>
      ${weaknesses.length ? weaknesses.map(w=>`<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--line);">
        <div><strong>${esc(w.topic)}</strong><div class="stat-label">${w.module} · priority ${w.priority}/5 · ${w.accuracy}% accuracy</div></div>
        <button class="btn btn-sm btn-primary" onclick="startPriorityPractice('${w.module}','${esc(w.topic)}')">Practise</button>
      </div>`).join('') : '<div class="empty">No priority topics yet — complete a session first.</div>'}
    </div>
    <div class="card">
      <h3>Flagged questions</h3>
      <div class="stat-num">${flagged.length}</div>
      <div class="stat-label">questions flagged during practice</div>
      <h3 style="margin-top:20px;">Incorrect answers logged</h3>
      <div class="stat-num">${incorrect.length}</div>
      <div class="stat-label">available for "previously incorrect only" practice</div>
      <a href="#/practice" class="btn btn-ghost" style="margin-top:14px;">Go set up a mistakes-only session</a>
    </div>
  </div>`;
}
