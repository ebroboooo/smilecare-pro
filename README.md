# SmileCare Pro

Clinic software for one dental practice. Staff sign in with a real account. Patients, appointments, payments, and the tooth chart are stored in SQLite on the clinic server.

This repository is proprietary. It is not licensed for reuse.

## Start in 5 minutes

Requirements: Node.js 22.

```powershell
cd <this-repo>
powershell -File scripts\setup-clinic.ps1
npm install
npm run dev
```

1. Open http://localhost:5173.
2. The first screen creates the clinic owner. There is no default password.
3. Sign in, then open Settings and set the clinic name, Arabic or English, and EGP.
4. Add a doctor and a service, then book a visit from the calendar.

The first day is written out in `docs/TUTORIAL.md` (English and Arabic).

`npm run dev` starts the API on port 3001 and the website on port 5173. The website sends `/api` to the API.

## Production

Set `SESSION_SECRET` to a unique value of at least 32 characters. `NODE_ENV=production` refuses to start with the sample secret.

```powershell
npm run build
npm start
```

`start.bat` and `start.sh` install dependencies, build, and start the API. In production the API also serves the built website.

See `docs/DEPLOY.md` for Docker and a Caddy sample, and `docs/BACKUP_RESTORE.md` for the database copy.

## Demo mode

`VITE_DEMO_MODE=true` keeps data in the browser and shows a demo banner. It is not the clinic installation. Do not use it for patient records.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

## Documents

- `docs/TUTORIAL.md` — first day in the clinic, English and Arabic
- `docs/INSTALL.md` — install on this computer
- `docs/ADMIN_GUIDE.md` — what the owner, reception, and doctor can do
- `docs/MESSAGING.md` — connect Telegram, and prepare WhatsApp
- `docs/QA_MANUAL.md` — what was tested on 12 Nov 2026
- `docs/REVIEW_REPORT.md` — independent commercial verification
- `docs/PHASES.md` — phases 0–5 and the files that landed
- `docs/DECISIONS.md` — choices made while building
- `docs/PERMISSIONS.md` — who can call which API
- `docs/PRIVACY.md` — what is stored, without a compliance claim
- `docs/FINAL_REPORT.md` — what is finished and what is not
