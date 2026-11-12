# SmileCare Pro — Phase 0 Audit Report

**Date:** 2026-11-12  
**Repository:** `E:\Projects\Project2_reservation_system` (remote: `https://github.com/ebroboooo/SmileCare-Pro.git`)  
**Commit audited:** `4f7823d` (working tree clean at audit start)  
**Scope:** Read-only inspection. **No application code was changed in Phase 0.**

---

## Executive verdict

SmileCare Pro is a **working portfolio SPA** (React 19 + TypeScript + Vite + Tailwind 4) with a rich admin UI and a public booking wizard. Default persistence is **localStorage mock data**. Authentication is **client-side simulation** (no password). Firestore is optional and **unsecured** (no rules in repo). Several UI features are stubs or show fake numbers.

**Commercial readiness:** not ready. Phases 1–2 (real API, SQL, auth, booking integrity) are blocking before sale to clinics.

---

## 1. Feature inventory

| Module | Status | Key paths | How verified |
|--------|--------|-----------|--------------|
| **Landing** | Partial | `src/components/Landing/LandingPage.tsx` | Started `npm run dev`; HTTP GET `http://localhost:5173/` → 200. Static `SERVICES`/`DOCTORS`/`TESTIMONIALS` (L10–37). Contact form only toasts (L375). English only; no `translations` usage. |
| **Login** | Stub | `src/App.tsx` (Login L58–155), `src/context/AuthContext.tsx` | Code review: no password field; role picker; session JSON in `localStorage` (`smilecare_auth_session`). “Reset Demo Data” calls `mockDbInstance.resetPreset` (App.tsx L88–91). |
| **Dashboard** | Working | `src/components/Dashboard/Dashboard.tsx` | KPIs derived from in-memory reservations/customers/audit logs (L17–47). No hardcoded “+24%” on this screen. |
| **Calendar** | Partial | `src/components/Calendar/SmartCalendar.tsx` | Week grid works; hours hardcoded `09:00`–`16:00` (L384). Day/Month are placeholders (L436–448: “Switch back to Week View”). Conflict check via `db.reservations.checkConflict` (client-side). |
| **Patients** | Working | `src/components/Customers/CustomerDatabase.tsx`, `CustomerProfile.tsx` | CRUD via repository; `org-smilecare-pro` hardcoded on create. No soft delete. |
| **Doctors** | Working | `src/components/Employees/EmployeeManagement.tsx` | CRUD + weekly schedule UI; default start `09:00`. |
| **Services** | Working | `src/components/Services/ServicesManagement.tsx` | CRUD, Active/Inactive, branch IDs. |
| **Waitlist** | Partial | `src/components/Waitlist/WaitlistQueue.tsx` | Add/list/cancel work. Promote always books `time: "09:00"` (L55); ignores preference and free-slot search. `waitlistEnabled` setting not enforced in UI. |
| **Leads** | Partial | `src/components/Leads/LeadsPipeline.tsx` | Kanban + create + status advance. Hardcoded `+24% month-on-month` (L87). No drag-and-drop despite copy. |
| **Reports** | Working (demo) | `src/components/Reports/Reports.tsx` | Metrics from filtered reservations; CSV + print. Gate: client `RequireRole BusinessOwner` only. Forecast translation keys unused. |
| **Settings** | Partial | `src/components/Settings/Settings.tsx` | Profile/currency/language persist to mock settings. Toggles for Stripe/PayPal/Google Calendar/WhatsApp **persist** but do not power real integrations. No Telegram token UI. |
| **Booking portal** | Working (demo) | `src/components/BookingPortal/BookingPortal.tsx`, `src/utils/bookingValidation.ts` | Slot generation in **browser** (`getAvailableSlots`). Slug check uses `mockDbInstance` even if Firestore enabled (L79). Stripe/PayPal adapters are simulated (`adapters.ts`). English only. |
| **Notifications (in-app)** | Working | `src/context/AppContext.tsx`, `DashboardLayout.tsx`, `adapters.ts` | Bell + mark-all-read against `db.notifications`. WhatsApp/Telegram/Email adapters return `true` with no I/O. |
| **PWA** | Partial | `public/service-worker.js`, `src/serviceWorkerRegistration.ts`, `public/manifest.json` | SW registered in production builds only. Manifest present. Limited offline value for data app. |
| **i18n** | Partial | `src/utils/translations.ts`, `AppContext.tsx` | Admin strings switch en/ar + RTL via settings. Landing and booking portal: **English hardcoded**. |

---

## 2. Gap table vs commercial spec

