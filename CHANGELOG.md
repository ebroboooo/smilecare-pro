# Changelog

All notable product changes for SmileCare Pro.

## 1.0.0 — 2026-11-12

### Added
- Express + SQLite clinic API with argon2id sessions, roles, CSRF, and audit log
- Public booking with server-side availability and double-booking protection
- Telegram staff alerts and patient reminder linking (server-side token)
- WhatsApp Cloud API settings and honest test send (patient reminders still coming soon)
- Tooth chart (FDI), visit notes, and patient payments/balances
- Privacy consent, patient export, owner anonymize, backup script
- Docker / Caddy samples, setup script, CI workflow
- Arabic/English for public site and many staff screens
- Independent review package under `docs/REVIEW_REPORT.md`

### Changed
- Removed Firebase / Firestore client path
- Removed demo staff login from the commercial UI
- Install docs use a portable repo path (not a fixed `E:\Projects\...` path)

### Known gaps
- Treatment plans, file attachments, medical-alert banners
- Playwright e2e not installed
- Live Telegram delivery depends on clinic bot credentials
