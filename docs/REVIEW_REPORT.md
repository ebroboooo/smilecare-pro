# SmileCare Pro — Independent Verification Report

**Date:** 2026-11-12  
**Verifier workspace:** `E:\Projects\Project2_reservation_system`  
**Rule:** No application code/tests/migrations/config modified during this review. Evidence from commands run and files read. Secrets redacted.

---

## Summary for reviewer (max 30 lines)

**Verdict: Ready for a supervised pilot with one clinic — not ready to sell as-is.**

| Gate | Result |
|------|--------|
| 1 Security blockers | **PARTIAL** |
| 2 Core function | **PARTIAL** |
| 3 Differentiators / notifications | **PARTIAL** |
| 4 Operations | **FAIL** |
| 5 Legal and trust | **PASS** (with doc gaps) |

**Top blockers before commercial sale**
1. Clean-room install from README/INSTALL **failed** here (`ENOSPC` on C: during `npm install`; docs hardcode `E:\Projects\Project2_reservation_system`).
2. Docker deployment **NOT VERIFIED** (`docker` not installed on PATH).
3. `npm audit`: **12 vulnerabilities (2 critical, 8 high, 2 moderate)** — not force-fixed; unexplained for sale.
4. Live Telegram delivery **NOT VERIFIED** (no real bot token in env this session).
5. Backup/restore end-to-end **NOT VERIFIED** in this session; `docs/API.md`, `docs/BACKUP_RESTORE.md`, `CHANGELOG.md` **missing**.

**What was verified:** typecheck/lint/tests/build green; security probe (auth, CSRF, roles sample, SQLi create, 20-way double-book → 1 success); production `SESSION_SECRET` refusal; proprietary LICENSE; demo mode build-time gated.

**Not verified:** Docker; clean-room first-run UI; live Telegram/WhatsApp; Playwright screenshots; 5k/20k load test; DST booking; XSS in browser print/CSV; nightly backup restore; CI run on GitHub Actions (workflow exists only).

---

## A. Repository state

### Git

| Item | Evidence |
|------|----------|
| Branch | `main` |
| Ahead of origin | **9 commits** (not pushed at review start): tip `6c5fa78` |
| Working tree | Review started with commercial commits present; this report adds docs only |
| Recent log (abbrev) | `6c5fa78` messaging/QA docs → `3e5ce50` Telegram/WhatsApp → `d54f807` Phase 5 → … → `fd72912` Phase 0 audit → older portfolio history |

Commands: `git status -sb`, `git log --oneline -n 50`, `git rev-parse --abbrev-ref HEAD`.

### Tree (2–3 levels, excluding node_modules/dist/.git)

Root: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `LICENSE`, `README.md`, `start.bat`, `start.sh`, `package.json`, `.env.example`, `vite.config.ts`, `vercel.json`, `TECHNICAL_DOCUMENTATION.txt`  
`docs/` — AUDIT/FINAL/PHASES/QA/MESSAGING/TUTORIAL/INSTALL/…  
`server/` — `src/`, `test/`, `migrations/`, `data/`, `.env.example`, `package.json`  
`src/` — `components/`, `context/`, `db/`, `types/`, `utils/`  
`.github/workflows/ci.yml`, `scripts/`, `public/`, `screenshots/`, `assets/`

### Versions

| Tool / package | Version |
|----------------|---------|
| Node | v22.22.3 |
| npm | 10.9.8 |
| Root deps | react 19.2.7, react-router-dom 7.18.0, vite 8.1.0, typescript ~6.0.2 |
| Server deps | express 4.21.2, better-sqlite3 12.4.1, argon2 0.43.0, zod 3.25.76, helmet 8.3.0, grammy 1.46.0, luxon 3.6.1, vitest 3.2.4 |

### Secrets / env tracking

| Check | Result |
|-------|--------|
| Tracked env | Only `.env.example`, `server/.env.example` (`git ls-files` + listing) |
| Real `.env` tracked | **No** real `.env` listed as tracked |
| History | Old Firebase `VITE_FIREBASE_API_KEY` **references** in deleted code; example `SESSION_SECRET=dev-only-change-me` in examples/tests — placeholders, not live clinic secrets |
| Disk note | System drive **C:** ~77 MB free during review; project on **E:** ~236 GB free. Clean-room install used C: TEMP/npm cache → `ENOSPC` |

