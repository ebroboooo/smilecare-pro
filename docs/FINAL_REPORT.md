# SmileCare Pro — final report

Date: 2026-11-12. This report matches the requirement IDs in `docs/AUDIT_REPORT.md`. Status is what is in the repository after Phases 1–5, not what the audit found.

## Commits

| Phase | SHA | Subject |
|---|---|---|
| 0 | `fd72912` | Audit |
| 1 | `be25fdd` | Clinic API, SQL persistence, staff sign-in |
| 2 | `30abd15` | Availability and public booking |
| 3 | `ff3d7b1` | Telegram alerts on the API |
| 4 | `21876bd` | Tooth chart, visit notes, balances |
| 5 | `d54f807` | Privacy, backup, packaging |

## Verification run for Phase 5

| Command | Result |
|---|---|
| `npm run typecheck` | Exit 0. Web `tsc -b` and server `tsc` (app and tests). |
| `npm test` | Exit 0. Vitest 12 tests in 6 files: auth 5, booking 2, telegram 1, dental 1, privacy 2, config 1. |
| `npm run lint` | Exit 0. Three existing `react(only-export-components)` warnings in ToastContext, AuthContext, and AppContext. |
| `npm run build` | The first combined run compiled the website (119 modules) and the server, then the shell log hit `ENOSPC` on the system drive. A second run, `npm run build -w smilecare-server` then `npx vite build`, exited 0. Vite again built 119 modules. |

Browser, against the running dev servers (`http://localhost:5173`, API on port 3001, existing clinic database):

- `/privacy` shows the privacy page, including that this is a description of the installation and that card numbers are not stored.
- `/book/smilecare-clinic` loads SmileCare Dental Clinic, Exam at 500 EGP, and Dr. Sara Nabil. Open times for 2026-11-13 omit 10:00, which is already booked. Step 2 shows the required consent checkbox. Checking it marks the box checked. The form was not submitted.
- The owner profile for Public Patient shows Export record and Anonymize, the visit "2026-11-12 Sensitivity", and "Charges 500 · Paid 200 · Balance 300". Export was not downloaded in the browser. The API test covers export and anonymize.

## Requirement table

