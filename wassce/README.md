# MathCloud Tutorial — WASSCE Self-Tutoring Platform

A modern React/Vite starter for a WASSCE preparation platform with:

- Student email/password login stored in Realtime Database (as requested)
- Admin login through Firebase Authentication
- One-device account locking with admin revoke
- WASSCE subject catalogue
- Topic/lesson library with MathJax
- UCAT-inspired interface patterns: timed diagnostic, question navigation, aptitude-style presentation, randomised practice
- Question bank import from Excel
- Explanations, difficulty, subtopic and skill metadata
- Student performance history
- Responsive/mobile layout
- Offline banner and Firebase Realtime Database persistence-ready architecture
- PWA manifest
- Starter WASSCE-style content
- Admin assignment screen
- Contact/help modal for device-lock assistance

## Important security architecture note

The requested "students authenticate only against Realtime Database, not Firebase Authentication" is implemented as a compatibility/demo design: passwords are PBKDF2-hashed in the browser and only hashes/salts are stored.

For a production education platform, this is **not equivalent to Firebase Authentication**. A client-accessible credential store cannot provide the same security guarantees as a server-controlled identity provider. If account security is critical, use Firebase Authentication for students too, then keep all student profile/course/progress/question data in Realtime Database. The current architecture is therefore best treated as a prototype until that decision is changed.

The included database rules are intentionally conservative for admin-owned content, but the custom student-login paths cannot be made as strong as Auth-backed paths without authenticating the student.

## Firebase setup

1. Create a Firebase project.
2. Enable Realtime Database.
3. Enable Authentication -> Email/Password for **admins**.
4. Create the admin account in Firebase Authentication.
5. Copy `.env.example` to `.env` and fill in the web app configuration.
6. Apply `database.rules.json` in Realtime Database Rules.
7. Run:

```bash
npm install
npm run dev
```

For production:

```bash
npm run build
```

Deploy the `dist` directory to Firebase Hosting, Vercel, Netlify, etc.

## Excel question format

Use the included `public/sample-wassce-questions.xlsx`.

Columns:

`id, subject, topic, subtopic, difficulty, type, question, optionA, optionB, optionC, optionD, answer, explanation, skill`

Math and science questions may contain TeX such as:

`Solve \\(2x+3=9\\).`

The platform renders TeX using MathJax.

## PDF topics

The current UI supports a topic record that can be extended with a PDF URL. For a production deployment, use Firebase Storage with admin-only upload rules and store the resulting download URL in the topic record.

## Content scope

The current subject catalogue reflects the WAEC Nigeria entry information available at the time this project was created. WAEC states that 2026/2027 candidates have English Language and General Mathematics as the two core subjects, with other subjects selected to make 8–9 total subjects; Citizenship and Heritage Studies and Digital Technologies are listed as new subjects not examined until 2028. See the official WAEC source for the current entry rules.

Do not copy copyrighted WAEC examination questions wholesale into the system without appropriate rights. The starter questions are original WASSCE-aligned examples. For past-paper ingestion, ensure you have the necessary rights/licences.

## Planned production enhancements

- Firebase Authentication for students (recommended)
- Cloud Functions / trusted server for atomic device enforcement
- Firebase Storage PDF upload
- Group assignment UI
- Full topic curriculum mapping
- Question versioning and moderation workflow
- Audit logs
- Scheduled diagnostic tests
- Adaptive difficulty engine
- More granular analytics: topic mastery, time/question, distractor analysis, streaks
- Voice reading controls using browser speech synthesis with natural voices where the device/browser provides them
- Accessibility settings, keyboard navigation and screen-reader labels


## Subscription system

The starter now includes:

- ₦3,000/month subscription pricing
- Multiple months can be purchased at once
- Subscription expiry timestamp in Realtime Database
- Student access lock after expiry
- Questions, diagnostics and topic notes are disabled when expired
- Student payment instructions for Opay:
  - Account: 9129225442
  - Name: Marshall Jacob
- WhatsApp receipt link
- Admin subscription management
- Admin can activate/extend subscriptions after confirming payment
- Admin can force-expire a subscription

The subscription timestamp should be trusted only when written by an authenticated admin. The client should not be allowed to change subscription records in production. Move subscription validation and writes behind authenticated server logic/Cloud Functions before public launch.
