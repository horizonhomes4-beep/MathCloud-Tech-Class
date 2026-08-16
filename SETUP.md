# MathCloud UCAT Coaching — multi-user setup

This turns the single-file app into three pages (`student.html`,
`admin.html`, `parent.html`) sharing one login (`login.html`), backed by
real Firebase Authentication. Admins create every student and parent
account from inside `admin.html` — nobody self-signs-up.

You'll need: the [Firebase CLI](https://firebase.google.com/docs/cli)
(`npm install -g firebase-tools`) and Node.js installed on your own
computer. None of this can be deployed from inside a chat — these are
one-time steps you run yourself, in a terminal, in this folder.

## 1. Turn on Email/Password sign-in

Firebase Console → your project (`memory-87b65`) → **Authentication** →
**Sign-in method** → enable **Email/Password**.

## 2. Install the Firebase CLI and log in

```
npm install -g firebase-tools
firebase login
```

## 3. Point this folder at your project

Rename `.firebaserc.example` to `.firebaserc` (it already has your
project ID filled in).

## 4. Deploy the database security rules

```
firebase deploy --only database
```

This makes `database.rules.json` live — it's what actually enforces
"students can only see their own data, parents can only see their
linked child, only admins can manage the question bank."

## 5. Install and deploy the Cloud Functions

The Accounts page in `admin.html` calls two small Cloud Functions
(`createAccount`, `linkParentToStudent`) to create logins — this needs
a paid **Blaze** plan (Cloud Functions require it), but the free tier
of Blaze covers this kind of usage easily for a small coaching practice.

```
cd functions
npm install
cd ..
firebase deploy --only functions
```

## 6. Deploy the site itself

```
firebase deploy --only hosting
```

Or just upload all the `.html`/`.js`/`.css` files (everything except
the `functions/` folder) to whatever static host you're already using
— they don't require Firebase Hosting specifically.

## 7. Create your first admin account — visit setup.html

Open `setup.html` in your browser and fill in your name, email, and
a password. This calls a Cloud Function (`bootstrapFirstAdmin`) that
checks whether any admin already exists for this project — since
none does yet, it creates yours and signs you straight in.

**`setup.html` only works once.** As soon as one admin exists, it
self-disables (the Cloud Function refuses, and shows a message
pointing back to `login.html`) — no need to remove or hide the page.
Every account after this, including any additional admins (e.g. a
second tutor), gets created from **admin.html → Accounts** instead,
which requires being signed in as an admin already.

*(There's also a `functions/bootstrap-admin.js` script that does the
same thing from a terminal with a Firebase service account key —
useful if you're ever locked out and need to create an admin without
a browser, but `setup.html` is the normal path.)*

## 8. Sign in

Go to `login.html`, sign in with the admin account from step 7, and
you'll land on `admin.html` → **Accounts**, where you can create
student, parent, and additional admin logins. Share each person's
email + temporary password with them directly — they sign in at the
same `login.html` and are routed to the right page automatically
based on their role.

---

## How it fits together

- **`shared.js`** — Firebase setup, the question bank, and every
  database read/write, used by all three pages.
- **`login.html`** — the one login page for every role.
- **`setup.html`** — one-time page to create the first admin account;
  self-disables once an admin exists.
- **`student.html` / `student-app.js`** — practice sessions, mock
  tests, mistake bank, and the student's own progress.
- **`admin.html` / `admin-app.js`** — roster overview, per-student
  detail + target score, account creation, question bank, Excel
  import, exam-format settings.
- **`parent.html` / `parent-app.js`** — read-only view of a linked
  child's placement score, target progress, and recent sessions.
- **`functions/index.js`** — the only code allowed to create Auth
  accounts or change who's linked to whom; everything it does is
  gated on the caller having the `admin` custom claim.
- **`database.rules.json`** — the actual access control. Custom
  claims are the source of truth for "who can read/write what,"
  not anything the browser code decides on its own.

## Known simplification worth knowing about

A student's database write access currently covers their whole
`/students/{uid}` subtree, which technically includes their own
`targetScore` (even though the student UI never shows a way to edit
it — only admin's per-student page does). If you want to fully lock
that down so a technically-inclined student *can't* edit their own
target via the browser console, that needs per-field rules or moving
target score into a path only admin can write to — worth doing before
this handles anything high-stakes, but not blocking for day-to-day use.
