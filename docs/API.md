# API overview

Base URL in development: `http://localhost:3001/api`  
Browser origin must match `CLIENT_ORIGIN`. Mutating requests need header `X-Requested-With: XMLHttpRequest` and the session cookie after sign-in.

Roles: `owner`, `receptionist`, `doctor`. See `docs/PERMISSIONS.md`.

## Public

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` (no `/api` prefix on mount: `/api/health`) | None |
| GET | `/setup/status` | None |
| POST | `/setup` | None (once) |
| POST | `/auth/login` | None |
| GET | `/public/clinic` | None |
| GET | `/public/services` | None |
| GET | `/public/doctors` | None |
| GET | `/public/slots` | None |
| POST | `/public/bookings` | None (rate limited) |
| GET | `/public/bookings/:ref` | Manage token |
| POST | `/public/bookings/:ref/cancel` | Manage token |
| POST | `/public/bookings/:ref/reschedule` | Manage token |
| POST | `/public/leads` | None |

## Auth / users

| Method | Path | Role |
|--------|------|------|
| POST | `/auth/logout` | Any signed-in |
| POST | `/auth/logout-all` | Any signed-in |
| GET | `/auth/me` | Any signed-in |
| POST | `/auth/change-password` | Any signed-in |
| GET / POST / PATCH | `/users` … | Owner |

## Clinic resources

| Area | Read | Write |
|------|------|-------|
| Branches, patients, doctors, services, appointments, leads, waitlist, holidays, time-off, notifications | Any signed-in | Owner + receptionist (most writes) |
| Settings (clinic branding, language, booking rules) | Any signed-in (messaging fields owner-only) | Owner |
| Telegram / WhatsApp test | — | Owner |
| Audit log | Any signed-in | Append only (POST); no update/delete |
| Odontogram / visits | Any signed-in | Any signed-in |
| Payments | Any signed-in | Owner + receptionist |
| Patient export | Any signed-in | — |
| Patient anonymize | — | Owner |

Query params `page`, `pageSize`, and `q` are accepted on several list endpoints. The current staff UI may still request the full page.