| ID | Status | What is true now |
|---|---|---|
| DATA-1 | Done | Express + TypeScript in `server/`, SQLite via `better-sqlite3`, SQL migrations applied at startup. |
| DATA-2 | Done | Queries use bound parameters. |
| DATA-3 | Done | Users, sessions, patients, appointments, audit, soft delete, dental tables. |
| DATA-4 | Done | One settings row is the clinic. `CLINIC_ID` is the string `clinic`. |
| DATA-5 | Done | Appointment instants are UTC. Clinic timezone uses Luxon, default `Africa/Cairo`. |
| DATA-6 | Done | `npm run seed:demo` exists. The first-run screen creates the owner. There is no default owner password. |
| DATA-7 | Done | `ApiRepository` is the default. Demo mode is the other path. |
| DATA-8 | Done | localStorage is used only when `VITE_DEMO_MODE=true`, and that mode shows a banner. |
| DATA-9 | Done | Firestore and the Firebase client are removed. |
| DATA-10 | Partial | Patients, appointments, and inquiries accept `page` and `pageSize`. The staff screens still request the full list. |
| AUTH-1 | Done | argon2id. |
| AUTH-2 | Done | First-run owner setup. |
| AUTH-3 | Done | httpOnly `sid` cookie, 12 hours, `SameSite=Lax`. |
| AUTH-4 | Done | Five failed sign-ins lock the account for 15 minutes. |
| AUTH-5 | Done | Mutating routes require `X-Requested-With: XMLHttpRequest`. CORS is the configured client origin. |
| AUTH-6 | Done | Owner, receptionist, and doctor are enforced on the server. Doctor calls to owner/receptionist routes return 403 in tests. |
| AUTH-7 | Done | `docs/PERMISSIONS.md` plus the API tests. |
| AUTH-8 | Done | Owner can create staff, deactivate them, and reset a password. A temporary password must be changed before other routes work. |
| AUTH-9 | Done | The commercial UI has no demo login. Reset-demo stays behind demo mode. |
| SEC-1 | Done | helmet, zod, and a 1 MB body limit. |
| SEC-2 | Done | Audit rows are append-only. There is no update or delete route for them. |
| SEC-3 | Done | Secrets come from the environment or `server/.env`, which is gitignored. Production refuses a missing, default, or short `SESSION_SECRET`. |
| SEC-4 | Partial | Vulnerabilities were documented in `docs/DECISIONS.md` and were not patched with `npm audit fix --force`. The last recorded `npm audit` after adding grammY was 7 vulnerabilities (1 moderate, 4 high, 2 critical). It was not re-run at the end of Phase 5. |
| SEC-5 | Done | React renders text. No `dangerouslySetInnerHTML` was added. |
| BOOK-1 | Done | The server checks schedule, breaks, time off, holidays, and existing appointments. |
| BOOK-2 | Done | The check and insert run in an immediate transaction. The test books the same slot twice and accepts one. |
| BOOK-3 | Done | `/api/public` is rate-limited (skipped when `NODE_ENV=test`). |
| BOOK-4 | Done | Public bookings start as Pending. The reference is a separate random token. |
| BOOK-5 | Done | Cancel and reschedule use a manage token stored as a SHA-256 hash. The reschedule form asks for a time; the API rejects a time that is not an open slot. |
| BOOK-6 | Done | Settings store notice, how far ahead, the cancel window, and the slot interval. |
| BOOK-7 | Done | Status changes follow the server transition rules. |
| BOOK-8 | Done | Promoting a waitlist entry books the first open slot in the requested part of the day. Demo mode still uses 09:00. |
| UI-1 | Done | Day and Month calendar views use local dates. |
| UI-2 | Done | Clinic holidays and doctor time off have a screen and API. |
| UI-3 | Done | The landing page and the inquiry count come from clinic data. The old "+24%" inquiry badge is gone. |
| UI-4 | Done | Stripe, PayPal, WhatsApp, and Google Calendar controls are gone. Payments are Cash or Card at the clinic. |
| UI-5 | Done | The landing contact form creates a lead through the API. |
| UI-6 | Done | The public site shows the clinic name, services, and doctors from the API. |
| UI-7 | Done | The app has an error boundary. Booking, calendar, and the tooth chart show empty and error states for the paths that were built. |
| I18N-1 | Partial | Landing and public booking switch between English and Arabic, including RTL. Many staff screens stay English. |
| I18N-2 | Partial | Closure labels, the tooth chart, privacy controls, and other staff strings are still hardcoded English. |
| NOTIF-1…8 | Partial | The API runs a grammY long poll, staff confirm/cancel buttons, a one-time patient `/start` token, and a reminder loop that records each upcoming reminder once. Settings keep the token write-only. A live Telegram chat was not used in this session, so delivery to a real chat was not observed. The reminder loop is inside the API process, not an external cron. |
| DENT-1 | Done | Adult FDI tooth chart. Conditions: Sound, Caries, Filled, Missing, Crown, Root canal. |
| DENT-2 | Done | Visit notes with date, complaint, diagnosis, and treatment. |
| DENT-3 | Missing | No treatment plans. |
| DENT-4 | Done | Payments and a balance of non-cancelled appointment fees minus recorded payments. Doctors cannot record a payment. |
| DENT-5 | Missing | No file attachments. |
| DENT-6 | Missing | No medical-alert banner. |
| DENT-7 | Partial | Reports still summarize appointments and recorded amounts. They are not a new clinical report pack. |
| PRIV-1 | Done | Public booking requires consent. `/privacy` and `docs/PRIVACY.md` do not claim legal compliance. |
| PRIV-2 | Done | Staff can export one patient. The owner can anonymize contact details. History remains. |
| PRIV-3 | Done | Request logs store method, path, and status. The bot token is redacted and is not returned by the API. |
| PRIV-4 | Done | `docs/PRIVACY.md`. |
| OPS-1…9 | Partial | Backup command, restore steps, Dockerfile, compose file, Caddy sample, nginx sample in `docs/DEPLOY.md`, `start.bat`, `start.sh`, setup script, request logging, and shutdown of the bot and database are in the repo. A daily schedule was not installed. Docker was not started here. |
| TEST-1 | Partial | Server tests cover auth, booking, telegram token handling, dental permissions, privacy, and the production secret check. There is no broad unit suite for the React screens. |
| TEST-2 | Done | API tests use supertest against a temporary database. |
| TEST-3 | Missing | Playwright is not installed and no browser smoke runs in CI. |
| TEST-4 | Done | `.github/workflows/ci.yml` runs install, typecheck, lint, test, and build on Ubuntu. |
| DOC-1 | Done | README describes the clinic installation. The MIT and Firebase badges are gone. |
| DOC-2 | Done | `docs/DEPLOY.md`, `docs/BACKUP.md`, `docs/PRIVACY.md`, `docs/PERMISSIONS.md`, `docs/DECISIONS.md`. |
| DOC-3 | Done | `LICENSE` is a proprietary placeholder. It is not an open-source grant. |

## Follow-up the same day

Messaging and a manual pass are in `docs/QA_MANUAL.md` and `docs/MESSAGING.md`.

- Telegram settings now include the bot username and the reminder window in hours. The token is still write-only. A test with a fake token returned 502 and was not marked sent.
- WhatsApp settings save the Cloud API phone number ID, business account ID, test recipient, and a write-only access token. Patient WhatsApp reminders are not sent and the screen says coming soon. A test is marked delivered only when Meta returns a message id. A fake token returned 502.
- A separate API on port 3011 passed 22 clinic checks: owner, doctor, service, patient, appointment, confirm, tooth chart, visit, payment, balance 300, public booking, and a rejected double book.
- The browser, signed in on the existing clinic, opened Home, Settings, Patients, the tooth chart, Calendar, and public booking in English and Arabic.
- A dashboard JSX error (two paragraphs inside one branch) was fixed before that browser pass.
- Clinic-facing instructions are in `docs/TUTORIAL.md`, `docs/INSTALL.md`, `docs/ADMIN_GUIDE.md`, and `docs/PHASES.md`.

## Remaining gaps

- Treatment plans, attachments, medical alerts, and a richer clinical report are not built.
- Patient WhatsApp reminders are not sent. Only a manual test to the owner's number can call Meta.
- Some calendar form labels inside the appointment dialog can still be English when the rest of the screen is Arabic.
- Playwright is not part of the project.
- Telegram and WhatsApp were not delivered to a real chat. Fake tokens were rejected.
- Docker and a nightly backup schedule are documented and were not executed on this machine.
- `npm audit` still reports toolchain vulnerabilities. They were not force-fixed.
- The public reschedule control is a time field. Invalid times are rejected by the API. It does not list open times for the new date.
- Demo mode remains a browser-only path with a banner. It is not the clinic installation.
