/* ============================================================
   CLOUD FUNCTIONS — MathCloud UCAT Coaching
   ------------------------------------------------------------
   Why this file exists: Firebase Authentication's client SDK
   can't let a signed-in admin create ANOTHER person's account
   without signing the admin out (creating a user signs you in as
   that new user). The Admin SDK doesn't have that limitation, but
   it only runs in a trusted backend — so these two callable
   functions are that backend. The webpage (admin-app.js) calls
   them with functions.httpsCallable(...); Firebase handles auth
   for the call automatically.

   Deploy with: firebase deploy --only functions
   (See ../SETUP.md for the full one-time setup.)
   ============================================================ */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.database();

// Throws unless the caller is signed in AND has the 'admin' custom claim.
function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  if (request.auth.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can do this.");
  }
}

/* ------------------------------------------------------------
   createAccount({ role, email, password, displayName, targetScore?, linkedStudentUid? })
   role: 'student' | 'parent' | 'admin'
   Admin-only. Creates the Firebase Auth user, sets their role as
   a custom claim (this is what database.rules.json checks), and
   writes their profile record. Admins can create more admins this
   way (e.g. a second tutor) once the very first one exists — see
   bootstrapFirstAdmin below for that first one.
   ------------------------------------------------------------ */
exports.createAccount = onCall(async (request) => {
  assertAdmin(request);
  const { role, email, password, displayName, targetScore, linkedStudentUid } = request.data || {};

  if (!["student", "parent", "admin"].includes(role)) {
    throw new HttpsError("invalid-argument", "role must be 'student', 'parent', or 'admin'.");
  }
  if (!email || !password || password.length < 6) {
    throw new HttpsError("invalid-argument", "A valid email and a password of at least 6 characters are required.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: displayName || email });
  } catch (err) {
    throw new HttpsError("already-exists", err.message || "Could not create that account.");
  }

  await admin.auth().setCustomUserClaims(userRecord.uid, { role });

  const now = Date.now();
  const updates = {};
  updates[`users/${userRecord.uid}`] = { role, email, displayName: displayName || email, createdAt: now };

  if (role === "student") {
    updates[`students/${userRecord.uid}/profile`] = {
      name: displayName || email,
      targetUniversity: "", targetCourse: "",
      targetUCATYear: new Date().getFullYear() + 1,
      targetScore: targetScore || 2500,
      testDate: ""
    };
  } else if (role === "parent") {
    updates[`parents/${userRecord.uid}/studentUids`] = linkedStudentUid ? { [linkedStudentUid]: true } : {};
  }

  await db.ref().update(updates);
  return { uid: userRecord.uid };
});

/* ------------------------------------------------------------
   bootstrapFirstAdmin({ email, password, displayName })
   NO auth required to call this — that's the point, it's how the
   very first admin gets created. Safe because it self-disables: it
   checks /users for any existing account with role 'admin' and
   refuses if one is already there. After that, setup.html stops
   being useful and every further account (including more admins)
   goes through createAccount from inside admin.html, which does
   require an existing admin to be signed in.
   ------------------------------------------------------------ */
exports.bootstrapFirstAdmin = onCall(async (request) => {
  const { email, password, displayName } = request.data || {};
  if (!email || !password || password.length < 6) {
    throw new HttpsError("invalid-argument", "A valid email and a password of at least 6 characters are required.");
  }

  // Atomically claim the "first admin" slot so two simultaneous setup.html
  // visitors can't both slip through the check-then-create window.
  const claim = await db.ref("meta/adminBootstrapped").transaction((current) => {
    if (current === true) return; // abort — already claimed
    return true;
  });
  if (!claim.committed) {
    throw new HttpsError(
      "already-exists",
      "An admin account already exists for this project. Sign in as that admin and create additional admins from the Accounts page instead."
    );
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: displayName || email });
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: "admin" });
    await db.ref(`users/${userRecord.uid}`).set({
      role: "admin", email, displayName: displayName || email, createdAt: Date.now()
    });
  } catch (err) {
    // Creation failed after claiming the slot — release it so setup.html can be retried.
    await db.ref("meta/adminBootstrapped").set(null);
    throw new HttpsError("internal", err.message || "Could not create that account.");
  }

  return { uid: userRecord.uid };
});

/* ------------------------------------------------------------
   linkParentToStudent({ parentUid, studentUid })
   Admin-only. Pass studentUid: null to unlink a parent from every
   student (the UI currently supports one child per parent at a
   time; the data model supports more if you extend the UI later).
   ------------------------------------------------------------ */
exports.linkParentToStudent = onCall(async (request) => {
  assertAdmin(request);
  const { parentUid, studentUid } = request.data || {};
  if (!parentUid) throw new HttpsError("invalid-argument", "parentUid is required.");

  await db.ref(`parents/${parentUid}/studentUids`).set(studentUid ? { [studentUid]: true } : {});
  return { ok: true };
});

/* ------------------------------------------------------------
   deleteAccount({ uid })
   Admin-only. Removes the Auth user and their database records.
   Use with care — this permanently deletes a student's attempt
   history along with their login.
   ------------------------------------------------------------ */
exports.deleteAccount = onCall(async (request) => {
  assertAdmin(request);
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");

  const userSnap = await db.ref(`users/${uid}`).once("value");
  const role = userSnap.exists() ? userSnap.val().role : null;

  await admin.auth().deleteUser(uid).catch(() => {}); // already-deleted auth user shouldn't block DB cleanup
  const updates = { [`users/${uid}`]: null };
  if (role === "student") updates[`students/${uid}`] = null;
  if (role === "parent") updates[`parents/${uid}`] = null;
  await db.ref().update(updates);
  return { ok: true };
});
