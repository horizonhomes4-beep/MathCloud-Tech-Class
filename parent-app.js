/* ============================================================
   PARENT-APP.JS — loaded only by parent.html (after shared.js).
   Read-only view of a parent's linked child/children: placement
   score vs target, module breakdown, recent sessions, and weak
   topics. No editing, no test-taking — parents view progress only.
   ============================================================ */
function esc2(str){ return esc(str); } // alias kept for readability below
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
  const attempts = await Data.getAttempts(uid);
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
    sjtLabel: bestByModule.SJT ? SJT_BAND_LABEL[bestByModule.SJT.band] : ''
  };
}

let PARENT_UID = null;
let ACTIVE_CHILD = null;

async function router(){
  const app = document.getElementById('app');
  app.innerHTML = '<div class="empty">Loading…</div>';
  const children = await Data.getLinkedStudents(PARENT_UID);
  if (!children.length) {
    app.innerHTML = `<div class="empty">No student is linked to your account yet. Ask the MathCloud admin to link you to your child's account.</div>`;
    return;
  }
  const hashUid = (location.hash.split('?')[1] || '').replace('uid=','');
  ACTIVE_CHILD = children.find(c => c.uid === hashUid) || children[0];
  app.innerHTML = await renderChildDashboard(children, ACTIVE_CHILD);
}
window.addEventListener('hashchange', router);

async function renderChildDashboard(children, child){
  const placement = await computePlacementScore(child.uid);
  const weaknesses = (await Data.getWeaknesses(child.uid)).sort((a,b)=>b.priority-a.priority).slice(0,5);
  const attempts = (await Data.getAttempts(child.uid)).slice(0,10);
  const target = child.targetScore || 0;
  const gap = placement.totalPlacement != null ? target - placement.totalPlacement : null;
  const pct = (placement.totalPlacement != null && target > 0) ? Math.min(100, Math.max(0, Math.round((placement.totalPlacement / target) * 100))) : 0;

  const switcher = children.length > 1 ? `
  <div class="nav" style="margin-bottom:20px; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:6px; display:inline-flex;">
    ${children.map(c=>`<a href="#/?uid=${c.uid}" class="${c.uid===child.uid?'active':''}">${esc(c.name)}</a>`).join('')}
  </div>` : '';

  return `
  <h2>${esc(child.name)}'s UCAT progress</h2>
  ${switcher}
  <div class="card" style="margin-bottom:20px; border:1.5px solid var(--primary); background:linear-gradient(135deg, var(--surface), var(--primary-tint));">
    <div class="eyebrow">Placement score vs target — updates automatically after every practice session or mock test</div>
    <div class="grid cols-4">
      <div><div class="stat-num" style="font-size:36px;">${placement.totalPlacement ?? '—'}</div><div class="stat-label">Placement score${placement.totalPlacement!=null ? ' (best VR+DM+QR)' : ''}</div></div>
      <div><div class="stat-num" style="font-size:36px; color:var(--ink-soft);">${target || '—'}</div><div class="stat-label">Target score</div></div>
      <div><div class="stat-num" style="font-size:36px; color:${gap!=null && gap<=0 ? 'var(--accent-green)' : 'var(--accent-amber)'};">${gap!=null ? (gap<=0 ? 'Met' : gap) : '—'}</div><div class="stat-label">${gap!=null ? (gap<=0 ? 'Target reached' : 'Points remaining') : 'Not enough data yet'}</div></div>
      <div><div class="stat-num" style="font-size:36px;">${attempts.length}</div><div class="stat-label">Recent sessions</div></div>
    </div>
    <div class="target-progress"><div style="width:${pct}%;"></div></div>
    <div class="grid cols-4" style="margin-top:18px;">
      ${MODULES.map(m => {
        if (m === 'SJT') return `<div><div class="eyebrow">${m}</div><div class="stat-num" style="font-size:19px;">${placement.sjtBand ? 'Band '+placement.sjtBand : '—'}</div><div class="stat-label">${esc(placement.sjtLabel) || 'No attempts yet'}</div></div>`;
        const best = placement.bestByModule[m];
        return `<div><div class="eyebrow">${m}</div><div class="stat-num" style="font-size:19px;">${best ? best.score : '—'}</div><div class="stat-label">${best ? 'Best (' + best.accuracy + '% acc.)' : 'No attempts yet'}</div></div>`;
      }).join('')}
    </div>
    <p class="disclaimer" style="margin-top:16px;">Practice scores are estimates generated by this platform and are not official UCAT results.</p>
  </div>
  <div class="grid cols-2">
    <div class="card">
      <h3>Areas to focus on</h3>
      ${weaknesses.length ? weaknesses.map(w=>`<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line);"><span>${esc(w.topic)} (${w.module})</span><span class="badge badge-red">${w.accuracy}%</span></div>`).join('') : '<div class="empty">No practice recorded yet.</div>'}
    </div>
    <div class="card">
      <h3>Recent sessions</h3>
      ${attempts.length ? `<table><thead><tr><th>Date</th><th>Module</th><th>Accuracy</th></tr></thead><tbody>${attempts.map(a=>`<tr><td>${new Date(a.date).toLocaleDateString()}</td><td>${a.module}</td><td>${a.accuracy}%</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No sessions yet.</div>'}
    </div>
  </div>`;
}

window.addEventListener('DOMContentLoaded', async () => {
  const user = await Auth.requireRole('parent');
  if (!user) return;
  PARENT_UID = user.uid;
  document.getElementById('signedInAs').textContent = user.email;
  document.getElementById('logoutBtn').addEventListener('click', async () => { await Auth.logout(); location.href = 'login.html'; });
  router();
});