---

## B. Clean-room installation test

### Steps attempted

1. `git clone` local repo → `C:\Users\...\Temp\smilecare-review-cleanroom\repo` — **OK**
2. Read `README.md` / `docs/INSTALL.md` — both say `cd E:\Projects\Project2_reservation_system` (**path not portable**)
3. `scripts\setup-clinic.ps1` — content OK (writes `server\.env` with random secret)
4. `npm install` in cleanroom — **FAIL** `ENOSPC: no space left on device` (C: ~87 MB free at time)
5. First-run owner UI, login, patient, appointment, restart persistence in cleanroom — **NOT VERIFIED** (install never completed)
6. Production build in cleanroom — **NOT VERIFIED**
7. Production refuse default secret — **VERIFIED** via `assertProductionSecret` (`server/src/config.ts` L19–25): missing/default/short secrets throw *Refusing to start…*
8. Docker compose — **NOT VERIFIED** (`docker` not recognized on PATH)

### Existing workspace (not clean-room)

| Check | Result | Evidence |
|-------|--------|----------|
| `npm run typecheck` | Pass exit 0 | Terminal 448590 |
| `npm run lint` | Pass exit 0 (warnings) | Terminal 448591 |
| `npm test` | Pass **16/16** | Terminal 448591 |
| `npm run build` | Pass exit 0 | Terminal 448593; `dist` ~533 KB / 35 files |
| Demo mode in prod build | Build-time only `VITE_DEMO_MODE === 'true'` | `src/db/index.ts` L38 — not set in default build |
| Live stack earlier | Health 200 on :3001 / Vite :5173 | Prior session smoke |

**Defects for install docs:** hardcoded absolute path; no mention that npm cache on full C: can fail; Docker not runnable here.

---

## C. Automated checks

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** exit 0 |
| `npm run lint` | **PASS** exit 0 — 5 oxlint warnings (Fast Refresh ×3, exhaustive-deps ×2) |
| `npm test` | **PASS** 16 tests / 7 files |
| E2E / Playwright | **Missing** — no Playwright; TEST-3 Missing |
| `npm run build` | **PASS** exit 0 |
| Coverage | **NOT VERIFIED** — no coverage config/report found |
| `npm audit` | **FAIL** exit 1 — **12 vulns (2 critical, 8 high, 2 moderate)** |

### High / Critical audit findings (2026-11-12)

| Severity | Package | Notes |
|----------|---------|-------|
| Critical | `tinypool` (via vitest) | Prototype pollution / RCE gadget — fix wants vitest 5 force |
| High | `vite` 8.0–8.1.5 | Dev middleware / launch-editor issues |
| High | `react-router` / `react-router-dom` 7.12–7.18.1 | RSC CSRF advisory |
| High | `postcss`, `nanoid`, `browserslist`, `source-map-js` | Tooling DoS/disclosure |
| High | `zod` <4.6.6 | Memory exhaustion on oversized collections — force to zod 4 |
| Moderate | `@vitest/mocker`, `baseline-browser-mapping` | Dev/test |

### Test inventory by area

| Area | Files | Count (approx) |
|------|-------|----------------|
| Auth / lockout / roles | `server/test/auth.test.ts` | 5 |
| Booking conflict / public / honeypot | `server/test/booking.test.ts` | 2 |
| Telegram token / reminder once | `server/test/telegram.test.ts` | 1 |
| WhatsApp honesty | `server/test/whatsapp.test.ts` | 4 |
| Dental / payments permissions | `server/test/dental.test.ts` | 1 |
| Privacy export/anonymize | `server/test/privacy.test.ts` | 2 |
| Config / prod secret | `server/test/config.test.ts` | 1 |
| Slot generation unit suite | — | **0 dedicated** (logic covered indirectly via booking) |
| Backups | — | **0** |
| E2E | — | **0** |

Independent probe also: **20 concurrent public bookings → 1×201 + 19×409** (`scratch/security-probe-results.json`).

---