| ID | Requirement (short) | Status | Evidence |
|----|---------------------|--------|----------|
| DATA-1 | Node + Express/Fastify + SQLite + migrations | Missing | No `server/` directory. |
| DATA-2 | Parameterized SQL | Missing | No SQL layer. |
| DATA-3 | Full schema (users, sessions, soft delete, etc.) | Missing | Client types only in `src/types/index.ts`. No soft delete. |
| DATA-4 | Remove `org-smilecare-pro`; settings = clinic identity | Missing | Hardcoded across Auth, AppContext, CRUD screens (grep). |
| DATA-5 | UTC timestamps + clinic timezone library | Missing | `date`/`time` local strings; branch timezone like `"UTC+3"` unused for conversion. |
| DATA-6 | `seed:demo` + first-run owner | Missing | Mock seeds inside `mockRepository.ts` only. |
| DATA-7 | `ApiRepository` + REST | Missing | Only Mock + Firestore in `src/db/index.ts`. |
| DATA-8 | localStorage not SoT; demo only via `VITE_DEMO_MODE` | Missing | Default SoT is localStorage; no demo-mode banner flag. |
| DATA-9 | Remove/replace Firestore behind flag | Partial | Firestore optional via `VITE_USE_FIRESTORE`; still in deps; no secure rules. |
| DATA-10 | Server pagination/search/filter | Missing | `getAll` loads full collections client-side. |
| AUTH-1 | argon2id/bcrypt passwords | Missing | No passwords. |
| AUTH-2 | First-run owner setup | Missing | Demo login always available. |
| AUTH-3 | Server sessions + httpOnly cookie | Missing | User JSON in localStorage. |
| AUTH-4 | Brute-force / lockout | Missing | — |
| AUTH-5 | CSRF + locked CORS | Missing | No API. |
| AUTH-6 | Roles owner/receptionist/doctor + server enforce | Partial | Roles exist as SuperAdmin/BusinessOwner/Receptionist/Employee; **client-only** guards. |
| AUTH-7 | Permission matrix documented + tested | Missing | No `docs/PERMISSIONS.md`; no tests. |
| AUTH-8 | User management (create/deactivate/reset pwd) | Missing | Doctors ≠ staff user accounts. |
| AUTH-9 | Remove demo login; reset only in demo mode | Missing | Demo login + Reset Demo always shown. |
| SEC-1 | helmet, validation, size limits | Missing | No server. |
| SEC-2 | Server audit log append-only | Partial | Client `auditLogs` create exists; no login/fail logging; deletable via repo delete pattern elsewhere. |
| SEC-3 | Secrets from env; refuse bad prod secrets | Partial | `.env.example` for Firebase only; no server secrets. |
| SEC-4 | npm audit High/Critical fixed/documented | Partial | `npm audit`: **13 vulns (11 high, 2 moderate)** — see §3. |
| SEC-5 | XSS-safe output | Partial | No `dangerouslySetInnerHTML` found; React escaping helps; print/export not hardened specifically. |
| BOOK-1 | Server-side availability | Missing | `bookingValidation.ts` in browser. |
| BOOK-2 | No double-booking under concurrency | Missing | Client `checkConflict` only; no transactions. |
| BOOK-3 | Public `/api/public/...` rate-limited | Missing | Public SPA only. |
| BOOK-4 | Pending + unguessable booking ref | Partial | Creates reservation client-side; IDs are short random strings, not dedicated booking refs. |
| BOOK-5 | Cancel/reschedule private token link | Missing | — |
| BOOK-6 | Configurable booking rules in Settings | Missing | No min notice / max days / cancel window settings wired. |
| BOOK-7 | Status transition enforcement | Missing | Status set freely in UI. |
| BOOK-8 | Waitlist promote real free slot | Missing | Fixed `09:00` (`WaitlistQueue.tsx` L55). |
| UI-1 | Day + Month calendar views | Missing | Placeholders only (`SmartCalendar.tsx` L436–448). |
| UI-2 | Doctor time off + clinic holidays | Missing | `HolidayOverride` type unused (no repo/UI). |
| UI-3 | Remove fake/hardcoded numbers | Partial | Leads `+24%`; landing static content; calendar hours fixed. |
| UI-4 | Settings toggles real or removed; pay at clinic only | Missing | Stripe/PayPal/GCal/WhatsApp shown without real backends. |
| UI-5 | Landing contact → server lead | Missing | Toast only (`LandingPage.tsx` L375). |
| UI-6 | Branding from settings on landing | Missing | Landing uses hardcoded copy/contacts. |
| UI-7 | Empty/loading/error + error boundary | Partial | Some EmptyState/Skeleton/LoadingSpinner; no global error boundary found. |
| I18N-1 | Full AR/EN incl. landing + booking + RTL | Partial | Admin only. |
| I18N-2 | No hardcoded user-facing strings | Missing | Landing/booking/login English hardcoded. |
| NOTIF-1…8 | Server Telegram + reminders + settings | Missing | Client stubs in `adapters.ts` return true. |
| DENT-1…7 | Odontogram, visits, plans, payments, files, alerts, reports | Missing | No dental clinical modules. |
| PRIV-1…4 | Consent, export/anonymize, no PII logs, PRIVACY.md | Missing | — |
| OPS-1…9 | Backups, Docker, start scripts, logging, shutdown | Partial | `start.bat` exists for Vite only; no Docker/health/backups. |
| TEST-1…4 | Unit, API, E2E, CI | Missing | Zero `*.test`/`*.spec` files; no Vitest/Jest/Playwright; no GitHub Actions workflow found. |
| DOC-1…3 | Commercial README, install docs, proprietary LICENSE | Missing | README is portfolio-oriented with MIT badge. |

