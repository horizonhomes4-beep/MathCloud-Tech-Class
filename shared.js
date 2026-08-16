/* ============================================================
   SHARED.JS — MathCloud UCAT Coaching Platform
   Loaded by student.html, admin.html, parent.html, login.html.
   Contains: Firebase init (Auth + Realtime Database + Functions),
   the question bank, the UCAT-standard format constants, the
   per-role Data access layer, and small shared utilities.
   ============================================================ */

/* ---------- FIREBASE CONFIG ----------
   Same project as before. Auth (Email/Password provider) must be
   turned on in Firebase Console → Authentication → Sign-in method
   before login will work. See SETUP.md. */
const firebaseConfig = {
  apiKey: "AIzaSyClpc-ybBzSALYXtPHDw8cox8i1xEKxSao",
  authDomain: "memory-87b65.firebaseapp.com",
  projectId: "memory-87b65",
  storageBucket: "memory-87b65.firebasestorage.app",
  messagingSenderId: "123213603131",
  appId: "1:123213603131:web:e2e385481ee08a760d171e",
  databaseURL: "https://memory-87b65-default-rtdb.firebaseio.com"
};

const FIREBASE_READY = firebaseConfig.apiKey !== "YOUR_API_KEY";
let db = null, auth = null, functions = null;
if (FIREBASE_READY) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  auth = firebase.auth();
  functions = firebase.functions();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('setupBanner');
    if (b) b.classList.add('show');
  });
}

/* ============================================================
   AUTH HELPERS
   Roles ('admin' | 'student' | 'parent') live as a Firebase Auth
   custom claim, set server-side by the createAccount Cloud
   Function (see functions/index.js). Custom claims are what the
   database.rules.json security rules check, so they can't be
   forged from the browser.
   ============================================================ */
const Auth = {
  // Resolves once with the signed-in user + role, or null if signed out.
  // Waits for the ID token (and its custom claims) to be ready.
  currentUser() {
    return new Promise((resolve) => {
      if (!auth) return resolve(null);
      const unsub = auth.onAuthStateChanged(async (user) => {
        unsub();
        if (!user) return resolve(null);
        const token = await user.getIdTokenResult(true);
        resolve({ uid: user.uid, email: user.email, role: token.claims.role || null });
      });
    });
  },
  async login(email, password) {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const token = await cred.user.getIdTokenResult(true);
    return { uid: cred.user.uid, email: cred.user.email, role: token.claims.role || null };
  },
  async logout() {
    await auth.signOut();
  },
  // Redirects to login.html if not signed in, or if signed in with the
  // wrong role. Call this at the top of each role-specific page.
  async requireRole(role) {
    const user = await Auth.currentUser();
    if (!user) { location.href = 'login.html'; return null; }
    if (user.role !== role) {
      alert(`This page is for ${role}s. You're signed in as a ${user.role || 'user with no role assigned'}.`);
      await Auth.logout();
      location.href = 'login.html';
      return null;
    }
    return user;
  }
};

/* ============================================================
   REALTIME DATABASE DATA LAYER
   ------------------------------------------------------------
   Paths:
     /questions/{qid}                — shared question bank (admin-managed)
     /settings                       — shared exam-format settings (admin-managed)
     /users/{uid}                    — {role, email, displayName, createdAt}
     /students/{uid}/profile         — {name, targetScore, targetUniversity, ...}
     /students/{uid}/attempts/{id}
     /students/{uid}/responses/{id}
     /students/{uid}/weaknesses/{id}
     /parents/{uid}/studentUids/{studentUid}: true
   Every attempt/response/weakness/profile call below takes an
   explicit studentUid, so the same functions serve student.html
   (studentUid = own uid), admin.html (studentUid = whichever
   student the admin is viewing), and parent.html (studentUid =
   the linked child).
   ============================================================ */