## D. Attack your own work (security verification)

Method: temporary `scratch/security-probe.ts` against in-process Express + temp SQLite on **E:** (not committed as app code). Results in `scratch/security-probe-results.json`.

| Attack | Result | Conclusion |
|--------|--------|------------|
| Protected GETs without login | All listed routes **401** | Auth gate works |
| Setup twice | 201 then **409** | First-run closed |
| Login `Set-Cookie` | `HttpOnly; SameSite=Lax`; Max-Age=43200; **Secure absent** in `NODE_ENV=test` | Matches `auth.ts` L133–139 (`secure: prod`) — **prod Secure flag NOT VERIFIED live** |
| CSRF without `X-Requested-With` | **403** | CSRF works |
| Doctor PATCH settings / GET users / POST patients / telegram-test | **403** | Matches PERMISSIONS for writes |
| Doctor GET settings | **200** | Settings **readable** by doctor (not write) — document as design |
| Receptionist GET users | **403**; POST patients **201**; PATCH settings **403**; GET audit **200** | Matches PERMISSIONS |
| Brute force 6 wrong passwords | Always **401** `"Invalid email or password"` | Messages generic; lockout **not distinguishable** in HTTP status (by design). Lockout covered by `auth.test.ts` (correct password still 401 after 5 fails) |
| Logout / logout-all | Subsequent `/auth/me` **401** | Server-side invalidation works |
| SQLi in patient name/phone/notes | Create **201**; patients still listable | Parameterized SQL holds |
| SQLi login | **400** | Rejected |
| XSS payloads stored | API **201** stores strings | **UI/print/CSV escaping NOT VERIFIED** in browser this session (React text nodes assumed; no `dangerouslySetInnerHTML` claimed in FINAL_REPORT) |
| 20 concurrent same slot | **1 success / 19 conflict** | Double-book protection holds |
| Past date / huge name | **409** / **400** | Rejected |
| Audit DELETE/PATCH | **401** (no session after logout-all path) / blocked | Append-only; no update/delete routes found |
| CORS evil origin | `Access-Control-Allow-Origin` = configured origin, **not** evil | Locked CORS |
| Helmet | `x-content-type-options: nosniff` present | Partial helmet check |
| Public rate-limit hammer | **NOT VERIFIED** in probe (`NODE_ENV=test` skips limiter per FINAL_REPORT) |
| Uploads `.exe`/50MB | **N/A** — DENT-5 attachments **Missing** |
| Bundle secret scan | Select-String on `dist/assets/index-*.js` for `SESSION_SECRET`/`argon2`/`telegramBotToken`/`dev-only-change-me` — **no hits in sample** | Token not in main chunk; full bundle grep **Partial** |
| Settings API returns bot token | Covered by `telegram.test.ts` / QA_MANUAL fake token 502 | Probe settings check after logout was unauth — rely on unit test |

---

## E. Functional verification vs original spec

Status column is **this reviewer’s** reading of code + commands; preferred evidence cited.