---

## 3. Security findings

| # | Severity | Issue | Path / evidence | Recommended fix |
|---|----------|-------|-----------------|-----------------|
| S1 | **Critical** | No real authentication; anyone can pick any role | `AuthContext.tsx` L61–77; `App.tsx` Login | Server sessions, hashed passwords, first-run owner (AUTH-1…3). |
| S2 | **Critical** | Authorization is client route guards only; tamperable localStorage session | `App.tsx` ProtectedAdminRoute / RequireRole; auth key in localStorage | Enforce every API call with server role checks. |
| S3 | **Critical** | Entire clinic dataset (patients, phones, notes) in cleartext localStorage | `mockRepository.ts` store key `smilecare_db_store` | Move SoT to server SQL; encrypt at rest via OS/disk. |
| S4 | **High** | Firestore optional with **no security rules in repo**; client Firebase config via `VITE_*` | No `firestore.rules`; `firebase/config.ts`; `db/index.ts` | Prefer SQL API; if Firestore kept, rules + Auth; never trust client alone. |
| S5 | **High** | Demo “Reset Demo Data” destroys data from login screen | `App.tsx` L88–91 | Gate behind build-time demo flag only. |
| S6 | **High** | Simulated payments present as if real (fake txn IDs) | `adapters.ts` Stripe/PayPal; BookingPortal | Remove or label Coming soon; keep Pay at clinic only until gateway. |
| S7 | **Medium** | Full-table loads of patients/appointments/audit into browser | repository `getAll` | Server pagination + search (DATA-10). |
| S8 | **Medium** | No CSRF/CORS/rate limits (no API yet) | — | Add with Phase 1 API (AUTH-4/5, SEC-1). |
| S9 | **Medium** | Dependency vulnerabilities | `npm audit` (2026-11-12) | See list below; fix or document (SEC-4). |
| S10 | **Low** | XSS: no `dangerouslySetInnerHTML` found; React default escaping | grep | Keep encoding; review print/CSV exports in Phase 1+. |
| S11 | **Low** | Firebase Auth imported but unused | `firebase/config.ts` `getFirebaseAuth` | Remove with Firestore or wire properly. |

### npm audit (verified 2026-11-12)

Command: `npm audit` → **13 vulnerabilities (2 moderate, 11 high)**. Exit code 1.

Notable High findings:

| Package | Advisory theme | Notes |
|---------|----------------|-------|
| `@grpc/grpc-js` (via `firebase`) | Auth context / error leakage | Fix wants `firebase@9.14.0` (breaking) via `--force` |
| `react-router` / `react-router-dom` | RSC Mode CSRF bypass | `npm audit fix` available |
| `vite` | launch-editor / middleware path issues | Dev-server class risks; `npm audit fix` |
| `postcss`, `nanoid`, `browserslist`, `source-map-js` | Various DoS / disclosure | Mostly tooling; `npm audit fix` |
| `baseline-browser-mapping`, `protobufjs` | Moderate DoS | `npm audit fix` |

**Not verified:** whether `npm audit fix` alone is safe without breaking the build (deferred to Phase 1 SEC-4).

---

## 4. Data model summary

**Defined:** `User`, `Organization`, `Branch`, `Customer`, `Reservation`, `Service`, `Employee` (+ `EmployeeSchedule`), `Lead`, `Notification`, `HolidayOverride`, `WaitlistRecord`, `AuditLog`, `SystemSettings`, payment enums.