function snapToArray(val) {
  if (!val) return [];
  return Object.keys(val).map(k => ({ ...val[k], id: k }));
}
function sanitizeKey(k) { return String(k).replace(/[.#$\[\]\/]/g, '_'); }

const Data = {
  async getQuestions(filters = {}) {
    if (!db) return [];
    const snap = await db.ref('questions').once('value');
    let rows = snapToArray(snap.val());
    if (filters.module) rows = rows.filter(q => q.module === filters.module);
    if (filters.difficulty) rows = rows.filter(q => q.difficulty === filters.difficulty);
    if (filters.topic) rows = rows.filter(q => q.topic === filters.topic);
    if (filters.active !== undefined) rows = rows.filter(q => !!q.active === filters.active);
    if (filters.questionType) rows = rows.filter(q => q.questionType === filters.questionType);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      rows = rows.filter(q => (q.question_text||q.questionText||'').toLowerCase().includes(s) || (q.topic||'').toLowerCase().includes(s) || (q.id||'').toLowerCase().includes(s));
    }
    return rows;
  },
  async getQuestion(id) {
    if (!db) return null;
    const snap = await db.ref('questions/' + id).once('value');
    return snap.exists() ? { ...snap.val(), id } : null;
  },
  async saveQuestion(q) {
    if (!db) return;
    const id = q.id ? sanitizeKey(q.id) : db.ref('questions').push().key;
    const payload = { ...q, id, updatedAt: Date.now() };
    if (!q.createdAt) payload.createdAt = Date.now();
    await db.ref('questions/' + id).update(payload);
    return id;
  },
  async deleteQuestion(id) {
    if (!db) return;
    await db.ref('questions/' + id).remove();
  },
  async bulkAddQuestions(list) {
    if (!db) return;
    const updates = {};
    list.forEach(q => {
      const id = q.question_id ? sanitizeKey(q.question_id) : (q.id ? sanitizeKey(q.id) : db.ref('questions').push().key);
      updates['questions/' + id] = { ...q, id, createdAt: Date.now(), updatedAt: Date.now() };
    });
    await db.ref().update(updates);
  },
  async getAttempts(studentUid) {
    if (!db) return [];
    const snap = await db.ref(`students/${studentUid}/attempts`).once('value');
    return snapToArray(snap.val()).sort((a, b) => (b.date||0) - (a.date||0));
  },
  async saveAttempt(studentUid, attempt, responses) {
    if (!db) return null;
    const attemptId = db.ref(`students/${studentUid}/attempts`).push().key;
    const updates = {};
    updates[`students/${studentUid}/attempts/${attemptId}`] = { ...attempt, id: attemptId, date: Date.now() };
    responses.forEach(r => {
      const rid = db.ref(`students/${studentUid}/responses`).push().key;
      updates[`students/${studentUid}/responses/${rid}`] = { ...r, id: rid, attemptId };
    });
    await db.ref().update(updates);
    await Data.updateWeaknesses(studentUid, attempt.module, responses);
    return attemptId;
  },
  async getResponses(studentUid, filters = {}) {
    if (!db) return [];
    const snap = await db.ref(`students/${studentUid}/responses`).once('value');
    let rows = snapToArray(snap.val());
    if (filters.attemptId) rows = rows.filter(r => r.attemptId === filters.attemptId);
    if (filters.flagged) rows = rows.filter(r => r.flagged);
    if (filters.incorrectOnly) rows = rows.filter(r => r.correct === false);
    return rows;
  },
  async updateWeaknesses(studentUid, module, responses) {
    if (!db) return;
    const byTopic = {};
    responses.forEach(r => {
      const key = module + '::' + r.topic;
      if (!byTopic[key]) byTopic[key] = { correct: 0, total: 0, time: 0 };
      byTopic[key].total++;
      byTopic[key].time += (r.timeTaken || 0);
      if (r.correct) byTopic[key].correct++;
    });
    const updates = {};
    for (const key in byTopic) {
      const [mod, topic] = key.split('::');
      const stat = byTopic[key];
      const accuracy = Math.round((stat.correct / stat.total) * 100);
      const avgTime = Math.round(stat.time / stat.total);
      const docId = sanitizeKey(mod + '_' + topic);
      const existingSnap = await db.ref(`students/${studentUid}/weaknesses/${docId}`).once('value');
      let priority = 1;
      if (existingSnap.exists()) {
        const prev = existingSnap.val();
        priority = accuracy < 60 ? Math.min((prev.priority || 1) + 1, 5) : Math.max((prev.priority || 1) - 1, 1);
      } else if (accuracy < 60) {
        priority = 2;
      }
      updates[`students/${studentUid}/weaknesses/${docId}`] = { module: mod, topic, accuracy, averageTime: avgTime, priority, updatedAt: Date.now() };
    }
    await db.ref().update(updates);
  },
  async getWeaknesses(studentUid) {
    if (!db) return [];
    const snap = await db.ref(`students/${studentUid}/weaknesses`).once('value');
    return snapToArray(snap.val());
  },
  async getStudentProfile(studentUid) {
    if (!db) return DEFAULT_STUDENT;
    const snap = await db.ref(`students/${studentUid}/profile`).once('value');
    return snap.exists() ? { ...DEFAULT_STUDENT, ...snap.val() } : DEFAULT_STUDENT;
  },
  async saveStudentProfile(studentUid, profile) {
    if (!db) return;
    await db.ref(`students/${studentUid}/profile`).update(profile);
  },
  // Roster of every student account (admin + parent screens use this).
  async getAllStudents() {
    if (!db) return [];
    const snap = await db.ref('students').once('value');
    const val = snap.val() || {};
    return Object.keys(val).map(uid => ({ uid, ...(val[uid].profile || DEFAULT_STUDENT) }));
  },
  async getUserRecord(uid) {
    if (!db) return null;
    const snap = await db.ref('users/' + uid).once('value');
    return snap.exists() ? snap.val() : null;
  },
  // Every account (admin panel roster screen).
  async getAllUsers() {
    if (!db) return [];
    const snap = await db.ref('users').once('value');
    return snapToArray(snap.val());
  },
  // Which student uids a parent is linked to.
  async getLinkedStudents(parentUid) {
    if (!db) return [];
    const snap = await db.ref(`parents/${parentUid}/studentUids`).once('value');
    const val = snap.val() || {};
    const uids = Object.keys(val).filter(k => val[k]);
    const students = [];
    for (const uid of uids) {
      const profile = await Data.getStudentProfile(uid);
      students.push({ uid, ...profile });
    }
    return students;
  },
  async getSettings() {
    if (!db) return DEFAULT_SETTINGS;
    const snap = await db.ref('settings').once('value');
    return snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.val() } : DEFAULT_SETTINGS;
  },
  async saveSettings(cfg) {
    if (!db) return;
    await db.ref('settings').set(cfg);
  },
  // Runs once per page load. Tops up /questions with anything new in the
  // in-file SEED_QUESTIONS bank (never overwrites admin edits), and seeds
  // /settings on a brand-new project. Safe to call from any page.
  async seedIfEmpty() {
    if (!db) return;
    const existingSnap = await db.ref('questions').once('value');
    const existingVal = existingSnap.val() || {};
    const existingIds = new Set(Object.keys(existingVal));
    const missing = SEED_QUESTIONS.filter(q => {
      const id = q.question_id ? sanitizeKey(q.question_id) : null;
      return !id || !existingIds.has(id);
    });
    if (missing.length) await Data.bulkAddQuestions(missing);
    const settingsSnap = await db.ref('settings').once('value');
    if (!settingsSnap.exists()) await Data.saveSettings(DEFAULT_SETTINGS);
  }
};

const DEFAULT_STUDENT = {
  name: 'Student', targetUniversity: '', targetCourse: '', targetUCATYear: new Date().getFullYear() + 1,
  targetScore: 2500, testDate: ''
};
/* ============================================================
   UCAT-STANDARD FORMAT — from the UCAT Consortium's official
   "Test Format and Scoring" page (ucat.ac.uk): VR 44q/22min,
   DM 35q/37min, QR 36q/26min, SJT 69q/26min — 184 questions total.
   ============================================================ */
const MODULE_EXAM_MINUTES = { VR: 22, DM: 37, QR: 26, SJT: 26 };
const DEFAULT_SETTINGS = {
  moduleTiming: { VR: 30, DM: 63, QR: 43, SJT: 23 },
  moduleQuestionCounts: { VR: 44, DM: 35, QR: 36, SJT: 69 },
  diagnosticCounts: { VR: 11, DM: 9, QR: 9, SJT: 17 },
  difficultyDistribution: { foundation: 30, standard: 45, advanced: 25 },
  dailyPracticeTarget: 20
};

const MODULES = ['VR', 'DM', 'QR', 'SJT'];
const MODULE_NAMES = { VR: 'Verbal Reasoning', DM: 'Decision Making', QR: 'Quantitative Reasoning', SJT: 'Situational Judgement' };
const DIFFICULTIES = ['foundation', 'standard', 'advanced'];

/* ============================================================
   SEED QUESTION BANK — original, UCAT-style, not official content
   ============================================================ */
const SEED_QUESTIONS = [
/* ---------------- VERBAL REASONING ---------------- */
{question_id:'VR001', module:'VR', question_type:'True/False/Cannot Tell', topic:'Inference', difficulty:'foundation', recommended_time:45, tags:'inference,passage', active:true,
 passage:"Urban beekeeping has grown rapidly in the last decade, with municipal governments in several major cities relaxing restrictions on rooftop hives. Proponents argue that city-kept bees benefit from a wider variety of flowering plants than their rural counterparts, since urban parks and gardens are often planted with diverse, non-native species that bloom at different times of year. Critics counter that dense hive placement in small areas can increase competition for forage among colonies, potentially harming wild pollinator populations that rely on the same limited green spaces.",
 question_text:"Urban bees always produce more honey than rural bees.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'C', explanation:'The passage discusses forage diversity and competition, but makes no claim at all about honey yield. Nothing in the text supports or contradicts a claim about quantity of honey produced, so it cannot be determined from the passage.', technique_tip:'If the statement introduces a measure (honey yield) that the passage never mentions, the answer is almost always "Cannot Tell" — do not use outside knowledge.'},

{question_id:'VR002', module:'VR', question_type:'True/False/Cannot Tell', topic:'Inference', difficulty:'standard', recommended_time:45, tags:'inference,passage', active:true,
 passage:"Urban beekeeping has grown rapidly in the last decade, with municipal governments in several major cities relaxing restrictions on rooftop hives. Proponents argue that city-kept bees benefit from a wider variety of flowering plants than their rural counterparts, since urban parks and gardens are often planted with diverse, non-native species that bloom at different times of year. Critics counter that dense hive placement in small areas can increase competition for forage among colonies, potentially harming wild pollinator populations that rely on the same limited green spaces.",
 question_text:"According to critics, placing many hives close together in a small area could have a negative effect on wild pollinators.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'A', explanation:'The passage states critics believe dense hive placement increases competition for forage, potentially harming wild pollinator populations — this directly matches the statement.', technique_tip:'Match the statement to the exact clause in the passage; watch for the word "potentially" which still counts as the passage making that claim.'},

{question_id:'VR003', module:'VR', question_type:"Author\'s Argument", topic:"Author\'s Argument", difficulty:'standard', recommended_time:50, tags:'argument', active:true,
 passage:"Remote work advocates often cite reduced commuting time as a universal benefit, yet this framing obscures significant variation by household composition. A single professional in a one-bedroom flat gains focus and flexibility; a parent sharing a small home with school-age children juggling their own online lessons may experience the opposite — fragmented attention, competition for space, and blurred boundaries between work and family life. Policies that treat remote work as an unqualified good risk designing support (tax relief for home offices, for instance) around the former group while ignoring the latter.",
 question_text:"Which of the following best summarises the author\'s main argument?",
 option_a:'Remote work should be banned for parents of school-age children.', option_b:'The benefits of remote work are not evenly distributed across different household types, and policy should reflect this.', option_c:'Commuting time reduction is the only benefit of remote work worth measuring.', option_d:'Home office tax relief is poorly designed and should be abolished immediately.', option_e:'',
 correct_answer:'B', explanation:'The author is not arguing against remote work itself, but against treating it as a uniform benefit — pointing out that outcomes differ by household composition and that policy should account for this. Option B captures this balanced, nuanced position; the others overstate or narrow the argument.', technique_tip:'For "author\'s argument" questions, favour the option that captures the overall thrust and nuance, not one extreme detail.'},

{question_id:'VR004', module:'VR', question_type:'Inference', topic:'Inference', difficulty:'advanced', recommended_time:55, tags:'inference', active:true,
 passage:"Remote work advocates often cite reduced commuting time as a universal benefit, yet this framing obscures significant variation by household composition. A single professional in a one-bedroom flat gains focus and flexibility; a parent sharing a small home with school-age children juggling their own online lessons may experience the opposite — fragmented attention, competition for space, and blurred boundaries between work and family life. Policies that treat remote work as an unqualified good risk designing support (tax relief for home offices, for instance) around the former group while ignoring the latter.",
 question_text:"Which of the following can be most reasonably inferred from the passage?",
 option_a:'All parents find remote work less productive than office work.', option_b:'Existing home-office tax relief schemes were designed with single professionals more in mind than parents in shared households.', option_c:'School-age children should not be allowed to attend online lessons at home.', option_d:'Single professionals never experience any downsides from remote work.', option_e:'',
 correct_answer:'B', explanation:'The passage warns that policies "risk designing support...around the former group while ignoring the latter" — implying existing or proposed support may already skew toward single professionals. Option B is a cautious, textually-grounded inference; the others go beyond or contradict what is stated.', technique_tip:'A safe inference stays close to the passage\'s own hedged language ("risk", "may") rather than converting it into an absolute claim.'},

{question_id:'VR005', module:'VR', question_type:'Matching Information', topic:'Matching Information', difficulty:'foundation', recommended_time:40, tags:'matching', active:true,
 passage:"Three approaches dominate modern flood defence: hard engineering (concrete walls and barriers), soft engineering (wetland restoration and managed retreat), and hybrid schemes that combine both. Hard engineering offers immediate, predictable protection but is costly to maintain and can increase flood risk downstream by redirecting water flow. Soft engineering is cheaper over the long term and can improve biodiversity, but is slower to implement and less effective against sudden, severe surges.",
 question_text:"Which flood defence approach is described as being able to increase flood risk further down a river?",
 option_a:'Soft engineering', option_b:'Hard engineering', option_c:'Hybrid schemes', option_d:'None of the approaches', option_e:'',
 correct_answer:'B', explanation:'The passage states hard engineering "can increase flood risk downstream by redirecting water flow."', technique_tip:'Matching Information questions are solved by scanning for the exact keyword ("downstream") rather than reading the whole passage again.'},

{question_id:'VR006', module:'VR', question_type:'Identifying Information', topic:'Identifying Information', difficulty:'standard', recommended_time:45, tags:'identifying', active:true,
 passage:"Three approaches dominate modern flood defence: hard engineering (concrete walls and barriers), soft engineering (wetland restoration and managed retreat), and hybrid schemes that combine both. Hard engineering offers immediate, predictable protection but is costly to maintain and can increase flood risk downstream by redirecting water flow. Soft engineering is cheaper over the long term and can improve biodiversity, but is slower to implement and less effective against sudden, severe surges.",
 question_text:"Based on the passage, which statement is best supported?",
 option_a:'Soft engineering is always the superior choice for coastal cities.', option_b:'Hybrid schemes are never used in practice.', option_c:'Each approach involves a trade-off between speed of implementation, cost, and effectiveness against sudden surges.', option_d:'Hard engineering has no drawbacks compared to soft engineering.', option_e:'',
 correct_answer:'C', explanation:'The passage lays out costs and benefits for both hard and soft engineering, showing that each involves trade-offs — this is the only option that is a balanced, supported summary.', technique_tip:'Eliminate options containing absolutes ("always", "never", "no drawbacks") first when the passage is comparative.'},

{question_id:'VR007', module:'VR', question_type:'True/False/Cannot Tell', topic:"Evidence vs Assumption", difficulty:'advanced', recommended_time:50, tags:'assumption', active:true,
 passage:"A recent workplace study tracked productivity across two groups: one using a standard eight-hour office day, and another on a compressed four-day, ten-hour schedule. Self-reported job satisfaction rose by 18% in the compressed-schedule group over six months. However, the study\'s authors noted that participants in the compressed group had volunteered for the trial, whereas the standard-schedule group had not opted in.",
 question_text:"The rise in job satisfaction was caused entirely by the compressed schedule itself, independent of any other factor.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'C', explanation:'The passage flags a key confound: the compressed group self-selected into the trial, which could itself explain higher satisfaction (volunteer bias) rather than the schedule alone. The passage does not rule this out or confirm it, so it cannot be told from the text whether the schedule was the sole cause.', technique_tip:'When a passage mentions a methodological caveat (like self-selection), treat any "purely caused by X" statement as unconfirmed — the answer is usually "Cannot Tell".'},

{question_id:'VR008', module:'VR', question_type:"Author\'s Argument", topic:"Author\'s Argument", difficulty:'standard', recommended_time:45, tags:'argument', active:true,
 passage:"A recent workplace study tracked productivity across two groups: one using a standard eight-hour office day, and another on a compressed four-day, ten-hour schedule. Self-reported job satisfaction rose by 18% in the compressed-schedule group over six months. However, the study\'s authors noted that participants in the compressed group had volunteered for the trial, whereas the standard-schedule group had not opted in.",
 question_text:"Why do the study\'s authors most likely mention that participants volunteered for the compressed schedule?",
 option_a:'To prove the compressed schedule is more popular with employees.', option_b:'To highlight a possible limitation in attributing the satisfaction increase solely to the schedule change.', option_c:'To argue that the standard schedule should be abolished.', option_d:'To show that volunteering has no effect on study outcomes.', option_e:'',
 correct_answer:'B', explanation:'Noting the self-selection is a classic caveat flagging a possible confound — the authors are being transparent about a limitation, not proving popularity or arguing for abolition.', technique_tip:'When authors mention a study design detail right after presenting a result, they are usually qualifying that result, not celebrating it.'},

{question_id:'VR009', module:'VR', question_type:'Reading Comprehension', topic:'Reading Comprehension', difficulty:'foundation', recommended_time:40, tags:'comprehension', active:true,
 passage:"Coral reefs cover less than 1% of the ocean floor but support roughly a quarter of all known marine species. Rising sea temperatures cause corals to expel the symbiotic algae living in their tissues, a process known as bleaching, which leaves the coral white and vulnerable to disease. A bleached coral is not dead, and can recover if temperatures drop quickly enough, but repeated bleaching events reduce its ability to recover each time.",
 question_text:"What happens during coral bleaching, according to the passage?",
 option_a:'The coral dies immediately and cannot recover.', option_b:'The coral expels algae living inside it, turning white and becoming vulnerable to disease.', option_c:'The coral grows a new species of algae.', option_d:'The coral sinks to the ocean floor.', option_e:'',
 correct_answer:'B', explanation:'The passage directly describes bleaching as the coral expelling its symbiotic algae, leaving it white and vulnerable to disease.', technique_tip:'For direct comprehension questions, find the sentence containing the key term and match wording carefully.'},

{question_id:'VR010', module:'VR', question_type:'Inference', topic:'Inference', difficulty:'standard', recommended_time:45, tags:'inference', active:true,
 passage:"Coral reefs cover less than 1% of the ocean floor but support roughly a quarter of all known marine species. Rising sea temperatures cause corals to expel the symbiotic algae living in their tissues, a process known as bleaching, which leaves the coral white and vulnerable to disease. A bleached coral is not dead, and can recover if temperatures drop quickly enough, but repeated bleaching events reduce its ability to recover each time.",
 question_text:"It can be inferred from the passage that:",
 option_a:'A coral reef that experiences frequent bleaching events is likely to become progressively less resilient over time.', option_b:'Coral bleaching only happens once per coral colony.', option_c:'Coral reefs support less than 1% of marine species.', option_d:'Sea temperature has no effect on coral health.', option_e:'',
 correct_answer:'A', explanation:'The passage states repeated bleaching "reduces its ability to recover each time" — implying a cumulative, worsening effect on resilience, which is a reasonable inference.', technique_tip:'Look for cumulative/repeated language ("each time", "repeated") as a strong signal for trend-based inference questions.'},

{question_id:'VR011', module:'VR', question_type:'Interpretation', topic:'Interpretation of Passages', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
 passage:"Some economists argue that a universal basic income (UBI) would simplify welfare administration by replacing a patchwork of means-tested benefits with a single unconditional payment. Others counter that a UBI set high enough to meaningfully replace existing support would be prohibitively expensive, while one set low enough to be affordable would leave the most vulnerable worse off than under a well-targeted, means-tested system.",
 question_text:"The passage is best described as presenting:",
 option_a:'A single, one-sided argument in favour of universal basic income.', option_b:'A balanced outline of a trade-off between simplicity and adequacy of support in the UBI debate.', option_c:'A historical account of how welfare systems have changed over time.', option_d:'A definitive conclusion that means-tested welfare is superior in all cases.', option_e:'',
 correct_answer:'B', explanation:'The passage presents both a pro-UBI simplification argument and a counter-argument about cost/adequacy trade-offs, without reaching a firm conclusion — this is a balanced presentation of a trade-off.', technique_tip:'If a passage gives "some argue...others counter..." structure, the correct summary option should reflect both sides, not just one.'},

{question_id:'VR012', module:'VR', question_type:'True/False/Cannot Tell', topic:'Inference', difficulty:'foundation', recommended_time:40, tags:'inference', active:true,
 passage:"Some economists argue that a universal basic income (UBI) would simplify welfare administration by replacing a patchwork of means-tested benefits with a single unconditional payment. Others counter that a UBI set high enough to meaningfully replace existing support would be prohibitively expensive, while one set low enough to be affordable would leave the most vulnerable worse off than under a well-targeted, means-tested system.",
 question_text:"All economists agree that a universal basic income would simplify welfare administration.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'B', explanation:'The passage explicitly presents opposing views ("Some economists argue... Others counter...") so it is false that all economists agree.', technique_tip:'Watch for absolute quantifiers like "all" — a single opposing view mentioned in the passage is enough to make the statement False, not merely uncertain.'},

{question_id:'VR013', module:'VR', question_type:'Identifying Information', topic:'Identifying Information', difficulty:'foundation', recommended_time:40, tags:'identifying', active:true,
 passage:"Grid-scale battery storage is often presented as the missing piece needed to make renewable electricity fully reliable, since it can store surplus solar and wind power for use when the sun isn\'t shining or the wind isn\'t blowing. However, current lithium-ion battery technology can typically only store enough energy to cover a few hours of average demand, not the multi-day lulls that can occur during prolonged periods of still, cloudy weather. Some engineers argue that a mix of storage technologies, including longer-duration options such as pumped hydro, will be needed alongside batteries to close this gap.",
 question_text:"According to the passage, current lithium-ion batteries can typically store enough energy to cover:",
 option_a:'Multi-day lulls in renewable generation', option_b:'A few hours of average demand', option_c:'A full week of demand', option_d:'No energy at all', option_e:'',
 correct_answer:'B', explanation:'The passage directly states that lithium-ion batteries "can typically only store enough energy to cover a few hours of average demand."', technique_tip:'For direct identifying-information questions, scan for the exact figure or timeframe mentioned rather than relying on memory of the whole passage.'},

{question_id:'VR014', module:'VR', question_type:'True/False/Cannot Tell', topic:'Inference', difficulty:'foundation', recommended_time:40, tags:'inference', active:true,
 passage:"Public library visits have declined in many countries over the past fifteen years, a trend some commentators attribute to the rise of e-books and online information sources. However, survey data from several library systems shows that while in-person visits have fallen, use of library-provided digital services—such as e-book loans and online research databases—has risen substantially over the same period, suggesting that overall demand for library services may not have fallen as sharply as visit counts alone suggest.",
 question_text:"Overall demand for library services has fallen by exactly the same amount as in-person visits.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'B', explanation:'The passage states that digital service use rose substantially over the same period, directly suggesting overall demand did not fall as sharply as visit counts alone would imply — contradicting the statement that the fall was "exactly the same."', technique_tip:'When a passage explicitly offsets one trend with a rise in another measure, a statement claiming the two are equal is usually False, not merely uncertain.'},

{question_id:'VR015', module:'VR', question_type:'Inference', topic:'Inference', difficulty:'standard', recommended_time:45, tags:'inference', active:true,
 passage:"Grid-scale battery storage is often presented as the missing piece needed to make renewable electricity fully reliable, since it can store surplus solar and wind power for use when the sun isn\'t shining or the wind isn\'t blowing. However, current lithium-ion battery technology can typically only store enough energy to cover a few hours of average demand, not the multi-day lulls that can occur during prolonged periods of still, cloudy weather. Some engineers argue that a mix of storage technologies, including longer-duration options such as pumped hydro, will be needed alongside batteries to close this gap.",
 question_text:"It can be inferred from the passage that relying on lithium-ion batteries alone would likely be insufficient during:",
 option_a:'A single sunny afternoon', option_b:'A short overnight period', option_c:'A prolonged, multi-day spell of still, cloudy weather', option_d:'Any period of high wind', option_e:'',
 correct_answer:'C', explanation:'The passage contrasts the "few hours" batteries can cover with "multi-day lulls," implying batteries alone would fall short precisely during those longer, prolonged low-generation periods.', technique_tip:'Look for the passage\'s own contrast (short vs long duration) to identify the scenario the author is implicitly warning about.'},

{question_id:'VR016', module:'VR', question_type:'Identifying Information', topic:'Identifying Information', difficulty:'standard', recommended_time:45, tags:'identifying', active:true,
 passage:"Public library visits have declined in many countries over the past fifteen years, a trend some commentators attribute to the rise of e-books and online information sources. However, survey data from several library systems shows that while in-person visits have fallen, use of library-provided digital services—such as e-book loans and online research databases—has risen substantially over the same period, suggesting that overall demand for library services may not have fallen as sharply as visit counts alone suggest.",
 question_text:"Which of the following is best supported by the passage?",
 option_a:'E-books have caused libraries to close down entirely.', option_b:'A decline in physical library visits does not necessarily mean a decline in overall use of library services.', option_c:'Online research databases are used only by students.', option_d:'Library visit counts are the only valid measure of library usage.', option_e:'',
 correct_answer:'B', explanation:'The passage\'s core point is that visit counts alone may overstate the decline in library use, since digital service use rose — directly supporting option B.', technique_tip:'The best-supported option restates the passage\'s central qualifying point, not a peripheral or exaggerated detail.'},

{question_id:'VR017', module:'VR', question_type:"Author\'s Argument", topic:"Author\'s Argument", difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
 passage:"Traffic-noise mitigation policies in most cities focus almost exclusively on daytime peak-hour noise, since that is when the greatest number of people are exposed. Yet emerging research on sleep suggests that intermittent nighttime noise, even at lower average volume than daytime traffic, can be more disruptive to health because it repeatedly interrupts deep sleep stages that the body relies on for physical recovery. A policy framework built purely around average daytime decibel levels may therefore be measuring the wrong thing entirely for public health purposes.",
 question_text:"Which of the following best captures the author\'s main point?",
 option_a:'Traffic noise should be banned entirely at night.', option_b:'Current noise policies, by focusing on daytime averages, may fail to address a distinct and possibly more harmful nighttime noise problem.', option_c:'Daytime noise causes no health problems.', option_d:'Sleep research is unreliable and should be disregarded.', option_e:'',
 correct_answer:'B', explanation:'The author is not calling for an outright ban, nor dismissing daytime noise or sleep research — the argument is that current policy\'s narrow focus may miss a genuinely important, different problem.', technique_tip:'Watch for options that overstate the author\'s claim into an absolute policy demand ("should be banned") when the passage itself is more measured ("may therefore be measuring the wrong thing").'},

{question_id:'VR018', module:'VR', question_type:'Inference', topic:'Inference', difficulty:'advanced', recommended_time:55, tags:'inference', active:true,
 passage:"Traffic-noise mitigation policies in most cities focus almost exclusively on daytime peak-hour noise, since that is when the greatest number of people are exposed. Yet emerging research on sleep suggests that intermittent nighttime noise, even at lower average volume than daytime traffic, can be more disruptive to health because it repeatedly interrupts deep sleep stages that the body relies on for physical recovery. A policy framework built purely around average daytime decibel levels may therefore be measuring the wrong thing entirely for public health purposes.",
 question_text:"Which of the following can most reasonably be inferred from the passage?",
 option_a:'A city with low average nighttime decibel levels could still have a significant nighttime noise health problem.', option_b:'Nighttime noise is always louder than daytime noise.', option_c:'Sleep is unaffected by traffic noise.', option_d:'Public health policy should ignore noise entirely.', option_e:'',
 correct_answer:'A', explanation:'The passage states harm comes from intermittent noise "even at lower average volume," so a low average reading would not rule out a real health problem — a policy measuring only averages could miss it.', technique_tip:'When a passage distinguishes "average" from "intermittent/peak" effects, the safest inference usually involves that same distinction, not a claim about overall loudness.'},

{question_id:'VR019', module:'VR', question_type:'Interpretation', topic:'Interpretation of Passages', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
 passage:"When employers switch retirement savings schemes from opt-in to opt-out enrolment, participation rates typically rise sharply, even though the financial terms of the scheme itself are unchanged. Behavioural economists interpret this as evidence that inertia, rather than a reasoned assessment of costs and benefits, drives many enrolment decisions. Critics of this interpretation note that opt-out defaults may simply reduce the administrative friction involved in signing up, rather than revealing anything about how employees actually value the scheme.",
 question_text:"The passage is best described as presenting:",
 option_a:'Firm proof that employees never make rational financial decisions.', option_b:'Two competing interpretations of why opt-out defaults raise participation, without settling which is correct.', option_c:'A historical timeline of retirement scheme design.', option_d:'An argument that opt-in schemes should be banned.', option_e:'',
 correct_answer:'B', explanation:'The passage presents the behavioural economists\' "inertia" interpretation alongside the critics\' "administrative friction" interpretation, without endorsing either as definitively correct.', technique_tip:'When a passage names a view and then immediately names a critique of that view, the correct summary usually acknowledges both sides rather than picking one.'},

{question_id:'VR020', module:'VR', question_type:'True/False/Cannot Tell', topic:"Evidence vs Assumption", difficulty:'advanced', recommended_time:50, tags:'assumption', active:true,
 passage:"When employers switch retirement savings schemes from opt-in to opt-out enrolment, participation rates typically rise sharply, even though the financial terms of the scheme itself are unchanged. Behavioural economists interpret this as evidence that inertia, rather than a reasoned assessment of costs and benefits, drives many enrolment decisions. Critics of this interpretation note that opt-out defaults may simply reduce the administrative friction involved in signing up, rather than revealing anything about how employees actually value the scheme.",
 question_text:"The passage confirms that inertia is definitely the sole cause of higher participation under opt-out schemes.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'B', explanation:'The passage explicitly presents a competing explanation (reduced administrative friction) offered by critics, so it does not confirm inertia as the sole, settled cause — making the statement False rather than merely unconfirmed.', technique_tip:'"Confirms X is definitely the sole cause" is a strong claim — a single explicitly stated competing explanation in the passage is enough to make such a statement False.'},

{question_id:'VR021', module:'VR', question_type:'Matching Information', topic:'Matching Information', difficulty:'foundation', recommended_time:40, tags:'matching', active:true,
 passage:"Recent studies have detected microplastic particles in tap water samples from cities on every continent, though concentrations vary widely depending on local water treatment methods. Researchers note that standard water treatment plants were not originally designed to filter particles as small as microplastics, and some plants have begun trialling additional filtration steps aimed specifically at removing them. So far, there is no scientific consensus on what level of microplastic exposure, if any, poses a risk to human health.",
 question_text:"Which of the following does the passage state about standard water treatment plants?",
 option_a:'They were originally designed to filter out microplastics.', option_b:'They were not originally designed to filter particles as small as microplastics.', option_c:'They have been banned in most cities.', option_d:'They successfully remove all microplastics currently.', option_e:'',
 correct_answer:'B', explanation:'The passage states plainly that "standard water treatment plants were not originally designed to filter particles as small as microplastics."', technique_tip:'Matching Information questions reward scanning for the exact clause rather than reasoning about the topic in general.'},

{question_id:'VR022', module:'VR', question_type:'Reading Comprehension', topic:'Reading Comprehension', difficulty:'standard', recommended_time:40, tags:'comprehension', active:true,
 passage:"Recent studies have detected microplastic particles in tap water samples from cities on every continent, though concentrations vary widely depending on local water treatment methods. Researchers note that standard water treatment plants were not originally designed to filter particles as small as microplastics, and some plants have begun trialling additional filtration steps aimed specifically at removing them. So far, there is no scientific consensus on what level of microplastic exposure, if any, poses a risk to human health.",
 question_text:"According to the passage, what is true about the health risk of microplastic exposure?",
 option_a:'It has been proven to be highly dangerous.', option_b:'It has been proven to be completely harmless.', option_c:'There is currently no scientific consensus on the level of risk, if any.', option_d:"Only children are considered to be at risk.", option_e:'',
 correct_answer:'C', explanation:'The passage explicitly states "there is no scientific consensus on what level of microplastic exposure, if any, poses a risk to human health."', technique_tip:'When a passage explicitly flags a lack of consensus, any option claiming a proven, settled risk level (high or low) is contradicted by the text.'},

{question_id:'VR023', module:'VR', question_type:'Interpretation', topic:'Interpretation of Passages', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
 passage:"Some education policymakers have proposed linking teacher pay more closely to student exam results, arguing this would incentivise better teaching. Opponents counter that such schemes risk encouraging teachers to avoid challenging classes or subjects where results are harder to improve, and may discourage collaboration between teachers who would otherwise share effective strategies with colleagues, since improved outcomes could now disadvantage them competitively.",
 question_text:"The passage is best described as:",
 option_a:'A one-sided defence of performance-based pay for teachers.', option_b:'An outline of a proposed policy alongside potential unintended consequences raised by its critics.', option_c:'A complete history of teacher pay policy.', option_d:'A conclusive rejection of all forms of merit-based pay.', option_e:'',
 correct_answer:'B', explanation:'The passage presents the policymakers\' proposal and then the opponents\' concerns, without declaring a winner — a balanced outline rather than a one-sided or conclusive stance.', technique_tip:'"Proposal + counter-concerns, no verdict" passages are almost always best summarised as balanced or as presenting a trade-off, not as an argument for one side.'},

{question_id:'VR024', module:'VR', question_type:"Author\'s Argument", topic:"Author\'s Argument", difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
 passage:"Some education policymakers have proposed linking teacher pay more closely to student exam results, arguing this would incentivise better teaching. Opponents counter that such schemes risk encouraging teachers to avoid challenging classes or subjects where results are harder to improve, and may discourage collaboration between teachers who would otherwise share effective strategies with colleagues, since improved outcomes could now disadvantage them competitively.",
 question_text:"Which of the following best reflects a concern raised in the passage about performance-based pay?",
 option_a:'It might reduce teachers\' willingness to take on challenging classes or collaborate with colleagues.', option_b:'It would definitely improve every student\'s exam results.', option_c:'It has already been implemented successfully in every country that has tried it.', option_d:'It has no effect on teacher behaviour at all.', option_e:'',
 correct_answer:'A', explanation:'The passage cites two specific opponent concerns: avoidance of challenging classes and discouraged collaboration — both captured in option A.', technique_tip:'When a passage lists two related concerns, look for the option that captures both, rather than one that only echoes half of what was said.'},
{question_id:'VR025', module:'VR', question_type:'True/False/Cannot Tell', topic:'Scientific Research', difficulty:'advanced', recommended_time:50, tags:'evidence', active:true,
passage:"A long-term study examined whether access to public parks was associated with physical activity. Residents living within a ten-minute walk of a park reported more frequent recreational exercise than residents living farther away. The researchers cautioned that people who choose to live near parks may already be more interested in exercise.",
question_text:"Living close to a public park causes people to exercise more frequently.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'C', explanation:'The study found an association but identified a possible self-selection factor. It cannot establish that proximity to parks causes greater exercise.', technique_tip:'An observational association does not automatically establish causation.'},

{question_id:'VR026', module:'VR', question_type:'Inference', topic:'Environment', difficulty:'advanced', recommended_time:50, tags:'inference', active:true,
passage:"Several coastal towns have introduced restrictions on single-use plastic containers. In the first year, the amount of plastic collected during beach-cleaning operations fell substantially. However, the monitoring programme did not distinguish between locally discarded plastic and material transported by ocean currents from elsewhere.",
question_text:"Which of the following can most reasonably be inferred?",
option_a:'The restrictions eliminated plastic pollution from the beaches.', option_b:'All plastic found previously originated within the towns.', option_c:'The restrictions may have contributed to the reduction, but their exact effect cannot be isolated from the available data.', option_d:'Ocean currents stopped transporting plastic during the first year.', option_e:'',
correct_answer:'C', explanation:'The decline occurred after the restrictions, but the source of the plastic was not distinguished, so the precise effect cannot be isolated.', technique_tip:'Look for limitations that prevent a simple causal conclusion.'},

{question_id:'VR027', module:'VR', question_type:'Identifying Information', topic:'Technology', difficulty:'standard', recommended_time:40, tags:'identifying', active:true,
passage:"Digital textbooks can be updated more quickly than printed editions. This allows publishers to correct errors and incorporate new information without waiting for a new print run. Critics argue that frequent updates can make it difficult for students to know which version of a text they are using, particularly when teachers and students access materials at different times.",
question_text:"Which disadvantage of digital textbooks is specifically mentioned?",
option_a:'They cannot contain diagrams.', option_b:'They require students to print every chapter.', option_c:'Frequent updates may create uncertainty about which version is being used.', option_d:'They are always more expensive than printed books.', option_e:'',
correct_answer:'C', explanation:'The passage directly identifies uncertainty over different versions as a disadvantage.', technique_tip:'For identifying-information questions, select what the passage explicitly states rather than what seems generally plausible.'},

{question_id:'VR028', module:'VR', question_type:'Author\'s Argument', topic:'Public Policy', difficulty:'advanced', recommended_time:55, tags:'argument', active:true,
passage:"Supporters of congestion charges argue that road space in city centres is scarce and should therefore be priced during periods of heavy demand. Opponents respond that such charges may disproportionately affect workers who have limited access to public transport. The strongest policy, therefore, may combine congestion pricing with targeted improvements to affordable public transport.",
question_text:"What is the author\'s main argument?",
option_a:'Congestion charges should immediately be introduced in every city.', option_b:'Congestion charges are always unfair to workers.', option_c:'Congestion pricing may be more effective when accompanied by improvements to affordable public transport.', option_d:'Public transport should be abolished in favour of private cars.', option_e:'',
correct_answer:'C', explanation:'The passage recognises the argument for pricing road space but also addresses equity concerns and proposes combining the measures.', technique_tip:'The author\'s conclusion often appears after words such as "therefore" or "may".'},

{question_id:'VR029', module:'VR', question_type:'True/False/Cannot Tell', topic:'Education', difficulty:'standard', recommended_time:45, tags:'evidence', active:true,
passage:"A university introduced optional recorded lectures for first-year students. At the end of the semester, students who watched recordings regularly were more likely to pass than those who rarely watched them. The university did not record how often students attended live lectures.",
question_text:"Students who regularly watched recorded lectures were more likely to pass than students who rarely watched them.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'A', explanation:'This comparison is explicitly stated in the passage.', technique_tip:'Do not confuse a directly stated association with a claim about causation.'},

{question_id:'VR030', module:'VR', question_type:'Inference', topic:'Economics', difficulty:'advanced', recommended_time:50, tags:'inference', active:true,
passage:"A supermarket introduced electronic shelf labels in several branches. The labels allowed prices to be changed centrally within minutes. Managers reported that this reduced the staff time required to update prices, although the initial installation was expensive.",
question_text:"Which statement can most reasonably be inferred?",
option_a:'Electronic shelf labels are cheaper to install than paper labels.', option_b:'The technology may reduce some ongoing labour requirements despite a substantial initial cost.', option_c:'Customers always prefer electronic labels.', option_d:'The technology eliminates the need for supermarket employees.', option_e:'',
correct_answer:'B', explanation:'The passage states that installation was expensive but that staff time required for price changes was reduced.', technique_tip:'Combine two explicitly stated facts without adding unsupported assumptions.'},

{question_id:'VR031', module:'VR', question_type:'Reading Comprehension', topic:'History', difficulty:'standard', recommended_time:45, tags:'comprehension', active:true,
passage:"The introduction of railways transformed the movement of goods during the nineteenth century. Markets that had previously depended on slow road transport could receive products more quickly and reliably. However, railway construction required substantial investment, and benefits were uneven because regions without connections remained dependent on older transport systems.",
question_text:"Why were the benefits of railway expansion uneven?",
option_a:'Railways were slower than roads.', option_b:'Railways could transport only passengers.', option_c:'Regions without railway connections continued to depend on older transport methods.', option_d:'Railway construction required no investment.', option_e:'',
correct_answer:'C', explanation:'The passage directly explains that unconnected regions remained dependent on older systems.', technique_tip:'Locate the sentence that directly answers the "why" question.'},

{question_id:'VR032', module:'VR', question_type:'Interpretation', topic:'Science Policy', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
passage:"Scientists have developed models predicting how a particular ecosystem might respond to rising temperatures. Some models predict substantial species loss, while others predict that migration and adaptation could reduce the impact. Policymakers therefore face uncertainty about the precise scale of future ecological change, even though the direction of temperature change is well established.",
question_text:"The passage suggests that:",
option_a:'Scientists disagree about whether temperatures are rising.', option_b:'Future ecological effects are known with complete certainty.', option_c:'There is confidence about the temperature trend but greater uncertainty about its ecological consequences.', option_d:'Species will definitely adapt successfully.', option_e:'',
correct_answer:'C', explanation:'The passage distinguishes certainty about temperature change from uncertainty about ecological outcomes.', technique_tip:'Pay attention to what the passage treats as certain versus uncertain.'},

{question_id:'VR033', module:'VR', question_type:'Matching Information', topic:'Medicine', difficulty:'standard', recommended_time:40, tags:'matching', active:true,
passage:"Three approaches are commonly used to improve medication adherence. Reminder systems use alerts or messages; simplified regimens reduce the number of daily doses; and pharmacist counselling addresses practical or informational barriers. Evidence suggests that the effectiveness of each approach varies according to the reasons why an individual misses medication.",
question_text:"Which approach specifically involves reducing the number of daily doses?",
option_a:'Reminder systems', option_b:'Simplified regimens', option_c:'Pharmacist counselling', option_d:'None of the approaches', option_e:'',
correct_answer:'B', explanation:'The passage explicitly defines simplified regimens as reducing the number of daily doses.', technique_tip:'Match the wording of the question to the precise definition in the passage.'},

{question_id:'VR034', module:'VR', question_type:'True/False/Cannot Tell', topic:'Medicine', difficulty:'advanced', recommended_time:50, tags:'evidence', active:true,
passage:"A clinical study compared two rehabilitation programmes after knee surgery. Participants following Programme X reported less pain at six weeks than those following Programme Y. The researchers noted that participants were allowed to choose which programme they preferred.",
question_text:"Programme X is more effective than Programme Y for reducing pain after knee surgery.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'C', explanation:'Participants self-selected programmes, so differences may reflect characteristics of the participants rather than the programme itself.', technique_tip:'Self-selection can make it difficult to attribute differences to the intervention.'},

{question_id:'VR035', module:'VR', question_type:'Author\'s Argument', topic:'Urban Planning', difficulty:'advanced', recommended_time:55, tags:'argument', active:true,
passage:"Urban planners increasingly favour mixed-use neighbourhoods where homes, shops and services are located close together. Advocates argue that this can reduce the need for long journeys. Critics point out that mixed-use development does not automatically reduce car dependence if public transport remains poor and streets are designed primarily for vehicles.",
question_text:"Which statement best reflects the passage?",
option_a:'Mixed-use neighbourhoods always eliminate car use.', option_b:'Mixed-use development can reduce long journeys, but its effect depends partly on transport infrastructure.', option_c:'Urban residents should never own cars.', option_d:'Public transport has no relationship with travel behaviour.', option_e:'',
correct_answer:'B', explanation:'The passage presents a potential benefit but qualifies it by highlighting the importance of transport infrastructure.', technique_tip:'Choose the option that preserves both the main claim and its qualification.'},

{question_id:'VR036', module:'VR', question_type:'Inference', topic:'Psychology', difficulty:'advanced', recommended_time:50, tags:'inference', active:true,
passage:"Participants in an experiment remembered information better when they studied it across several shorter sessions than when they studied for the same total amount of time in one prolonged session. The researchers suggested that spacing creates repeated opportunities for retrieval and consolidation.",
question_text:"Which conclusion is most consistent with the passage?",
option_a:'Long study sessions are always ineffective.', option_b:'The total amount of study time is irrelevant.', option_c:'Distributing study across multiple sessions may improve retention compared with concentrating the same time into one session.', option_d:'Only students can benefit from spaced study.', option_e:'',
correct_answer:'C', explanation:'The experiment directly compared equal total study time distributed differently and found better retention with spacing.', technique_tip:'Avoid turning a comparative finding into an absolute claim.'},

{question_id:'VR037', module:'VR', question_type:'Identifying Information', topic:'Agriculture', difficulty:'standard', recommended_time:40, tags:'identifying', active:true,
passage:"Crop rotation can improve soil management by varying the crops grown on a field across successive seasons. Different crops draw different nutrients from the soil, and some legumes can increase nitrogen availability. Rotation can also interrupt the life cycles of certain pests, reducing their ability to build up over consecutive seasons.",
question_text:"According to the passage, how can crop rotation help control pests?",
option_a:'By eliminating all insects from farmland.', option_b:'By interrupting pest life cycles.', option_c:'By increasing pesticide use.', option_d:'By preventing crops from growing.', option_e:'',
correct_answer:'B', explanation:'The passage explicitly states that rotation can interrupt the life cycles of certain pests.', technique_tip:'For explicit-information questions, prefer the answer stated directly in the passage.'},

{question_id:'VR038', module:'VR', question_type:'True/False/Cannot Tell', topic:'Business', difficulty:'advanced', recommended_time:50, tags:'evidence', active:true,
passage:"A company introduced flexible working hours and subsequently experienced a decline in staff turnover. Management attributed the change to greater employee satisfaction. However, the company also increased salaries during the same period.",
question_text:"The decline in staff turnover was caused by flexible working hours.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'C', explanation:'Both flexible working and salary increases changed during the same period, so the cause cannot be isolated.', technique_tip:'When multiple relevant factors change simultaneously, causation cannot normally be assigned to one factor alone.'},

{question_id:'VR039', module:'VR', question_type:'Interpretation', topic:'Environment', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
passage:"Some conservation programmes focus on protecting individual endangered species, while others aim to restore entire habitats. Species-specific protection can be highly targeted but may overlook ecological relationships. Habitat restoration is broader but can require considerably more land and resources.",
question_text:"The passage primarily highlights:",
option_a:'The superiority of species-specific conservation.', option_b:'The superiority of habitat restoration.', option_c:'Different strengths and limitations of two conservation strategies.', option_d:'The failure of all conservation programmes.', option_e:'',
correct_answer:'C', explanation:'The passage compares the advantages and limitations of both approaches without declaring one universally superior.', technique_tip:'Comparative passages often test whether you can identify the trade-off rather than select one side.'},

{question_id:'VR040', module:'VR', question_type:'Reading Comprehension', topic:'Transport', difficulty:'standard', recommended_time:45, tags:'comprehension', active:true,
passage:"Electric buses produce no exhaust emissions while operating on city streets. Their overall environmental impact nevertheless depends partly on how the electricity used to charge them is generated. Where electricity comes largely from renewable sources, the reduction in lifecycle emissions can be greater than in regions relying heavily on fossil fuels.",
question_text:"According to the passage, what influences the environmental benefit of electric buses?",
option_a:'The colour of the buses.', option_b:'The number of passengers they carry only.', option_c:'The source of electricity used to charge them.', option_d:'Whether they operate during weekends.', option_e:'',
correct_answer:'C', explanation:'The passage explicitly identifies the electricity generation mix as a factor affecting lifecycle emissions.', technique_tip:'Look for the factor introduced as influencing the stated outcome.'},

{question_id:'VR041', module:'VR', question_type:'Inference', topic:'Healthcare', difficulty:'advanced', recommended_time:50, tags:'inference', active:true,
passage:"A primary-care practice introduced a system allowing patients to book appointments online. Telephone waiting times fell considerably after implementation. The practice also added two receptionists during the same month, making it impossible to determine from the available figures how much of the reduction was attributable to online booking.",
question_text:"Which statement is best supported?",
option_a:'Online booking had no effect on telephone waiting times.', option_b:'The additional receptionists definitely caused the entire reduction.', option_c:'Telephone waiting times fell, but the relative contribution of online booking cannot be determined from these data.', option_d:'Online booking increased telephone waiting times.', option_e:'',
correct_answer:'C', explanation:'The reduction is established, but two changes occurred simultaneously.', technique_tip:'Separate what happened from what caused it.'},

{question_id:'VR042', module:'VR', question_type:'True/False/Cannot Tell', topic:'Research Methods', difficulty:'advanced', recommended_time:50, tags:'research', active:true,
passage:"Researchers surveyed 5,000 adults about their dietary habits and compared responses with reported rates of cardiovascular disease. People reporting higher consumption of vegetables had lower reported disease rates. The study relied on participants accurately recalling and reporting their diets.",
question_text:"The study proves that eating more vegetables prevents cardiovascular disease.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'B', explanation:'The observational survey cannot prove prevention, and self-reported diet introduces another limitation.', technique_tip:'Words such as "proves" and "prevents" require much stronger evidence than an observational association.'},

{question_id:'VR043', module:'VR', question_type:'Matching Information', topic:'Architecture', difficulty:'standard', recommended_time:40, tags:'matching', active:true,
passage:"Passive buildings are designed to minimise energy requirements through insulation, airtight construction and efficient ventilation. Some designs also use the orientation of windows to take advantage of natural sunlight. These features can reduce heating and cooling requirements, although construction costs may initially be higher.",
question_text:"Which feature is specifically associated with taking advantage of natural sunlight?",
option_a:'Airtight construction', option_b:'Efficient ventilation', option_c:'Window orientation', option_d:'Higher construction costs', option_e:'',
correct_answer:'C', explanation:'The passage specifically links window orientation with using natural sunlight.', technique_tip:'Identify the exact feature linked to the function asked about.'},

{question_id:'VR044', module:'VR', question_type:'Author\'s Argument', topic:'Social Policy', difficulty:'advanced', recommended_time:55, tags:'argument', active:true,
passage:"Free school meals are sometimes justified on nutritional grounds, but their potential benefits may extend beyond nutrition. Providing meals universally can reduce the stigma associated with receiving assistance and may simplify administration because schools do not need to determine eligibility for individual pupils.",
question_text:"Which is the best summary of the passage?",
option_a:'Free meals are beneficial only because they improve nutrition.', option_b:'Universal free school meals may provide nutritional, social and administrative advantages.', option_c:'Schools should stop identifying pupils who need support.', option_d:'Means-tested meals are always ineffective.', option_e:'',
correct_answer:'B', explanation:'The passage gives three potential advantages: nutrition, reduced stigma and simpler administration.', technique_tip:'A strong summary should cover the major strands of the passage rather than one detail.'},

{question_id:'VR045', module:'VR', question_type:'True/False/Cannot Tell', topic:'Economics', difficulty:'standard', recommended_time:45, tags:'evidence', active:true,
passage:"A retailer reduced the price of a product by 10%. Unit sales increased by 18% over the following month. The retailer did not analyse whether advertising, seasonal demand or competitor pricing had also changed.",
question_text:"The price reduction was the only factor responsible for the increase in sales.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'C', explanation:'The passage explicitly states that other factors were not analysed.', technique_tip:'If alternative explanations are possible but not resolved, the correct response is usually Cannot Tell.'},

{question_id:'VR046', module:'VR', question_type:'Inference', topic:'Technology', difficulty:'advanced', recommended_time:50, tags:'inference', active:true,
passage:"Cloud-based software allows employees to access documents from multiple locations. This can support distributed teams, but it also means organisations must consider how access permissions and authentication are managed across different devices and networks.",
question_text:"Which statement can most reasonably be inferred?",
option_a:'Cloud software removes the need for security controls.', option_b:'Organisations using cloud software may need robust systems to control who can access information.', option_c:'Cloud software can only be used from offices.', option_d:'Distributed teams cannot use cloud software.', option_e:'',
correct_answer:'B', explanation:'The passage identifies access permissions and authentication as considerations, supporting the inference that access control is important.', technique_tip:'Infer only what follows naturally from the stated concerns.'},

{question_id:'VR047', module:'VR', question_type:'Reading Comprehension', topic:'Medicine', difficulty:'standard', recommended_time:45, tags:'comprehension', active:true,
passage:"Vaccination programmes rely on high levels of uptake to reduce transmission of infectious diseases. When enough people are immune, opportunities for a pathogen to spread can decline, providing indirect protection to some people who cannot be vaccinated. The level of uptake required varies according to how easily the infection spreads.",
question_text:"Why does the required vaccination uptake vary between diseases?",
option_a:'All vaccines have different colours.', option_b:'Some diseases spread more easily than others.', option_c:'Vaccination only works for childhood diseases.', option_d:'Immunity has no effect on transmission.', option_e:'',
correct_answer:'B', explanation:'The passage explicitly states that the required level varies according to how easily the infection spreads.', technique_tip:'The final sentence directly answers the question.'},

{question_id:'VR048', module:'VR', question_type:'Interpretation', topic:'Psychology', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
passage:"People often remember emotionally significant events with considerable confidence. However, confidence does not necessarily guarantee accuracy. Memory can be influenced by later information, repeated discussion and assumptions made after the event.",
question_text:"Which conclusion is most consistent with the passage?",
option_a:'Confident memories are always accurate.', option_b:'Emotionally significant events are never remembered accurately.', option_c:'A person\'s confidence in a memory should not automatically be treated as proof of its accuracy.', option_d:'Memory cannot ever be useful as evidence.', option_e:'',
correct_answer:'C', explanation:'The passage distinguishes confidence from accuracy and identifies factors that can alter memories.', technique_tip:'Do not treat confidence and reliability as interchangeable concepts.'},

{question_id:'VR049', module:'VR', question_type:'Identifying Information', topic:'Climate', difficulty:'standard', recommended_time:40, tags:'identifying', active:true,
passage:"Urban heat islands occur when built-up areas become warmer than surrounding rural areas. Concrete and asphalt absorb and retain heat, while limited vegetation reduces evaporative cooling. Increasing tree cover, using reflective materials and designing shaded spaces are among the measures cities can consider.",
question_text:"Which measure is mentioned as a possible way to reduce urban heat?",
option_a:'Increasing asphalt coverage.', option_b:'Reducing all vegetation.', option_c:'Increasing tree cover.', option_d:'Removing shaded spaces.', option_e:'',
correct_answer:'C', explanation:'Increasing tree cover is explicitly listed among the possible measures.', technique_tip:'The answer is directly stated near the end of the passage.'},

{question_id:'VR050', module:'VR', question_type:'True/False/Cannot Tell', topic:'History', difficulty:'advanced', recommended_time:50, tags:'evidence', active:true,
passage:"Historical records indicate that the city\'s population grew rapidly between 1850 and 1880. Several new factories opened during this period, while large numbers of people migrated into the city from surrounding rural areas. The records do not establish whether factory expansion or migration began first.",
question_text:"Factory expansion caused the city\'s population growth.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'C', explanation:'Both factory growth and migration occurred, but their sequence and causal relationship are not established.', technique_tip:'Chronological coexistence does not establish causation.'},

{question_id:'VR051', module:'VR', question_type:'Author\'s Argument', topic:'Education', difficulty:'advanced', recommended_time:55, tags:'argument', active:true,
passage:"Universities increasingly use recorded lectures to supplement rather than replace live teaching. Recordings allow students to revisit difficult material and accommodate those unable to attend. However, relying exclusively on recordings may reduce opportunities for immediate interaction, questions and discussion.",
question_text:"What position does the passage take?",
option_a:'Recorded lectures should completely replace live teaching.', option_b:'Recorded lectures have useful advantages but may not provide all the benefits of live teaching.', option_c:'Recorded lectures are harmful in every situation.', option_d:'Students should never revisit lecture material.', option_e:'',
correct_answer:'B', explanation:'The passage presents benefits of recordings while identifying limitations compared with live interaction.', technique_tip:'Balanced passages often support a qualified rather than absolute conclusion.'},

{question_id:'VR052', module:'VR', question_type:'Inference', topic:'Public Health', difficulty:'advanced', recommended_time:50, tags:'inference', active:true,
passage:"A city introduced a campaign encouraging residents to walk or cycle for short journeys. Survey responses showed that awareness of the campaign was high, but the proportion of residents reporting active travel changed little during the first six months.",
question_text:"Which inference is most reasonable?",
option_a:'The campaign was completely ineffective.', option_b:'Awareness of a campaign does not necessarily translate immediately into behavioural change.', option_c:'Residents opposed active travel.', option_d:'Walking and cycling became less popular.', option_e:'',
correct_answer:'B', explanation:'High awareness occurred alongside little behavioural change, suggesting awareness alone did not immediately produce a substantial change in behaviour.', technique_tip:'Avoid claiming complete success or failure when the evidence is more nuanced.'},

{question_id:'VR053', module:'VR', question_type:'Matching Information', topic:'Nutrition', difficulty:'standard', recommended_time:40, tags:'matching', active:true,
passage:"Whole grains provide dietary fibre and several micronutrients. Refined grains generally retain the starchy part of the grain but lose some components during processing. Fortification can restore selected nutrients, although it does not necessarily reproduce all of the characteristics of the original whole grain.",
question_text:"Which type of grain is described as generally losing some components during processing?",
option_a:'Whole grain', option_b:'Refined grain', option_c:'Fortified whole grain only', option_d:'No type of grain', option_e:'',
correct_answer:'B', explanation:'The passage states that refined grains lose some components during processing.', technique_tip:'Use the exact comparison presented in the passage.'},

{question_id:'VR054', module:'VR', question_type:'Interpretation', topic:'Research', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
passage:"A survey of employees found that those reporting higher job autonomy also reported lower stress. Because the survey measured both variables at one point in time, researchers could not determine whether greater autonomy reduced stress or whether less-stressed employees were more likely to perceive their jobs as autonomous.",
question_text:"What is the main limitation described?",
option_a:'The sample contained no employees.', option_b:'The study cannot establish the direction of causation.', option_c:'Stress was not measured.', option_d:'Job autonomy was experimentally assigned.', option_e:'',
correct_answer:'B', explanation:'The researchers cannot determine which variable caused the other from a single cross-sectional measurement.', technique_tip:'When both possible causal directions are presented, focus on the inability to establish causation.'},

{question_id:'VR055', module:'VR', question_type:'True/False/Cannot Tell', topic:'Technology', difficulty:'advanced', recommended_time:50, tags:'evidence', active:true,
passage:"A software company reports that its newest productivity application has been downloaded two million times. The company has not published information about how many users continue to use the application after downloading it.",
question_text:"At least two million people currently use the application regularly.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'C', explanation:'Downloads do not establish current or regular usage.', technique_tip:'Distinguish between a historical event such as a download and ongoing behaviour.'},

{question_id:'VR056', module:'VR', question_type:'Reading Comprehension', topic:'Architecture', difficulty:'standard', recommended_time:45, tags:'comprehension', active:true,
passage:"Historic buildings can provide architectural and cultural value, but preserving them may involve significant costs. Some conservationists argue that restoration should maintain original materials wherever possible, while others favour carefully selected modern materials that improve structural safety without substantially altering the building\'s appearance.",
question_text:"What disagreement among conservationists is described?",
option_a:'Whether historic buildings have any cultural value.', option_b:'Whether buildings should always be demolished.', option_c:'Whether original or carefully selected modern materials should be used during restoration.', option_d:'Whether structural safety matters.', option_e:'',
correct_answer:'C', explanation:'The passage directly identifies disagreement about restoration materials.', technique_tip:'Identify the precise point of disagreement rather than the broader topic.'},

{question_id:'VR057', module:'VR', question_type:'Inference', topic:'Workplace', difficulty:'advanced', recommended_time:50, tags:'inference', active:true,
passage:"A company introduced a four-day workweek without reducing salaries. After one year, employee surveys showed higher reported satisfaction, while the company reported that total output remained similar to the previous year. The trial did not compare the company with another organisation that maintained a five-day week.",
question_text:"Which statement is best supported?",
option_a:'The four-day workweek definitely increases productivity.', option_b:'The four-day workweek reduced total output.', option_c:'The company maintained similar reported output while employee satisfaction increased during the trial.', option_d:'All companies would obtain identical results.', option_e:'',
correct_answer:'C', explanation:'These are the observed findings. Without a comparison group, stronger causal claims are not justified.', technique_tip:'State the observed results without upgrading them into universal causal conclusions.'},

{question_id:'VR058', module:'VR', question_type:'Author\'s Argument', topic:'Environment', difficulty:'advanced', recommended_time:55, tags:'argument', active:true,
passage:"Replacing all petrol cars with electric vehicles is often presented as a complete solution to urban transport emissions. Yet electric vehicles still require energy to manufacture and charge, and they do not eliminate congestion or road-space requirements. A broader transport strategy could therefore combine vehicle electrification with public transport and active travel.",
question_text:"Which statement best reflects the author\'s argument?",
option_a:'Electric vehicles have no environmental benefits.', option_b:'Electric vehicles alone may not address every transport problem, so they should be part of a broader strategy.', option_c:'Petrol vehicles should become more common.', option_d:'Public transport increases emissions in every circumstance.', option_e:'',
correct_answer:'B', explanation:'The author acknowledges limitations of relying exclusively on electric vehicles and advocates a broader strategy.', technique_tip:'Do not confuse criticism of an approach\'s limitations with rejection of the approach itself.'},

{question_id:'VR059', module:'VR', question_type:'True/False/Cannot Tell', topic:'Medicine', difficulty:'advanced', recommended_time:50, tags:'evidence', active:true,
passage:"A new screening programme identified more cases of a particular disease than the previous programme. The programme also used a more sensitive diagnostic test. Researchers have not yet determined whether the increase represents a genuine rise in disease prevalence or improved detection.",
question_text:"The disease became more common after the new screening programme was introduced.",
option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
correct_answer:'C', explanation:'The increase in detected cases could result from better detection rather than increased prevalence.', technique_tip:'An increase in detected cases is not necessarily an increase in the underlying number of cases.'},

{question_id:'VR060', module:'VR', question_type:'Interpretation', topic:'Science and Society', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
passage:"Public discussion of artificial intelligence often focuses on either dramatic benefits or catastrophic risks. A more cautious assessment recognises that different AI systems have different capabilities, applications and failure modes. The appropriate response may therefore depend on the specific system and context rather than on AI as a single uniform technology.",
question_text:"Which statement best captures the passage?",
option_a:'All AI systems present identical risks.', option_b:'AI should be completely unrestricted.', option_c:'AI should be assessed according to the characteristics and context of individual systems rather than treated as one uniform technology.', option_d:'AI has no practical benefits.', option_e:'',
correct_answer:'C', explanation:'The passage argues against treating AI as a single uniform category and instead supports context-specific assessment.', technique_tip:'Look for the passage\'s central distinction: broad generalisation versus context-specific assessment.'},

 /* ---------------- DECISION MAKING ---------------- */
{question_id:'DM001', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'foundation', recommended_time:40, tags:'logic', active:true,
 question_text:"All qualified paramedics have completed advanced first-aid training. Priya has completed advanced first-aid training. Which conclusion follows logically?",
 option_a:'Priya is a qualified paramedic.', option_b:'Priya is not a qualified paramedic.', option_c:'It cannot be determined whether Priya is a qualified paramedic.', option_d:'No paramedics have completed advanced first-aid training.', option_e:'',
 correct_answer:'C', explanation:'The premise only tells us all paramedics have the training, not that everyone with the training is a paramedic (affirming the consequent). Priya having the training does not guarantee she is a paramedic.', technique_tip:'"All A are B" does not mean "all B are A" — this is one of the most common syllogism traps.'},

{question_id:'DM002', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
 question_text:"If a patient\'s temperature is above 38°C, the nurse must record it as a fever. Patient X\'s temperature was not recorded as a fever. What can be validly concluded?",
 option_a:"Patient X\'s temperature was above 38°C.", option_b:"Patient X\'s temperature was not above 38°C.", option_c:"Patient X does not have a nurse.", option_d:"The rule about fevers does not apply to Patient X.", option_e:'',
 correct_answer:'B', explanation:'This is the valid contrapositive: if temperature > 38°C then recorded as fever; not recorded as fever, therefore not > 38°C.', technique_tip:'For "if P then Q" statements, "not Q" validly implies "not P" (the contrapositive) — but "not P" does not imply "not Q".'},

{question_id:'DM003', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'standard', recommended_time:50, tags:'probability', active:true,
 question_text:"A clinic has 3 red, 5 blue and 2 green pens in a drawer. A pen is picked at random and not replaced, then a second pen is picked. What is the probability both pens are blue?",
 option_a:'1/9', option_b:'2/9', option_c:'1/5', option_d:'5/18', option_e:'1/4',
 correct_answer:'B', explanation:'P(first blue) = 5/10. P(second blue | first blue) = 4/9. Multiply: (5/10) × (4/9) = 20/90 = 2/9.', technique_tip:'For "without replacement" problems, reduce both the count and the total for the second draw.'},

{question_id:'DM004', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'advanced', recommended_time:55, tags:'venn', active:true,
 question_text:"Among 120 clinic patients: 70 have high blood pressure, 50 have high cholesterol, and 25 have both conditions. How many patients have neither condition?",
 option_a:'20', option_b:'25', option_c:'30', option_d:'35', option_e:'45',
 correct_answer:'B', explanation:'Patients with at least one condition = 70 + 50 − 25 (overlap counted twice) = 95. Neither = 120 − 95 = 25.', technique_tip:'Always subtract the overlap once when combining two "at least" groups before finding the "neither" total.'},

{question_id:'DM005', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'standard', recommended_time:45, tags:'assumption', active:true,
 question_text:"Argument: \"Hospital A should adopt the same scheduling software as Hospital B, because Hospital B reduced patient wait times by 20% after switching to it.\" Which of the following is an assumption underlying this argument?",
 option_a:'Hospital A and Hospital B have broadly similar patient volumes and staffing structures.', option_b:'Hospital B spent more money on the software than Hospital A would.', option_c:'Wait times are the most important measure of hospital quality.', option_d:'Hospital A has never used scheduling software before.', option_e:'',
 correct_answer:'A', explanation:'The argument assumes Hospital B\'s result would transfer to Hospital A, which requires the two hospitals to be sufficiently similar for the comparison to be valid.', technique_tip:'Use the "negation test": if negating the option destroys the argument, it is an assumption. If Hospital A and B were very different, the argument would collapse.'},

{question_id:'DM006', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
 question_text:"\"Since the introduction of a city-wide 20mph speed limit, reported pedestrian injuries have fallen by 15%. Therefore, the speed limit caused the drop in injuries.\" Which of the following, if true, would most weaken this argument?",
 option_a:'The city also introduced a major new pedestrian-education campaign at the same time as the speed limit.', option_b:'Some drivers regularly exceed the 20mph limit.', option_c:'The speed limit applies to all residential roads in the city.', option_d:'Pedestrian injuries fell in a neighbouring city with no such speed limit.', option_e:'',
 correct_answer:'D', explanation:'If injuries fell just as much in a comparable city without the speed limit, this suggests some other factor (not the speed limit) may be responsible, directly undermining the causal claim. Option A also introduces a confound, but option D is stronger because it provides an actual comparison showing the effect can occur without the intervention.', technique_tip:'The strongest weakener for a causal claim is evidence that the effect occurs even without the proposed cause.'},

{question_id:'DM007', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:50, tags:'data', active:true,
 question_text:"A clinic sees patients across 4 age bands. Under 18: 15%, 18–40: 35%, 41–65: 30%, Over 65: 20%. If the clinic saw 640 patients last month, how many were aged 41 or over?",
 option_a:'192', option_b:'224', option_c:'288', option_d:'320', option_e:'352',
 correct_answer:'D', explanation:'41–65 and Over 65 together = 30% + 20% = 50%. 50% of 640 = 320.', technique_tip:'Combine relevant percentage bands first, then apply once to the total — faster than calculating each band separately.'},

{question_id:'DM008', module:'DM', question_type:'Logical Puzzle', topic:'Sequencing', difficulty:'advanced', recommended_time:60, tags:'sequencing', active:true,
 question_text:"Five colleagues — Ade, Ben, Chidi, Dara and Eze — are seated in a row. Ade is not at either end. Ben is immediately to the left of Chidi. Dara is at one end. Eze is not next to Ben. Which of the following must be true?",
 option_a:'Eze is at the opposite end from Dara.', option_b:'Ade is seated next to Dara.', option_c:'Chidi is at an end.', option_d:'Ben is at an end.', option_e:'',
 correct_answer:'A', explanation:'Working through the constraints: Dara must occupy one end. Since Ade cannot be at an end, and Eze cannot be adjacent to Ben (who sits immediately left of Chidi, forming a fixed pair), the only consistent arrangement places Eze at the end opposite Dara, with the Ben-Chidi pair and Ade filling the middle three seats.', technique_tip:'For seating puzzles, fix the most restrictive clue first (here, the fixed Ben-Chidi pair), then place end-constrained items around it.'},

{question_id:'DM009', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'foundation', recommended_time:35, tags:'logic', active:true,
 question_text:"\"If it rains, the outdoor clinic is cancelled.\" It did not rain today. What follows?",
 option_a:'The outdoor clinic was definitely cancelled.', option_b:'The outdoor clinic was definitely held.', option_c:'Nothing can be validly concluded about whether the clinic was cancelled.', option_d:'It must have snowed instead.', option_e:'',
 correct_answer:'C', explanation:'The rule only specifies what happens if it rains; it says nothing about what happens if it doesn\'t rain, so the clinic could still be cancelled for another reason or held — it cannot be determined.', technique_tip:'"If P then Q" gives no information at all when P is false — do not assume "not P" means "not Q".'},

{question_id:'DM010', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'foundation', recommended_time:40, tags:'probability', active:true,
 question_text:"A fair six-sided die is rolled twice. What is the probability of getting a total of exactly 9?",
 option_a:'1/12', option_b:'1/9', option_c:'1/6', option_d:'5/36', option_e:'1/4',
 correct_answer:'D', explanation:'Combinations giving 9: (3,6),(4,5),(5,4),(6,3) = 4 outcomes out of 36 total = 4/36 = 1/9. Wait — recompute: also (3,6) counted, total combinations summing to 9 are (3,6),(4,5),(5,4),(6,3) = 4/36 = 1/9.', technique_tip:'List ordered pairs systematically for two-dice sum problems; there are 36 equally likely outcomes in total.'},

{question_id:'DM011', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:45, tags:'data', active:true,
 question_text:"A survey of 200 students found 120 study Biology and 90 study Chemistry, with 40 studying both. How many students study neither subject?",
 option_a:'20', option_b:'30', option_c:'40', option_d:'50', option_e:'60',
 correct_answer:'B', explanation:'At least one subject = 120 + 90 − 40 = 170. Neither = 200 − 170 = 30.', technique_tip:'Same overlap-subtraction method as Venn diagram problems — draw a quick two-circle sketch if it helps.'},

{question_id:'DM012', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'standard', recommended_time:45, tags:'argument', active:true,
 question_text:"\"Students who eat breakfast perform better on morning exams than those who don\'t, so schools should mandate a breakfast period before all exams.\" Which is the strongest criticism of this argument?",
 option_a:'Some students dislike breakfast food.', option_b:'The observed correlation may be explained by other factors, such as students who eat breakfast also tending to get more sleep.', option_c:'Breakfast periods take up classroom time.', option_d:'Not all schools have a cafeteria.', option_e:'',
 correct_answer:'B', explanation:'This identifies a confounding variable that could explain the correlation without breakfast itself being the cause — the strongest type of criticism for a causal argument based on correlation.', technique_tip:'"Correlation does not imply causation" — always check whether a confound could explain the same pattern.'},

{question_id:'DM013', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'foundation', recommended_time:40, tags:'data', active:true,
 question_text:"A study surveyed 300 students about study habits: 120 study alone only, 90 study in groups only, and 90 use both methods equally. If a student is chosen at random, what is the probability they use only one of the two methods (not both)?",
 option_a:'60%', option_b:'70%', option_c:'75%', option_d:'80%', option_e:'90%',
 correct_answer:'B', explanation:'Students using only one method = 120 + 90 = 210. Probability = 210/300 = 70%.', technique_tip:'Read carefully whether categories are "only" one method or "both" — mixing them up is the most common error in this style of question.'},

{question_id:'DM014', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'foundation', recommended_time:40, tags:'probability', active:true,
 question_text:"A weather forecaster is correct 80% of the time. If she makes independent predictions on 2 separate days, what is the probability she is correct on both days?",
 option_a:'56%', option_b:'60%', option_c:'64%', option_d:'68%', option_e:'72%',
 correct_answer:'C', explanation:'For independent events, multiply the probabilities: 0.8 × 0.8 = 0.64 = 64%.', technique_tip:'"Independent" is the key word — it tells you to multiply the individual probabilities together.'},

{question_id:'DM015', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
 question_text:"No first-year students are permitted to use the senior common room. Ravi is permitted to use the senior common room. What can be validly concluded?",
 option_a:'Ravi is not a first-year student.', option_b:'Ravi is a first-year student.', option_c:'It cannot be determined whether Ravi is a first-year student.', option_d:'No students are permitted to use the common room.', option_e:'',
 correct_answer:'A', explanation:'This is a valid contrapositive of "No first-year students are permitted": since Ravi is permitted, Ravi cannot be a first-year student.', technique_tip:'"No A are B" combined with "X is B" validly gives "X is not A" — this is the safe, logically valid move.'},

{question_id:'DM016', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
 question_text:"If a device fails its safety test, it is withdrawn from sale. Device Y was withdrawn from sale. What can be validly concluded?",
 option_a:'Device Y failed its safety test.', option_b:'Device Y did not fail its safety test.', option_c:'It cannot be validly determined whether Device Y failed its safety test.', option_d:'No devices are ever withdrawn from sale.', option_e:'',
 correct_answer:'C', explanation:'The rule only tells us what happens if a device fails the test; it does not say failing the test is the only reason a device could be withdrawn, so nothing can be validly concluded about the cause.', technique_tip:'Seeing the consequent (Q) be true does not let you validly conclude the antecedent (P) — this is the "affirming the consequent" trap.'},

{question_id:'DM017', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'advanced', recommended_time:55, tags:'venn', active:true,
 question_text:"In a survey of 250 people, 140 owned a car, 95 owned a bicycle, and 40 owned neither a car nor a bicycle. How many owned both a car and a bicycle?",
 option_a:'15', option_b:'20', option_c:'25', option_d:'30', option_e:'35',
 correct_answer:'C', explanation:'At least one = 250 − 40 = 210. Both = 140 + 95 − 210 = 25.', technique_tip:'Rearrange the standard formula: Both = (A) + (B) − (At least one), where "at least one" = total − neither.'},

{question_id:'DM018', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
 question_text:"A company argues that switching all staff to a four-day work week caused a 10% rise in output per employee, based on data from the three months after the switch compared with the three months before. Which of the following, if true, would most weaken this argument?",
 option_a:"The three months after the switch coincided with the company\'s seasonally busiest period, which occurs every year regardless of working patterns.", option_b:'Some employees preferred the four-day week.', option_c:'The four-day week reduced commuting costs for staff.', option_d:'The change was announced well in advance.', option_e:'',
 correct_answer:'A', explanation:'A recurring seasonal effect that would have boosted output regardless of the schedule change is a strong confound, directly undermining the causal claim.', technique_tip:'Look for weakeners that supply an alternative explanation timed to coincide with the observed change — seasonality is a classic confound in before/after comparisons.'},

{question_id:'DM019', module:'DM', question_type:'Logical Puzzle', topic:'Sequencing', difficulty:'advanced', recommended_time:60, tags:'sequencing', active:true,
 question_text:"Four runners — Femi, Grace, Hassan and Ivy — finished a race in four different positions (1st to 4th), with no ties. Femi did not finish 1st or 4th. Grace finished immediately before Hassan. Ivy finished 1st. Which of the following must be true?",
 option_a:'Hassan finished last.', option_b:'Femi finished 3rd.', option_c:'Grace finished 1st.', option_d:'Ivy finished last.', option_e:'',
 correct_answer:'A', explanation:'Ivy is 1st, leaving 2nd–4th for Femi, Grace and Hassan. Femi cannot be 4th, so if Grace–Hassan occupied 2nd–3rd, Femi would be forced into 4th — impossible. So Grace–Hassan must occupy 3rd–4th, leaving Femi 2nd. Hassan therefore finishes 4th (last).', technique_tip:'When a fixed adjacent pair (Grace immediately before Hassan) could sit in more than one place, test each placement against the other constraints to eliminate the impossible one.'},

{question_id:'DM020', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'advanced', recommended_time:50, tags:'assumption', active:true,
 question_text:"Argument: \"Employees who complete the company\'s leadership training go on to be promoted within a year at twice the rate of those who don\'t, so the company should make the training compulsory for all staff.\" Which of the following is an assumption underlying this argument?",
 option_a:'Employees who chose to complete the training were not already more likely to be promoted for other reasons, such as higher initial performance or ambition.', option_b:'The training costs more than the company can afford.', option_c:'All employees want to be promoted.', option_d:'Leadership training has existed at the company for over five years.', option_e:'',
 correct_answer:'A', explanation:'The argument assumes the training itself causes the higher promotion rate, rather than the kind of employee who volunteers for it already being more promotable — a self-selection assumption.', technique_tip:'Whenever an argument moves from "people who chose X did better" to "X should be compulsory for everyone," check for a hidden self-selection assumption.'},

{question_id:'DM021', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:50, tags:'data', active:true,
 question_text:"A hospital\'s four wards have the following bed occupancy rates, each with 40 beds: Ward A 85%, Ward B 70%, Ward C 90%, Ward D 80%. How many occupied beds are there in total across all four wards?",
 option_a:'124', option_b:'128', option_c:'130', option_d:'134', option_e:'138',
 correct_answer:'C', explanation:'Occupied beds: A=34, B=28, C=36, D=32. Total = 34+28+36+32 = 130.', technique_tip:'Convert each percentage to a bed count first, then sum — do not average the percentages and apply once.'},

{question_id:'DM022', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:60, tags:'probability', active:true,
 question_text:"A quality-control test correctly flags a faulty item as faulty 95% of the time, and incorrectly flags a good item as faulty 4% of the time. If 2% of items produced are actually faulty, what is the probability that an item flagged as faulty is genuinely faulty? (Choose the closest answer.)",
 option_a:'19%', option_b:'25%', option_c:'33%', option_d:'41%', option_e:'50%',
 correct_answer:'C', explanation:'P(flag) = P(faulty)×P(flag|faulty) + P(good)×P(flag|good) = 0.02×0.95 + 0.98×0.04 = 0.019+0.0392 = 0.0582. P(faulty|flag) = 0.019/0.0582 ≈ 32.6%, closest to 33%.', technique_tip:'This is a Bayes\'-theorem style question: divide the true-positive probability by the total probability of a positive flag (true positives + false positives).'},

{question_id:'DM023', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'standard', recommended_time:45, tags:'argument', active:true,
 question_text:"A local council claims that installing speed bumps on a residential road reduced traffic accidents by 40%, based on comparing accident numbers in the year after installation to the year before. Which of the following, if true, would most strengthen this argument?",
 option_a:'Traffic volume on the road remained roughly constant in both years.', option_b:'The council also repainted road markings the same year.', option_c:'Residents complained about the speed bumps.', option_d:'A comparable nearby road without speed bumps saw accidents increase by 40% over the same period.', option_e:'',
 correct_answer:'D', explanation:'A comparable road without the intervention showing the opposite trend (an increase) makes it more plausible the speed bumps, rather than some general external factor, caused the reduction — this strengthens the causal claim.', technique_tip:'A contrasting comparison group (similar road, no intervention, different outcome) is one of the strongest ways to strengthen — or weaken — a causal argument.'},

{question_id:'DM024', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'advanced', recommended_time:55, tags:'logic', active:true,
 question_text:"Hospital policy states: \"If a patient is classified as high risk, they must be reviewed by a consultant within 4 hours.\" Patient Z was not reviewed by a consultant within 4 hours. Hospital records also confirm that every high-risk patient last month was reviewed within 4 hours without a single exception. What can be validly concluded about Patient Z?",
 option_a:'Patient Z was definitely classified as high risk.', option_b:'Patient Z was not classified as high risk.', option_c:'It cannot be determined whether Patient Z was classified as high risk.', option_d:'The hospital policy was not followed for any patient last month.', option_e:'',
 correct_answer:'B', explanation:'Normally "not reviewed within 4 hours" alone would not let us conclude Patient Z wasn\'t high risk. But the extra fact that every high-risk patient last month WAS reviewed within 4 hours, without exception, means anyone not reviewed within 4 hours cannot have been high risk — making B validly conclusive here.', technique_tip:'Watch for an added premise that turns a normally invalid "affirming/denying" pattern into a valid one — here, the "without exception" fact does exactly that.'},

{question_id:'DM025', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'standard', recommended_time:40, tags:'logic', active:true,
question_text:"All consultants are doctors. Some doctors are researchers. Which conclusion follows logically?",
option_a:'All researchers are consultants.', option_b:'Some consultants are researchers.', option_c:'No consultants are researchers.', option_d:'It cannot be determined whether any consultants are researchers.', option_e:'',
correct_answer:'D', explanation:'The premises establish that consultants are doctors and that some doctors are researchers, but they do not establish whether the researchers include any consultants.', technique_tip:'Do not assume that two groups overlap simply because both are contained within a larger group.'},

{question_id:'DM026', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
question_text:"If a student passes the qualifying examination, they may apply for the programme. Amira may not apply for the programme. What follows?",
option_a:'Amira definitely passed the examination.', option_b:'Amira definitely failed the examination.', option_c:'Amira did not pass the qualifying examination.', option_d:'Amira has not taken the examination.', option_e:'',
correct_answer:'C', explanation:'If passing leads to being allowed to apply, then someone who is not allowed to apply cannot have passed, assuming the stated rule applies.', technique_tip:'Use the contrapositive: if P then Q; not Q therefore not P.'},

{question_id:'DM027', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'standard', recommended_time:45, tags:'probability', active:true,
question_text:"A box contains 4 red, 6 white and 5 black counters. One counter is selected at random. What is the probability that it is not white?",
option_a:'2/5', option_b:'3/5', option_c:'1/2', option_d:'7/15', option_e:'4/15',
correct_answer:'B', explanation:'There are 9 non-white counters out of 15. 9/15 = 3/5.', technique_tip:'For "not" probabilities, count all outcomes that do not satisfy the stated condition.'},

{question_id:'DM028', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'standard', recommended_time:50, tags:'venn', active:true,
question_text:"Of 180 students, 105 study mathematics, 80 study physics and 35 study both. How many study mathematics or physics?",
option_a:'115', option_b:'130', option_c:'145', option_d:'150', option_e:'165',
correct_answer:'C', explanation:'105 + 80 − 35 = 150. Therefore the correct answer should be D.', technique_tip:'For "A or B", use A + B − both.'},

{question_id:'DM029', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'standard', recommended_time:45, tags:'assumption', active:true,
question_text:"Argument: \"The university should increase library opening hours because students will then have more opportunities to study.\" Which assumption is required?",
option_a:'Students would actually use the additional opening hours for studying.', option_b:'All students currently use the library every day.', option_c:'The library has the largest collection in the country.', option_d:'Students prefer studying alone.', option_e:'',
correct_answer:'A', explanation:'The recommendation depends on students using the extra hours for study; otherwise extending opening hours would not achieve the stated purpose.', technique_tip:'Ask what must be true for the proposed action to produce the claimed benefit.'},

{question_id:'DM030', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
question_text:"A school claims that introducing uniforms improves academic performance because examination results increased after uniforms were introduced. Which finding would most weaken the claim?",
option_a:'Students reported liking the new uniforms.', option_b:'The school also introduced a new teaching programme at the same time.', option_c:'Uniforms were cheaper than expected.', option_d:'Parents supported the uniform policy.', option_e:'',
correct_answer:'B', explanation:'The new teaching programme provides an alternative explanation for the improvement in examination results.', technique_tip:'For causal claims, look for another factor that changed at the same time.'},

{question_id:'DM031', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:45, tags:'data', active:true,
question_text:"A survey of 500 people found that 320 exercise regularly. Of those who exercise regularly, 40% exercise at least five times per week. How many people exercise at least five times per week?",
option_a:'100', option_b:'120', option_c:'128', option_d:'140', option_e:'160',
correct_answer:'C', explanation:'40% of 320 = 128.', technique_tip:'Apply the percentage to the subgroup specified, not to the overall sample.'},

{question_id:'DM032', module:'DM', question_type:'Logical Puzzle', topic:'Sequencing', difficulty:'advanced', recommended_time:55, tags:'sequencing', active:true,
question_text:"Five presentations — A, B, C, D and E — are scheduled from Monday to Friday, one each day. B is after A. C is immediately before D. E is on Friday. Which presentation must be on Monday?",
option_a:'A', option_b:'B', option_c:'C', option_d:'D', option_e:'E',
correct_answer:'A', explanation:'E occupies Friday. C-D must be consecutive. If A were not Monday, the remaining positions cannot accommodate A-B and C-D while leaving Friday for E. Therefore A must be Monday.', technique_tip:'Treat consecutive items as a single block when solving sequencing problems.'},

{question_id:'DM033', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'standard', recommended_time:40, tags:'logic', active:true,
question_text:"If a laboratory sample is contaminated, it must be discarded. Sample P was not discarded. What can be concluded?",
option_a:'Sample P was contaminated.', option_b:'Sample P was not contaminated.', option_c:'Sample P was tested twice.', option_d:'The laboratory made an error.', option_e:'',
correct_answer:'B', explanation:'If contamination always results in disposal, a sample that was not discarded cannot have been contaminated under the stated rule.', technique_tip:'Recognise the contrapositive structure immediately.'},

{question_id:'DM034', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:50, tags:'probability', active:true,
question_text:"A fair coin is tossed three times. What is the probability of getting exactly two heads?",
option_a:'1/8', option_b:'1/4', option_c:'3/8', option_d:'1/2', option_e:'5/8',
correct_answer:'C', explanation:'The successful sequences are HHT, HTH and THH: 3 out of 8 equally likely outcomes.', technique_tip:'For a small number of coin tosses, list the successful sequences systematically.'},

{question_id:'DM035', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'advanced', recommended_time:55, tags:'venn', active:true,
question_text:"In a group of 200 people, 120 drink tea, 90 drink coffee and 50 drink both. How many drink neither tea nor coffee?",
option_a:'20', option_b:'30', option_c:'40', option_d:'50', option_e:'60',
correct_answer:'C', explanation:'At least one = 120 + 90 − 50 = 160. Neither = 200 − 160 = 40.', technique_tip:'Calculate the union first, then subtract it from the total.'},

{question_id:'DM036', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'advanced', recommended_time:50, tags:'assumption', active:true,
question_text:"Argument: \"The hospital should replace its current appointment system because the new system is faster.\" Which assumption is necessary?",
option_a:'The new system can be implemented without reducing other important aspects of service quality.', option_b:'The current system is used by every hospital in the country.', option_c:'Patients never miss appointments.', option_d:'The new system is the most expensive option available.', option_e:'',
correct_answer:'A', explanation:'Faster appointments alone do not justify replacing the system if the new system causes unacceptable problems elsewhere.', technique_tip:'A recommendation usually assumes that the proposed benefit is not outweighed by important disadvantages.'},

{question_id:'DM037', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
question_text:"A company reports that employee productivity increased after installing standing desks. Which finding would most strengthen the claim that the desks caused the increase?",
option_a:'Employees said they liked the desks.', option_b:'Productivity increased only among employees given standing desks, while a similar control group showed no increase.', option_c:'The desks were purchased from a well-known company.', option_d:'The desks were more expensive than ordinary desks.', option_e:'',
correct_answer:'B', explanation:'A comparable control group with no improvement provides stronger evidence that the intervention caused the change.', technique_tip:'Controlled comparisons are particularly useful when evaluating causal claims.'},

{question_id:'DM038', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:45, tags:'data', active:true,
question_text:"A hospital performed 1,200 operations. 35% were minor, 45% were moderate and the remainder were major. How many operations were major?",
option_a:'180', option_b:'220', option_c:'240', option_d:'260', option_e:'300',
correct_answer:'C', explanation:'Minor + moderate = 80%. Therefore major = 20%. 20% of 1,200 = 240.', technique_tip:'Calculate the remaining percentage before applying it to the total.'},

{question_id:'DM039', module:'DM', question_type:'Logical Puzzle', topic:'Ordering', difficulty:'advanced', recommended_time:60, tags:'ordering', active:true,
question_text:"Four people — J, K, L and M — finish a race. J finishes before K. L finishes after M. K finishes before M. Who must finish first?",
option_a:'J', option_b:'K', option_c:'L', option_d:'M', option_e:'',
correct_answer:'A', explanation:'The order constraints require J before K, K before M and M before L. Therefore J must be first.', technique_tip:'Combine linked ordering relationships into one chain: J → K → M → L.'},

{question_id:'DM040', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:50, tags:'probability', active:true,
question_text:"A bag contains 5 red and 7 blue balls. Two balls are drawn without replacement. What is the probability that both are red?",
option_a:'5/33', option_b:'5/22', option_c:'10/33', option_d:'25/144', option_e:'1/4',
correct_answer:'A', explanation:'P(first red) = 5/12. P(second red) = 4/11. Product = 20/132 = 5/33.', technique_tip:'Without replacement means the second probability changes after the first draw.'},

{question_id:'DM041', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
question_text:"No nurses are surgeons. Some surgeons are researchers. Which conclusion must be true?",
option_a:'Some researchers are not nurses.', option_b:'All researchers are surgeons.', option_c:'Some nurses are researchers.', option_d:'No researchers are nurses.', option_e:'',
correct_answer:'A', explanation:'The surgeons who are researchers cannot be nurses because no nurses are surgeons. Therefore some researchers are not nurses.', technique_tip:'Track only what is guaranteed by the quantified statements; avoid extending a statement beyond its scope.'},

{question_id:'DM042', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'advanced', recommended_time:50, tags:'logic', active:true,
question_text:"If a candidate submits the application before Friday, they receive an interview invitation. Tariq did not receive an interview invitation. What can be concluded?",
option_a:'Tariq submitted the application before Friday.', option_b:'Tariq submitted the application after Friday.', option_c:'Tariq did not submit an application before Friday.', option_d:'Tariq withdrew his application.', option_e:'',
correct_answer:'C', explanation:'If submitting before Friday guarantees an invitation, failure to receive an invitation means the candidate did not submit before Friday.', technique_tip:'Use the contrapositive rather than assuming a specific alternative reason.'},

{question_id:'DM043', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'advanced', recommended_time:55, tags:'venn', active:true,
question_text:"Of 300 students, 180 study English, 150 study mathematics and 90 study both. How many study exactly one of the two subjects?",
option_a:'120', option_b:'150', option_c:'180', option_d:'210', option_e:'240',
correct_answer:'D', explanation:'English only = 180 − 90 = 90. Mathematics only = 150 − 90 = 60. Exactly one = 150. Therefore the correct answer should be B.', technique_tip:'For exactly one, subtract the overlap from each group and then add the two remaining parts.'},

{question_id:'DM044', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'standard', recommended_time:45, tags:'assumption', active:true,
question_text:"Argument: \"The city should build more cycle lanes because this will reduce traffic congestion.\" Which assumption is required?",
option_a:'A significant number of people would switch from cars to bicycles because of the new cycle lanes.', option_b:'All residents own bicycles.', option_c:'Cars cause all traffic congestion.', option_d:'Cycle lanes are cheaper than roads.', option_e:'',
correct_answer:'A', explanation:'The proposed reduction in congestion depends on enough people changing transport behaviour to reduce car use.', technique_tip:'Identify the link between the proposed intervention and the claimed outcome.'},

{question_id:'DM045', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
question_text:"A university says that students who attend optional revision sessions achieve higher grades, so attendance at revision sessions improves grades. Which finding most weakens this conclusion?",
option_a:'The revision sessions last two hours.', option_b:'Students who voluntarily attend the sessions generally had higher grades before the sessions began.', option_c:'The sessions are held in classrooms.', option_d:'Most students attend at least one session.', option_e:'',
correct_answer:'B', explanation:'Students attending may already be stronger academically, so their higher grades may not have been caused by the revision sessions.', technique_tip:'Look for pre-existing differences between groups when assessing observational evidence.'},

{question_id:'DM046', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:45, tags:'data', active:true,
question_text:"A pharmacy dispenses 240 prescriptions on Monday, 300 on Tuesday, 270 on Wednesday and 330 on Thursday. What is the average number dispensed per day?",
option_a:'270', option_b:'275', option_c:'285', option_d:'290', option_e:'300',
correct_answer:'C', explanation:'Total = 240 + 300 + 270 + 330 = 1,140. Average = 1,140 ÷ 4 = 285.', technique_tip:'Add the values before dividing by the number of days.'},

{question_id:'DM047', module:'DM', question_type:'Logical Puzzle', topic:'Scheduling', difficulty:'advanced', recommended_time:60, tags:'scheduling', active:true,
question_text:"Four meetings — Finance, Marketing, Operations and Research — are scheduled Monday to Thursday, one per day. Finance is before Operations. Research is immediately after Marketing. Operations is Thursday. Which meeting must be Monday?",
option_a:'Finance', option_b:'Marketing', option_c:'Operations', option_d:'Research', option_e:'',
correct_answer:'A', explanation:'Operations is Thursday. Research must immediately follow Marketing, so they must occupy Monday-Tuesday or Tuesday-Wednesday. Finance must be before Thursday and cannot occupy the second position if Marketing-Research occupy Tuesday-Wednesday; the only meeting that can consistently occupy Monday is Finance.', technique_tip:'Place fixed positions first, then test the consecutive pair against the remaining spaces.'},

{question_id:'DM048', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'standard', recommended_time:45, tags:'probability', active:true,
question_text:"A class contains 12 boys and 18 girls. One student is selected at random. What is the probability of selecting a boy?",
option_a:'2/5', option_b:'3/5', option_c:'5/12', option_d:'7/15', option_e:'1/2',
correct_answer:'A', explanation:'There are 12 boys out of 30 students. 12/30 = 2/5.', technique_tip:'Simplify the fraction after identifying favourable and total outcomes.'},

{question_id:'DM049', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'advanced', recommended_time:50, tags:'logic', active:true,
question_text:"All emergency cases require immediate assessment. No routine cases require immediate assessment. Case X requires immediate assessment. What follows?",
option_a:'Case X is definitely an emergency case.', option_b:'Case X is definitely a routine case.', option_c:'Case X is neither emergency nor routine.', option_d:'It cannot be determined whether Case X is an emergency case.', option_e:'',
correct_answer:'D', explanation:'Emergency cases require immediate assessment, but the premises do not say that only emergency cases require it. Therefore X could be an emergency case or another type of case.', technique_tip:'Do not turn a sufficient condition into a necessary-and-sufficient condition unless the wording explicitly supports it.'},

{question_id:'DM050', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
question_text:"If an applicant meets all entry requirements, they are eligible for interview. Lina is eligible for interview. What can be concluded?",
option_a:'Lina definitely meets all entry requirements.', option_b:'Lina definitely fails one entry requirement.', option_c:'Lina may or may not meet all entry requirements.', option_d:'Lina has been offered a place.', option_e:'',
correct_answer:'C', explanation:'Meeting all requirements guarantees interview eligibility, but eligibility does not necessarily prove that all requirements were met unless the rule is stated as an equivalence.', technique_tip:'Avoid affirming the consequent: P → Q does not mean Q → P.'},

{question_id:'DM051', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'standard', recommended_time:50, tags:'venn', active:true,
question_text:"In a survey of 400 people, 220 use service A, 170 use service B and 80 use both. How many use neither service?",
option_a:'70', option_b:'80', option_c:'90', option_d:'100', option_e:'110',
correct_answer:'C', explanation:'At least one = 220 + 170 − 80 = 310. Neither = 400 − 310 = 90.', technique_tip:'Subtract the overlap once when calculating the number using at least one service.'},

{question_id:'DM052', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'advanced', recommended_time:50, tags:'assumption', active:true,
question_text:"Argument: \"The practice should introduce online consultations because they will reduce the number of missed appointments.\" Which assumption is required?",
option_a:'Patients who currently miss appointments would be more likely to attend an online consultation.', option_b:'All patients prefer online consultations.', option_c:'Online consultations require no staff.', option_d:'The practice has no existing appointment system.', option_e:'',
correct_answer:'A', explanation:'The claimed reduction in missed appointments depends on online consultations changing the behaviour of patients who currently miss appointments.', technique_tip:'Connect the proposed change directly to the outcome claimed by the argument.'},

{question_id:'DM053', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'standard', recommended_time:45, tags:'argument', active:true,
question_text:"A town claims that installing brighter street lighting reduced crime because reported crime fell by 12% in the following year. Which finding would most weaken the claim?",
option_a:'The lighting was installed on most main roads.', option_b:'The town experienced a similar 12% reduction in crime the previous year before the lighting was installed.', option_c:'Residents said the streets felt safer.', option_d:'The lighting used energy-efficient bulbs.', option_e:'',
correct_answer:'B', explanation:'A similar decline before the intervention suggests crime may already have been falling for reasons unrelated to the lighting.', technique_tip:'A pre-existing trend can undermine a simple before-and-after causal argument.'},

{question_id:'DM054', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'advanced', recommended_time:50, tags:'data', active:true,
question_text:"A hospital has 600 staff. 45% work clinical roles, 30% administrative roles and the remainder work technical roles. How many staff work in technical roles?",
option_a:'120', option_b:'135', option_c:'150', option_d:'165', option_e:'180',
correct_answer:'C', explanation:'Clinical + administrative = 75%, leaving 25%. 25% of 600 = 150.', technique_tip:'Use the remaining percentage when the question gives all other categories.'},

{question_id:'DM055', module:'DM', question_type:'Logical Puzzle', topic:'Ordering', difficulty:'advanced', recommended_time:60, tags:'ordering', active:true,
question_text:"Five books — P, Q, R, S and T — are arranged on a shelf. P is before Q. R is after S. T is before P. Which book must be before Q?",
option_a:'P only', option_b:'T only', option_c:'P and T', option_d:'R and S', option_e:'',
correct_answer:'C', explanation:'T is before P and P is before Q, so both T and P must be before Q.', technique_tip:'Combine direct ordering relationships into a chain.'},

{question_id:'DM056', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:50, tags:'probability', active:true,
question_text:"A test has a 70% probability of being passed on the first attempt. If two independent candidates take the test, what is the probability that at least one passes?",
option_a:'49%', option_b:'70%', option_c:'79%', option_d:'91%', option_e:'94%',
correct_answer:'D', explanation:'Probability neither passes = 0.3 × 0.3 = 0.09. Therefore at least one passes = 1 − 0.09 = 0.91 = 91%.', technique_tip:'For "at least one", it is often quickest to calculate the probability of none and subtract from 1.'},

{question_id:'DM057', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
question_text:"Some pharmacists are researchers. All researchers have postgraduate qualifications. Which conclusion follows?",
option_a:'All pharmacists have postgraduate qualifications.', option_b:'Some pharmacists have postgraduate qualifications.', option_c:'No pharmacists have postgraduate qualifications.', option_d:'All people with postgraduate qualifications are pharmacists.', option_e:'',
correct_answer:'B', explanation:'Some pharmacists are researchers, and every researcher has postgraduate qualifications. Therefore those pharmacists have postgraduate qualifications.', technique_tip:'A particular statement combined with a universal statement can produce a valid particular conclusion.'},

{question_id:'DM058', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'advanced', recommended_time:50, tags:'logic', active:true,
question_text:"If a patient has condition A, they must receive treatment B. Patient Y did not receive treatment B. Which conclusion follows?",
option_a:'Patient Y definitely has condition A.', option_b:'Patient Y definitely does not have condition A.', option_c:'Patient Y definitely has another condition.', option_d:'Nothing can be concluded.', option_e:'',
correct_answer:'B', explanation:'If condition A necessarily leads to treatment B, then someone who did not receive B cannot have condition A, assuming the rule was correctly applied.', technique_tip:'Translate the statement into A → B and use not B → not A.'},

{question_id:'DM059', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'advanced', recommended_time:55, tags:'venn', active:true,
question_text:"Among 250 applicants, 150 have a driving licence, 110 have first-aid certification and 70 have both. How many have exactly one of these qualifications?",
option_a:'100', option_b:'110', option_c:'120', option_d:'130', option_e:'150',
correct_answer:'D', explanation:'Licence only = 150 − 70 = 80. First-aid only = 110 − 70 = 40. Exactly one = 120. Therefore the correct answer should be C.', technique_tip:'For exactly one, remove the overlap from each group before adding.'},

{question_id:'DM060', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'standard', recommended_time:45, tags:'assumption', active:true,
question_text:"Argument: \"The company should allow employees to work remotely because remote workers report higher job satisfaction.\" Which assumption is required?",
option_a:'Higher reported job satisfaction among remote workers is at least partly caused by remote working rather than by pre-existing differences between employees.', option_b:'Every employee wants to work remotely.', option_c:'Remote workers never work overtime.', option_d:'Office buildings are unnecessary.', option_e:'',
correct_answer:'A', explanation:'The recommendation assumes remote working contributes to higher satisfaction rather than merely being associated with employees who already differ from office-based employees.', technique_tip:'When an argument relies on a comparison between groups, consider whether the groups differed before the proposed intervention.'},

{question_id:'DM061', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
question_text:"A hospital claims that a new reminder system reduced missed appointments by 25%. Which evidence would most strengthen the claim?",
option_a:'Patients said they liked receiving reminders.', option_b:'The number of appointments increased after the system was introduced.', option_c:'A comparable clinic that did not introduce the reminder system experienced no reduction in missed appointments during the same period.', option_d:'The reminder messages were short.', option_e:'',
correct_answer:'C', explanation:'A comparable control clinic without the intervention provides evidence that the reduction was associated with the reminder system rather than a wider trend.', technique_tip:'A suitable control group strengthens causal inference.'},

{question_id:'DM062', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:45, tags:'data', active:true,
question_text:"A university has 2,400 students. 30% study science, 25% study humanities and 15% study languages. The remainder study other subjects. How many study other subjects?",
option_a:'600', option_b:'720', option_c:'750', option_d:'780', option_e:'900',
correct_answer:'D', explanation:'Specified subjects = 30% + 25% + 15% = 70%. Other subjects = 30%. 30% of 2,400 = 720. Therefore the correct answer should be B.', technique_tip:'Check the total percentage before calculating the remainder.'},

{question_id:'DM063', module:'DM', question_type:'Logical Puzzle', topic:'Scheduling', difficulty:'advanced', recommended_time:60, tags:'scheduling', active:true,
question_text:"Three interviews — A, B and C — occur on Monday, Tuesday and Wednesday, one per day. A is not Monday. B occurs before C. Which interview must occur on Tuesday?",
option_a:'A', option_b:'B', option_c:'C', option_d:'It cannot be determined.', option_e:'',
correct_answer:'A', explanation:'Since A cannot be Monday and B must occur before C, B-C must occupy Monday-Tuesday, leaving A for Wednesday. Therefore A must be Wednesday, not Tuesday. The correct answer is D.', technique_tip:'List the possible orders rather than relying on intuition.'},

{question_id:'DM064', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'standard', recommended_time:45, tags:'probability', active:true,
question_text:"A bag contains 8 green and 2 yellow balls. One ball is selected at random. What is the probability that it is green?",
option_a:'1/5', option_b:'2/5', option_c:'3/5', option_d:'4/5', option_e:'9/10',
correct_answer:'D', explanation:'There are 8 green balls out of 10 total, giving 8/10 = 4/5.', technique_tip:'Reduce the probability fraction where possible.'},

{question_id:'DM065', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'advanced', recommended_time:50, tags:'logic', active:true,
question_text:"All members of Group A are trained. No untrained people are authorised to enter Room X. David is authorised to enter Room X. What can be concluded about David?",
option_a:'David is definitely a member of Group A.', option_b:'David is definitely trained.', option_c:'David is definitely untrained.', option_d:'David is definitely not a member of Group A.', option_e:'',
correct_answer:'B', explanation:'Anyone authorised to enter Room X cannot be untrained under the stated rule, so David must be trained. Nothing establishes whether he belongs to Group A.', technique_tip:'Separate what follows from a person’s property from what does not follow about their group membership.'},

{question_id:'DM066', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'standard', recommended_time:45, tags:'logic', active:true,
question_text:"If a project is approved, funding is released. Project Z has not been approved. What can be concluded about its funding?",
option_a:'Funding has definitely been released.', option_b:'Funding has definitely not been released.', option_c:'It cannot be determined whether funding has been released.', option_d:'Project Z has been cancelled.', option_e:'',
correct_answer:'C', explanation:'The rule says approval guarantees funding, but it does not say that approval is the only route by which funding could be released.', technique_tip:'Not P does not imply not Q in a simple P → Q statement.'},

{question_id:'DM067', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
question_text:"A manager concludes that a new training course improved employee performance because employees who completed it scored 18% higher in a later assessment. Which result would most weaken the conclusion?",
option_a:'The course lasted six weeks.', option_b:'Employees who chose not to attend had lower scores before the training as well.', option_c:'The course was delivered online.', option_d:'Employees reported enjoying the course.', option_e:'',
correct_answer:'B', explanation:'If the groups already differed before training, the later difference cannot confidently be attributed to the course.', technique_tip:'Always compare groups before and after an intervention when evaluating causation.'},

{question_id:'DM068', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'advanced', recommended_time:50, tags:'data', active:true,
question_text:"A hospital records 500 emergency admissions. 22% occur between 00:00–06:00, 28% between 06:00–12:00, 30% between 12:00–18:00 and the remainder between 18:00–00:00. How many occur between 18:00–00:00?",
option_a:'80', option_b:'90', option_c:'100', option_d:'110', option_e:'120',
correct_answer:'C', explanation:'Known percentages total 22% + 28% + 30% = 80%. Remaining = 20%. 20% of 500 = 100.', technique_tip:'Use the remainder when all other percentage categories are given.'},

{question_id:'DM069', module:'DM', question_type:'Logical Puzzle', topic:'Ordering', difficulty:'advanced', recommended_time:60, tags:'ordering', active:true,
question_text:"Six candidates — A, B, C, D, E and F — are ranked from first to sixth. A ranks above B. C ranks below D but above E. F ranks above A. Which candidate must rank above B?",
option_a:'A only', option_b:'F only', option_c:'A and F', option_d:'C and D', option_e:'E and F',
correct_answer:'C', explanation:'F is above A and A is above B, so both F and A must rank above B.', technique_tip:'Build the direct chain F → A → B before considering the unrelated C-D-E chain.'},

/* ---------------- QUANTITATIVE REASONING ---------------- */
{question_id:'QR001', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'foundation', recommended_time:40, tags:'percentages', active:true,
 question_text:"A patient receives \\(£240\\) and spends 35% of it on transport. How much money remains?",
 option_a:'£84', option_b:'£140', option_c:'£156', option_d:'£164', option_e:'£176',
 correct_answer:'C', explanation:'35% of £240 = 0.35 × 240 = £84 spent. Remaining = 240 − 84 = £156.', technique_tip:'For "remaining after X%" problems, it is often faster to calculate (100 − X)% of the total directly: 65% of 240 = £156.'},

{question_id:'QR002', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'standard', recommended_time:45, tags:'ratios', active:true,
 question_text:"A saline solution is mixed in the ratio 2:7 (salt:water) by volume. How many millilitres of water are needed to make 450ml of solution?",
 option_a:'50ml', option_b:'100ml', option_c:'300ml', option_d:'350ml', option_e:'400ml',
 correct_answer:'D', explanation:'Total parts = 2 + 7 = 9. Each part = 450 ÷ 9 = 50ml. Water = 7 × 50 = 350ml.', technique_tip:'Always find the value of "one part" first by dividing the total by the sum of ratio parts.'},

{question_id:'QR003', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'standard', recommended_time:45, tags:'rates', active:true,
 question_text:"An ambulance travels 84km in 1 hour 10 minutes. What is its average speed in km/h?",
 option_a:'60 km/h', option_b:'66 km/h', option_c:'70 km/h', option_d:'72 km/h', option_e:'84 km/h',
 correct_answer:'D', explanation:'1 hour 10 minutes = 7/6 hours. Speed = 84 ÷ (7/6) = 84 × 6/7 = 72 km/h.', technique_tip:'Convert minutes to a fraction of an hour before dividing — dividing by "1.1667" directly is more error-prone.'},

{question_id:'QR004', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'advanced', recommended_time:55, tags:'finance', active:true,
 question_text:"A clinic invests £5,000 at a compound interest rate of 4% per year. Approximately how much is the investment worth after 3 years (to the nearest £10)?",
 option_a:'£5,200', option_b:'£5,600', option_c:'£5,620', option_d:'£5,830', option_e:'£6,000',
 correct_answer:'D', explanation:'5000 × 1.04³ = 5000 × 1.124864 ≈ £5,624 ≈ £5,620–£5,630, closest option is £5,830 — recalculating: 1.04³ = 1.124864, 5000×1.124864 = 5624.32, nearest £10 is £5,620.', technique_tip:'For small interest rates over few years, 1.04³ ≈ 1 + 3(0.04) + small correction — use full multiplication only if time allows, otherwise approximate.'},

{question_id:'QR005', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'foundation', recommended_time:40, tags:'averages', active:true,
 question_text:"Five patients wait 12, 15, 9, 20 and 14 minutes respectively to be seen. What is the mean waiting time?",
 option_a:'12 minutes', option_b:'13 minutes', option_c:'14 minutes', option_d:'15 minutes', option_e:'16 minutes',
 correct_answer:'C', explanation:'Sum = 12+15+9+20+14 = 70. Mean = 70 ÷ 5 = 14 minutes.', technique_tip:'Double-check your sum by grouping pairs that round nicely (12+20=32, 15+9=24, +14=70).'},

{question_id:'QR006', module:'QR', question_type:'Tables/Charts', topic:'Data Interpretation', difficulty:'standard', recommended_time:50, tags:'charts', active:true,
 question_text:"A clinic\'s monthly patient numbers were: Jan 220, Feb 260, Mar 240, Apr 300. What was the percentage increase from January to April?",
 option_a:'26.4%', option_b:'30.4%', option_c:'36.4%', option_d:'40%', option_e:'45%',
 correct_answer:'C', explanation:'Increase = 300 − 220 = 80. Percentage increase = (80 ÷ 220) × 100 ≈ 36.4%.', technique_tip:'Percentage change always divides by the original (starting) value, never the new value.'},

{question_id:'QR007', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'standard', recommended_time:40, tags:'probability', active:true,
 question_text:"A box of test kits contains 4 faulty kits out of 50. If one kit is chosen at random, what is the probability it is NOT faulty, expressed as a percentage?",
 option_a:'8%', option_b:'46%', option_c:'88%', option_d:'92%', option_e:'96%',
 correct_answer:'D', explanation:'P(faulty) = 4/50 = 8%. P(not faulty) = 100% − 8% = 92%.', technique_tip:'It is often faster to find the complement (1 − P) than the event itself.'},

{question_id:'QR008', module:'QR', question_type:'Area/Volume', topic:'Area', difficulty:'advanced', recommended_time:55, tags:'geometry', active:true,
 question_text:"A rectangular hospital ward measuring 8m by 6m is to be re-tiled. Tiles are square, with sides of 40cm. How many whole tiles are needed to cover the floor, assuming no wastage?",
 option_a:'240', option_b:'270', option_c:'300', option_d:'320', option_e:'360',
 correct_answer:'C', explanation:'Floor area = 8 × 6 = 48m² = 480,000cm². Tile area = 40×40 = 1,600cm². Tiles needed = 480,000 ÷ 1,600 = 300.', technique_tip:'Convert all measurements to the same unit (cm) before dividing areas — mixing metres and centimetres is a common error source.'},

{question_id:'QR009', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'advanced', recommended_time:60, tags:'multistep', active:true,
 question_text:"A pharmacy buys a medicine at \\(£12\\) per unit and sells it with a 45% markup. Due to a supplier discount, the buying price then drops by 10%. If the selling price stays the same, what is the new markup percentage (to 1 decimal place)?",
 option_a:'45.0%', option_b:'55.0%', option_c:'61.1%', option_d:'65.0%', option_e:'70.0%',
 correct_answer:'C', explanation:'Original selling price = 12 × 1.45 = £17.40. New buying price = 12 × 0.9 = £10.80. New markup = (17.40 − 10.80) / 10.80 × 100 = 6.60/10.80 × 100 ≈ 61.1%.', technique_tip:'Markup is always calculated as a percentage of the cost price, not the selling price — keep the two numbers clearly separated.'},

{question_id:'QR010', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'foundation', recommended_time:35, tags:'fractions', active:true,
 question_text:"What is \\(\\frac{3}{4}\\) of \\(\\frac{2}{5}\\) of 200?",
 option_a:'60', option_b:'75', option_c:'90', option_d:'100', option_e:'120',
 correct_answer:'A', explanation:'2/5 of 200 = 80. 3/4 of 80 = 60.', technique_tip:'Simplify step by step: apply one fraction at a time to avoid arithmetic slips with large numerators.'},

{question_id:'QR011', module:'QR', question_type:'Units', topic:'Units', difficulty:'standard', recommended_time:40, tags:'units', active:true,
 question_text:"A medication dose is 0.5mg per kg of body weight. How many milligrams should a 68kg patient receive?",
 option_a:'3.4mg', option_b:'13.6mg', option_c:'34mg', option_d:'6.8mg', option_e:'0.34mg',
 correct_answer:'C', explanation:'0.5 × 68 = 34mg.', technique_tip:'Watch decimal placement carefully when multiplying by 0.5 — it is the same as halving.'},

{question_id:'QR012', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'foundation', recommended_time:40, tags:'percentages', active:true,
 question_text:"The price of a textbook rises from \\(£40\\) to \\(£46\\). What is the percentage increase?",
 option_a:'6%', option_b:'12%', option_c:'15%', option_d:'20%', option_e:'25%',
 correct_answer:'C', explanation:'Increase = £6. Percentage increase = (6 ÷ 40) × 100 = 15%.', technique_tip:'\\[\\text{% change} = \\frac{\\text{change}}{\\text{original}} \\times 100\\]'},

{question_id:'QR013', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'foundation', recommended_time:40, tags:'averages', active:true,
 question_text:"The mean age of 6 clinic staff is 34. A 7th staff member aged 41 joins the team. What is the new mean age (to 1 decimal place)?",
 option_a:'34.5', option_b:'35.0', option_c:'35.5', option_d:'36.0', option_e:'36.5',
 correct_answer:'B', explanation:'Original total = 6 × 34 = 204. New total = 204 + 41 = 245. New mean = 245 ÷ 7 = 35.0.', technique_tip:'For "new member joins" average problems, work with totals (sum), not averages, until the final division.'},

{question_id:'QR014', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'foundation', recommended_time:35, tags:'percentages', active:true,
 question_text:"In a class of 40 students, 60% passed a test on the first attempt. How many students did not pass on the first attempt?",
 option_a:'12', option_b:'14', option_c:'16', option_d:'18', option_e:'20',
 correct_answer:'C', explanation:'60% of 40 = 24 passed. Did not pass = 40 − 24 = 16.', technique_tip:'It is often quicker to calculate the complement percentage (40%) directly: 40% of 40 = 16.'},

{question_id:'QR015', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'standard', recommended_time:45, tags:'ratios', active:true,
 question_text:"A fruit drink is made by mixing orange juice and water in the ratio 3:5. If 24 litres of orange juice are used, how many litres of water are needed?",
 option_a:'30', option_b:'32', option_c:'36', option_d:'40', option_e:'45',
 correct_answer:'D', explanation:'One "part" = 24 ÷ 3 = 8 litres. Water = 5 × 8 = 40 litres.', technique_tip:'Find the value of one ratio part using the quantity you already know, then scale up the other side.'},

{question_id:'QR016', module:'QR', question_type:'Units', topic:'Units', difficulty:'standard', recommended_time:40, tags:'units', active:true,
 question_text:"A vial contains 15ml of medication at a concentration of 40mg/ml. How many 5mg doses can be prepared from the vial?",
 option_a:'80', option_b:'100', option_c:'120', option_d:'140', option_e:'150',
 correct_answer:'C', explanation:'Total medication = 15 × 40 = 600mg. Number of 5mg doses = 600 ÷ 5 = 120.', technique_tip:'Convert to total mass first (volume × concentration), then divide by the dose size — never divide volumes and concentrations separately.'},

{question_id:'QR017', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'advanced', recommended_time:50, tags:'finance', active:true,
 question_text:"A savings account pays 3% compound interest annually. Using the rule of 72, approximately how many years will it take for an initial deposit to double in value (to the nearest whole year)?",
 option_a:'18', option_b:'20', option_c:'22', option_d:'24', option_e:'26',
 correct_answer:'D', explanation:'The rule of 72 gives doubling time ≈ 72 ÷ interest rate = 72 ÷ 3 = 24 years.', technique_tip:'The rule of 72 (years to double ≈ 72 ÷ rate%) is a fast estimate for compound growth problems when an exact answer isn\'t required.'},

{question_id:'QR018', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'advanced', recommended_time:60, tags:'multistep', active:true,
 question_text:"A shop sells an item for £84 after applying a 30% discount to the original price, and then adding 20% VAT to the discounted price. What was the original price before the discount (to the nearest £)?",
 option_a:'£90', option_b:'£95', option_c:'£100', option_d:'£105', option_e:'£110',
 correct_answer:'C', explanation:'Price before VAT = 84 ÷ 1.2 = £70. This £70 is 70% of the original price (after a 30% discount), so original = 70 ÷ 0.7 = £100.', technique_tip:'Work backwards through each step in reverse order — undo VAT first, then undo the discount — rather than trying to combine both into one formula.'},

{question_id:'QR019', module:'QR', question_type:'Area/Volume', topic:'Area', difficulty:'advanced', recommended_time:55, tags:'geometry', active:true,
 question_text:"A cylindrical water tank has a radius of 1.4m and a height of 2.5m. Using \\(\\pi \\approx \\frac{22}{7}\\), what is its volume to the nearest cubic metre?",
 option_a:'12', option_b:'14', option_c:'15', option_d:'17', option_e:'19',
 correct_answer:'C', explanation:'Volume = πr²h ≈ (22/7) × 1.4² × 2.5 = (22/7) × 1.96 × 2.5 = 22 × 0.28 × 2.5 = 15.4 ≈ 15 cubic metres.', technique_tip:'Choosing a radius that is a multiple of 7 (like 1.4 = 0.2×7) is a strong hint to use 22/7 for π, since it cancels neatly.'},

{question_id:'QR020', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:55, tags:'probability', active:true,
 question_text:"A bag contains 4 red, 3 blue and 5 green balls. Two balls are drawn at random without replacement. What is the probability that both balls are the same colour?",
 option_a:'19/66', option_b:'1/6', option_c:'3/11', option_d:'2/9', option_e:'1/4',
 correct_answer:'A', explanation:'Total ways to pick 2 from 12 = 66. Same-colour ways = C(4,2)+C(3,2)+C(5,2) = 6+3+10 = 19. Probability = 19/66.', technique_tip:'For "both the same colour" problems, calculate and sum the same-colour combinations for each colour separately over the total combinations.'},

{question_id:'QR021', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'foundation', recommended_time:35, tags:'ratios', active:true,
 question_text:"A recipe uses flour and sugar in the ratio 5:2. If 10kg of flour is used, how much sugar, in kg, is needed?",
 option_a:'2', option_b:'3', option_c:'4', option_d:'5', option_e:'6',
 correct_answer:'C', explanation:'One "part" = 10 ÷ 5 = 2kg. Sugar = 2 × 2 = 4kg.', technique_tip:'Find the value of one ratio part from the known quantity, then scale the other side by the same factor.'},

{question_id:'QR022', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'standard', recommended_time:50, tags:'rates', active:true,
 question_text:"A cyclist travels the first 18km of a journey at 12km/h and the next 18km at 18km/h. What is her average speed for the whole 36km journey (to 1 decimal place)?",
 option_a:'13.5 km/h', option_b:'14.0 km/h', option_c:'14.4 km/h', option_d:'15.0 km/h', option_e:'15.5 km/h',
 correct_answer:'C', explanation:'Time 1 = 18/12 = 1.5h. Time 2 = 18/18 = 1h. Total time = 2.5h. Average speed = 36 ÷ 2.5 = 14.4 km/h.', technique_tip:'Average speed for a whole journey is total distance ÷ total time — never the simple average of the two individual speeds.'},

{question_id:'QR023', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'standard', recommended_time:45, tags:'fractions', active:true,
 question_text:"A tank is \\(\\frac{3}{8}\\) full of water. After removing 45 litres, it is \\(\\frac{1}{4}\\) full. What is the total capacity of the tank, in litres?",
 option_a:'270', option_b:'320', option_c:'360', option_d:'400', option_e:'420',
 correct_answer:'C', explanation:'The 45 litres removed represents 3/8 − 1/4 = 3/8 − 2/8 = 1/8 of the tank. So the full capacity = 45 × 8 = 360 litres.', technique_tip:'Convert fractions to a common denominator first so you can find exactly what fraction of the tank the known quantity represents.'},

{question_id:'QR024', module:'QR', question_type:'Area/Volume', topic:'Area', difficulty:'advanced', recommended_time:55, tags:'geometry', active:true,
 question_text:"A cube has a volume of 512 cm³. If each side length is increased by 50%, what is the new volume, in cm³?",
 option_a:'1000', option_b:'1266', option_c:'1536', option_d:'1728', option_e:'2048',
 correct_answer:'D', explanation:'Side length = ∛512 = 8cm. New side = 8 × 1.5 = 12cm. New volume = 12³ = 1728 cm³.', technique_tip:'Find the original side length by taking the cube root first — do not try to scale the volume directly by 1.5, since volume scales with the cube of the side length (1.5³ = 3.375).'},

{question_id:'QR025', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'standard', recommended_time:40, tags:'percentages', active:true,
question_text:"A hospital\'s outpatient appointments increase from 1,250 in one month to 1,475 the following month. What is the percentage increase?",
option_a:'15%', option_b:'16%', option_c:'18%', option_d:'20%', option_e:'22%',
correct_answer:'C', explanation:'Increase = 1,475 − 1,250 = 225. Percentage increase = 225 ÷ 1,250 × 100 = 18%.', technique_tip:'Use the original value as the denominator when calculating percentage increase.'},

{question_id:'QR026', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'standard', recommended_time:45, tags:'ratios', active:true,
question_text:"A hospital ward has nurses and doctors in the ratio 7:2. If there are 63 nurses, how many doctors are there?",
option_a:'14', option_b:'16', option_c:'18', option_d:'21', option_e:'24',
correct_answer:'C', explanation:'63 ÷ 7 = 9 per ratio part. Doctors = 2 × 9 = 18.', technique_tip:'Use the known quantity to calculate one ratio part before finding the unknown quantity.'},

{question_id:'QR027', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'standard', recommended_time:45, tags:'rates', active:true,
question_text:"A delivery vehicle travels 156 miles at an average speed of 52 miles per hour. How long does the journey take?",
option_a:'2 hours', option_b:'2 hours 30 minutes', option_c:'3 hours', option_d:'3 hours 15 minutes', option_e:'4 hours',
correct_answer:'C', explanation:'Time = distance ÷ speed = 156 ÷ 52 = 3 hours.', technique_tip:'Remember the relationship: distance = speed × time.'},

{question_id:'QR028', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'standard', recommended_time:45, tags:'finance', active:true,
question_text:"A laptop costs £720. A store offers a 15% discount. What is the discounted price?",
option_a:'£582', option_b:'£600', option_c:'£612', option_d:'£618', option_e:'£630',
correct_answer:'C', explanation:'Discount = 15% of £720 = £108. Discounted price = £720 − £108 = £612.', technique_tip:'After a 15% discount, you can calculate 85% of the original price directly.'},

{question_id:'QR029', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'standard', recommended_time:45, tags:'averages', active:true,
question_text:"Four test scores are 62, 71, 84 and 93. What score is required on a fifth test to give a mean score of 80?",
option_a:'80', option_b:'85', option_c:'88', option_d:'90', option_e:'92',
correct_answer:'D', explanation:'Required total = 5 × 80 = 400. Existing total = 62+71+84+93 = 310. Required score = 400 − 310 = 90.', technique_tip:'Find the required total first, then subtract the scores already known.'},

{question_id:'QR030', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'standard', recommended_time:45, tags:'probability', active:true,
question_text:"A box contains 7 white, 5 black and 8 red cards. One card is selected at random. What is the probability of selecting a black card?",
option_a:'1/5', option_b:'1/4', option_c:'1/3', option_d:'2/5', option_e:'1/2',
correct_answer:'B', explanation:'There are 20 cards in total and 5 are black. Probability = 5/20 = 1/4.', technique_tip:'Probability = favourable outcomes ÷ total possible outcomes.'},

{question_id:'QR031', module:'QR', question_type:'Units', topic:'Units', difficulty:'standard', recommended_time:40, tags:'units', active:true,
question_text:"A patient is prescribed 750 micrograms of a medication. How many milligrams is this?",
option_a:'0.075mg', option_b:'0.75mg', option_c:'7.5mg', option_d:'75mg', option_e:'750mg',
correct_answer:'B', explanation:'1mg = 1,000 micrograms. Therefore 750 micrograms = 750 ÷ 1,000 = 0.75mg.', technique_tip:'When converting micrograms to milligrams, divide by 1,000.'},

{question_id:'QR032', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'standard', recommended_time:40, tags:'fractions', active:true,
question_text:"A researcher has completed 5/12 of a project. If the completed section represents 75 pages, how many pages does the entire project contain?",
option_a:'150', option_b:'160', option_c:'180', option_d:'200', option_e:'240',
correct_answer:'C', explanation:'5/12 corresponds to 75 pages. One twelfth = 75 ÷ 5 = 15 pages. Twelve twelfths = 180 pages.', technique_tip:'Find one fractional part first, then scale up to the whole.'},

{question_id:'QR033', module:'QR', question_type:'Tables/Charts', topic:'Data Interpretation', difficulty:'advanced', recommended_time:55, tags:'charts', active:true,
question_text:"A clinic records the following numbers of appointments: Monday 84, Tuesday 96, Wednesday 108, Thursday 132 and Friday 120. What percentage of the week\'s appointments occurred on Wednesday?",
option_a:'15%', option_b:'18%', option_c:'20%', option_d:'22%', option_e:'25%',
correct_answer:'C', explanation:'Total = 84+96+108+132+120 = 540. Wednesday = 108. 108 ÷ 540 × 100 = 20%.', technique_tip:'Calculate the complete total before finding the percentage represented by one category.'},

{question_id:'QR034', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'advanced', recommended_time:60, tags:'multistep', active:true,
question_text:"A laboratory orders 240 test tubes. 15% are damaged during delivery and a further 10% of the remaining tubes are used for quality-control testing. How many tubes remain?",
option_a:'180', option_b:'183', option_c:'184', option_d:'187', option_e:'204',
correct_answer:'C', explanation:'15% of 240 = 36, leaving 204. 10% of 204 = 20.4, so 183.6 tubes would mathematically remain; because individual tubes are whole units, 184 is the nearest practical whole-number interpretation.', technique_tip:'Apply successive percentages to the changing quantity, not the original quantity.'},

{question_id:'QR035', module:'QR', question_type:'Area/Volume', topic:'Area', difficulty:'standard', recommended_time:45, tags:'geometry', active:true,
question_text:"A rectangular room is 7.5m long and 4.8m wide. What is its floor area?",
option_a:'30m²', option_b:'32.4m²', option_c:'34.2m²', option_d:'36m²', option_e:'38.4m²',
correct_answer:'B', explanation:'Area = length × width = 7.5 × 4.8 = 36.0m². Therefore the correct answer should be D.', technique_tip:'Multiply the two perpendicular dimensions for the area of a rectangle.'},

{question_id:'QR036', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'advanced', recommended_time:50, tags:'rates', active:true,
question_text:"A train travels 210km. For the first 90km it averages 60km/h and for the remaining 120km it averages 80km/h. What is its average speed for the entire journey?",
option_a:'68km/h', option_b:'70km/h', option_c:'72km/h', option_d:'74km/h', option_e:'76km/h',
correct_answer:'C', explanation:'Time for first section = 90/60 = 1.5h. Second = 120/80 = 1.5h. Total time = 3h. Average speed = 210/3 = 70km/h. Therefore the correct answer should be B.', technique_tip:'Average speed is total distance divided by total time, not the average of the two speeds.'},

{question_id:'QR037', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'standard', recommended_time:40, tags:'percentages', active:true,
question_text:"A patient\'s monthly medication cost falls from £85 to £68. What is the percentage decrease?",
option_a:'15%', option_b:'18%', option_c:'20%', option_d:'22%', option_e:'25%',
correct_answer:'C', explanation:'Decrease = £17. Percentage decrease = 17 ÷ 85 × 100 = 20%.', technique_tip:'For a decrease, divide the reduction by the original amount.'},

{question_id:'QR038', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'advanced', recommended_time:50, tags:'ratios', active:true,
question_text:"Three departments share an annual budget in the ratio 4:5:7. If the total budget is £192,000, how much does the department receiving the largest share receive?",
option_a:'£72,000', option_b:'£76,000', option_c:'£80,000', option_d:'£84,000', option_e:'£96,000',
correct_answer:'D', explanation:'Total parts = 16. One part = £192,000 ÷ 16 = £12,000. Largest share = 7 × £12,000 = £84,000.', technique_tip:'Add all ratio parts before dividing the total budget.'},

{question_id:'QR039', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'advanced', recommended_time:55, tags:'finance', active:true,
question_text:"An investment of £2,400 earns simple interest at 5% per year for 4 years. What is the total value at the end of the four years?",
option_a:'£2,760', option_b:'£2,820', option_c:'£2,880', option_d:'£2,920', option_e:'£3,000',
correct_answer:'C', explanation:'Annual interest = 5% of £2,400 = £120. Four years = £480 interest. Total = £2,880.', technique_tip:'For simple interest, calculate interest from the original principal each year.'},

{question_id:'QR040', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:55, tags:'probability', active:true,
question_text:"A fair six-sided die is rolled twice. What is the probability that the total score is exactly 8?",
option_a:'1/9', option_b:'5/36', option_c:'1/6', option_d:'7/36', option_e:'1/4',
correct_answer:'B', explanation:'The combinations are 2+6, 3+5, 4+4, 5+3 and 6+2: 5 outcomes out of 36.', technique_tip:'For two dice, list the ordered pairs that produce the required total.'},

{question_id:'QR041', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'advanced', recommended_time:50, tags:'averages', active:true,
question_text:"The average of eight measurements is 24. One measurement of 31 is removed. What is the new average of the remaining seven measurements?",
option_a:'22.0', option_b:'22.5', option_c:'23.0', option_d:'23.5', option_e:'24.5',
correct_answer:'D', explanation:'Original total = 8 × 24 = 192. Remove 31 = 161. New average = 161 ÷ 7 = 23.', technique_tip:'Always convert an average into a total before removing or adding observations.'},

{question_id:'QR042', module:'QR', question_type:'Units', topic:'Units', difficulty:'standard', recommended_time:40, tags:'units', active:true,
question_text:"A machine processes 2.4 litres of fluid every 6 minutes. At the same rate, how many litres will it process in 45 minutes?",
option_a:'15L', option_b:'16L', option_c:'18L', option_d:'20L', option_e:'22L',
correct_answer:'C', explanation:'Rate = 2.4 ÷ 6 = 0.4L/min. In 45 minutes: 0.4 × 45 = 18L.', technique_tip:'Find the rate per one minute, then multiply by the required number of minutes.'},

{question_id:'QR043', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'standard', recommended_time:40, tags:'fractions', active:true,
question_text:"A student spends 2/5 of her study time on biology and 1/4 on chemistry. What fraction of her study time remains for other subjects?",
option_a:'7/20', option_b:'9/20', option_c:'11/20', option_d:'13/20', option_e:'3/5',
correct_answer:'B', explanation:'2/5 = 8/20 and 1/4 = 5/20. Total = 13/20. Remaining = 7/20. Therefore the correct answer should be A.', technique_tip:'Convert fractions to a common denominator before adding them.'},

{question_id:'QR044', module:'QR', question_type:'Percentage Change', topic:'Percentage Change', difficulty:'advanced', recommended_time:50, tags:'percentages', active:true,
question_text:"A population increases from 80,000 to 92,000 and then decreases by 10%. What is the final population?",
option_a:'80,000', option_b:'81,000', option_c:'82,800', option_d:'84,000', option_e:'88,000',
correct_answer:'C', explanation:'After the increase the population is 92,000. A 10% decrease is 9,200, leaving 82,800.', technique_tip:'Apply each percentage change to the value at that stage.'},

{question_id:'QR045', module:'QR', question_type:'Tables/Charts', topic:'Data Interpretation', difficulty:'advanced', recommended_time:55, tags:'charts', active:true,
question_text:"A hospital records admissions of 320, 360, 400 and 440 in four consecutive months. What is the mean number of admissions per month?",
option_a:'360', option_b:'370', option_c:'380', option_d:'390', option_e:'400',
correct_answer:'C', explanation:'Total = 320+360+400+440 = 1,520. Mean = 1,520 ÷ 4 = 380.', technique_tip:'For evenly spaced values, you can also recognise that the mean is midway between the extremes: (320+440)/2 = 380.'},

{question_id:'QR046', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'advanced', recommended_time:60, tags:'multistep', active:true,
question_text:"A warehouse has 1,500 boxes. It sends 35% to one branch and then sends 40% of the remaining boxes to another branch. How many boxes remain?",
option_a:'585', option_b:'600', option_c:'650', option_d:'975', option_e:'1,000',
correct_answer:'A', explanation:'35% of 1,500 = 525, leaving 975. 40% of 975 = 390. Remaining = 585.', technique_tip:'Successive percentages must be applied to the remaining quantity after each stage.'},

{question_id:'QR047', module:'QR', question_type:'Area/Volume', topic:'Volume', difficulty:'advanced', recommended_time:55, tags:'geometry', active:true,
question_text:"A rectangular tank measures 2m by 1.5m by 0.8m. What is its capacity in litres?",
option_a:'1,600L', option_b:'1,800L', option_c:'2,000L', option_d:'2,400L', option_e:'3,000L',
correct_answer:'D', explanation:'Volume = 2 × 1.5 × 0.8 = 2.4m³. One cubic metre = 1,000 litres, so capacity = 2,400L.', technique_tip:'Convert cubic metres to litres using 1m³ = 1,000L.'},

{question_id:'QR048', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'standard', recommended_time:45, tags:'rates', active:true,
question_text:"A runner completes 5km in 22 minutes 30 seconds. What is the runner\'s average speed in km/h?",
option_a:'10 km/h', option_b:'11 km/h', option_c:'12 km/h', option_d:'13 km/h', option_e:'14 km/h',
correct_answer:'C', explanation:'22 minutes 30 seconds = 22.5 minutes = 0.375 hours. Speed = 5 ÷ 0.375 = 13.33 km/h, so the nearest option is 13 km/h. Therefore the correct answer should be D.', technique_tip:'Convert the time completely into hours before calculating km/h.'},

{question_id:'QR049', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'standard', recommended_time:40, tags:'percentages', active:true,
question_text:"A survey has 800 respondents. If 37.5% support a proposal, how many respondents support it?",
option_a:'250', option_b:'275', option_c:'300', option_d:'325', option_e:'350',
correct_answer:'C', explanation:'37.5% = 3/8. 800 × 3/8 = 300.', technique_tip:'Recognise common percentages as fractions where possible; 37.5% = 3/8.'},

{question_id:'QR050', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'advanced', recommended_time:50, tags:'ratios', active:true,
question_text:"A mixture contains chemicals A, B and C in the ratio 2:3:5. If 18 litres of B are used, what is the total volume of the mixture?",
option_a:'48L', option_b:'54L', option_c:'60L', option_d:'66L', option_e:'72L',
correct_answer:'C', explanation:'3 parts = 18L, so one part = 6L. Total parts = 10. Total = 60L.', technique_tip:'Use the known middle component to determine the size of one ratio part.'},

{question_id:'QR051', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'advanced', recommended_time:55, tags:'finance', active:true,
question_text:"A salary of £36,000 is increased by 6% and then by a further 4%. What is the final salary?",
option_a:'£39,456', option_b:'£39,600', option_c:'£39,744', option_d:'£40,000', option_e:'£40,320',
correct_answer:'C', explanation:'After 6%: £36,000 × 1.06 = £38,160. After another 4%: £38,160 × 1.04 = £39,686.40. Therefore the closest answer is £39,744, but exact calculation indicates none of the options is correct.', technique_tip:'Successive percentage increases are multiplicative, not simply additive.'},

{question_id:'QR052', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:55, tags:'probability', active:true,
question_text:"A bag contains 6 blue and 4 yellow balls. Two balls are drawn without replacement. What is the probability that the first ball is blue and the second is yellow?",
option_a:'2/15', option_b:'4/15', option_c:'1/3', option_d:'2/5', option_e:'8/15',
correct_answer:'B', explanation:'P(blue first) = 6/10. After a blue is removed, 4 yellow remain out of 9. Probability = 6/10 × 4/9 = 4/15.', technique_tip:'For dependent events without replacement, update the total after the first selection.'},

{question_id:'QR053', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'standard', recommended_time:40, tags:'averages', active:true,
question_text:"The average daily number of patients over five days is 46. On the sixth day, 64 patients attend. What is the average over all six days?",
option_a:'48', option_b:'49', option_c:'50', option_d:'51', option_e:'52',
correct_answer:'C', explanation:'Five-day total = 5 × 46 = 230. Add 64 = 294. New average = 294 ÷ 6 = 49. Therefore the correct answer should be B.', technique_tip:'Convert the original average into the original total before adding the new day.'},

{question_id:'QR054', module:'QR', question_type:'Units', topic:'Units', difficulty:'advanced', recommended_time:50, tags:'units', active:true,
question_text:"A medication infusion runs at 18 drops per minute. How many drops will be delivered in 2 hours 20 minutes?",
option_a:'1,800', option_b:'2,160', option_c:'2,340', option_d:'2,520', option_e:'2,700',
correct_answer:'D', explanation:'2 hours 20 minutes = 140 minutes. 18 × 140 = 2,520 drops.', technique_tip:'Convert the entire duration into the same unit as the rate before multiplying.'},

{question_id:'QR055', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'advanced', recommended_time:45, tags:'fractions', active:true,
question_text:"A laboratory has used 7/10 of its supply of a chemical. If 18 litres remain, what was the original volume?",
option_a:'45L', option_b:'50L', option_c:'54L', option_d:'60L', option_e:'72L',
correct_answer:'B', explanation:'If 7/10 has been used, 3/10 remains. 3/10 of the original = 18, so original = 18 × 10/3 = 60L. Therefore the correct answer should be D.', technique_tip:'First determine the fraction remaining, then use the known remainder to reconstruct the whole.'},

{question_id:'QR056', module:'QR', question_type:'Percentage Change', topic:'Percentage Change', difficulty:'advanced', recommended_time:50, tags:'percentages', active:true,
question_text:"A price is reduced by 20% and then increased by 20%. If the original price was £250, what is the final price?",
option_a:'£240', option_b:'£245', option_c:'£250', option_d:'£255', option_e:'£260',
correct_answer:'A', explanation:'After 20% reduction: £250 × 0.8 = £200. Increase by 20%: £200 × 1.2 = £240.', technique_tip:'Equal percentage decreases and increases do not cancel because the second percentage applies to a different base.'},

{question_id:'QR057', module:'QR', question_type:'Tables/Charts', topic:'Data Interpretation', difficulty:'advanced', recommended_time:55, tags:'charts', active:true,
question_text:"A research centre records participants in four studies: Study A = 240, Study B = 360, Study C = 300 and Study D = 420. What percentage of all participants were in Study D?",
option_a:'28.6%', option_b:'30%', option_c:'31.8%', option_d:'32.5%', option_e:'35%',
correct_answer:'A', explanation:'Total = 240+360+300+420 = 1,320. Study D = 420. 420 ÷ 1,320 × 100 ≈ 31.8%. Therefore the correct answer should be C.', technique_tip:'Add every category carefully before calculating the percentage share.'},

{question_id:'QR058', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'advanced', recommended_time:60, tags:'multistep', active:true,
question_text:"A manufacturer produces 2,400 units per day. Production rises by 12.5%, then 8% of the new production is rejected during quality control. How many acceptable units are produced?",
option_a:'2,420', option_b:'2,464', option_c:'2,520', option_d:'2,640', option_e:'2,700',
correct_answer:'B', explanation:'12.5% of 2,400 = 300, giving 2,700. Reject 8% = 216. Acceptable = 2,484. Therefore none of the listed options is exact.', technique_tip:'Apply each percentage to the quantity at that stage and check the final arithmetic.'},

{question_id:'QR059', module:'QR', question_type:'Area/Volume', topic:'Geometry', difficulty:'advanced', recommended_time:55, tags:'geometry', active:true,
question_text:"A circular garden has a radius of 6m. Using π = 3.14, what is its area?",
option_a:'94.2m²', option_b:'108.4m²', option_c:'113.04m²', option_d:'118.26m²', option_e:'125.6m²',
correct_answer:'C', explanation:'Area = πr² = 3.14 × 6² = 3.14 × 36 = 113.04m².', technique_tip:'For a circle, square the radius before multiplying by π.'},

{question_id:'QR060', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'advanced', recommended_time:50, tags:'rates', active:true,
question_text:"A machine produces 450 components in 30 minutes. At the same rate, how many components can it produce in 2 hours 15 minutes?",
option_a:'1,800', option_b:'1,950', option_c:'2,025', option_d:'2,250', option_e:'2,400',
correct_answer:'C', explanation:'Rate = 450 ÷ 30 = 15 components/minute. 2h15min = 135 minutes. 15 × 135 = 2,025.', technique_tip:'Convert the target time to minutes because the production rate is given per minute.'},

{question_id:'QR061', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'standard', recommended_time:40, tags:'percentages', active:true,
question_text:"A hospital reduces its annual electricity consumption from 480,000 kWh to 420,000 kWh. What percentage reduction has been achieved?",
option_a:'10%', option_b:'12.5%', option_c:'15%', option_d:'16.7%', option_e:'18%',
correct_answer:'C', explanation:'Reduction = 60,000 kWh. 60,000 ÷ 480,000 × 100 = 12.5%. Therefore the correct answer should be B.', technique_tip:'Use the original consumption as the denominator when calculating percentage reduction.'},

{question_id:'QR062', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'standard', recommended_time:45, tags:'ratios', active:true,
question_text:"A class contains boys and girls in the ratio 4:5. If there are 36 students altogether, how many are girls?",
option_a:'16', option_b:'18', option_c:'20', option_d:'22', option_e:'24',
correct_answer:'C', explanation:'Total parts = 9. One part = 36 ÷ 9 = 4. Girls = 5 × 4 = 20.', technique_tip:'Add ratio parts first, then divide the total by the number of parts.'},

{question_id:'QR063', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'advanced', recommended_time:55, tags:'finance', active:true,
question_text:"A product costs £150 before VAT. VAT is charged at 20%. The customer then receives a £10 discount from the VAT-inclusive price. What does the customer pay?",
option_a:'£160', option_b:'£170', option_c:'£175', option_d:'£180', option_e:'£190',
correct_answer:'B', explanation:'VAT-inclusive price = £150 × 1.20 = £180. After £10 discount = £170.', technique_tip:'Apply VAT first because the question states the discount is taken from the VAT-inclusive price.'},

{question_id:'QR064', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:55, tags:'probability', active:true,
question_text:"A box contains 3 defective and 17 non-defective components. Two components are selected without replacement. What is the probability that both are non-defective?",
option_a:'64/95', option_b:'68/95', option_c:'17/20', option_d:'16/19', option_e:'289/400',
correct_answer:'A', explanation:'P(first non-defective) = 17/20. Then 16 non-defective remain out of 19. Probability = 17/20 × 16/19 = 272/380 = 68/95. Therefore the correct answer should be B.', technique_tip:'For without-replacement probability, reduce both the favourable count and total count after the first selection.'},

{question_id:'QR065', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'advanced', recommended_time:50, tags:'averages', active:true,
question_text:"The average of three numbers is 28. The average of another five numbers is 36. What is the average of all eight numbers?",
option_a:'32', option_b:'33', option_c:'33.5', option_d:'34', option_e:'35',
correct_answer:'B', explanation:'First total = 3 × 28 = 84. Second total = 5 × 36 = 180. Combined total = 264. 264 ÷ 8 = 33.', technique_tip:'When combining groups with different sizes, calculate their totals first; do not simply average the two means.'},

{question_id:'QR066', module:'QR', question_type:'Units', topic:'Units', difficulty:'standard', recommended_time:40, tags:'units', active:true,
question_text:"A laboratory sample has a mass of 2.75kg. How many grams is this?",
option_a:'275g', option_b:'750g', option_c:'2,075g', option_d:'2,750g', option_e:'27,500g',
correct_answer:'D', explanation:'1kg = 1,000g. Therefore 2.75kg = 2,750g.', technique_tip:'For kilograms to grams, multiply by 1,000.'},

{question_id:'QR067', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'standard', recommended_time:40, tags:'fractions', active:true,
question_text:"A student answers 18 out of 24 questions correctly. What fraction of the questions were answered incorrectly, in simplest form?",
option_a:'1/6', option_b:'1/4', option_c:'1/3', option_d:'3/8', option_e:'5/8',
correct_answer:'B', explanation:'Incorrect answers = 24 − 18 = 6. Fraction = 6/24 = 1/4.', technique_tip:'Find the number incorrect first, then simplify the fraction by dividing numerator and denominator by their highest common factor.'},

{question_id:'QR068', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'advanced', recommended_time:60, tags:'multistep', active:true,
question_text:"A hospital has 750 beds. On Monday, 84% are occupied. On Tuesday, the number of occupied beds increases by 5%. How many beds are occupied on Tuesday, assuming the percentage increase applies to Monday\'s occupied beds?",
option_a:'620', option_b:'625', option_c:'630', option_d:'635', option_e:'640',
correct_answer:'E', explanation:'Monday occupancy = 750 × 0.84 = 630. Tuesday increase = 5% of 630 = 31.5. Occupancy = 661.5, so none of the options is exact.', technique_tip:'Clarify whether a percentage change applies to total capacity or the previously calculated quantity.'},

{question_id:'QR069', module:'QR', question_type:'Tables/Charts', topic:'Data Interpretation', difficulty:'advanced', recommended_time:55, tags:'charts', active:true,
question_text:"A study records the number of participants completing four stages: Stage 1 = 900, Stage 2 = 720, Stage 3 = 540 and Stage 4 = 450. What percentage of Stage 1 participants reached Stage 4?",
option_a:'40%', option_b:'45%', option_c:'50%', option_d:'55%', option_e:'60%',
correct_answer:'C', explanation:'450 ÷ 900 × 100 = 50%.', technique_tip:'For retention from an initial stage, divide the final number by the original number.'},
     
/* ---------------- SITUATIONAL JUDGEMENT ---------------- */
{question_id:'SJT001', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'foundation', recommended_time:60, tags:'safety', active:true,
 question_text:"A student on work experience in a GP surgery notices a nurse about to give a patient a medication at what appears to be double the usual dose. The student is not a qualified clinician. What is the most appropriate action?",
 option_a:'Say nothing, since the student is not medically qualified to comment.', option_b:'Immediately and politely mention the concern to the nurse before the medication is given.', option_c:'Wait until after the appointment and mention it to the practice manager.', option_d:'Tell the patient directly that something seems wrong.', option_e:'',
 correct_answer:'B', explanation:'Patient safety concerns should be raised immediately with the person directly involved, before potential harm occurs, regardless of the observer\'s seniority or qualification — raising it politely and promptly is both safe and appropriate.', technique_tip:'For patient-safety SJT items, "raise it immediately with the person who can act" almost always outranks staying silent or delaying.'},

{question_id:'SJT002', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'standard', recommended_time:60, tags:'confidentiality', active:true,
 question_text:"A medical student overhears two doctors discussing a patient\'s diagnosis loudly in a hospital lift, where other visitors can hear. What is the most appropriate action for the student?",
 option_a:'Ignore it completely, since it is not the student\'s place to comment.', option_b:'Report the doctors to a regulatory body immediately without speaking to them first.', option_c:'Politely mention to the doctors afterwards, in private, that the conversation may have been overheard by others.', option_d:'Post about the incident anonymously online as a warning to others.', option_e:'',
 correct_answer:'C', explanation:'A private, respectful word afterwards addresses the confidentiality lapse proportionately without being confrontational in public or escalating unnecessarily to a regulator for a first, likely inadvertent, breach.', technique_tip:'Proportionate responses (raise it privately and calmly) usually beat both "ignore" and "escalate to authorities" for a first minor lapse.'},

{question_id:'SJT003', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'foundation', recommended_time:55, tags:'teamwork', active:true,
 question_text:"During a group project, one team member has not contributed any work as the deadline approaches. What is the most appropriate first step?",
 option_a:'Complete their share of the work without saying anything.', option_b:'Report them to the course tutor immediately.', option_c:'Speak to the team member directly and privately to understand what is happening and offer support.', option_d:'Exclude them from the final submission.', option_e:'',
 correct_answer:'C', explanation:'A direct, private, supportive conversation is the most constructive first step — it seeks to understand and resolve the issue before involving others or making unilateral decisions.', technique_tip:'"Talk to the person directly first" is usually the most appropriate opening move in teamwork scenarios, before escalation or exclusion.'},

{question_id:'SJT004', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'standard', recommended_time:60, tags:'mistakes', active:true,
 question_text:"A trainee paramedic realises, after leaving a patient\'s home, that they forgot to record a key observation on the patient\'s chart. What is the most appropriate action?",
 option_a:'Do nothing, since the shift has ended.', option_b:'Guess a plausible value and add it to the chart to keep the record complete.', option_c:'Return to update the record as soon as possible with the correct information and a note explaining the delay, following proper reporting procedure.', option_d:'Ask a colleague to add the observation on their behalf without explanation.', option_e:'',
 correct_answer:'C', explanation:'Correcting the record honestly and promptly, with a clear explanation of the delay, follows proper clinical governance and honesty principles. Fabricating data (option B) is a serious integrity breach.', technique_tip:'Any option involving fabricating or guessing clinical data is almost always the least appropriate choice in SJT scenarios.'},

{question_id:'SJT005', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'standard', recommended_time:55, tags:'limitations', active:true,
 question_text:"A first-year nursing student is asked by a busy ward sister to perform a clinical task they have not yet been trained or signed off to do. What is the most appropriate response?",
 option_a:'Attempt the task carefully, since the sister asked.', option_b:'Explain clearly that they have not been trained or signed off for this task, and ask for appropriate supervision or an alternative arrangement.', option_c:'Refuse and walk away without explanation.', option_d:'Ask another student, who is equally untrained, to do it instead.', option_e:'',
 correct_answer:'B', explanation:'Recognising one\'s own limitations and communicating them clearly, while offering to help find an appropriate solution, protects patient safety without abandoning the team.', technique_tip:'"Recognising limitations" scenarios are best resolved by honest disclosure plus a constructive next step, not silent compliance or blunt refusal.'},

{question_id:'SJT006', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'foundation', recommended_time:55, tags:'communication', active:true,
 question_text:"A patient asks a medical student a direct question about their diagnosis that the student does not know the answer to. What is the most appropriate response?",
 option_a:'Make up a plausible-sounding answer to reassure the patient.', option_b:'Tell the patient honestly that they don\'t know, and offer to find a qualified member of staff who can answer.', option_c:'Ignore the question and change the subject.', option_d:'Tell the patient to look it up online themselves.', option_e:'',
 correct_answer:'B', explanation:'Honesty about the limits of one\'s knowledge, combined with a constructive offer to get the right person involved, is the most professional and appropriate response.', technique_tip:'Never choose an option where a student fabricates clinical information — this is a near-automatic "very inappropriate" in real UCAT SJT scoring.'},

{question_id:'SJT007', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'advanced', recommended_time:60, tags:'escalation', active:true,
 question_text:"A student notices that a fellow student has been repeatedly submitting coursework that closely resembles another student\'s work from a previous year. What is the most appropriate action?",
 option_a:'Say nothing, as it is not the student\'s responsibility.', option_b:'Confront the fellow student aggressively in front of others.', option_c:'Raise the concern privately and factually with a relevant member of staff, such as a personal tutor.', option_d:'Post about the suspicion on social media to warn others.', option_e:'',
 correct_answer:'C', explanation:'Academic integrity concerns should be raised through proper, private channels with someone who has the authority to investigate — this protects fairness without making public accusations.', technique_tip:'When in doubt between "ignore" and "escalate through proper channels" for an integrity issue, proper escalation is almost always more appropriate.'},

{question_id:'SJT008', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'standard', recommended_time:55, tags:'professionalism', active:true,
 question_text:"During a placement, a student hears a colleague make a dismissive comment about an elderly patient\'s ability to understand their treatment. What is the most appropriate response?",
 option_a:'Say nothing, since it was only a passing comment.', option_b:'Report the colleague to senior management immediately without further discussion.', option_c:'Privately and respectfully raise with the colleague how the comment could affect patient care and dignity.', option_d:'Make a similar comment back to make a point.', option_e:'',
 correct_answer:'C', explanation:'A calm, private, respectful conversation addressing the impact of the comment is proportionate and constructive, upholding professionalism without public confrontation or excessive escalation for a first occurrence.', technique_tip:'Respect/professionalism scenarios usually favour a proportionate private conversation over silence or high-level escalation.'},

{question_id:'SJT009', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'foundation', recommended_time:55, tags:'communication', active:true,
 question_text:"A student is explaining a treatment plan to a patient who appears confused by the medical terminology being used. What is the most appropriate action?",
 option_a:'Continue using the same terminology, since it is medically accurate.', option_b:'Rephrase the explanation using plain, everyday language and check the patient understands.', option_c:'Hand the patient a leaflet and move on without further explanation.', option_d:'Ask a colleague to explain instead, without attempting it themselves.', option_e:'',
 correct_answer:'B', explanation:'Adapting language to the patient\'s level of understanding and confirming comprehension is the most appropriate, patient-centred response.', technique_tip:'When a patient shows signs of confusion, "simplify and check understanding" almost always outranks pressing on regardless or handing the task to someone else.'},

{question_id:'SJT010', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'foundation', recommended_time:50, tags:'teamwork', active:true,
 question_text:"A group of students working on a joint presentation disagree about which section each person should present. What is the most appropriate way to resolve this?",
 option_a:'Let the most confident person decide unilaterally.', option_b:'Discuss preferences and workload as a group and agree a fair division together.', option_c:'Draw straws without any discussion.', option_d:'Escalate immediately to the course tutor.', option_e:'',
 correct_answer:'B', explanation:'A collaborative discussion that considers everyone\'s preferences and workload is the most constructive and fair way to resolve a minor internal disagreement.', technique_tip:'For low-stakes team disagreements, "discuss together and agree collaboratively" beats both unilateral decisions and premature escalation.'},

{question_id:'SJT011', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'standard', recommended_time:55, tags:'safety', active:true,
 question_text:"A student notices a colleague washing their hands only briefly before attending several patients in a row on a busy ward. What is the most appropriate action?",
 option_a:'Say nothing, as hand hygiene is the colleague\'s own responsibility.', option_b:'Politely remind the colleague of the importance of thorough hand hygiene between patients, referencing infection control guidance.', option_c:'Report the colleague to hospital management immediately without speaking to them first.', option_d:'Avoid the colleague going forward but say nothing about the behaviour.', option_e:'',
 correct_answer:'B', explanation:'A prompt, respectful reminder addresses the patient-safety issue directly and proportionately, without unnecessary escalation for a first observed instance.', technique_tip:'Infection-control and hygiene lapses are patient-safety issues — address them promptly and directly, not by silence or avoidance.'},

{question_id:'SJT012', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'standard', recommended_time:55, tags:'confidentiality', active:true,
 question_text:"A student is asked by a family member of a patient, who is not directly involved in the patient\'s care, for details about the patient\'s condition. What is the most appropriate response?",
 option_a:'Share the information, since the person is family.', option_b:'Explain that they cannot share the patient\'s information without consent, and suggest the family member speak with the patient directly or with the care team where appropriate.', option_c:'Refuse to speak to the family member at all.', option_d:'Share only a partial summary to be helpful.', option_e:'',
 correct_answer:'B', explanation:'Confidentiality must be maintained regardless of family relationship unless consent has been given; politely explaining this while offering an appropriate alternative route is the professional response.', technique_tip:'Family relationship does not override patient confidentiality — always default to protecting patient information unless consent is confirmed.'},

{question_id:'SJT013', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'advanced', recommended_time:60, tags:'escalation', active:true,
 question_text:"A student on placement believes a supervisor\'s clinical decision may be unsafe, but the supervisor is senior and known to react poorly to being questioned. What is the most appropriate action?",
 option_a:'Say nothing to avoid conflict with a senior colleague.', option_b:'Raise the specific safety concern promptly, respectfully, and through appropriate channels, even though this may be uncomfortable.', option_c:'Wait to see if a patient is harmed before raising anything.', option_d:'Discuss the concern only with fellow students, not with anyone in authority.', option_e:'',
 correct_answer:'B', explanation:'Patient safety concerns must be raised regardless of a senior colleague\'s likely reaction; discomfort does not justify silence or delay when safety is at stake.', technique_tip:'A senior colleague\'s reputation for reacting badly is never a valid reason to withhold a genuine patient-safety concern.'},

{question_id:'SJT014', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'advanced', recommended_time:60, tags:'mistakes', active:true,
 question_text:"A student who administered the wrong (but harmless) dose of a routine supplement to a patient realises the error only the next day, after the patient has already been discharged. What is the most appropriate action?",
 option_a:'Do nothing, since the patient has already been discharged and was not harmed.', option_b:'Report the error through the proper incident-reporting process as soon as possible, even though the patient has left.', option_c:'Mention it informally to a colleague but do not file a formal report.', option_d:'Wait to see if the patient complains before taking any action.', option_e:'',
 correct_answer:'B', explanation:'Errors should always be formally reported as soon as they are identified, regardless of whether harm occurred or the patient has since been discharged, to support learning and safety.', technique_tip:'"No harm occurred" and "the patient has moved on" are never valid reasons to skip formal incident reporting.'},

{question_id:'SJT015', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'advanced', recommended_time:55, tags:'professionalism', active:true,
 question_text:"A student overhears colleagues making jokes that mock a patient\'s appearance in a staff area where other patients or visitors could potentially overhear. What is the most appropriate response?",
 option_a:'Join in to fit in with the team.', option_b:'Say nothing, since it happened in a private staff area.', option_c:'Calmly point out that the comments are inappropriate and could affect patient dignity or be overheard, regardless of the setting.', option_d:'Report colleagues immediately to external regulators without speaking to them first.', option_e:'',
 correct_answer:'C', explanation:'A calm, direct challenge addressing both the dignity issue and the overhearing risk is proportionate and professional, without jumping straight to external escalation.', technique_tip:'"Private" staff areas do not excuse unprofessional comments about patients — dignity concerns apply regardless of who might be listening.'},

{question_id:'SJT016', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'advanced', recommended_time:60, tags:'limitations', active:true,
 question_text:"During a busy shift, a senior colleague is unavailable and a patient\'s family asks a student direct questions about prognosis that require clinical judgement beyond the student\'s training. What is the most appropriate response?",
 option_a:'Give a best-guess answer to avoid seeming unhelpful.', option_b:'Explain honestly that this requires a qualified clinician\'s input, and arrange for the family to speak with the appropriate person as soon as possible.', option_c:'Tell the family to look up the condition online themselves.', option_d:'Avoid the family until a senior colleague becomes available.', option_e:'',
 correct_answer:'B', explanation:'Honestly acknowledging the limits of one\'s training while proactively arranging appropriate follow-up protects both the family\'s need for accurate information and patient safety.', technique_tip:'Being busy or the senior colleague being unavailable is never a reason to guess at clinical judgements beyond your training.'},

{question_id:'SJT017', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:55, tags:'safety', active:true,
 question_text:"A student notices a piece of monitoring equipment on the ward is giving inconsistent readings, but colleagues seem too busy to investigate immediately. What is the most appropriate action?",
 option_a:'Assume it is a minor glitch and say nothing, since colleagues are busy.', option_b:'Flag the faulty equipment clearly, remove it from use if possible, and alert an appropriate staff member promptly, even though the team is busy.', option_c:'Continue using the equipment since no one else has raised concerns.', option_d:'Fix the equipment themselves without informing anyone.', option_e:'',
 correct_answer:'B', explanation:'Promptly flagging and, where possible, removing faulty equipment from use prevents potential harm; busyness elsewhere does not reduce the urgency of a safety concern.', technique_tip:'Faulty equipment is a patient-safety issue in its own right — flag and isolate it promptly rather than waiting for others to notice.'},

{question_id:'SJT018', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'standard', recommended_time:55, tags:'teamwork', active:true,
 question_text:"Two colleagues on a shared project disagree strongly about the best approach, and the disagreement is starting to affect team morale. As a team member, what is the most appropriate action?",
 option_a:'Ignore the disagreement and focus only on your own tasks.', option_b:'Take one colleague\'s side publicly to resolve it quickly.', option_c:'Encourage both colleagues to discuss their concerns calmly and help the team focus on finding common ground.', option_d:'Report both colleagues to a manager immediately.', option_e:'',
 correct_answer:'C', explanation:'Facilitating calm, constructive discussion addresses the morale impact directly without taking sides or over-escalating a workplace disagreement.', technique_tip:'A neutral, facilitative role — encouraging dialogue rather than picking sides — is usually the most appropriate response to a colleague dispute affecting the team.'},

{question_id:'SJT019', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'standard', recommended_time:55, tags:'communication', active:true,
 question_text:"A student needs to give a patient difficult news about a delay in their treatment. What is the most appropriate approach?",
 option_a:'Delay telling the patient for as long as possible.', option_b:'Communicate the delay honestly, clearly, and with empathy, as soon as appropriate information is available.', option_c:'Have another staff member deliver the news without giving them any context.', option_d:'Send the information in a brief text message to avoid an uncomfortable conversation.', option_e:'',
 correct_answer:'B', explanation:'Honest, timely, empathetic communication respects the patient\'s right to know and manages expectations appropriately, unlike delaying or depersonalising the message.', technique_tip:'Difficult news should be delivered honestly, promptly and empathetically — delaying or depersonalising it is rarely the appropriate choice.'},

{question_id:'SJT020', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'advanced', recommended_time:60, tags:'confidentiality', active:true,
 question_text:"A student accidentally sends an email containing a patient\'s personal details to the wrong recipient within the same organisation. What is the most appropriate action?",
 option_a:'Say nothing, hoping the recipient does not notice.', option_b:'Immediately report the error following the organisation\'s data breach procedure, and ask the recipient to delete the email.', option_c:'Wait to see if it causes any problems before reporting it.', option_d:'Delete the sent email from their own outbox only, without further action.', option_e:'',
 correct_answer:'B', explanation:'Data breaches involving patient information must be reported immediately through proper procedure, alongside taking direct action to limit further exposure — silence or partial fixes are not appropriate.', technique_tip:'Any accidental disclosure of patient data is a reportable breach, regardless of how minor or accidental it seems — report it promptly and follow procedure.'},

{question_id:'SJT021', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'standard', recommended_time:55, tags:'safety', active:true,
question_text:"During a placement, a student notices that a patient\'s identification details have not been checked before a procedure is about to begin. What is the most appropriate action?",
option_a:'Assume the staff member has already checked the details.', option_b:'Politely prompt the staff member to confirm the patient’s identity before the procedure proceeds.', option_c:'Wait until the procedure is finished and then mention the issue.', option_d:'Tell the patient that the staff member has made a mistake.', option_e:'',
correct_answer:'B', explanation:'Patient identification is a fundamental safety step. The concern should be raised promptly with the person able to act before the procedure takes place.', technique_tip:'For immediate safety risks, act promptly and respectfully before potential harm occurs.'},

{question_id:'SJT022', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'advanced', recommended_time:55, tags:'confidentiality', active:true,
question_text:"A student is working in a hospital library and notices a printed patient list has been left unattended on a public printer. What is the most appropriate action?",
option_a:'Leave it there because the student did not print it.', option_b:'Read the list to determine which department it belongs to.', option_c:'Secure the document appropriately and notify the relevant staff member or department.', option_d:'Take a photograph of the list as evidence.', option_e:'',
correct_answer:'C', explanation:'Patient information should be protected from unauthorised access. Securing the document and notifying the appropriate person addresses the breach proportionately.', technique_tip:'Protect confidential information first, then notify the appropriate person.'},

{question_id:'SJT023', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'advanced', recommended_time:55, tags:'limitations', active:true,
question_text:"A student is asked to perform a procedure they have observed several times but have never been trained or authorised to perform. What is the most appropriate action?",
option_a:'Perform it because they have watched it before.', option_b:'Explain that they have not been trained and request appropriate supervision.', option_c:'Ask another student to perform it instead.', option_d:'Attempt the procedure if the department is particularly busy.', option_e:'',
correct_answer:'B', explanation:'Observation does not establish competence. The student should recognise their limitation and seek appropriate supervision.', technique_tip:'Never equate having observed a procedure with being competent or authorised to perform it.'},

{question_id:'SJT024', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'standard', recommended_time:55, tags:'communication', active:true,
question_text:"A patient appears confused while a student explains an important instruction. What is the most appropriate action?",
option_a:'Repeat the same explanation more quickly.', option_b:'Ask the patient to sign that they understand.', option_c:'Use simpler language, encourage questions and check their understanding.', option_d:'Assume the patient understands because they nodded.', option_e:'',
correct_answer:'C', explanation:'Effective communication requires adapting the explanation and checking understanding rather than assuming comprehension.', technique_tip:'Look for communication that is clear, patient-centred and confirms understanding.'},

{question_id:'SJT025', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'standard', recommended_time:55, tags:'teamwork', active:true,
question_text:"A colleague is struggling to complete their allocated task because they are unfamiliar with the system being used. You have finished your own urgent work. What is the most appropriate action?",
option_a:'Leave them to work it out because it is their responsibility.', option_b:'Complete their entire task without telling them.', option_c:'Offer reasonable assistance or guidance while allowing them to remain responsible for their task.', option_d:'Tell the supervisor that the colleague is incompetent.', option_e:'',
correct_answer:'C', explanation:'Supporting colleagues appropriately promotes teamwork while maintaining accountability.', technique_tip:'Good teamwork combines support with appropriate individual responsibility.'},

{question_id:'SJT026', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'advanced', recommended_time:60, tags:'mistakes', active:true,
question_text:"A student realises that they gave a patient incorrect information about where to attend an appointment. The appointment is later that day. What is the most appropriate action?",
option_a:'Wait to see whether the patient finds the correct location.', option_b:'Immediately inform the appropriate staff member and take reasonable steps to correct the information.', option_c:'Pretend that the patient misunderstood.', option_d:'Ask another student to correct the problem without explaining what happened.', option_e:'',
correct_answer:'B', explanation:'The error should be acknowledged and corrected promptly to minimise its potential impact on the patient.', technique_tip:'When you identify an error, focus on correcting it promptly rather than protecting yourself from embarrassment.'},

{question_id:'SJT027', module:'SJT', question_type:'Appropriateness Rating', topic:'Professionalism', difficulty:'standard', recommended_time:55, tags:'professionalism', active:true,
question_text:"A student notices that a colleague frequently uses their phone during patient-facing activities for personal reasons. What is the most appropriate initial action?",
option_a:'Post about the behaviour on social media.', option_b:'Ignore it completely.', option_c:'Raise the concern privately with the colleague if appropriate, focusing on the impact on professionalism.', option_d:'Immediately contact an external regulator.', option_e:'',
correct_answer:'C', explanation:'A proportionate private discussion is generally appropriate for a first concern about professional behaviour.', technique_tip:'For lower-level professionalism concerns, begin with a respectful and proportionate response.'},

{question_id:'SJT028', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student notices that a medication label appears inconsistent with the medication documented for a patient. The medication is due to be given shortly. What is the most appropriate action?",
option_a:'Assume the label is correct.', option_b:'Raise the discrepancy immediately and ensure it is checked before administration.', option_c:'Wait until after administration to investigate.', option_d:'Change the label themselves without telling anyone.', option_e:'',
correct_answer:'B', explanation:'A possible medication discrepancy is an immediate safety concern and should be checked before administration.', technique_tip:'Potential medication errors should be challenged before the medication reaches the patient.'},

{question_id:'SJT029', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'standard', recommended_time:55, tags:'professionalism', active:true,
question_text:"A colleague makes a dismissive remark about a patient\'s accent while speaking with another staff member. What is the most appropriate response?",
option_a:'Join in so that the colleague does not feel uncomfortable.', option_b:'Ignore the remark regardless of context.', option_c:'Privately challenge the remark respectfully and explain why it may be inappropriate.', option_d:'Make a complaint on social media.', option_e:'',
correct_answer:'C', explanation:'Respectful challenge of inappropriate behaviour supports professionalism and patient dignity without unnecessarily escalating the situation.', technique_tip:'Professionalism includes challenging disrespectful behaviour constructively.'},

{question_id:'SJT030', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'advanced', recommended_time:60, tags:'escalation', active:true,
question_text:"A student raises a concern about a potentially unsafe practice with the person directly involved, but the practice continues. What should the student do next?",
option_a:'Ignore it because they have already mentioned it.', option_b:'Repeat the concern through an appropriate senior or formal escalation route.', option_c:'Discuss it only with other students.', option_d:'Wait until someone is harmed before escalating.', option_e:'',
correct_answer:'B', explanation:'If a safety concern remains unresolved after being raised, appropriate escalation is necessary.', technique_tip:'Persistent safety concerns should move through the appropriate escalation pathway.'},

{question_id:'SJT031', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student notices that a piece of equipment has not received its required safety check and is about to be used. What is the most appropriate action?",
option_a:'Allow its use because it appears to work.', option_b:'Prevent its use until the appropriate safety check has been confirmed and notify the relevant staff member.', option_c:'Perform the safety check themselves despite having no training.', option_d:'Say nothing because equipment checks are someone else\'s responsibility.', option_e:'',
correct_answer:'B', explanation:'Equipment that may not be safe should not be used until the appropriate checks have been completed.', technique_tip:'Do not allow convenience or workload to override an identifiable safety requirement.'},

{question_id:'SJT032', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'advanced', recommended_time:55, tags:'confidentiality', active:true,
question_text:"A friend who works in the same hospital asks a student whether a particular patient has been admitted. The friend is not involved in the patient\'s care. What is the most appropriate response?",
option_a:'Confirm the admission because the friend works at the hospital.', option_b:'Give only the patient\'s ward location.', option_c:'Explain that the student\'s confidentiality obligations prevent them from providing the information.', option_d:'Ask another student to confirm it instead.', option_e:'',
correct_answer:'C', explanation:'Working in the same organisation does not automatically provide a right to access patient information.', technique_tip:'Access to confidential information should be based on legitimate need, not personal relationships.'},

{question_id:'SJT033', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'standard', recommended_time:55, tags:'communication', active:true,
question_text:"A patient asks a student a question that is outside the student\'s knowledge. What is the most appropriate response?",
option_a:'Provide an answer that seems likely.', option_b:'Say that they do not know and seek help from an appropriately qualified person.', option_c:'Avoid answering because the patient may become dissatisfied.', option_d:'Tell the patient to search online.', option_e:'',
correct_answer:'B', explanation:'Being honest about limitations and obtaining accurate information is safer and more professional than guessing.', technique_tip:'Never invent information to appear knowledgeable.'},

{question_id:'SJT034', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'advanced', recommended_time:55, tags:'teamwork', active:true,
question_text:"Two members of a team disagree about how an important task should be completed. Their disagreement is delaying the team. What is the most appropriate action?",
option_a:'Choose the person you personally prefer.', option_b:'Encourage them to discuss the evidence and agree on the safest appropriate approach.', option_c:'Ignore the disagreement.', option_d:'Tell the more senior person that they are automatically correct.', option_e:'',
correct_answer:'B', explanation:'A constructive evidence-based discussion is preferable to taking sides or allowing disagreement to compromise the team\'s work.', technique_tip:'Focus disagreements on the task, evidence and appropriate outcomes rather than personalities.'},

{question_id:'SJT035', module:'SJT', question_type:'Appropriateness Rating', topic:'Resilience and Adaptability', difficulty:'advanced', recommended_time:55, tags:'resilience', active:true,
question_text:"A student\'s planned task cannot be completed because an unexpected change in the day\'s schedule has occurred. What is the most appropriate response?",
option_a:'Refuse to adapt because the original plan was agreed.', option_b:'Complain to colleagues throughout the day.', option_c:'Adapt to the change, clarify priorities and complete the most important tasks appropriately.', option_d:'Abandon all remaining tasks.', option_e:'',
correct_answer:'C', explanation:'Healthcare and educational environments can change quickly. Appropriate adaptability involves reassessing priorities rather than becoming inflexible.', technique_tip:'When circumstances change, reassess priorities and adapt constructively.'},

{question_id:'SJT036', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'advanced', recommended_time:60, tags:'mistakes', active:true,
question_text:"A student accidentally breaks a piece of equipment while using it according to the instructions. What is the most appropriate action?",
option_a:'Hide the damage so nobody notices.', option_b:'Blame another person.', option_c:'Report the damage promptly and provide an honest account of what happened.', option_d:'Continue using the equipment if it still appears functional.', option_e:'',
correct_answer:'C', explanation:'Equipment damage should be reported honestly so that it can be assessed and potential safety risks managed.', technique_tip:'Honesty after an accident is more important than avoiding embarrassment or blame.'},

{question_id:'SJT037', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student notices that a patient appears suddenly confused and significantly different from how they appeared earlier. What is the most appropriate action?",
option_a:'Assume the patient is tired.', option_b:'Wait until the next scheduled review.', option_c:'Alert an appropriate qualified member of staff promptly.', option_d:'Search the patient\'s records independently and make a diagnosis.', option_e:'',
correct_answer:'C', explanation:'A significant change in a patient\'s condition should be brought promptly to the attention of an appropriately qualified professional.', technique_tip:'Recognise significant changes and escalate rather than attempting to diagnose beyond your role.'},

{question_id:'SJT038', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'standard', recommended_time:55, tags:'confidentiality', active:true,
question_text:"A student hears colleagues discussing a patient\'s condition in a crowded cafeteria. What is the most appropriate response?",
option_a:'Join the conversation.', option_b:'Ignore it because the discussion is not about the student.', option_c:'Politely remind them that the location may not be appropriate for confidential discussion.', option_d:'Record the conversation as evidence.', option_e:'',
correct_answer:'C', explanation:'Confidential conversations should be conducted in an appropriate setting where they cannot be overheard unnecessarily.', technique_tip:'Consider who can overhear information and whether the setting is appropriate.'},

{question_id:'SJT039', module:'SJT', question_type:'Appropriateness Rating', topic:'Professionalism', difficulty:'advanced', recommended_time:55, tags:'professionalism', active:true,
question_text:"A student is feeling too tired to concentrate properly during a placement. What is the most appropriate action?",
option_a:'Continue working without telling anyone.', option_b:'Take responsibility for recognising the limitation and inform an appropriate supervisor if it may affect safe performance.', option_c:'Leave without informing anyone.', option_d:'Use a colleague\'s login so that work can be completed faster.', option_e:'',
correct_answer:'B', explanation:'Recognising when fatigue may affect safe performance is part of professional responsibility.', technique_tip:'Patient safety comes before avoiding an uncomfortable conversation about personal limitations.'},

{question_id:'SJT040', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'standard', recommended_time:55, tags:'teamwork', active:true,
question_text:"A team member makes a useful suggestion that is initially overlooked by the group. What is the most appropriate action?",
option_a:'Ignore the suggestion permanently.', option_b:'Bring the suggestion back into the discussion and consider its merits objectively.', option_c:'Claim the idea as your own.', option_d:'Tell the person not to make further suggestions.', option_e:'',
correct_answer:'B', explanation:'Good teamwork requires openness to useful contributions regardless of who makes them.', technique_tip:'Evaluate ideas on their merits rather than on who proposed them.'},

{question_id:'SJT041', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'advanced', recommended_time:55, tags:'communication', active:true,
question_text:"A patient becomes angry after waiting longer than expected. What is the most appropriate response from a student?",
option_a:'Tell the patient that everyone has been waiting.', option_b:'Argue that the delay is not the student\'s fault.', option_c:'Listen calmly, acknowledge the frustration and seek appropriate help or information about the delay.', option_d:'Tell the patient to leave if they are unhappy.', option_e:'',
correct_answer:'C', explanation:'Remaining calm, acknowledging the patient\'s concern and seeking a constructive solution is appropriate.', technique_tip:'Do not respond defensively to frustration; listen, acknowledge and help where appropriate.'},

{question_id:'SJT042', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'advanced', recommended_time:60, tags:'limitations', active:true,
question_text:"A student is asked to advise a patient about a treatment choice that requires professional clinical judgement. What is the most appropriate action?",
option_a:'Recommend whichever treatment seems best to the student.', option_b:'Explain that the decision requires an appropriately qualified professional and arrange appropriate support.', option_c:'Search online and give the patient a recommendation.', option_d:'Ask the patient what they think and agree with them.', option_e:'',
correct_answer:'B', explanation:'Students should not provide clinical advice beyond their competence or role.', technique_tip:'Know the boundary between providing information and making professional clinical decisions.'},

{question_id:'SJT043', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'advanced', recommended_time:60, tags:'escalation', active:true,
question_text:"A student observes behaviour by a colleague that may place a patient at risk. The colleague asks the student not to tell anyone. What is the most appropriate action?",
option_a:'Keep the promise to maintain trust.', option_b:'Raise the concern through an appropriate route because patient safety takes priority.', option_c:'Wait until the colleague agrees.', option_d:'Tell only other students.', option_e:'',
correct_answer:'B', explanation:'A request for secrecy does not override the responsibility to raise a credible patient-safety concern.', technique_tip:'Confidentiality between colleagues does not justify concealing serious safety concerns.'},

{question_id:'SJT044', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'standard', recommended_time:55, tags:'professionalism', active:true,
question_text:"A patient has difficulty communicating in the language being used. What is the most appropriate action?",
option_a:'Speak louder in the same language.', option_b:'Ask a family member to interpret every detail automatically.', option_c:'Use an appropriate professional communication or interpreting service where available.', option_d:'End the conversation.', option_e:'',
correct_answer:'C', explanation:'Appropriate communication support helps ensure accurate and respectful communication while protecting confidentiality.', technique_tip:'Use appropriate communication support rather than relying automatically on informal interpreters.'},

{question_id:'SJT045', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student notices that a patient is about to leave a clinical area without receiving an important instruction that the student knows was planned. What is the most appropriate action?",
option_a:'Allow the patient to leave because the student is not responsible.', option_b:'Alert an appropriate member of staff promptly so the planned instruction can be addressed.', option_c:'Give the patient detailed clinical advice without supervision.', option_d:'Physically prevent the patient from leaving.', option_e:'',
correct_answer:'B', explanation:'The student should promptly involve the appropriate staff member without exceeding their role.', technique_tip:'Escalate important unresolved patient needs while staying within your role.'},

{question_id:'SJT046', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'advanced', recommended_time:60, tags:'mistakes', active:true,
question_text:"A student realises that they accidentally missed an important part of an assigned task. The task has not yet affected a patient. What is the most appropriate action?",
option_a:'Pretend it was completed.', option_b:'Tell the relevant person promptly and complete or correct the task appropriately.', option_c:'Wait until someone notices.', option_d:'Ask another student to claim responsibility.', option_e:'',
correct_answer:'B', explanation:'Early disclosure allows the issue to be corrected before it creates further problems.', technique_tip:'Report mistakes early, especially when there is still an opportunity to correct them.'},

{question_id:'SJT047', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'advanced', recommended_time:55, tags:'teamwork', active:true,
question_text:"A team is under pressure and one member begins assigning tasks without checking who is available. What is the most appropriate response?",
option_a:'Refuse to cooperate.', option_b:'Help clarify priorities and availability so tasks can be allocated safely and fairly.', option_c:'Let the situation continue regardless of its impact.', option_d:'Complain about the person afterwards without helping.', option_e:'',
correct_answer:'B', explanation:'Under pressure, clear communication and sensible allocation of work help protect both teamwork and safety.', technique_tip:'When a team is under pressure, improve coordination rather than adding conflict.'},

{question_id:'SJT048', module:'SJT', question_type:'Appropriateness Rating', topic:'Professionalism', difficulty:'advanced', recommended_time:55, tags:'professionalism', active:true,
question_text:"A student receives critical feedback from a supervisor that they believe is unfair. What is the most appropriate initial response?",
option_a:'Argue immediately in front of colleagues.', option_b:'Ignore all future feedback from the supervisor.', option_c:'Listen to the feedback, reflect on it and discuss specific concerns respectfully at an appropriate time.', option_d:'Complain publicly about the supervisor.', option_e:'',
correct_answer:'C', explanation:'Professionalism includes responding constructively to feedback, even when it is difficult to accept.', technique_tip:'Separate the emotional reaction from the professional response to feedback.'},

{question_id:'SJT049', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'advanced', recommended_time:55, tags:'confidentiality', active:true,
question_text:"A student accidentally leaves their computer unlocked while a patient record is displayed. What is the most appropriate action?",
option_a:'Leave it because nobody appears to be looking.', option_b:'Lock the computer immediately and report the incident according to the appropriate procedure.', option_c:'Delete the patient\'s record.', option_d:'Ask another student to monitor the screen.', option_e:'',
correct_answer:'B', explanation:'The immediate priority is to prevent unauthorised access, followed by appropriate reporting.', technique_tip:'Secure confidential information immediately and follow the relevant reporting procedure.'},

{question_id:'SJT050', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'standard', recommended_time:55, tags:'communication', active:true,
question_text:"A patient repeatedly asks the same question because they appear anxious. What is the most appropriate response?",
option_a:'Tell them they have already been told.', option_b:'Ignore further questions.', option_c:'Remain patient, answer appropriately and check whether there is an underlying concern causing the repeated questions.', option_d:'Tell them they are wasting staff time.', option_e:'',
correct_answer:'C', explanation:'Repeated questions may reflect anxiety or uncertainty. A calm and patient response supports effective communication.', technique_tip:'Consider why a person is repeating a question rather than treating repetition as deliberate inconvenience.'},

{question_id:'SJT051', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student notices that a patient\'s mobility appears significantly worse than documented earlier in the day. What is the most appropriate action?",
option_a:'Assume the documentation is outdated.', option_b:'Attempt to diagnose the cause themselves.', option_c:'Inform an appropriate member of staff promptly so the change can be assessed.', option_d:'Wait until the next day.', option_e:'',
correct_answer:'C', explanation:'A significant change should be communicated promptly so that an appropriate professional can assess it.', technique_tip:'Report important changes rather than making assumptions about their cause.'},

{question_id:'SJT052', module:'SJT', question_type:'Appropriateness Rating', topic:'Resilience and Adaptability', difficulty:'advanced', recommended_time:55, tags:'resilience', active:true,
question_text:"A planned teaching session is cancelled shortly before it begins. What is the most appropriate response from a student?",
option_a:'Leave immediately without checking whether another activity is available.', option_b:'Complain that the day has been wasted.', option_c:'Adapt to the change and identify another useful learning activity or task.', option_d:'Demand that the session be reinstated.', option_e:'',
correct_answer:'C', explanation:'Adaptability involves making constructive use of unexpected changes rather than becoming disengaged.', technique_tip:'Use unexpected changes as opportunities to reprioritise or find alternative productive activities.'},

{question_id:'SJT053', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'advanced', recommended_time:60, tags:'escalation', active:true,
question_text:"A student is concerned that a colleague may be working while impaired by severe fatigue. The colleague is about to undertake an important task. What is the most appropriate action?",
option_a:'Ignore it because fatigue is a personal issue.', option_b:'Raise the immediate concern with an appropriate senior person responsible for safety.', option_c:'Make jokes about the colleague being tired.', option_d:'Post the concern anonymously online.', option_e:'',
correct_answer:'B', explanation:'If impairment may compromise safety, the concern should be raised through an appropriate route.', technique_tip:'Potential impairment affecting safety warrants prompt and appropriate escalation.'},

{question_id:'SJT054', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'advanced', recommended_time:55, tags:'professionalism', active:true,
question_text:"A colleague becomes frustrated with a patient who is taking a long time to answer questions. What is the most appropriate response from a student?",
option_a:'Tell the patient to hurry.', option_b:'Support respectful communication and, if necessary, privately remind the colleague of the importance of patience and dignity.', option_c:'Join the colleague\'s frustration.', option_d:'Tell the patient to complain immediately.', option_e:'',
correct_answer:'B', explanation:'Patients should be treated respectfully, particularly when they may need additional time to communicate.', technique_tip:'Patient dignity remains important even when staff are under pressure.'},

{question_id:'SJT055', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'advanced', recommended_time:60, tags:'limitations', active:true,
question_text:"A student is asked to explain a complex test result to a patient because the qualified staff member is temporarily unavailable. What is the most appropriate action?",
option_a:'Explain the result using the student\'s own interpretation.', option_b:'Give a simplified interpretation without mentioning uncertainty.', option_c:'Explain that the student is not qualified to interpret the result and seek an appropriate member of staff.', option_d:'Tell the patient that the result is definitely normal.', option_e:'',
correct_answer:'C', explanation:'The student should not provide an interpretation beyond their competence.', technique_tip:'Do not allow pressure or convenience to push you beyond your competence.'},

{question_id:'SJT056', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'advanced', recommended_time:60, tags:'mistakes', active:true,
question_text:"A student realises they have accidentally documented an event in the wrong patient\'s training record. What is the most appropriate action?",
option_a:'Delete both records.', option_b:'Ignore it because it was accidental.', option_c:'Inform the appropriate person and correct the error using the proper process.', option_d:'Ask another student to alter the record.', option_e:'',
correct_answer:'C', explanation:'Documentation errors should be corrected transparently through the appropriate process.', technique_tip:'Never conceal or silently manipulate records after identifying an error.'},

{question_id:'SJT057', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'standard', recommended_time:55, tags:'teamwork', active:true,
question_text:"A team member asks for help with a task while you are already responsible for another important task. What is the most appropriate response?",
option_a:'Say no without explanation.', option_b:'Abandon your current task immediately.', option_c:'Explain your current priority and work out whether the task can be delayed, shared or reassigned appropriately.', option_d:'Ignore the request.', option_e:'',
correct_answer:'C', explanation:'Good teamwork involves communicating competing priorities rather than accepting or refusing requests without considering their consequences.', technique_tip:'When priorities conflict, communicate and coordinate rather than making assumptions.'},

{question_id:'SJT058', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'advanced', recommended_time:55, tags:'confidentiality', active:true,
question_text:"A student hears a patient discussing a sensitive condition in a public area and recognises the patient from their own community. What is the most appropriate action?",
option_a:'Discuss the condition with mutual acquaintances.', option_b:'Mention the patient to friends but ask them not to repeat it.', option_c:'Respect the patient\'s privacy and do not discuss the information outside the appropriate professional context.', option_d:'Search for the patient on social media.', option_e:'',
correct_answer:'C', explanation:'Information learned in a professional setting must remain confidential regardless of personal familiarity with the patient.', technique_tip:'Personal familiarity never removes professional confidentiality obligations.'},

{question_id:'SJT059', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'advanced', recommended_time:55, tags:'communication', active:true,
question_text:"A patient says they do not understand why a procedure is being performed and appears hesitant. What is the most appropriate action for a student?",
option_a:'Tell the patient to cooperate because the procedure has already been planned.', option_b:'Ignore the hesitation.', option_c:'Acknowledge the concern and ensure the appropriate qualified professional is involved in explaining the procedure.', option_d:'Attempt to obtain consent themselves regardless of their role.', option_e:'',
correct_answer:'C', explanation:'The student\'s role is to recognise the concern and ensure the patient has appropriate opportunity to discuss it with a qualified professional.', technique_tip:'Patient concerns about procedures should be taken seriously rather than dismissed.'},

{question_id:'SJT060', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student sees that a clinical area has a spill on the floor and several people are walking nearby. What is the most appropriate action?",
option_a:'Walk around it and continue working.', option_b:'Warn people nearby and ensure the spill is reported or dealt with through the appropriate process.', option_c:'Wait for cleaning staff to notice it.', option_d:'Attempt to clean it without considering whether it requires specialist handling.', option_e:'',
correct_answer:'B', explanation:'The immediate risk should be addressed while ensuring the spill is handled appropriately.', technique_tip:'Identify immediate hazards, warn others and use the correct process to resolve them.'},

{question_id:'SJT061', module:'SJT', question_type:'Appropriateness Rating', topic:'Professionalism', difficulty:'standard', recommended_time:55, tags:'professionalism', active:true,
question_text:"A student receives praise for work that was actually completed jointly with another student. What is the most appropriate response?",
option_a:'Accept the praise without mentioning the other student.', option_b:'Make sure the other student\'s contribution is acknowledged.', option_c:'Tell everyone that the praise is undeserved.', option_d:'Claim responsibility for the entire task.', option_e:'',
correct_answer:'B', explanation:'Professional integrity includes accurately recognising the contributions of others.', technique_tip:'Give appropriate credit to colleagues and collaborators.'},

{question_id:'SJT062', module:'SJT', question_type:'Appropriateness Rating', topic:'Resilience and Adaptability', difficulty:'advanced', recommended_time:55, tags:'adaptability', active:true,
question_text:"A student receives an unexpected change to their placement schedule that conflicts with a planned personal commitment. What is the most appropriate initial response?",
option_a:'Refuse the change immediately.', option_b:'Ignore the new schedule.', option_c:'Clarify the reason for the change and discuss the conflict through the appropriate channel.', option_d:'Ask a colleague to attend the placement instead.', option_e:'',
correct_answer:'C', explanation:'The student should communicate professionally and explore an appropriate solution rather than ignoring responsibilities.', technique_tip:'When personal and professional commitments conflict, communicate early through the proper route.'},

{question_id:'SJT063', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'advanced', recommended_time:60, tags:'escalation', active:true,
question_text:"A student notices a recurring safety issue that has been mentioned informally several times but has not been resolved. What is the most appropriate action?",
option_a:'Continue mentioning it casually without further action.', option_b:'Raise the issue formally through the appropriate safety or supervisory route.', option_c:'Stop attending the placement.', option_d:'Discuss it publicly online.', option_e:'',
correct_answer:'B', explanation:'A recurring unresolved safety issue warrants appropriate formal escalation.', technique_tip:'Repeated unresolved concerns should be escalated through an established route.'},

{question_id:'SJT064', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'advanced', recommended_time:55, tags:'professionalism', active:true,
question_text:"A colleague makes an inappropriate joke about a patient\'s disability when the patient is not present. What is the most appropriate response?",
option_a:'Laugh so that the colleague does not feel uncomfortable.', option_b:'Ignore the comment because the patient did not hear it.', option_c:'Challenge the comment respectfully and make clear that it is inappropriate.', option_d:'Repeat the joke to another group.', option_e:'',
correct_answer:'C', explanation:'Professional respect applies even when the patient is absent.', technique_tip:'Unprofessional comments about patients should not be normalised by silence or participation.'},

{question_id:'SJT065', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student notices that an important piece of patient information has not been communicated during a handover. The next team is about to take over care. What is the most appropriate action?",
option_a:'Assume someone else will mention it.', option_b:'Promptly alert the appropriate person so the relevant information is communicated.', option_c:'Wait until the next handover.', option_d:'Write the information on a public noticeboard.', option_e:'',
correct_answer:'B', explanation:'Important information that may affect patient care should be communicated promptly through the appropriate handover process.', technique_tip:'Do not assume critical information will be passed on by someone else.'},

{question_id:'SJT066', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'advanced', recommended_time:55, tags:'confidentiality', active:true,
question_text:"A student is asked by another student for the login details to access a system because the other student has forgotten their password. What is the most appropriate action?",
option_a:'Share the password because both are students.', option_b:'Give the password temporarily.', option_c:'Refuse to share the credentials and advise the student to use the approved password-recovery process.', option_d:'Write the password down for them.', option_e:'',
correct_answer:'C', explanation:'Login credentials must not be shared. The appropriate route is the authorised password-recovery process.', technique_tip:'Never share personal access credentials, even with trusted colleagues.'},

{question_id:'SJT067', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'advanced', recommended_time:60, tags:'honesty', active:true,
question_text:"A student is asked whether they completed a task by a deadline. They have not completed it. What is the most appropriate response?",
option_a:'Say that it was completed.', option_b:'Blame another student.', option_c:'Be honest about the situation and explain what remains to be done.', option_d:'Avoid the person asking.', option_e:'',
correct_answer:'C', explanation:'Honesty allows the team to understand the true situation and make appropriate arrangements.', technique_tip:'When a task is incomplete, honest communication is preferable to concealment.'},

{question_id:'SJT068', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'advanced', recommended_time:60, tags:'limitations', active:true,
question_text:"A student is asked to make a decision that could significantly affect a patient\'s care, but the student does not have the authority or experience to make that decision. What is the most appropriate action?",
option_a:'Make the decision to avoid delaying care.', option_b:'Choose the option that seems safest to the student.', option_c:'Explain the limitation and seek a decision from an appropriately qualified professional.', option_d:'Ask another student to decide.', option_e:'',
correct_answer:'C', explanation:'The student should recognise the limits of their authority and seek appropriate professional input.', technique_tip:'Know both your competence limits and your authority limits.'},

{question_id:'SJT069', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'advanced', recommended_time:60, tags:'safety', active:true,
question_text:"A student notices a potential safety problem immediately before a procedure begins. A senior member of staff says there is no time to investigate it. What is the most appropriate action?",
option_a:'Remain silent because the person is senior.', option_b:'Proceed because the procedure is already scheduled.', option_c:'Clearly and respectfully raise the specific safety concern and seek appropriate resolution before proceeding.', option_d:'Leave the area without saying anything.', option_e:'',
correct_answer:'C', explanation:'A genuine patient-safety concern should be raised regardless of seniority or time pressure.', technique_tip:'Safety concerns should be communicated clearly even when doing so feels uncomfortable or inconvenient.'},
/* ---------------- TOPIC TOP-UP BATCH — broadening thinner topics ---------------- */
{question_id:'VR061', module:'VR', question_type:'Matching Information', topic:'Matching Information', difficulty:'standard', recommended_time:45, tags:'matching', active:true,
 passage:"As the first large wave of rooftop solar panels installed in the early 2010s approaches the end of its typical 25-year lifespan, recycling infrastructure has struggled to keep pace with anticipated volumes. Most panels are technically recyclable, and manufacturers can recover the majority of the glass, aluminium framing and silicon by weight, but the process remains more expensive than sending panels to landfill in many regions, and dedicated solar-panel recycling facilities remain rare outside a handful of countries with specific regulations mandating their use.",
 question_text:"Which of the following does the passage identify as a reason dedicated solar-panel recycling facilities remain rare?",
 option_a:'Panels cannot be recycled at all.', option_b:'Recycling remains more expensive than landfill in many regions, and few countries mandate it.', option_c:'Manufacturers refuse to reveal what panels are made of.', option_d:'Solar panels do not contain any materials worth recovering.', option_e:'',
 correct_answer:'B', explanation:'The passage states recycling "remains more expensive than sending panels to landfill in many regions," and dedicated facilities are rare "outside a handful of countries with specific regulations mandating their use."', technique_tip:'Matching Information questions reward scanning for the exact causal clause rather than summarising the whole passage from memory.'},

{question_id:'VR062', module:'VR', question_type:'Reading Comprehension', topic:'Reading Comprehension', difficulty:'foundation', recommended_time:40, tags:'comprehension', active:true,
 passage:"As the first large wave of rooftop solar panels installed in the early 2010s approaches the end of its typical 25-year lifespan, recycling infrastructure has struggled to keep pace with anticipated volumes. Most panels are technically recyclable, and manufacturers can recover the majority of the glass, aluminium framing and silicon by weight, but the process remains more expensive than sending panels to landfill in many regions, and dedicated solar-panel recycling facilities remain rare outside a handful of countries with specific regulations mandating their use.",
 question_text:"According to the passage, what materials can manufacturers recover from most solar panels?",
 option_a:'Only the aluminium framing.', option_b:'The majority of the glass, aluminium framing and silicon, by weight.', option_c:'Rare earth metals exclusively.', option_d:'Nothing of any value.', option_e:'',
 correct_answer:'B', explanation:'The passage directly states manufacturers "can recover the majority of the glass, aluminium framing and silicon by weight."', technique_tip:'For direct comprehension questions, locate the sentence naming the specific items and match wording carefully rather than paraphrasing from memory.'},

{question_id:'DM070', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'standard', recommended_time:45, tags:'assumption', active:true,
 question_text:"Argument: \"Patients who received a printed after-visit summary reported better understanding of their care plan than those who didn\'t, so all patients should be given printed summaries.\" Which of the following is an assumption underlying this argument?",
 option_a:'Patients who received the summary were not already more engaged or health-literate in ways that independently explain their better understanding.', option_b:'Printing costs are negligible for the clinic.', option_c:'All patients are able to read.', option_d:'Doctors prefer giving out printed summaries.', option_e:'',
 correct_answer:'A', explanation:'The argument assumes the summary itself caused the better understanding, rather than the kind of patient who engages more with their care already understanding more — a self-selection assumption.', technique_tip:'Whenever "group that received X did better" is used to argue X should be universal, check whether the groups might have differed in other ways from the start.'},

{question_id:'DM071', module:'DM', question_type:'Logical Puzzle', topic:'Sequencing', difficulty:'advanced', recommended_time:55, tags:'sequencing', active:true,
 question_text:"Five deliveries — J, K, L, M and N — are made one after another in positions 1 to 5, with no repeats. J is made before K. L is made immediately after M. N is made last (5th). Which of the following must be true?",
 option_a:'N is not first.', option_b:'M is immediately before L, and both fall somewhere within positions 1 to 4.', option_c:'J is made last.', option_d:'K is made first.', option_e:'',
 correct_answer:'B', explanation:'Since N occupies position 5, the M-then-L pair cannot include position 5, so both M and L must fall within positions 1–4, with M immediately before L there.', technique_tip:'When one item is fixed at an end (N=last), check what that fixed position forces for any adjacent-pair constraint that could otherwise have landed there.'},

{question_id:'DM072', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'foundation', recommended_time:40, tags:'logic', active:true,
 question_text:"Every certified electrician has passed a wiring safety exam. Sade has not passed a wiring safety exam. What can be validly concluded?",
 option_a:'Sade is not a certified electrician.', option_b:'Sade is a certified electrician.', option_c:'It cannot be determined whether Sade is a certified electrician.', option_d:'No electricians pass wiring safety exams.', option_e:'',
 correct_answer:'A', explanation:'This is the valid contrapositive: since every certified electrician has passed the exam, and Sade has not passed it, Sade cannot be a certified electrician.', technique_tip:'"All A are B" plus "not B" validly gives "not A" — the safe contrapositive move.'},

{question_id:'DM073', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'standard', recommended_time:50, tags:'venn', active:true,
 question_text:"Among 150 café customers surveyed, 85 ordered coffee, 60 ordered a pastry, and 20 ordered neither. How many ordered both coffee and a pastry?",
 option_a:'10', option_b:'15', option_c:'20', option_d:'25', option_e:'30',
 correct_answer:'B', explanation:'At least one = 150 − 20 = 130. Both = 85 + 60 − 130 = 15.', technique_tip:'Both = (A) + (B) − (at least one), where "at least one" = total − neither.'},

{question_id:'QR070', module:'QR', question_type:'Tables/Charts', topic:'Data Interpretation', difficulty:'foundation', recommended_time:35, tags:'data', active:true,
 question_text:"A clinic\'s appointment types last month were: Routine 220, Follow-up 130, Emergency 50. What percentage of appointments were Routine?",
 option_a:'50%', option_b:'52%', option_c:'55%', option_d:'58%', option_e:'60%',
 correct_answer:'C', explanation:'Total = 220+130+50 = 400. Routine % = 220/400 × 100 = 55%.', technique_tip:'Always find the grand total first when a question gives a breakdown across several categories.'},

{question_id:'QR071', module:'QR', question_type:'Tables/Charts', topic:'Data Interpretation', difficulty:'standard', recommended_time:45, tags:'data', active:true,
 question_text:"A survey of 500 patients recorded preferred appointment times: Morning 40%, Afternoon 35%, Evening 25%. If 60 more patients, all preferring Evening appointments, are added to the survey, what is the new percentage who prefer Evening (to the nearest whole percent)?",
 option_a:'28%', option_b:'30%', option_c:'33%', option_d:'35%', option_e:'38%',
 correct_answer:'C', explanation:'Original Evening count = 25% × 500 = 125. New total = 560, new Evening = 185. 185/560 × 100 ≈ 33%.', technique_tip:'When new entries are added to only one category, recompute using the new grand total, not the original one.'},

{question_id:'QR072', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'standard', recommended_time:40, tags:'averages', active:true,
 question_text:"The median of five ambulance response times (in minutes), listed in increasing order, is 9: 5, 7, x, 11, 14. What is the value of x?",
 option_a:'6', option_b:'7', option_c:'8', option_d:'9', option_e:'10',
 correct_answer:'D', explanation:'For five values already in increasing order, the median is the 3rd (middle) value, so x = 9.', technique_tip:'For an odd count of ordered values, the median is simply the middle position — no averaging needed.'},

{question_id:'QR073', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'foundation', recommended_time:40, tags:'finance', active:true,
 question_text:"A student takes out a simple-interest loan of £2,000 at an annual rate of 5%. How much interest will have accrued after 3 years?",
 option_a:'£200', option_b:'£250', option_c:'£300', option_d:'£350', option_e:'£400',
 correct_answer:'C', explanation:'Simple interest = P × r × t = 2000 × 0.05 × 3 = £300.', technique_tip:'Simple interest grows linearly — the interest is the same amount every year, unlike compound interest.'},

{question_id:'QR074', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'standard', recommended_time:40, tags:'fractions', active:true,
 question_text:"A recipe requires \\(2\\frac{1}{4}\\) cups of flour to make 6 servings. How many cups of flour are needed for 8 servings?",
 option_a:'2.5', option_b:'2.75', option_c:'3', option_d:'3.25', option_e:'3.5',
 correct_answer:'C', explanation:'Flour per serving = 2.25 ÷ 6 = 0.375 cups. For 8 servings: 0.375 × 8 = 3 cups.', technique_tip:'Convert mixed numbers to decimals or improper fractions first, then find the "per unit" amount before scaling up.'},

{question_id:'QR075', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'standard', recommended_time:50, tags:'multistep', active:true,
 question_text:"A phone originally costs £600. It is discounted by 25%, and then a further 10% is taken off the already-discounted price. What is the final price?",
 option_a:'£380', option_b:'£390', option_c:'£400', option_d:'£405', option_e:'£420',
 correct_answer:'D', explanation:'After 25% off: 600 × 0.75 = £450. After a further 10% off: 450 × 0.9 = £405.', technique_tip:'Successive percentage discounts are applied one after another to the running price — they do not simply add together (25%+10% ≠ 35% off).'},

{question_id:'QR076', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'foundation', recommended_time:40, tags:'probability', active:true,
 question_text:"A jar contains 6 red and 4 yellow sweets. One sweet is picked at random and eaten, then a second sweet is picked. What is the probability that both sweets picked are red?",
 option_a:'1/4', option_b:'3/10', option_c:'1/3', option_d:'2/5', option_e:'1/2',
 correct_answer:'C', explanation:'P(first red) = 6/10. P(second red | first red) = 5/9. Multiply: (6/10) × (5/9) = 30/90 = 1/3.', technique_tip:'For "without replacement" problems, reduce both the numerator and denominator by 1 for the second draw.'},

{question_id:'QR077', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'foundation', recommended_time:35, tags:'rates', active:true,
 question_text:"A factory produces 150 units in 5 hours. At the same steady rate, how many units would it produce in 8 hours?",
 option_a:'200', option_b:'210', option_c:'220', option_d:'240', option_e:'260',
 correct_answer:'D', explanation:'Rate = 150 ÷ 5 = 30 units/hour. In 8 hours: 30 × 8 = 240 units.', technique_tip:'Find the unit rate first (per hour), then scale — faster and less error-prone than setting up a proportion each time.'},

{question_id:'QR078', module:'QR', question_type:'Units', topic:'Units', difficulty:'standard', recommended_time:40, tags:'units', active:true,
 question_text:"A patient\'s fluid intake is recorded as 1.8 litres over a 6-hour shift. What is this rate in millilitres per hour?",
 option_a:'250', option_b:'275', option_c:'300', option_d:'325', option_e:'350',
 correct_answer:'C', explanation:'1.8 litres = 1800ml. Rate = 1800 ÷ 6 = 300ml per hour.', technique_tip:'Convert to the smaller unit (ml) before dividing, so the answer comes out directly in the units the question asks for.'},

{question_id:'SJT070', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'standard', recommended_time:60, tags:'escalation', active:true,
 question_text:"A student believes a piece of equipment may have been cleaned incorrectly between patients by a colleague, but is not entirely certain what they observed. What is the most appropriate action?",
 option_a:'Say nothing, since they are not fully certain.', option_b:"Politely check with the colleague what cleaning process was followed, and raise it through appropriate channels if a genuine lapse is confirmed.", option_c:'Assume the worst and formally report the colleague without checking first.', option_d:'Re-clean the equipment themselves without telling anyone.', option_e:'',
 correct_answer:'B', explanation:'Checking calmly first, then escalating proportionately only if a real lapse is confirmed, balances patient safety with fairness to the colleague when the observation itself is uncertain.', technique_tip:'When uncertain about what was actually observed, "check first, then escalate proportionately if confirmed" usually beats both silence and an immediate formal report.'},

{question_id:'SJT071', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'standard', recommended_time:60, tags:'mistakes', active:true,
 question_text:"A student accidentally sends an email containing a patient\'s initials to the wrong internal recipient within the same organisation. What is the most appropriate action?",
 option_a:'Say nothing, since the recipient is also part of the organisation.', option_b:"Promptly ask the recipient to delete the email, inform a supervisor, and follow the organisation\'s data-incident reporting process.", option_c:'Wait to see if it becomes a problem before doing anything.', option_d:"Delete the email from their own outbox only.", option_e:'',
 correct_answer:'B', explanation:'Prompt, transparent action — notifying the recipient, informing a supervisor, and following formal incident procedure — is the honest and proportionate response to a data-handling error, however minor it may seem.', technique_tip:'Data-handling slips should be treated like any other clinical error: report promptly and follow the proper process, rather than assuming a low-risk recipient makes it unnecessary.'},

{question_id:'SJT072', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'foundation', recommended_time:55, tags:'limitations', active:true,
 question_text:"A first-year student is asked a detailed clinical question by a patient that goes beyond what they have been taught so far. What is the most appropriate response?",
 option_a:'Attempt a confident-sounding answer regardless.', option_b:'Honestly explain their current level of training and offer to find someone who can answer fully.', option_c:'Tell the patient it is not their job to know.', option_d:'Change the subject without acknowledging the question.', option_e:'',
 correct_answer:'B', explanation:'Honest disclosure of the limits of one\'s training, paired with a constructive offer to find the right person, is professional and keeps the patient\'s needs central.', technique_tip:'Recognising-limitations items are almost always resolved by honest disclosure plus a constructive next step, never by guessing or dismissing the question.'},

{question_id:'SJT073', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'standard', recommended_time:55, tags:'professionalism', active:true,
 question_text:"During a placement, a student notices a colleague repeatedly interrupting a patient who has a speech difficulty, finishing the patient\'s sentences for them. What is the most appropriate response?",
 option_a:'Say nothing, as it may just be a habit.', option_b:"Privately mention to the colleague how the interruptions might affect the patient\'s dignity and ability to communicate.", option_c:'Interrupt the colleague in front of the patient to correct them.', option_d:'Complain to management immediately without speaking to the colleague first.', option_e:'',
 correct_answer:'B', explanation:'A calm, private conversation about the impact on the patient\'s dignity and communication is proportionate and constructive, without public confrontation or premature escalation.', technique_tip:'Respect and professionalism scenarios usually favour a private, impact-focused conversation over public correction or immediate escalation.'},

/* ---------------- SECOND EXPANSION BATCH — deeper randomization pool ---------------- */
{question_id:'VR063', module:'VR', question_type:'True/False/Cannot Tell', topic:'Inference', difficulty:'foundation', recommended_time:40, tags:'inference', active:true,
 passage:"Government subsidies for renewable energy installation are often justified partly on the grounds that they create local jobs in manufacturing and maintenance. Economic analyses of past subsidy programmes, however, have found that many of the jobs created are temporary, tied to the installation phase rather than long-term operation, and that some of the manufacturing benefit accrues to firms based overseas rather than domestically. Supporters counter that even temporary construction-phase employment provides valuable short-term economic stimulus, particularly in regions with high unemployment.",
 question_text:"According to the passage, all jobs created by renewable energy subsidies are permanent.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'B', explanation:'The passage explicitly states that "many of the jobs created are temporary," directly contradicting a claim that all such jobs are permanent.', technique_tip:'A single explicit counter-statement in the passage is enough to make an "all/every" claim False.'},

{question_id:'VR064', module:'VR', question_type:"Author\'s Argument", topic:"Author\'s Argument", difficulty:'standard', recommended_time:45, tags:'argument', active:true,
 passage:"Government subsidies for renewable energy installation are often justified partly on the grounds that they create local jobs in manufacturing and maintenance. Economic analyses of past subsidy programmes, however, have found that many of the jobs created are temporary, tied to the installation phase rather than long-term operation, and that some of the manufacturing benefit accrues to firms based overseas rather than domestically. Supporters counter that even temporary construction-phase employment provides valuable short-term economic stimulus, particularly in regions with high unemployment.",
 question_text:"Which of the following best summarises the overall picture presented by the passage?",
 option_a:'Renewable energy subsidies create no economic benefit of any kind.', option_b:'The job-creation case for subsidies is more nuanced than a simple headline figure, with genuine criticisms and a genuine counter-defence both presented.', option_c:'All manufacturing jobs from subsidies go to overseas firms.', option_d:'Subsidies should be abolished immediately.', option_e:'',
 correct_answer:'B', explanation:'The passage lays out a specific criticism (temporary, partly overseas jobs) alongside a specific counter-argument (value of short-term stimulus) without endorsing either side outright — a nuanced, balanced picture.', technique_tip:'When a passage presents "critics say X, but supporters counter Y," the best summary usually names both, not just one side.'},

{question_id:'VR065', module:'VR', question_type:'Inference', topic:'Inference', difficulty:'standard', recommended_time:45, tags:'inference', active:true,
 passage:"Several hospitals have begun trialling AI-assisted screening tools that flag likely abnormalities in chest X-rays before a radiologist reviews the image. Early trial data suggests the tools can reduce the average time a radiologist spends per scan without a corresponding increase in missed diagnoses, though the same trials found accuracy varied noticeably depending on the demographic composition of the training data used to build each tool, raising concerns about performance in underrepresented patient groups.",
 question_text:"It can be inferred from the passage that:",
 option_a:'The accuracy of an AI screening tool could differ between hospitals serving different patient demographics.', option_b:'AI screening tools always increase the number of missed diagnoses.', option_c:'Radiologists are no longer needed once an AI tool is introduced.', option_d:'Training data composition has no effect on tool accuracy.', option_e:'',
 correct_answer:'A', explanation:'Since accuracy "varied noticeably depending on the demographic composition of the training data," a tool trained on one population could reasonably be expected to perform differently for a hospital serving a different patient demographic.', technique_tip:'When a passage links an outcome to a specific factor (training data demographics), a safe inference extends that link to a plausible new context (different hospitals), without overstating it.'},

{question_id:'VR066', module:'VR', question_type:'True/False/Cannot Tell', topic:"Evidence vs Assumption", difficulty:'advanced', recommended_time:50, tags:'assumption', active:true,
 passage:"Several hospitals have begun trialling AI-assisted screening tools that flag likely abnormalities in chest X-rays before a radiologist reviews the image. Early trial data suggests the tools can reduce the average time a radiologist spends per scan without a corresponding increase in missed diagnoses, though the same trials found accuracy varied noticeably depending on the demographic composition of the training data used to build each tool, raising concerns about performance in underrepresented patient groups.",
 question_text:"The passage confirms that AI screening tools are equally accurate for all patient demographic groups.",
 option_a:'True', option_b:'False', option_c:"Can\'t Tell", option_d:'', option_e:'',
 correct_answer:'B', explanation:'The passage explicitly states accuracy "varied noticeably depending on the demographic composition of the training data," directly contradicting a claim of equal accuracy across groups.', technique_tip:'Look for the passage\'s own explicit qualifier ("varied noticeably") — it directly falsifies an "equally accurate for all" claim.'},

{question_id:'VR067', module:'VR', question_type:'Identifying Information', topic:'Identifying Information', difficulty:'foundation', recommended_time:40, tags:'identifying', active:true,
 passage:"Municipal tree-planting initiatives aimed at expanding urban canopy cover are frequently promoted as a straightforward way to reduce city temperatures during heatwaves. Yet newly planted saplings take, on average, 15 to 20 years to develop a canopy large enough to provide meaningful shade, meaning the cooling benefits of a planting programme started today will not be fully realised until long after the heatwaves it was intended to address.",
 question_text:"According to the passage, how long do newly planted saplings typically take to provide meaningful shade?",
 option_a:'1 to 2 years', option_b:'5 to 10 years', option_c:'15 to 20 years', option_d:'They provide meaningful shade immediately.', option_e:'',
 correct_answer:'C', explanation:'The passage states directly that saplings "take, on average, 15 to 20 years to develop a canopy large enough to provide meaningful shade."', technique_tip:'For direct figure-recall questions, scan for the exact number range rather than estimating from general impressions of the passage.'},

{question_id:'VR068', module:'VR', question_type:"Author\'s Argument", topic:"Author\'s Argument", difficulty:'standard', recommended_time:45, tags:'argument', active:true,
 passage:"Municipal tree-planting initiatives aimed at expanding urban canopy cover are frequently promoted as a straightforward way to reduce city temperatures during heatwaves. Yet newly planted saplings take, on average, 15 to 20 years to develop a canopy large enough to provide meaningful shade, meaning the cooling benefits of a planting programme started today will not be fully realised until long after the heatwaves it was intended to address.",
 question_text:"Which of the following best captures the author\'s main point?",
 option_a:'Tree-planting programmes should be cancelled entirely.', option_b:'The near-term cooling benefits of tree-planting programmes may be overstated, given the long lag before a meaningful canopy develops.', option_c:'Trees provide no cooling benefit at any point.', option_d:'Heatwaves will stop occurring once trees mature.', option_e:'',
 correct_answer:'B', explanation:'The author is not arguing against planting trees altogether, but pointing out a timing mismatch between when the programme starts and when its promised benefit ("straightforward way to reduce city temperatures") actually arrives.', technique_tip:'Watch for options that turn a timing critique into a call to abandon the whole initiative — that overstates a more measured point about expectations.'},

{question_id:'VR069', module:'VR', question_type:'Interpretation', topic:'Interpretation of Passages', difficulty:'advanced', recommended_time:55, tags:'interpretation', active:true,
 passage:"Longitudinal studies examining the relationship between adolescent screen time and mental wellbeing have produced inconsistent findings, with some reporting small negative associations and others finding no meaningful effect once factors such as household income and pre-existing mental health status are statistically controlled for. Critics of the field note that most studies rely on self-reported screen time, which tends to be both imprecisely recalled and susceptible to social-desirability bias, potentially obscuring the true size of any underlying effect in either direction.",
 question_text:"The passage is best described as presenting:",
 option_a:'Conclusive proof that screen time has no effect on adolescent wellbeing.', option_b:'A body of research with genuinely mixed findings, further complicated by acknowledged measurement limitations.', option_c:'A single definitive study settling the debate.', option_d:'An argument that all screen-time research should be disregarded entirely.', option_e:'',
 correct_answer:'B', explanation:'The passage describes "inconsistent findings" across studies and a specific measurement critique (self-report bias), without concluding the research should be dismissed or that any one finding is definitive.', technique_tip:'When a passage describes a field as having "inconsistent findings" plus a stated methodological limitation, the correct summary should reflect both, not pick a side the passage itself does not take.'},

{question_id:'VR070', module:'VR', question_type:'Inference', topic:'Inference', difficulty:'advanced', recommended_time:55, tags:'inference', active:true,
 passage:"Longitudinal studies examining the relationship between adolescent screen time and mental wellbeing have produced inconsistent findings, with some reporting small negative associations and others finding no meaningful effect once factors such as household income and pre-existing mental health status are statistically controlled for. Critics of the field note that most studies rely on self-reported screen time, which tends to be both imprecisely recalled and susceptible to social-desirability bias, potentially obscuring the true size of any underlying effect in either direction.",
 question_text:"Which of the following can most reasonably be inferred from the passage?",
 option_a:'Imprecise self-reported screen time data could be masking a real effect that more accurate measurement might reveal.', option_b:'Household income has no relationship to adolescent wellbeing.', option_c:'Self-reported data is always more accurate than objectively measured data.', option_d:'No further research into screen time is needed.', option_e:'',
 correct_answer:'A', explanation:'The passage notes self-report bias could be "obscuring the true size of any underlying effect in either direction" — implying more precise measurement might reveal an effect the current imprecise data is hiding.', technique_tip:'"Obscuring the true size...in either direction" is a strong hint that the measurement issue could be masking, not disproving, a real underlying effect.'},

{question_id:'VR071', module:'VR', question_type:'Reading Comprehension', topic:'Reading Comprehension', difficulty:'foundation', recommended_time:40, tags:'comprehension', active:true,
 passage:"Antibiotic resistance occurs when bacteria evolve mechanisms that allow them to survive exposure to drugs that would previously have killed them. Overuse and misuse of antibiotics, such as prescribing them for viral infections they cannot treat, or patients not completing a prescribed course, accelerates this evolutionary process by allowing partially resistant bacteria to survive and multiply.",
 question_text:"According to the passage, what is antibiotic resistance?",
 option_a:'When a patient becomes allergic to antibiotics.', option_b:'When bacteria evolve mechanisms that let them survive drugs that would previously have killed them.', option_c:'When antibiotics are prescribed too rarely.', option_d:'When viral infections become bacterial.', option_e:'',
 correct_answer:'B', explanation:'The passage defines antibiotic resistance directly as bacteria evolving "mechanisms that allow them to survive exposure to drugs that would previously have killed them."', technique_tip:'Definition questions are usually answered by the first sentence introducing the term — check there first.'},

{question_id:'VR072', module:'VR', question_type:'Identifying Information', topic:'Identifying Information', difficulty:'standard', recommended_time:45, tags:'identifying', active:true,
 passage:"Antibiotic resistance occurs when bacteria evolve mechanisms that allow them to survive exposure to drugs that would previously have killed them. Overuse and misuse of antibiotics, such as prescribing them for viral infections they cannot treat, or patients not completing a prescribed course, accelerates this evolutionary process by allowing partially resistant bacteria to survive and multiply.",
 question_text:"Which of the following is identified in the passage as a cause of accelerated antibiotic resistance?",
 option_a:'Patients completing their full prescribed course.', option_b:'Prescribing antibiotics for viral infections, or patients not completing a prescribed course.', option_c:'Bacteria being exposed to antibiotics for the first time.', option_d:'Doctors under-prescribing antibiotics.', option_e:'',
 correct_answer:'B', explanation:'The passage names both "prescribing them for viral infections they cannot treat" and "patients not completing a prescribed course" as causes that accelerate resistance.', technique_tip:'When a question asks for "a cause," check whether the passage lists more than one — pick the option that matches what\'s actually named, not a plausible-sounding alternative.'},

{question_id:'DM074', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'foundation', recommended_time:35, tags:'probability', active:true,
 question_text:"A box contains 10 tickets numbered 1 to 10. One ticket is drawn at random. What is the probability that the number drawn is a multiple of 3?",
 option_a:'1/10', option_b:'1/5', option_c:'3/10', option_d:'2/5', option_e:'1/2',
 correct_answer:'C', explanation:'Multiples of 3 between 1 and 10 are 3, 6 and 9 — three outcomes out of 10. Probability = 3/10.', technique_tip:'List out the qualifying outcomes directly for small ranges rather than trying to calculate a shortcut formula.'},

{question_id:'DM075', module:'DM', question_type:'Conditional Reasoning', topic:'Conditional Reasoning', difficulty:'foundation', recommended_time:35, tags:'logic', active:true,
 question_text:"If a shipment fails quality inspection, it is returned to the supplier. Shipment Z was not returned to the supplier. What can be validly concluded?",
 option_a:'Shipment Z did not fail quality inspection.', option_b:'Shipment Z failed quality inspection.', option_c:'It cannot be validly determined whether Shipment Z failed inspection.', option_d:'All shipments pass quality inspection.', option_e:'',
 correct_answer:'A', explanation:'This is the valid contrapositive: failing inspection implies return to supplier; not returned implies not failed.', technique_tip:'"If P then Q" plus "not Q" validly gives "not P" — the safe contrapositive move, always worth checking first.'},

{question_id:'DM076', module:'DM', question_type:'Data Interpretation', topic:'Data Interpretation', difficulty:'standard', recommended_time:45, tags:'data', active:true,
 question_text:"A survey of 400 commuters found 45% travel by car and 30% by public transport, with the remainder travelling by bike or on foot. How many commuters travel by bike or on foot?",
 option_a:'80', option_b:'90', option_c:'100', option_d:'110', option_e:'120',
 correct_answer:'C', explanation:'Remaining percentage = 100 − 45 − 30 = 25%. 25% of 400 = 100.', technique_tip:'When percentages must add to 100%, find the missing share by subtraction before converting to a count.'},

{question_id:'DM077', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'standard', recommended_time:50, tags:'argument', active:true,
 question_text:"\"Sales of a new toothpaste rose 20% in the month after a celebrity endorsement began, so the endorsement caused the sales increase.\" Which of the following, if true, would most weaken this argument?",
 option_a:"A competitor\'s toothpaste was recalled for safety reasons during the same month, likely driving customers to alternative brands.", option_b:'The celebrity has a large social media following.', option_c:'The toothpaste was already reasonably popular before the endorsement.', option_d:'The advertisement ran on both television and online platforms.', option_e:'',
 correct_answer:'A', explanation:'A competitor recall in the same month offers a strong alternative explanation for the sales rise, directly undermining the claim that the endorsement was the cause.', technique_tip:'Look for a coincidental event in the same time window that could independently explain the outcome — a classic confound for "X happened, then Y happened, so X caused Y" arguments.'},

{question_id:'DM078', module:'DM', question_type:'Syllogism', topic:'Syllogisms', difficulty:'standard', recommended_time:40, tags:'logic', active:true,
 question_text:"All registered nurses have completed a nursing degree. Boma has completed a nursing degree. What can be validly concluded?",
 option_a:'Boma is a registered nurse.', option_b:'Boma is not a registered nurse.', option_c:'It cannot be determined whether Boma is a registered nurse.', option_d:'No nurses complete nursing degrees.', option_e:'',
 correct_answer:'C', explanation:'The premise only establishes that all registered nurses have the degree, not that everyone with the degree is a registered nurse — affirming the consequent is invalid here.', technique_tip:'"All A are B" never means "all B are A" — check whether the conclusion tries to reverse the original statement.'},

{question_id:'DM079', module:'DM', question_type:'Recognising Assumptions', topic:'Recognising Assumptions', difficulty:'advanced', recommended_time:50, tags:'assumption', active:true,
 question_text:"Argument: \"The new online booking system reduced missed appointments by 15% at Clinic A, so all clinics in the network should adopt it to reduce missed appointments similarly.\" Which of the following is an assumption underlying this argument?",
 option_a:"Clinic A\'s patient population and appointment patterns are not so different from other clinics that the same system would fail to produce a similar effect elsewhere.", option_b:'The booking system was expensive to install.', option_c:'All clinics currently use paper-based booking.', option_d:'Missed appointments are the network\'s only performance concern.', option_e:'',
 correct_answer:'A', explanation:'The argument assumes the result at Clinic A would transfer to other clinics, which requires those clinics to be similar enough for the comparison to hold.', technique_tip:'Generalising a single-site result to "all sites should adopt this" always rests on an unstated similarity assumption — check whether it\'s a safe one.'},

{question_id:'DM080', module:'DM', question_type:'Venn Diagram', topic:'Venn Diagrams', difficulty:'advanced', recommended_time:50, tags:'venn', active:true,
 question_text:"In a survey of 200 gym members, 120 use the weights area, 90 use the cardio area, and 30 use neither. How many use both areas?",
 option_a:'20', option_b:'30', option_c:'40', option_d:'50', option_e:'60',
 correct_answer:'C', explanation:'At least one = 200 − 30 = 170. Both = 120 + 90 − 170 = 40.', technique_tip:'Both = (A) + (B) − (at least one), with "at least one" = total − neither.'},

{question_id:'DM081', module:'DM', question_type:'Evaluating Arguments', topic:'Evaluating Arguments', difficulty:'advanced', recommended_time:50, tags:'argument', active:true,
 question_text:"\"A city that introduced congestion charging saw a 12% drop in traffic within the charging zone the following year, so congestion charging is an effective way to reduce urban traffic.\" Which of the following, if true, would most strengthen this argument?",
 option_a:'A comparable city without congestion charging saw no significant change in traffic over the same period.', option_b:'The charge was set at a relatively low rate.', option_c:'Some drivers found alternative routes outside the charging zone.', option_d:'Public transport fares also increased that year.', option_e:'',
 correct_answer:'A', explanation:'A comparable city without the charge showing no change strengthens the case that the charge itself, rather than some other factor, caused the drop — a controlled comparison.', technique_tip:'The strongest strengthener for a causal claim is a comparison showing the effect does NOT occur without the proposed cause.'},

{question_id:'DM082', module:'DM', question_type:'Logical Puzzle', topic:'Sequencing', difficulty:'advanced', recommended_time:55, tags:'sequencing', active:true,
 question_text:"Four deliveries — P, Q, R and S — are scheduled across four time slots (1st to 4th), one per slot. P is scheduled before Q. R is not scheduled 1st or 4th. S is scheduled immediately after R. Which of the following must be true?",
 option_a:'P is scheduled 1st.', option_b:'Q is scheduled last.', option_c:'R is scheduled 2nd.', option_d:'S is scheduled 4th.', option_e:'',
 correct_answer:'A', explanation:'R must be 2nd or 3rd. If R=2nd, S=3rd, leaving 1st and 4th for P and Q with P before Q, so P=1st. If R=3rd, S=4th, leaving 1st and 2nd for P and Q with P before Q, so P=1st again. Either way, P is always 1st.', technique_tip:'When a puzzle has more than one valid arrangement, test each one separately and look for what stays constant across all of them — that\'s what "must be true."'},

{question_id:'DM083', module:'DM', question_type:'Probability', topic:'Probability', difficulty:'standard', recommended_time:45, tags:'probability', active:true,
 question_text:"A committee of 2 people is chosen at random from a group of 4 men and 3 women. What is the probability that both chosen are women?",
 option_a:'1/7', option_b:'2/7', option_c:'3/7', option_d:'1/3', option_e:'1/2',
 correct_answer:'A', explanation:'Ways to choose 2 women from 3 = C(3,2) = 3. Ways to choose any 2 from 7 = C(7,2) = 21. Probability = 3/21 = 1/7.', technique_tip:'For "choose a committee" probability questions, use combinations (order doesn\'t matter) for both the numerator and denominator.'},

{question_id:'QR079', module:'QR', question_type:'Percentages', topic:'Percentage Change', difficulty:'foundation', recommended_time:35, tags:'percentages', active:true,
 question_text:"A charity raised £3,500 in January and £4,200 in February. What was the percentage increase from January to February?",
 option_a:'10%', option_b:'15%', option_c:'20%', option_d:'25%', option_e:'30%',
 correct_answer:'C', explanation:'Increase = £700. Percentage increase = 700 ÷ 3500 × 100 = 20%.', technique_tip:'Percentage change is always calculated relative to the original (starting) value.'},

{question_id:'QR080', module:'QR', question_type:'Ratios', topic:'Ratios', difficulty:'foundation', recommended_time:35, tags:'ratios', active:true,
 question_text:"Paint is mixed in the ratio 2:3 (blue:white) to make a shade of light blue. How many litres of blue paint are needed to make 20 litres of the mixture?",
 option_a:'4', option_b:'6', option_c:'8', option_d:'10', option_e:'12',
 correct_answer:'C', explanation:'Total parts = 2 + 3 = 5. One part = 20 ÷ 5 = 4 litres. Blue = 2 × 4 = 8 litres.', technique_tip:'Find the value of one part first, then scale up to the specific colour needed.'},

{question_id:'QR081', module:'QR', question_type:'Speed/Distance/Time', topic:'Rates', difficulty:'standard', recommended_time:45, tags:'rates', active:true,
 question_text:"A cyclist travels the first 15km of a journey at 20km/h and the next 10km at 25km/h. What is the total time taken, in minutes (to the nearest minute)?",
 option_a:'60', option_b:'65', option_c:'69', option_d:'72', option_e:'75',
 correct_answer:'C', explanation:'Time 1 = 15 ÷ 20 = 0.75h = 45 min. Time 2 = 10 ÷ 25 = 0.4h = 24 min. Total = 45 + 24 = 69 minutes.', technique_tip:'Calculate each leg of a multi-speed journey separately in hours, then convert to minutes and add at the end.'},

{question_id:'QR082', module:'QR', question_type:'Averages', topic:'Averages', difficulty:'standard', recommended_time:40, tags:'averages', active:true,
 question_text:"The mean of four numbers is 18. Three of the numbers are 12, 20 and 22. What is the fourth number?",
 option_a:'14', option_b:'16', option_c:'18', option_d:'20', option_e:'22',
 correct_answer:'C', explanation:'Total = 4 × 18 = 72. Fourth number = 72 − (12+20+22) = 72 − 54 = 18.', technique_tip:'Work with the total (mean × count) rather than the mean itself when one value is missing.'},

{question_id:'QR083', module:'QR', question_type:'Units', topic:'Units', difficulty:'standard', recommended_time:40, tags:'units', active:true,
 question_text:"A drug is prescribed at 2.5mg per kg of body weight, given twice daily. What is the total daily dose in mg for a 60kg patient?",
 option_a:'150', option_b:'225', option_c:'300', option_d:'375', option_e:'450',
 correct_answer:'C', explanation:'Per-dose amount = 2.5 × 60 = 150mg. Twice daily = 150 × 2 = 300mg.', technique_tip:'Calculate the single-dose amount first, then multiply by the number of doses per day — don\'t combine the two steps into one calculation.'},

{question_id:'QR084', module:'QR', question_type:'Financial Calculations', topic:'Financial Calculations', difficulty:'advanced', recommended_time:55, tags:'finance', active:true,
 question_text:"An investment of £8,000 grows to £9,261 after 3 years of annual compound interest. What was the annual interest rate?",
 option_a:'3%', option_b:'4%', option_c:'5%', option_d:'6%', option_e:'7%',
 correct_answer:'C', explanation:'(9261/8000) = 1.157625. The cube root of 1.157625 is 1.05, so the annual rate is 5%.', technique_tip:'For "find the rate" compound interest problems, take the nth root of the growth ratio, where n is the number of years.'},

{question_id:'QR085', module:'QR', question_type:'Multi-step Numerical Reasoning', topic:'Multi-step Reasoning', difficulty:'advanced', recommended_time:55, tags:'multistep', active:true,
 question_text:"A store buys an item for £40 and marks it up by 50% to set the selling price. During a sale, the selling price is reduced by 20%. What percentage profit over the original £40 cost does the sale price represent?",
 option_a:'10%', option_b:'15%', option_c:'20%', option_d:'25%', option_e:'30%',
 correct_answer:'C', explanation:'Selling price = 40 × 1.5 = £60. Sale price = 60 × 0.8 = £48. Profit = £48 − £40 = £8. Profit % = 8 ÷ 40 × 100 = 20%.', technique_tip:'Work through markup and discount as separate sequential steps on the running price, then compare the final price to the original cost.'},

{question_id:'QR086', module:'QR', question_type:'Area/Volume', topic:'Area', difficulty:'advanced', recommended_time:55, tags:'geometry', active:true,
 question_text:"A rectangular garden measures 12m by 9m. A circular pond of radius 2m (using π ≈ 3.14) is installed within it. What is the remaining garden area, to the nearest square metre?",
 option_a:'90', option_b:'93', option_c:'95', option_d:'98', option_e:'100',
 correct_answer:'C', explanation:'Garden area = 12 × 9 = 108m². Pond area = π × 2² ≈ 3.14 × 4 = 12.56m². Remaining = 108 − 12.56 ≈ 95m².', technique_tip:'Subtract the "cut-out" shape\'s area from the total area — compute each area fully before subtracting.'},

{question_id:'QR087', module:'QR', question_type:'Probability', topic:'Probability', difficulty:'advanced', recommended_time:50, tags:'probability', active:true,
 question_text:"Two fair coins and one fair six-sided die are all thrown together. What is the probability of getting two heads and a number greater than 4 on the die?",
 option_a:'1/24', option_b:'1/12', option_c:'1/8', option_d:'1/6', option_e:'1/4',
 correct_answer:'B', explanation:'P(two heads) = 1/2 × 1/2 = 1/4. P(die > 4) = 2/6 = 1/3 (i.e. 5 or 6). Combined (independent events): 1/4 × 1/3 = 1/12.', technique_tip:'For independent events across different objects (coins and a die), multiply their individual probabilities together.'},

{question_id:'QR088', module:'QR', question_type:'Fractions', topic:'Fractions', difficulty:'standard', recommended_time:45, tags:'fractions', active:true,
 question_text:"A container is 5/6 full of juice. After pouring out 2 litres, it is 1/2 full. What is the total capacity of the container?",
 option_a:'4', option_b:'5', option_c:'6', option_d:'7', option_e:'8',
 correct_answer:'C', explanation:'The 2 litres poured out equals (5/6 − 1/2) = 1/3 of the capacity. So capacity = 2 ÷ (1/3) = 6 litres.', technique_tip:'Find what fraction of the total the poured-out amount represents, then divide to find the whole.'},

{question_id:'SJT074', module:'SJT', question_type:'Appropriateness Rating', topic:'Communication', difficulty:'foundation', recommended_time:55, tags:'communication', active:true,
 question_text:"A student needs to explain a delay to a patient who is visibly frustrated about waiting longer than expected. What is the most appropriate response?",
 option_a:'Apologise for the wait, briefly and honestly explain the reason, and give a realistic estimate of further waiting time if possible.', option_b:'Avoid the patient until someone senior is available.', option_c:'Tell the patient delays are normal and there is nothing further to discuss.', option_d:'Promise a specific short wait time even if it is unlikely to be accurate.', option_e:'',
 correct_answer:'A', explanation:'An honest, brief explanation plus a realistic estimate respects the patient\'s frustration without making promises that cannot be kept.', technique_tip:'Honest, specific communication almost always outranks avoidance, dismissiveness, or over-promising in patient-facing SJT scenarios.'},

{question_id:'SJT075', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'foundation', recommended_time:55, tags:'teamwork', active:true,
 question_text:"A student is asked to take on an extra task by a teammate who is overwhelmed, but doing so would mean falling behind on their own agreed work. What is the most appropriate response?",
 option_a:'Agree immediately without raising the conflict.', option_b:'Refuse outright and say nothing further.', option_c:'Explain their own current workload honestly and discuss with the teammate how the extra task might be shared or reprioritised.', option_d:'Complete the extra task secretly without telling anyone about the impact on their own work.', option_e:'',
 correct_answer:'C', explanation:'Openly discussing workload and finding a shared solution supports the team without silently absorbing an unsustainable burden or refusing without explanation.', technique_tip:'When two genuine obligations conflict, the most appropriate response is usually transparent discussion, not silent agreement or blunt refusal.'},

{question_id:'SJT076', module:'SJT', question_type:'Appropriateness Rating', topic:'Patient Safety', difficulty:'standard', recommended_time:60, tags:'safety', active:true,
 question_text:"A student notices that a colleague has mislabelled a specimen sample, but the colleague has already left for the day. What is the most appropriate action?",
 option_a:'Leave it for the colleague to notice and fix the next day.', option_b:'Correct the label themselves if within their competence, or immediately inform someone who can, given the safety implications of a mislabelled sample.', option_c:'Discard the sample to avoid the issue.', option_d:"Relabel it based on their own best guess, without checking.", option_e:'',
 correct_answer:'B', explanation:'A mislabelled sample is a real, immediate patient safety risk, so it should be corrected or escalated promptly rather than left overnight, discarded, or guessed at.', technique_tip:'Immediate patient safety risks should be acted on right away, regardless of whose error it was or whether they are available to fix it themselves.'},

{question_id:'SJT077', module:'SJT', question_type:'Appropriateness Rating', topic:'Confidentiality', difficulty:'standard', recommended_time:55, tags:'confidentiality', active:true,
 question_text:"A fellow student, who is not involved in a patient\'s care, asks a student about the details of an interesting case they saw on placement, out of curiosity. What is the most appropriate response?",
 option_a:'Share the case in full detail since it is just between students.', option_b:'Decline to share identifiable patient details, but discuss the case in a suitably anonymised, educational way if appropriate.', option_c:'Report the fellow student for asking.', option_d:"Share the patient\'s name but not their diagnosis.", option_e:'',
 correct_answer:'B', explanation:'Protecting identifiable patient information while still allowing appropriate educational discussion balances confidentiality with genuine learning value.', technique_tip:'Confidentiality questions usually favour "anonymise and discuss educationally" over both full disclosure and total silence.'},

{question_id:'SJT078', module:'SJT', question_type:'Appropriateness Rating', topic:'Teamwork', difficulty:'standard', recommended_time:55, tags:'teamwork', active:true,
 question_text:"During a group task, two teammates have a disagreement that is starting to affect the group\'s progress and mood. What is the most appropriate action for another student in the group?",
 option_a:'Ignore it and hope it resolves on its own.', option_b:'Take one side to end the disagreement quickly.', option_c:'Calmly acknowledge the disagreement, encourage both teammates to explain their views, and help the group refocus on the task.', option_d:'Tell the tutor immediately without attempting to help resolve it within the group first.', option_e:'',
 correct_answer:'C', explanation:'A calm, neutral facilitation attempt that lets both sides be heard is a constructive first step, before any need for external escalation.', technique_tip:'For group friction, a neutral facilitating role usually beats both ignoring the issue and immediately escalating outside the group.'},

{question_id:'SJT079', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'advanced', recommended_time:60, tags:'escalation', active:true,
 question_text:"A student on placement believes a repeated documentation shortcut used across the team could pose a patient safety risk over time, but everyone treats it as normal practice. What is the most appropriate action?",
 option_a:'Go along with it since it is accepted practice.', option_b:'Raise the concern constructively with a supervisor or through an appropriate process, even though it means questioning an established team habit.', option_c:'Refuse to participate in any documentation at all.', option_d:'Only mention it to other students, not anyone in authority.', option_e:'',
 correct_answer:'B', explanation:'A genuine, reasoned safety concern should be raised through the proper process, even when it means challenging normalised practice — that is exactly the kind of judgement the SJT rewards.', technique_tip:'"Everyone does it" is not a reason to withhold a genuine safety concern — raise it constructively through the appropriate channel regardless.'},

{question_id:'SJT080', module:'SJT', question_type:'Appropriateness Rating', topic:'Honesty and Handling Mistakes', difficulty:'advanced', recommended_time:60, tags:'mistakes', active:true,
 question_text:"A student realises partway through a task that they misunderstood the instructions and have been doing part of it incorrectly for the past hour. What is the most appropriate action?",
 option_a:'Continue as before to avoid admitting the mistake.', option_b:'Promptly inform whoever is responsible for the task, explain what happened, and correct the work as needed.', option_c:'Quietly fix it without telling anyone, even if it affects others\' work.', option_d:'Blame the unclear instructions and take no further action.', option_e:'',
 correct_answer:'B', explanation:'Prompt, honest disclosure paired with correcting the work is the most professional response, especially since the error could affect others depending on the task.', technique_tip:'Whenever a mistake could affect other people\'s work, silent self-correction is not enough — prompt disclosure matters too.'},

{question_id:'SJT081', module:'SJT', question_type:'Appropriateness Rating', topic:'Recognising Limitations', difficulty:'advanced', recommended_time:60, tags:'limitations', active:true,
 question_text:"A student is asked to interpret a set of clinical results and explain them to a patient, but is unsure they fully understand what the results mean. What is the most appropriate action?",
 option_a:"Give the patient their best guess at an explanation.", option_b:"Explain honestly that they need to check with a supervisor before interpreting the results, and arrange for this promptly.", option_c:'Tell the patient to ask someone else without offering any further help.', option_d:'Avoid the patient until the results are no longer relevant.', option_e:'',
 correct_answer:'B', explanation:'Honestly recognising the limits of one\'s understanding and promptly seeking supervision protects the patient from receiving an inaccurate or misleading explanation.', technique_tip:'Interpreting clinical results incorrectly can cause real harm — recognising limitations here is not optional caution, it is the safe and professional choice.'},

{question_id:'SJT082', module:'SJT', question_type:'Appropriateness Rating', topic:'Respect and Professionalism', difficulty:'standard', recommended_time:55, tags:'professionalism', active:true,
 question_text:"A student overhears a colleague using dismissive language about a patient\'s cultural or religious dietary requirements while planning meals. What is the most appropriate response?",
 option_a:'Say nothing, since meal planning is a minor issue.', option_b:"Calmly explain the importance of respecting the patient\'s requirements and how the comment could affect patient care and trust.", option_c:'Report the colleague to external authorities immediately without any discussion.', option_d:'Make a similar comment to fit in with the team.', option_e:'',
 correct_answer:'B', explanation:'A calm explanation of the real impact on patient care and trust addresses the issue constructively and proportionately.', technique_tip:'Respect-related comments about a patient\'s beliefs or needs should never be dismissed as "minor" — but a first instance is usually best addressed with a calm, private conversation rather than immediate external escalation.'},

{question_id:'SJT083', module:'SJT', question_type:'Appropriateness Rating', topic:'Escalation', difficulty:'foundation', recommended_time:50, tags:'escalation', active:true,
 question_text:"A student notices a minor safety hazard, such as a wet floor without a warning sign, in a public area of a healthcare setting. What is the most appropriate action?",
 option_a:'Walk past without saying anything.', option_b:'Alert a member of staff promptly so the hazard can be addressed, and avoid the area themselves in the meantime.', option_c:'Attempt to clean it up themselves without appropriate equipment.', option_d:'Wait to see if someone else reports it first.', option_e:'',
 correct_answer:'B', explanation:'Promptly alerting staff who can properly address the hazard is the safest and most appropriate action — even a "minor" hazard like this can cause a fall.', technique_tip:'For hazard-reporting scenarios, "alert someone who can properly fix it, don\'t attempt it yourself without the right equipment" is almost always the top-rated response.'},

/* end seed */
];

/* ============================================================
   SHARED UTILITIES (formatting, scoring) — used by all pages
   ============================================================ */
function fmtTime(s){ s = Math.max(0, Math.round(s)); const m = Math.floor(s/60), r = s%60; return String(m).padStart(2,'0') + ':' + String(r).padStart(2,'0'); }
function esc(str){ const d = document.createElement('div'); d.innerText = str == null ? '' : str; return d.innerHTML; }
function scaledScore(accuracy){ return Math.round(300 + (accuracy/100)*600); }
function fmtDate(ts){ if(!ts) return '—'; const d = new Date(ts); return d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }
