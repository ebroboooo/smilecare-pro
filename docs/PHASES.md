# Phases 0–5

The commercial build was already committed before the messaging and tutorial follow-up. This page records what each phase put in the repository. Status details are in `docs/FINAL_REPORT.md`.

| Phase | Commit | What landed |
|---|---|---|
| 0 Audit | `fd72912` | `docs/AUDIT_REPORT.md`. Honest gaps before the rebuild: browser-only data, fake payment toggles, no real staff accounts |
| 1 Clinic API | `be25fdd` | `server/` Express API, `server/migrations/001_core.sql`, SQLite, argon2id owner setup, httpOnly session, roles |
| 2 Booking | `30abd15` | `server/src/availability.ts`, `server/src/routes/public.ts`. Slot checks, public booking, consent-ready flow, one winner when two people take the same time |
| 3 Telegram | `ff3d7b1` | `server/src/telegram.ts`. grammY long poll, staff confirm/cancel, one-time patient link, reminder recorded once. Token stays on the server |
| 4 Dental chart | `21876bd` | `server/migrations/002_dental.sql`, `server/src/routes/dental.ts`, `src/components/Customers/DentalChart.tsx`. Adult FDI chart, visit notes, cash/card payments, balance |
| 5 Privacy and packaging | `d54f807` | `server/src/routes/privacy.ts`, `docs/PRIVACY.md`, `docs/BACKUP.md`, `docs/DEPLOY.md`, `docs/PERMISSIONS.md`, Dockerfile, compose, `start.bat`, `start.sh`, GitHub Actions in `.github/workflows/ci.yml` |

Later the same day, staff Arabic and simpler labels were filled through `src/utils/translations.ts`, and messaging gained a bot username, a reminder-hour setting, and a WhatsApp Cloud API test that does not report success unless Meta returns a message id (`server/migrations/002_messaging.sql`, `server/src/whatsapp.ts`).
