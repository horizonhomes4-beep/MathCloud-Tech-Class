/* ============================================================
   BOOTSTRAP-ADMIN.JS — run this ONCE, locally, to create your
   very first admin account. After that, use the Accounts page
   inside admin.html for every other account (students, parents,
   and any additional admins) — this script is a one-time
   chicken-and-egg fix, since the createAccount Cloud Function
   requires an existing admin to call it.

   Setup:
     1. Firebase Console → Project Settings → Service Accounts →
        "Generate new private key". Save the downloaded file as
        serviceAccountKey.json in this same functions/ folder.
        (Never commit this file or share it — it grants full
        admin access to your Firebase project.)
     2. cd functions && npm install
     3. node bootstrap-admin.js you@example.com "a-strong-password" "Your Name"
   ============================================================ */
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

const [,, email, password, displayName] = process.argv;
if (!email || !password) {
  console.error("Usage: node bootstrap-admin.js <email> <password> [displayName]");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});

(async () => {
  const user = await admin.auth().createUser({ email, password, displayName: displayName || email });
  await admin.auth().setCustomUserClaims(user.uid, { role: "admin" });
  await admin.database().ref(`users/${user.uid}`).set({
    role: "admin", email, displayName: displayName || email, createdAt: Date.now()
  });
  console.log(`Admin account created: ${email} (uid: ${user.uid})`);
  console.log("You can now sign in at login.html and create every other account from the Accounts page.");
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
