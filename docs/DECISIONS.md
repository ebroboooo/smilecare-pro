# Decisions

## 2026-11-12 — Phase 1

- The API is Express + TypeScript in `server/`, with SQLite through `better-sqlite3`. Numbered SQL files in `server/migrations/` run automatically at startup.
- Primary keys are integers. JSON responses use those ids as strings so the existing screens keep working. A booking reference is a separate 12-character token.
- Staff roles are `owner`, `receptionist`, and `doctor`. The old `SuperAdmin` / `BusinessOwner` / `Receptionist` / `Employee` labels are gone.
- One settings row is the clinic. The old `org-smilecare-pro` tenant id is not stored.
- Appointment instants are UTC. The clinic timezone defaults to `Africa/Cairo` (Luxon).
- Sessions are httpOnly cookies, 12 hours, `SameSite=Lax`. Mutating requests must send `X-Requested-With: XMLHttpRequest`.
- Passwords are argon2id. Five failed sign-ins lock the account for 15 minutes. Errors stay generic.
- The React app talks to the API by default. `VITE_DEMO_MODE=true` is the only localStorage path, and it shows a demo banner.
- Firestore and the Firebase client were removed.
- Fake Stripe, PayPal, WhatsApp, and Google Calendar controls were removed. Payment in the product is pay-at-clinic (`Cash` or `Card`).
- Creating an appointment already rejects an overlapping doctor booking inside a write transaction. Schedules, holidays, and the public booking API are Phase 2.
- `npm audit` on 2026-11-12, after Firebase was removed: 12 vulnerabilities (2 critical, 8 high, 2 moderate). They are in the toolchain and libraries we did not patch with `--force`: `tinypool`/`vitest` (dev-only test runner), `vite`/`launch-editor` (dev server), `postcss`, `browserslist`, `nanoid`, `source-map-js`, `react-router` (the reported issue is RSC mode, which this SPA does not use), and `zod` (very large payloads; the API rejects bodies over 1 MB). No `--force` downgrade was applied.

## 2026-11-12 — Phase 2

- A slot is bookable only when the doctor is scheduled that weekday, outside breaks, time off, and clinic closures, and no other active appointment overlaps. Public booking also enforces the notice window and how far ahead patients may book. Staff can still record a time that has already passed.
- The overlap check runs inside a SQLite immediate transaction. Two requests for the same slot cannot both commit.
- Public booking does not require a staff session. It returns a reference and a one-time manage token. The token is stored as a SHA-256 hash. Cancel and reschedule use that token and honor the cancellation window.
- A filled honeypot field (`companyWebsite`) is acknowledged and not saved.
- Waitlist promotion books the first open slot that matches Morning, Afternoon, Evening, or Any. It does not invent 09:00.
- Appointment status changes follow Pending → Confirmed or Cancelled, then Confirmed → Completed, Cancelled, or No Show. Completed, Cancelled, and No Show do not change again.
- The public site reads the clinic name, services, and doctors from the API. The contact form creates a lead. Payment copy stays pay-at-clinic.
- Landing and the public booking page switch between English and Arabic, including RTL. Staff screens that already had translations keep them; closure labels on the calendar stay English.

## 2026-11-12 — Phase 3

- Telegram runs only on the API, using grammY long polling. The bot starts when a token is saved and alerts are turned on. The web app never receives the token back; the settings response has `telegramTokenSet` and the chat id only.
- Staff alerts include Confirm and Cancel buttons. A patient link is a one-time `/start` token stored as a hash. Reminders for the next 24 hours are recorded in `reminders` and are not sent twice for the same appointment.
- The in-app notification list was already loaded from `/api/notifications`. Public bookings add a row there as well as a Telegram alert when the bot is configured.

## 2026-11-12 — Phase 4

- The tooth chart uses adult FDI numbers 11–18, 21–28, 31–38, and 41–48. A finding is Sound, Caries, Filled, Missing, Crown, or Root canal. Doctors and receptionists can update it. Teeth with no finding stay Sound and are not stored.
- A visit is a dated note with complaint, diagnosis, and treatment. It is not a treatment plan.
- Balance is the sum of appointment fees, excluding cancelled appointments, minus cash and card payments recorded for that patient. Doctors can read the balance. Only an owner or receptionist can record a payment.
- Treatment plans, file attachments, medical-alert banners, and richer reports are not in this phase.

## 2026-11-12 — Phase 5

- A public booking is stored only when the request includes `consent: true`. The form has a required checkbox and a link to `/privacy`. The privacy page describes what this installation stores. It does not claim GDPR, HIPAA, or any other certification.
- Any signed-in staff member can export one patient as JSON. Only the owner can anonymize. Anonymize replaces the name and contact fields, clears notes and the Telegram link, and keeps appointments, visits, the tooth chart, and payments.
- Request logs record the method, path, and status. They do not record the body. The bot token is redacted and is not written back to the browser.
- `npm run backup` in `server/` uses SQLite's online backup. Restore is documented as stop, replace the file, start. The repository does not install a daily schedule.
- Production mode serves the built website from the API. `Dockerfile`, `docker-compose.yml`, and `Caddyfile` are samples. They were not launched in this session. `start.bat` and `start.sh` install, build, and start. `scripts/setup-clinic.ps1` writes `server/.env` only when that file is missing, including a generated `SESSION_SECRET`.
- GitHub Actions runs install, typecheck, lint, test, and build. Playwright is not installed, so there is no browser job.
- The API reads `server/.env` or `.env` for variables that are not already set. A variable already in the process environment wins.

## 2026-11-12 — Messaging follow-up

- Telegram settings now also store the bot username and how many hours before a visit to send the one reminder (1–72, default 24). The patient link uses `https://t.me/<username>?start=...` when a username is saved.
- WhatsApp Cloud API credentials (phone number ID, business account ID, test recipient, access token) are stored on the server. The token is not returned to the browser.
- A WhatsApp or Telegram test is `delivered: true` only after the provider accepts it. The automated test runner does not call Meta or Telegram and returns 501 for the WhatsApp test route. A fake token against the live adapter returns 502 and is not recorded as sent.
- Patient WhatsApp reminders are not sent. The settings screen says coming soon. Only the explicit test button calls Meta, and only to the number the owner typed.
