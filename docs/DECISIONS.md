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
