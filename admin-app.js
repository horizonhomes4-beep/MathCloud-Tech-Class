/* ============================================================
   ADMIN-APP.JS — loaded only by admin.html (after shared.js).
   Roster overview, per-student detail, account creation (via the
   createAccount Cloud Function), question bank management, Excel
   import, and platform-wide exam settings.
   ============================================================ */
function typeset(){ if (window.MathJax && MathJax.typesetPromise) { MathJax.typesetPromise(); } }
function openModal(html){ document.getElementById('modalBody').innerHTML = html; document.getElementById('modalBg').classList.add('show'); typeset(); }
function closeModal(){ document.getElementById('modalBg').classList.remove('show'); }
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
const SJT_BAND_LABEL = { 1: 'Band 1 — Excellent', 2: 'Band 2 — Good', 3: 'Band 3 — Moderate', 4: 'Band 4 — Needs improvement' };
function getModuleRecord(attempt, m){
  if (attempt.moduleResults && attempt.moduleResults[m]) return attempt.moduleResults[m];
  if (attempt.module === m) {
    if (m === 'SJT') return { accuracy: attempt.accuracy, band: attempt.sjtBand != null ? attempt.sjtBand : bandForSJT(attempt.accuracy) };
    return { accuracy: attempt.accuracy, score: attempt.score != null ? attempt.score : scaledScore(attempt.accuracy) };
  }
  return null;
}
async function computePlacementScore(uid){
  const attempts = await Data.getAttempts(uid); // sorted most-recent-first
  const bestByModule = {}, latestByModule = {};
  MODULES.forEach(m => {
    let best = null, latest = null;
    attempts.forEach(a => {
      const r = getModuleRecord(a, m);
      if (!r) return;
      if (latest === null) latest = r;
      if (m === 'SJT') { if (best === null || r.band < best.band) best = r; }
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

/* ============================================================
   ADMIN — NAV (shared across every admin screen)
   ============================================================ */
function adminNav(active){
  const items = [
    ['#/admin','Overview'], ['#/admin/accounts','Accounts'],
    ['#/admin/questions','Question bank'], ['#/admin/import','Excel import'],
    ['#/admin/settings','Settings']
  ];
  return `<div class="nav" style="margin-bottom:20px; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:6px; display:inline-flex;">
    ${items.map(([href,label])=>`<a href="${href}" class="${active===href?'active':''}">${label}</a>`).join('')}
  </div>`;
}

/* ============================================================
   ADMIN — OVERVIEW (roster of every student + bank-wide stats)
   ============================================================ */
async function viewAdminOverview(){
  const questions = await Data.getQuestions({});
  const students = await Data.getAllStudents();
  const byModule = MODULES.map(m => questions.filter(q=>q.module===m).length);
  const byDiff = DIFFICULTIES.map(d => questions.filter(q=>q.difficulty===d).length);

  const rosterRows = await Promise.all(students.map(async s => {
    const attempts = await Data.getAttempts(s.uid);
    const placement = await computePlacementScore(s.uid);
    const avgAcc = attempts.length ? Math.round(attempts.reduce((sum,a)=>sum+a.accuracy,0)/attempts.length) : null;
    return { ...s, sessions: attempts.length, avgAcc, placement: placement.totalPlacement };
  }));

  return `
  <h2>Admin dashboard</h2>
  ${adminNav('#/admin')}
  <div class="grid cols-4">
    <div class="card"><div class="stat-num">${students.length}</div><div class="stat-label">Student accounts</div></div>
    <div class="card"><div class="stat-num">${questions.length}</div><div class="stat-label">Questions in bank</div></div>
    <div class="card"><div class="stat-num">${questions.filter(q=>q.active).length}</div><div class="stat-label">Active questions</div></div>
    <div class="card"><div class="stat-num">${rosterRows.reduce((s,r)=>s+r.sessions,0)}</div><div class="stat-label">Total practice sessions</div></div>
  </div>
  <div class="card" style="margin-top:20px;">
    <h3>Students</h3>
    ${students.length ? `<table class="roster-table" style="margin-top:10px;"><thead><tr><th>Name</th><th>Target</th><th>Placement</th><th>Sessions</th><th>Avg accuracy</th><th></th></tr></thead>
    <tbody>${rosterRows.map(r=>`<tr>
      <td>${esc(r.name)}</td>
      <td>${r.targetScore || '—'}</td>
      <td>${r.placement ?? '—'}</td>
      <td>${r.sessions}</td>
      <td>${r.avgAcc!=null ? r.avgAcc+'%' : '—'}</td>
      <td><a href="#/admin/student?uid=${r.uid}" class="btn btn-sm btn-ghost">View</a></td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="empty">No student accounts yet. Create one from the <a href="#/admin/accounts">Accounts</a> page.</div>`}
  </div>
  <div class="grid cols-2" style="margin-top:20px;">
    <div class="card"><h3>Questions by module</h3>${MODULES.map((m,i)=>`<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line);"><span>${MODULE_NAMES[m]}</span><strong>${byModule[i]}</strong></div>`).join('')}</div>
    <div class="card"><h3>Questions by difficulty</h3>${DIFFICULTIES.map((d,i)=>`<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line);"><span>${d}</span><strong>${byDiff[i]}</strong></div>`).join('')}</div>
  </div>`;
}

/* ============================================================
   ADMIN — ONE STUDENT'S DETAIL VIEW (placement, weaknesses, target)
   ============================================================ */
async function viewAdminStudent(uid){
  if (!uid) return `<div class="empty">No student selected. Go back to <a href="#/admin">Overview</a>.</div>`;
  const profile = await Data.getStudentProfile(uid);
  const weaknesses = await Data.getWeaknesses(uid);
  const placement = await computePlacementScore(uid);
  const weakest = [...weaknesses].sort((a,b)=>a.accuracy-b.accuracy).slice(0,5);
  const target = profile.targetScore || 0;
  const gap = placement.totalPlacement != null ? target - placement.totalPlacement : null;
  const pct = (placement.totalPlacement != null && target > 0) ? Math.min(100, Math.max(0, Math.round((placement.totalPlacement / target) * 100))) : 0;
  const realtimeDelta = (placement.latestPlacement != null && placement.totalPlacement != null) ? placement.latestPlacement - placement.totalPlacement : null;
  return `
  <h2>${esc(profile.name)}</h2>
  ${adminNav('')}
  <a href="#/admin" class="btn btn-ghost btn-sm" style="margin-bottom:14px; display:inline-block;">← Back to overview</a>
  <div class="card" style="margin-bottom:20px; border:1.5px solid var(--primary); background:linear-gradient(135deg, var(--surface), var(--primary-tint));">
    <div class="eyebrow">Placement score vs target — updates live from every attempt, including full mock tests</div>
    <h3 style="margin-bottom:14px;">${esc(profile.name)}'s progress toward target</h3>
    <div class="grid cols-4">
      <div><div class="stat-num" style="font-size:36px;">${placement.totalPlacement ?? '—'}</div><div class="stat-label">Placement score${placement.totalPlacement!=null ? ' (personal best, VR+DM+QR)' : ''}</div></div>
      <div><div class="stat-num" style="font-size:36px; color:var(--primary-dark);">${placement.latestPlacement ?? '—'}</div><div class="stat-label">Realtime score${realtimeDelta!=null ? ` <span class="badge ${realtimeDelta>=0?'badge-green':'badge-amber'}">${realtimeDelta>=0?'+':''}${realtimeDelta} vs best</span>` : ''}</div></div>
      <div><div class="stat-num" style="font-size:36px; color:var(--ink-soft);">${target || '—'}</div><div class="stat-label">Target score</div></div>
      <div><div class="stat-num" style="font-size:36px; color:${gap!=null && gap<=0 ? 'var(--accent-green)' : 'var(--accent-amber)'};">${gap!=null ? (gap<=0 ? 'Met' : gap) : '—'}</div><div class="stat-label">${gap!=null ? (gap<=0 ? 'Target reached' : 'Points remaining') : 'Not enough data yet'}</div></div>
    </div>
    <div class="progress-bar" style="margin-top:16px; height:10px;"><div style="width:${pct}%; background:${gap!=null && gap<=0 ? 'var(--accent-green)' : 'var(--primary)'};"></div></div>
    <div class="grid cols-4" style="margin-top:18px;">
      ${MODULES.map(m => {
        if (m === 'SJT') return `<div><div class="eyebrow">${m}</div><div class="stat-num" style="font-size:19px;">${placement.sjtBand ? 'Band '+placement.sjtBand : '—'}</div><div class="stat-label">${esc(placement.sjtLabel) || 'No attempts yet'}</div></div>`;
        const best = placement.bestByModule[m];
        return `<div><div class="eyebrow">${m}</div><div class="stat-num" style="font-size:19px;">${best ? best.score : '—'}</div><div class="stat-label">${best ? 'Best (' + best.accuracy + '% acc.)' : 'No attempts yet'}</div></div>`;
      }).join('')}
    </div>
  </div>
  <div class="card" style="margin-bottom:20px;">
    <h3>Target &amp; profile</h3>
    <form onsubmit="saveStudentTarget(event,'${uid}')">
      <div class="grid cols-2">
        <div><label>Target score</label><input type="number" id="targetScoreInput" value="${target}" min="900" max="2700"></div>
        <div><label>Test date</label><input type="date" id="testDateInput" value="${profile.testDate||''}"></div>
      </div>
      <button type="submit" class="btn btn-primary" style="margin-top:12px;">Save</button>
    </form>
  </div>
  <div class="card" style="margin-bottom:20px;"><h3>Weakest topics</h3>
    ${weakest.length ? weakest.map(w=>`<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line);"><span>${esc(w.topic)} (${w.module})</span><span class="badge badge-red">${w.accuracy}%</span></div>`).join('') : '<div class="empty">No attempts recorded yet.</div>'}
  </div>
  <div class="card">
    <h3>Recent sessions</h3>
    <a href="#/admin/reports?uid=${uid}" class="btn btn-sm btn-ghost" style="margin-bottom:10px; display:inline-block;">Export full history as CSV</a>
    <div id="recentSessions"><div class="empty">Loading…</div></div>
  </div>
  <script>loadRecentSessions('${uid}')</script>`;
}
async function loadRecentSessions(uid){
  const attempts = (await Data.getAttempts(uid)).slice(0,10);
  document.getElementById('recentSessions').innerHTML = attempts.length
    ? `<table><thead><tr><th>Date</th><th>Module</th><th>Mode</th><th>Accuracy</th><th>Score</th></tr></thead>
       <tbody>${attempts.map(a=>`<tr><td>${new Date(a.date).toLocaleDateString()}</td><td>${a.module}</td><td>${a.mode}</td><td>${a.accuracy}%</td><td>${a.score ?? '—'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No sessions recorded yet.</div>';
}
async function saveStudentTarget(e, uid){
  e.preventDefault();
  await Data.saveStudentProfile(uid, {
    targetScore: Number(document.getElementById('targetScoreInput').value) || 0,
    testDate: document.getElementById('testDateInput').value
  });
  router();
}
/* ============================================================
   ADMIN — QUESTION BANK
   ============================================================ */
async function viewAdminQuestions(params){
  const filters = { module: params.get('module')||undefined, difficulty: params.get('difficulty')||undefined, active: params.get('active')==='1'?true:params.get('active')==='0'?false:undefined, search: params.get('search')||undefined };
  const questions = await Data.getQuestions(filters);
  return `
  <h2>Question bank management</h2>
  ${adminNav('#/admin/questions')}
  <div class="filters">
    <input type="search" id="qSearch" placeholder="Search question text or ID…" value="${esc(params.get('search')||'')}" onkeydown="if(event.key==='Enter')applyQFilters()">
    <select id="qModuleF" onchange="applyQFilters()"><option value="">All modules</option>${MODULES.map(m=>`<option value="${m}" ${params.get('module')===m?'selected':''}>${m}</option>`).join('')}</select>
    <select id="qDiffF" onchange="applyQFilters()"><option value="">All difficulties</option>${DIFFICULTIES.map(d=>`<option value="${d}" ${params.get('difficulty')===d?'selected':''}>${d}</option>`).join('')}</select>
    <select id="qActiveF" onchange="applyQFilters()"><option value="">Active + inactive</option><option value="1" ${params.get('active')==='1'?'selected':''}>Active only</option><option value="0" ${params.get('active')==='0'?'selected':''}>Inactive only</option></select>
    <button class="btn btn-primary" onclick="location.hash='#/admin/edit'">+ New question</button>
  </div>
  <div class="card">
    <table><thead><tr><th>ID</th><th>Module</th><th>Topic</th><th>Difficulty</th><th>Active</th><th></th></tr></thead>
    <tbody>${questions.map(q=>`<tr>
      <td>${esc(q.id)}</td><td><span class="badge badge-blue">${q.module}</span></td><td>${esc(q.topic)}</td>
      <td><span class="badge badge-${q.difficulty==='advanced'?'red':q.difficulty==='standard'?'amber':'green'}">${q.difficulty}</span></td>
      <td>${q.active?'<span class="badge badge-green">Active</span>':'<span class="badge badge-grey">Inactive</span>'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-ghost" onclick="location.hash='#/admin/edit?id=${encodeURIComponent(q.id)}'">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="duplicateQuestion('${esc(q.id)}')">Duplicate</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleActive('${esc(q.id)}', ${!q.active})">${q.active?'Deactivate':'Activate'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteQ('${esc(q.id)}')">Delete</button>
      </td></tr>`).join('') || `<tr><td colspan="6"><div class="empty">No questions match these filters.</div></td></tr>`}
    </tbody></table>
  </div>`;
}
function applyQFilters(){
  const s = document.getElementById('qSearch').value, m = document.getElementById('qModuleF').value, d = document.getElementById('qDiffF').value, a = document.getElementById('qActiveF').value;
  const p = new URLSearchParams(); if(s)p.set('search',s); if(m)p.set('module',m); if(d)p.set('difficulty',d); if(a)p.set('active',a);
  location.hash = '#/admin/questions?' + p.toString();
}
async function duplicateQuestion(id){
  const q = await Data.getQuestion(id);
  if (!q) return;
  const copy = { ...q }; delete copy.id; copy.question_id = q.question_id ? q.question_id+'_COPY_'+Date.now() : undefined;
  await Data.saveQuestion(copy);
  router();
}
async function toggleActive(id, val){ const q = await Data.getQuestion(id); await Data.saveQuestion({ ...q, active: val }); router(); }
async function deleteQ(id){ if (!confirm('Delete this question permanently?')) return; await Data.deleteQuestion(id); router(); }

/* ---------- question editor ---------- */
async function viewAdminEditor(id){
  const q = id ? await Data.getQuestion(id) : {};
  const isNew = !id;
  return `
  <h2>${isNew ? 'New question' : 'Edit question'}</h2>
  <div class="card">
    <form id="qForm" onsubmit="return false;">
      <div class="grid cols-3">
        <div class="field"><label>Module *</label><select id="f_module">${MODULES.map(m=>`<option value="${m}" ${q.module===m?'selected':''}>${MODULE_NAMES[m]}</option>`).join('')}</select></div>
        <div class="field"><label>Difficulty *</label><select id="f_difficulty">${DIFFICULTIES.map(d=>`<option value="${d}" ${q.difficulty===d?'selected':''}>${d}</option>`).join('')}</select></div>
        <div class="field"><label>Active</label><select id="f_active"><option value="true" ${q.active!==false?'selected':''}>Active</option><option value="false" ${q.active===false?'selected':''}>Inactive</option></select></div>
      </div>
      <div class="grid cols-2">
        <div class="field"><label>Question type *</label><input type="text" id="f_qtype" value="${esc(q.question_type||q.questionType||'')}"></div>
        <div class="field"><label>Topic *</label><input type="text" id="f_topic" value="${esc(q.topic||'')}"></div>
      </div>
      <div class="field"><label>Passage / data (optional — supports plain text)</label><textarea id="f_passage" rows="4">${esc(q.passage||'')}</textarea></div>
      <div class="field"><label>Question text * (LaTeX supported: \\( \\) inline, \\[ \\] display)</label><textarea id="f_qtext" rows="2">${esc(q.question_text||q.questionText||'')}</textarea></div>
      <div class="grid cols-2">
        ${['a','b','c','d','e'].map(k=>`<div class="field"><label>Option ${k.toUpperCase()} ${k!=='e'?'*':'(optional)'}</label><input type="text" id="f_opt_${k}" value="${esc(q['option_'+k]||'')}"></div>`).join('')}
      </div>
      <div class="grid cols-2">
        <div class="field"><label>Correct answer (A–E) *</label><input type="text" id="f_correct" maxlength="1" value="${esc(q.correct_answer||'')}"></div>
        <div class="field"><label>Recommended time (seconds)</label><input type="number" id="f_time" value="${q.recommended_time||45}"></div>
      </div>
      <div class="field"><label>Explanation *</label><textarea id="f_explain" rows="3">${esc(q.explanation||'')}</textarea></div>
      <div class="field"><label>Technique tip</label><textarea id="f_tip" rows="2">${esc(q.technique_tip||'')}</textarea></div>
      <div class="field"><label>Tags (comma separated)</label><input type="text" id="f_tags" value="${esc(q.tags||'')}"></div>
      <div id="qFormErrors" style="color:var(--accent-red); font-size:13px; margin-bottom:10px;"></div>
      <button class="btn btn-primary" onclick="saveQuestionForm('${q.id||''}')">Save question</button>
      <a href="#/admin/questions" class="btn btn-ghost">Cancel</a>
    </form>
  </div>`;
}
function validateQuestionForm(v){
  const errs = [];
  if (!v.question_text) errs.push('Question text is required.');
  if (!v.module) errs.push('Module is required.');
  if (!v.question_type) errs.push('Question type is required.');
  if (!v.difficulty) errs.push('Difficulty is required.');
  if (!v.option_a || !v.option_b) errs.push('At least options A and B are required.');
  if (!v.correct_answer) errs.push('Correct answer is required.');
  const validKeys = ['a','b','c','d','e'].filter(k => v['option_'+k]).map(k=>k.toUpperCase());
  if (v.correct_answer && !validKeys.includes(v.correct_answer.toUpperCase())) errs.push('Correct answer must match one of the filled-in options.');
  if (!v.explanation) errs.push('Explanation is required.');
  return errs;
}
async function saveQuestionForm(existingId){
  const v = {
    module: document.getElementById('f_module').value, difficulty: document.getElementById('f_difficulty').value,
    active: document.getElementById('f_active').value === 'true',
    question_type: document.getElementById('f_qtype').value.trim(), topic: document.getElementById('f_topic').value.trim(),
    passage: document.getElementById('f_passage').value.trim(), question_text: document.getElementById('f_qtext').value.trim(),
    option_a: document.getElementById('f_opt_a').value.trim(), option_b: document.getElementById('f_opt_b').value.trim(),
    option_c: document.getElementById('f_opt_c').value.trim(), option_d: document.getElementById('f_opt_d').value.trim(), option_e: document.getElementById('f_opt_e').value.trim(),
    correct_answer: document.getElementById('f_correct').value.trim().toUpperCase(), recommended_time: parseInt(document.getElementById('f_time').value)||45,
    explanation: document.getElementById('f_explain').value.trim(), technique_tip: document.getElementById('f_tip').value.trim(),
    tags: document.getElementById('f_tags').value.trim()
  };
  const errs = validateQuestionForm(v);
  if (errs.length) { document.getElementById('qFormErrors').innerHTML = errs.map(e=>'• '+esc(e)).join('<br>'); return; }
  if (existingId) v.id = existingId;
  await Data.saveQuestion(v);
  location.hash = '#/admin/questions';
}

/* ============================================================
   ADMIN — EXCEL IMPORT / TEMPLATE
   ============================================================ */
const TEMPLATE_COLUMNS = ['question_id','module','question_type','topic','difficulty','question_text','passage','option_a','option_b','option_c','option_d','option_e','correct_answer','explanation','technique_tip','recommended_time','tags','active'];
function downloadTemplate(){
  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.json_to_sheet([
    { question_id:'QR100', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'foundation', question_text:'A patient receives £240 and spends 35% of it. How much remains?', passage:'', option_a:'£84', option_b:'£140', option_c:'£156', option_d:'£164', option_e:'£176', correct_answer:'C', explanation:'35% of 240 = 84; 240-84 = 156.', technique_tip:'Try 65% of 240 directly.', recommended_time:40, tags:'percentages', active:true },
    { question_id:'VR100', module:'VR', question_type:'True/False/Cannot Tell', topic:'Inference', difficulty:'standard', question_text:'Statement to evaluate against the passage.', passage:'Full passage text goes here.', option_a:'True', option_b:'False', option_c:"Can't Tell", option_d:'', option_e:'', correct_answer:'B', explanation:'Explain why.', technique_tip:'A tip.', recommended_time:45, tags:'inference', active:true },
    { question_id:'DM100', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'standard', question_text:'Logical premise question text.', passage:'', option_a:'Option A', option_b:'Option B', option_c:'Option C', option_d:'Option D', option_e:'', correct_answer:'A', explanation:'Explain the logic.', technique_tip:'A tip.', recommended_time:45, tags:'logic', active:true },
    { question_id:'SJT100', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'foundation', question_text:'Scenario and question text.', passage:'', option_a:'Very appropriate', option_b:'Appropriate', option_c:'Inappropriate', option_d:'Very inappropriate', option_e:'', correct_answer:'A', explanation:'Explain why this is the best response.', technique_tip:'A tip.', recommended_time:60, tags:'safety', active:true }
  ], { header: TEMPLATE_COLUMNS });
  XLSX.utils.book_append_sheet(wb, wsData, 'Questions');
  const instructions = TEMPLATE_COLUMNS.map(c => ({ field: c, description: {
    question_id:'Unique ID for the question, e.g. QR101. Leave blank to auto-generate.', module:'One of: VR, DM, QR, SJT.',
    question_type:'Free text describing the question format, e.g. Syllogism, True/False/Cannot Tell.', topic:'The specific topic, used for weak-area tracking, e.g. Percentage Change.',
    difficulty:'One of: foundation, standard, advanced.', question_text:'The question itself. LaTeX supported using \\( \\) and \\[ \\].',
    passage:'Reading passage or data table text (VR/DM/QR as applicable). Leave blank if not needed.', option_a:'Answer option A (required).', option_b:'Answer option B (required).',
    option_c:'Answer option C (optional).', option_d:'Answer option D (optional).', option_e:'Answer option E (optional).',
    correct_answer:'Single letter A-E matching the correct option (required).', explanation:'Full explanation of the correct answer (required).',
    technique_tip:'Optional short technique tip.', recommended_time:'Recommended time in seconds, e.g. 45.', tags:'Comma-separated tags.', active:'TRUE or FALSE — whether the question is live in the bank.'
  }[c] }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instructions), 'Instructions');
  const examples = SEED_QUESTIONS.filter(q => ['VR001','DM001','QR001','SJT001'].includes(q.question_id));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(examples, { header: TEMPLATE_COLUMNS }), 'Examples');
  XLSX.writeFile(wb, 'UCAT_Question_Bank_Template.xlsx');
}
function viewAdminImport(){
  return `
  <h2>Excel question bank import</h2>
  ${adminNav('#/admin/import')}
  <div class="grid cols-2">
    <div class="card">
      <h3>1. Get the template</h3>
      <p>Download the template, fill it in following the Instructions sheet, then upload it below.</p>
      <button class="btn btn-primary" onclick="downloadTemplate()">Download Question Bank Excel Template</button>
    </div>
    <div class="card">
      <h3>2. Upload &amp; validate</h3>
      <p>Supports .xlsx and .csv. Every row is validated before anything is imported.</p>
      <input type="file" id="importFile" accept=".xlsx,.csv" onchange="handleImportFile(event)">
    </div>
  </div>
  <div id="importPreview" style="margin-top:20px;"></div>`;
}
let importRows = [];
function handleImportFile(e){
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const wb = XLSX.read(ev.target.result, { type: 'binary' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    importRows = rows.map(r => validateImportRow(r));
    renderImportPreview();
  };
  reader.readAsBinaryString(file);
}
function validateImportRow(r){
  const errs = [];
  if (!MODULES.includes(String(r.module).toUpperCase())) errs.push('Invalid or missing module');
  if (!DIFFICULTIES.includes(String(r.difficulty).toLowerCase())) errs.push('Invalid or missing difficulty');
  if (!r.question_text) errs.push('Missing question_text');
  if (!r.option_a || !r.option_b) errs.push('Missing option_a/option_b');
  if (!r.correct_answer) errs.push('Missing correct_answer');
  else {
    const valid = ['a','b','c','d','e'].filter(k=>r['option_'+k]).map(k=>k.toUpperCase());
    if (!valid.includes(String(r.correct_answer).toUpperCase())) errs.push('correct_answer does not match a filled option');
  }
  if (!r.explanation) errs.push('Missing explanation');
  return { ...r, module: String(r.module).toUpperCase(), difficulty: String(r.difficulty).toLowerCase(), correct_answer: String(r.correct_answer).toUpperCase(), active: String(r.active).toLowerCase() !== 'false', __errors: errs, __valid: errs.length === 0 };
}
function renderImportPreview(){
  const valid = importRows.filter(r=>r.__valid).length;
  const invalid = importRows.length - valid;
  document.getElementById('importPreview').innerHTML = `
  <div class="card">
    <h3>Preview — ${importRows.length} rows read (${valid} valid, ${invalid} failed)</h3>
    <table><thead><tr><th>Row</th><th>ID</th><th>Module</th><th>Status</th><th>Errors</th></tr></thead>
    <tbody>${importRows.map((r,i)=>`<tr><td>${i+2}</td><td>${esc(r.question_id||'(auto)')}</td><td>${esc(r.module)}</td>
      <td>${r.__valid?'<span class="badge badge-green">Valid</span>':'<span class="badge badge-red">Failed</span>'}</td>
      <td style="color:var(--accent-red); font-size:12px;">${esc(r.__errors.join('; '))}</td></tr>`).join('')}</tbody></table>
    <div style="margin-top:14px; display:flex; gap:10px;">
      <button class="btn btn-primary" onclick="confirmImport()" ${valid===0?'disabled':''}>Import ${valid} valid question(s)</button>
      <button class="btn btn-ghost" onclick="downloadImportErrors()" ${invalid===0?'disabled':''}>Download error report (CSV)</button>
    </div>
  </div>`;
}
async function confirmImport(){
  const validRows = importRows.filter(r=>r.__valid).map(r => { const { __errors, __valid, ...rest } = r; return rest; });
  await Data.bulkAddQuestions(validRows);
  alert(validRows.length + ' question(s) imported successfully.');
  location.hash = '#/admin/questions';
}
function downloadImportErrors(){
  const failed = importRows.filter(r=>!r.__valid);
  const csv = ['row,question_id,module,errors', ...failed.map((r,i)=>`${i+2},"${(r.question_id||'')}","${r.module||''}","${r.__errors.join('; ')}"`)].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'import_errors.csv'; a.click();
}

/* ============================================================
   ADMIN — SETTINGS
   ============================================================ */
async function viewAdminSettings(){
  const s = await Data.getSettings();
  return `
  <h2>Admin settings</h2>
  ${adminNav('#/admin/settings')}
  <p style="color:var(--ink-soft); font-size:13px; margin-bottom:14px;">These are platform-wide exam-format settings shared by every student. To edit a specific student's name or target score, open them from the <a href="#/admin">Overview</a> roster.</p>
  <div class="card">
    <h3>Module timing (seconds per question)</h3>
    ${MODULES.map(m=>`<div class="field"><label>${MODULE_NAMES[m]}</label><input type="number" id="t_${m}" value="${s.moduleTiming[m]}"></div>`).join('')}
    <h3 style="margin-top:16px;">Full mock question counts</h3>
    ${MODULES.map(m=>`<div class="field"><label>${MODULE_NAMES[m]}</label><input type="number" id="c_${m}" value="${s.moduleQuestionCounts[m]}"></div>`).join('')}
    <h3 style="margin-top:16px;">Diagnostic test question counts</h3>
    ${MODULES.map(m=>`<div class="field"><label>${MODULE_NAMES[m]}</label><input type="number" id="d_${m}" value="${s.diagnosticCounts[m]}"></div>`).join('')}
    <div class="field"><label>Daily practice target (questions)</label><input type="number" id="dailyTarget" value="${s.dailyPracticeTarget}"></div>
  </div>
  <button class="btn btn-primary" style="margin-top:16px;" onclick="saveAllSettings()">Save settings</button>`;
}
async function saveAllSettings(){
  const current = await Data.getSettings();
  const moduleTiming = {}, moduleQuestionCounts = {}, diagnosticCounts = {};
  MODULES.forEach(m => { moduleTiming[m] = parseInt(document.getElementById('t_'+m).value)||30; moduleQuestionCounts[m] = parseInt(document.getElementById('c_'+m).value)||20; diagnosticCounts[m] = parseInt(document.getElementById('d_'+m).value)||10; });
  const settings = { moduleTiming, moduleQuestionCounts, diagnosticCounts, difficultyDistribution: current.difficultyDistribution, dailyPracticeTarget: parseInt(document.getElementById('dailyTarget').value)||20 };
  await Data.saveSettings(settings);
  alert('Settings saved.');
  router();
}

/* ============================================================
   ADMIN — REPORTS
   ============================================================ */
async function viewAdminReports(params){
  const uid = params ? params.get('uid') : null;
  if (!uid) {
    const students = await Data.getAllStudents();
    return `
    <h2>Parent / coach reports</h2>
    ${adminNav('')}
    <div class="card"><h3>Pick a student</h3>
      ${students.length ? students.map(s=>`<a href="#/admin/reports?uid=${s.uid}" class="btn btn-ghost" style="margin:4px 6px 4px 0; display:inline-block;">${esc(s.name)}</a>`).join('') : '<div class="empty">No student accounts yet.</div>'}
    </div>`;
  }
  const profile = await Data.getStudentProfile(uid);
  const attempts = await Data.getAttempts(uid);
  return `
  <h2>Reports — ${esc(profile.name)}</h2>
  ${adminNav('')}
  <div class="card">
    <h3>All practice sessions (${attempts.length})</h3>
    <button class="btn btn-primary" onclick="exportAttemptsCSV('${uid}','${esc(profile.name)}')" ${attempts.length===0?'disabled':''}>Export as CSV</button>
    <table style="margin-top:14px;"><thead><tr><th>Date</th><th>Module</th><th>Mode</th><th>Accuracy</th><th>Score</th><th>Time used</th></tr></thead>
    <tbody>${attempts.map(a=>`<tr><td>${new Date(a.date).toLocaleDateString()}</td><td>${a.module}</td><td>${a.mode}</td><td>${a.accuracy}%</td><td>${a.score}</td><td>${fmtTime(a.timeUsed)}</td></tr>`).join('') || `<tr><td colspan="6"><div class="empty">No sessions recorded yet.</div></td></tr>`}</tbody></table>
  </div>`;
}
async function exportAttemptsCSV(uid, name){
  const attempts = await Data.getAttempts(uid);
  const rows = ['date,module,mode,accuracy,score,timeUsed,questionsAttempted,questionsCorrect', ...attempts.map(a => `${new Date(a.date).toISOString()},${a.module},${a.mode},${a.accuracy},${a.score},${a.timeUsed},${a.questionsAttempted},${a.questionsCorrect}`)].join('\n');
  const blob = new Blob([rows], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mathcloud_ucat_${(name||'student').replace(/\s+/g,'_')}.csv`; a.click();
}

/* ============================================================
   ADMIN — ACCOUNTS
   ------------------------------------------------------------
   Creates real Firebase Authentication accounts via the
   'createAccount' Cloud Function (functions/index.js), which
   verifies the caller is an admin, creates the auth user, sets
   their role as a custom claim, and writes their profile record.
   Client code never touches passwords beyond forwarding them once
   over the callable — Firebase Auth stores them, not our database.
   ============================================================ */
async function viewAdminAccounts(){
  const users = await Data.getAllUsers();
  const students = await Data.getAllStudents();
  const parents = users.filter(u=>u.role==='parent');
  return `
  <h2>Accounts</h2>
  ${adminNav('#/admin/accounts')}
  <div class="grid cols-2">
    <div class="card">
      <h3>Create student account</h3>
      <form onsubmit="createAccount(event,'student')">
        <div class="field"><label>Full name</label><input type="text" id="new_s_name" required></div>
        <div class="field"><label>Email</label><input type="email" id="new_s_email" required></div>
        <div class="field"><label>Temporary password</label><input type="text" id="new_s_password" required minlength="6" placeholder="min. 6 characters"></div>
        <div class="field"><label>Target score</label><input type="number" id="new_s_target" value="2500" min="900" max="2700"></div>
        <button type="submit" class="btn btn-primary" style="margin-top:8px;">Create student</button>
        <div class="err" id="acct_err_student" style="display:none; color:var(--accent-red); font-size:13px; margin-top:8px;"></div>
      </form>
    </div>
    <div class="card">
      <h3>Create parent account</h3>
      <form onsubmit="createAccount(event,'parent')">
        <div class="field"><label>Full name</label><input type="text" id="new_p_name" required></div>
        <div class="field"><label>Email</label><input type="email" id="new_p_email" required></div>
        <div class="field"><label>Temporary password</label><input type="text" id="new_p_password" required minlength="6" placeholder="min. 6 characters"></div>
        <div class="field"><label>Link to student</label>
          <select id="new_p_link">
            <option value="">— link later —</option>
            ${students.map(s=>`<option value="${s.uid}">${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:8px;">Create parent</button>
        <div class="err" id="acct_err_parent" style="display:none; color:var(--accent-red); font-size:13px; margin-top:8px;"></div>
      </form>
    </div>
    <div class="card">
      <h3>Create admin account</h3>
      <p style="color:var(--ink-soft); font-size:12.5px; margin:0 0 6px;">For a second tutor/coach who also needs full access — the question bank, every student's data, and the ability to create accounts.</p>
      <form onsubmit="createAccount(event,'admin')">
        <div class="field"><label>Full name</label><input type="text" id="new_a_name" required></div>
        <div class="field"><label>Email</label><input type="email" id="new_a_email" required></div>
        <div class="field"><label>Temporary password</label><input type="text" id="new_a_password" required minlength="6" placeholder="min. 6 characters"></div>
        <button type="submit" class="btn btn-primary" style="margin-top:8px;">Create admin</button>
        <div class="err" id="acct_err_admin" style="display:none; color:var(--accent-red); font-size:13px; margin-top:8px;"></div>
      </form>
    </div>
  </div>

  <div class="card" style="margin-top:20px;">
    <h3>Parents &amp; linked students</h3>
    ${parents.length ? `<table class="roster-table"><thead><tr><th>Parent</th><th>Email</th><th>Linked student</th><th></th></tr></thead>
    <tbody>${parents.map(p=>`<tr>
      <td>${esc(p.displayName||'—')}</td><td>${esc(p.email)}</td>
      <td id="linkedFor_${p.uid}">Loading…</td>
      <td><select id="linkSelect_${p.uid}" style="width:auto; display:inline-block;">
        <option value="">— unlink —</option>
        ${students.map(s=>`<option value="${s.uid}">${esc(s.name)}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-ghost" onclick="linkParent('${p.uid}')">Set</button></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No parent accounts yet.</div>'}
  </div>

  <div class="card" style="margin-top:20px;">
    <h3>All accounts (${users.length})</h3>
    <table class="roster-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th></tr></thead>
    <tbody>${users.map(u=>`<tr><td>${esc(u.displayName||'—')}</td><td>${esc(u.email)}</td><td><span class="badge-role ${u.role}">${u.role}</span></td><td>${fmtDate(u.createdAt)}</td></tr>`).join('')}</tbody></table>
  </div>
  <script>renderLinkedStudents(${JSON.stringify(parents.map(p=>p.uid))})</script>`;
}

async function renderLinkedStudents(parentUids){
  for (const uid of parentUids) {
    const linked = await Data.getLinkedStudents(uid);
    const el = document.getElementById('linkedFor_' + uid);
    if (el) el.textContent = linked.length ? linked.map(s=>s.name).join(', ') : '— none —';
  }
}

async function createAccount(e, role){
  e.preventDefault();
  const prefix = role === 'student' ? 's' : role === 'parent' ? 'p' : 'a';
  const errEl = document.getElementById('acct_err_' + role);
  errEl.style.display = 'none';
  const payload = {
    role,
    displayName: document.getElementById(`new_${prefix}_name`).value.trim(),
    email: document.getElementById(`new_${prefix}_email`).value.trim(),
    password: document.getElementById(`new_${prefix}_password`).value
  };
  if (role === 'student') payload.targetScore = parseInt(document.getElementById('new_s_target').value) || 2500;
  if (role === 'parent') {
    const linkUid = document.getElementById('new_p_link').value;
    if (linkUid) payload.linkedStudentUid = linkUid;
  }
  try {
    const createAccountFn = functions.httpsCallable('createAccount');
    await createAccountFn(payload);
    alert(`${role[0].toUpperCase()+role.slice(1)} account created for ${payload.email}. Share the email + temporary password with them — they should change it after first login.`);
    router();
  } catch (err) {
    errEl.textContent = err.message || 'Could not create account.';
    errEl.style.display = 'block';
  }
}

async function linkParent(parentUid){
  const studentUid = document.getElementById('linkSelect_' + parentUid).value;
  try {
    const linkFn = functions.httpsCallable('linkParentToStudent');
    await linkFn({ parentUid, studentUid: studentUid || null });
    router();
  } catch (err) {
    alert(err.message || 'Could not update link.');
  }
}


/* ============================================================
   ROUTER
   ============================================================ */
function setActiveNav(hash){} // admin nav highlighting is handled by adminNav() per-view
async function router(){
  const hash = location.hash || '#/admin';
  const [path, qs] = hash.split('?');
  const params = new URLSearchParams(qs || '');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="empty">Loading…</div>';

  if (path === '#/admin' || path === '#/' ) app.innerHTML = await viewAdminOverview();
  else if (path === '#/admin/student') app.innerHTML = await viewAdminStudent(params.get('uid'));
  else if (path === '#/admin/accounts') app.innerHTML = await viewAdminAccounts();
  else if (path === '#/admin/questions') app.innerHTML = await viewAdminQuestions(params);
  else if (path === '#/admin/edit') app.innerHTML = await viewAdminEditor(params.get('id'));
  else if (path === '#/admin/import') app.innerHTML = viewAdminImport();
  else if (path === '#/admin/settings') app.innerHTML = await viewAdminSettings();
  else if (path === '#/admin/reports') app.innerHTML = await viewAdminReports(params);
  else app.innerHTML = await viewAdminOverview();
  typeset();
}
window.addEventListener('hashchange', router);

/* ============================================================
   AUTH GATE
   ============================================================ */
window.addEventListener('DOMContentLoaded', async () => {
  const user = await Auth.requireRole('admin');
  if (!user) return;
  document.getElementById('signedInAs').textContent = user.email;
  document.getElementById('logoutBtn').addEventListener('click', async () => { await Auth.logout(); location.href = 'login.html'; });
  if (db) { await Data.seedIfEmpty(); }
  router();
});