| ID | Requirement | Status | Evidence | Notes / defects |
|----|-------------|--------|----------|-----------------|
| DATA-1 | Express+SQLite+migrations | Done | `server/`, `server/migrations/001_core.sql` (+002_*) | |
| DATA-2 | Parameterized SQL | Done | `availability.ts` L46–53 `.prepare(...).get(?)` | Spot-checked |
| DATA-3 | Full schema | Done | migrations | |
| DATA-4 | No org hardcode SoT | Done | settings row / `CLINIC_ID` | |
| DATA-5 | UTC + Luxon TZ | Done | `time.ts`, `availability.ts` | DST edge **NOT VERIFIED** |
| DATA-6 | seed + first-run | Done | `seed.ts`, `/api/setup` | |
| DATA-7 | ApiRepository | Done | `src/db/apiRepository.ts`, `index.ts` | |
| DATA-8 | Demo only build-time | Done | `VITE_DEMO_MODE` | |
| DATA-9 | Firestore removed | Done | no firebase deps in package.json | |
| DATA-10 | Server pagination | Partial | API accepts page; UI still full list (FINAL_REPORT) | |
| AUTH-1…9 | Auth suite | Done/Partial | tests + probe | Full route×role matrix **Partial** (sample only) |
| SEC-1…3 | Hardening | Done | app.ts helmet/cors/1mb; config refuse | |
| SEC-4 | npm audit | Partial | 12 vulns open | Blocker |
| SEC-5 | XSS | Partial | Store OK; render **NOT VERIFIED** | |
| BOOK-1…8 | Booking | Done | availability + booking.test + probe concurrency | Public rate limit skipped in test |
| UI-1…7 | UI | Partial | Calendar/day-month claimed; e2e this session limited | Fake +24% removed per FINAL |
| I18N-1…2 | Arabic | Partial | Public AR verified earlier QA; staff English remains | Naive key script unreliable (nested objects) |
| NOTIF-* | Telegram | Partial | Code+unit tests; live **NOT VERIFIED** | WhatsApp patient reminders Coming soon |
| DENT-1,2,4 | Chart/visits/pay | Done | dental.test + QA | |
| DENT-3,5,6 | Plans/files/alerts | Missing | — | |
| DENT-7 | Reports | Partial | Appointment-based | |
| PRIV-1…4 | Privacy | Done | privacy routes + docs | |
| OPS-* | Ops | Partial | Docker/backup schedule not run | |
| TEST-1…4 | Tests | Partial | No Playwright; CI file exists unrun here | |
| DOC-* | Docs | Partial | Missing API.md, BACKUP_RESTORE.md, CHANGELOG.md | INSTALL path hardcoded |

**Fake data search:** `+24%` gone from components (grep only “Coming soon” WhatsApp strings).  
**5000 patients load:** **NOT VERIFIED** (disk/time).  
**Audit log real entries:** unit/setup paths write audit; interactive UI audit **NOT VERIFIED** this session.

---

## F. Notifications (Telegram)

| Item | Status |
|------|--------|
| Live bot token / chat ID in environment | **NOT VERIFIED (live)** — none available |
| Mock/integration | `server/test/telegram.test.ts` — token not returned; reminder claimed once |
| Scheduler | `telegram.ts` `claimReminder` UNIQUE insert; loop in API process (`index.ts` L15) |
| Idempotency across restart | **NOT VERIFIED** live; DB unique constraint supports it |
| Patient message content (no service/medical) | **NOT VERIFIED** live; code review needed by reviewer in `telegram.ts` handlers |
| WhatsApp | Settings + test route; patient reminders **Coming soon** (`docs/MESSAGING.md`) |

---

## G. Operations, privacy, documentation

| Item | Status | Evidence |
|------|--------|----------|
| Backup script | Present | `server/src/backup.ts` — SQLite `.backup` API |
| Run backup + restore verify | **NOT VERIFIED** this session | |
| Patient export/anonymize | Present + tested | `privacy.test.ts`, `privacy.ts` |
| README | Commercial; proprietary | No MIT badge |
| LICENSE | Proprietary placeholder | Read L1–8 |
| docs/INSTALL.md | Exists; **wrong absolute path** | Defect |
| docs/BACKUP.md | Exists (not named BACKUP_RESTORE.md) | Spec name mismatch |
| docs/API.md | **Missing** | |
| CHANGELOG.md | **Missing** | |
| docs/PERMISSIONS.md | Exists | Sample matrix matches probe |
| Logging PII | Request log method/path/status only (`app.ts` L37–41) | Booking body not logged in that middleware |
| Bundle size | dist ~533 463 bytes / 35 files | After build |
| API cold start / memory after load | **NOT VERIFIED** | |
| CI | Workflow present | **NOT VERIFIED** on GitHub run |

### Documentation checklist

| File | Exists? | Complete? | Issues |
|------|---------|-----------|--------|
| README.md | Yes | Mostly | Hardcoded `E:\Projects\...` |
| docs/INSTALL.md | Yes | Partial | Same path; clean-room failed |
| docs/ADMIN_GUIDE.md | Yes | Yes | — |
| docs/API.md | **No** | — | Spec DOC-2 gap |
| docs/PERMISSIONS.md | Yes | Yes | — |
| docs/PRIVACY.md | Yes | Yes | No compliance claims |
| docs/BACKUP_RESTORE.md | **No** | — | Content in `docs/BACKUP.md` |
| docs/DECISIONS.md | Yes | Yes | — |
| CHANGELOG.md | **No** | — | |
| docs/MESSAGING.md | Yes | Yes | EN+AR |
| LICENSE | Yes | Proprietary | OK for Gate 5 |