**Relationships (logical):** Org → Branches; Customers/Reservations/Services/Employees/Leads/Waitlist/Notifications/Audit/Settings scoped by `orgId`; Reservation → customer, service, employee, branch.

**Hardcoded:** `org-smilecare-pro`, booking slug `smilecare-clinic` (`DEFAULT_PUBLIC_BOOKING_SLUG`), branch `br-main` in several creates.

**Unused / incomplete types:**

- `Organization` — no repository/UI.
- `HolidayOverride` — type only; no storage, no availability effect.
- Soft delete (`deleted_at`) — absent.
- Users as staff accounts — login fabricates users; not stored as entities with passwords.

**Timezone:** Branch has `timezone` string; slot math uses browser `Date` in `bookingValidation.ts`, not a TZ library.

---

## 5. Fake or hardcoded data in the UI

| Item | Location | Behavior |
|------|----------|----------|
| `+24% month-on-month` | `LeadsPipeline.tsx` L87 | Static marketing figure |
| Landing SERVICES/DOCTORS/TESTIMONIALS | `LandingPage.tsx` L10–37 | Static, not from DB/settings |
| Landing contact form | `LandingPage.tsx` L375 | Toast only; no lead created |
| Calendar hour range | `SmartCalendar.tsx` L384 | Fixed 09:00–16:00 |
| Waitlist promote time | `WaitlistQueue.tsx` L55 | Always 09:00 |
| Stripe/PayPal “payment” | `adapters.ts` + BookingPortal | Fake success + random txn IDs |
| Notification adapters | `adapters.ts` | No-op `return true` |
| Google Calendar adapter | `adapters.ts` | Writes audit log only; not called from calendar sync path meaningfully for real GCal |
| Forecast translation keys | `translations.ts` | Unused (no charts) |
| `org-smilecare-pro` | Many files | Single demo tenant |

---

## 6. Build / test health

| Check | Command | Result |
|-------|---------|--------|
| Install | `npm install` | OK — 146 packages audited at install |
| Lint | `npm run lint` (`oxlint`) | **Pass with 3 warnings** — `react(only-export-components)` in AppContext, AuthContext, ToastContext |
| Typecheck + build | `npm run build` (`tsc -b && vite build`) | **Pass** — built in ~7.4s |
| Bundle | Vite output | Main chunk `index-*.js` **~730 kB** (gzip **~221 kB**); warning >500 kB. `dist/` total ~968 kB across 34 files |
| Tests | — | **None** — no test script; 0 `*.test`/`*.spec` files |
| Dev server | `npm run dev` | **Pass** — Vite ready ~1.4s at `http://localhost:5173/`; GET `/` → **200** |
| npm audit | `npm audit` | **Fail** — 13 vulns (11 high, 2 moderate) |

**Typecheck:** covered by `tsc -b` inside `npm run build` (no separate `typecheck` script).

---

## 7. Risks and unknowns

1. **Firestore production usage** — Could not verify a live Firestore project; with `VITE_USE_FIRESTORE=true` and empty env, helpers return empty arrays (silent empty app). Security of any deployed Firebase project is unknown (no rules in repo).
2. **Concurrent booking races** — Client conflict check cannot prevent double booking under multi-tab/multi-user; severity High for clinics.
3. **Multi-branch** — UI/types mention branches; practical behavior is largely single-branch demo (`br-main`).
4. **PWA offline correctness** with mutating localStorage — not fully exercised.
5. **Whether `npm audit fix` breaks Firebase/Vite** — not applied in Phase 0.
6. **TECHNICAL_DOCUMENTATION.txt** — large narrative doc present; not treated as source of truth over code.
7. **No E2E browser walkthrough of every admin screen** in this audit beyond landing HTTP 200 and code review; interactive CRUD assumed from code paths + prior build success.

---

## 8. Architecture snapshot (as-is)

```
Browser SPA (Vite)
  ├── AuthContext → localStorage session (fabricated User)
  ├── AppContext → loads all entities via db.*
  └── db/index.ts
        ├── Mock*Repository → localStorage (default)
        └── Firestore*Repository → Firebase client SDK (optional)
```

No backend process. No SQL. No real Telegram/SMS/email. No CI.

---

## 9. Phase 0 conclusion

Phase 0 complete. Application source was **not modified**. Next: **Phase 1** (backend, SQLite, real auth, ApiRepository) per the commercial prompt, then commit after each phase’s typecheck/lint/test/build cycle.

**Priority reminder from prompt:** if time is short, finish Phases **0–2 and 5** properly before Phase 4.