---

## H. Commercial readiness gates

### Gate 1 — Security blockers — **PARTIAL**

| Criterion | Result |
|-----------|--------|
| Real password auth; no demo login in production | **PASS** (code + tests) |
| Server-side authorization | **PASS** sample + auth.test; full matrix Partial |
| Sessions httpOnly, invalidation, CSRF, brute-force | **PASS** with notes (Secure prod code-only; lockout generic 401) |
| No secrets in repo/bundle/API | **PASS** examples only; live bundle spot-check |
| No High/Critical vulns unexplained | **FAIL** — 2 critical + 8 high open |
| SQLi / XSS tests | **PARTIAL** — SQLi PASS; XSS store PASS, render NOT VERIFIED |

### Gate 2 — Core function — **PARTIAL**

| Criterion | Result |
|-----------|--------|
| Public booking AR/EN mobile | **PARTIAL** — prior QA AR/EN desktop; mobile viewport **NOT VERIFIED** this session |
| No double booking | **PASS** — probe 1/20 + booking.test |
| Staff manage entities | **PASS** — API/tests/QA |
| Persist across restart | **PARTIAL** — prior Phase 1 acceptance; clean-room **NOT VERIFIED** |

### Gate 3 — Differentiators — **PARTIAL**

| Criterion | Result |
|-----------|--------|
| Telegram live or credible tests | **PARTIAL** — credible unit tests; live missing |
| Dental features | Odontogram/visits/payments **Done**; attachments/plans/alerts **Missing** |

### Gate 4 — Operations — **FAIL**

| Criterion | Result |
|-----------|--------|
| Clean-room install from docs | **FAIL** |
| Backup/restore verified | **NOT VERIFIED** |
| Docker verified | **NOT VERIFIED** |
| CI passing | Workflow exists; **NOT VERIFIED** remote |

### Gate 5 — Legal and trust — **PASS**

Consent + privacy page + export/anonymize exist; no unsupported compliance claims found in PRIVACY; LICENSE proprietary (not MIT).

---

## Verdict and remaining work

**Ready for a supervised pilot with one clinic / Not ready to sell as-is.**

### Ordered blockers (est. hours)

1. Fix install docs (portable paths) + verify clean-room on machine with free disk — **2–4 h**
2. Address or formally waive High/Critical `npm audit` (upgrade vitest/zod/vite/react-router carefully) — **4–8 h**
3. Docker install + compose up/down persistence proof — **2–4 h**
4. Live Telegram Confirm/Cancel + reminder demo recorded — **2–3 h** (needs owner tokens)
5. Backup/restore dry-run + rename/add BACKUP_RESTORE + API.md + CHANGELOG — **3–5 h**
6. Playwright smoke (setup→book→calendar) + AR mobile screenshots — **6–10 h**
7. XSS print/CSV review + fuller role×route matrix automation — **4–6 h**
8. Optional before sale: attachments, medical alerts, treatment plans — **20–40 h**

### Top 10 buyer / clinic risks

1. Install fails on full system disk / wrong README path.  
2. Unpatched critical vitest/tinypool and high vite/router advisories.  
3. Operator never completes Telegram setup → silent “no alerts”.  
4. WhatsApp patient reminders advertised as Coming soon — staff may over-promise.  
5. Doctor can **read** full settings JSON (not token) — information disclosure vs least privilege.  
6. No attachment vault for X-rays.  
7. Staff UI still partly English in Arabic mode.  
8. No Playwright CI — regressions may ship.  
9. Single-process reminder loop dies if API process dies.  
10. Multi-user concurrency beyond double-book (reporting load) untested at scale.

---

## Screenshots

`docs/screenshots/` — **NOT VERIFIED / not captured** this session (Playwright not installed; disk pressure on C:; browser capture not re-run). Existing marketing images remain under repo `screenshots/`.
