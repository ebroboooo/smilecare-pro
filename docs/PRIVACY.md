# Privacy

This note describes the SmileCare Pro installation. It is not a legal opinion and it does not claim compliance with GDPR, HIPAA, or any other law.

## Stored data

- Staff name, email, role, and a password hash (argon2id). Session tokens are stored as SHA-256 hashes in an httpOnly cookie.
- Patient name, phone, email, notes, appointments, tooth chart, visit notes, and payments recorded at the clinic.
- A Telegram bot token, if the clinic saves one. The API never returns that token to the browser.

Card numbers are not collected. Online payment gateways are not connected.

## Access

Signed-in staff can open clinic records. The public booking page returns only the clinic, services, doctors, open times, and the single booking that matches a private token.

The clinic owner can export one patient as JSON and can replace that patient's name and contact details with an anonymized record. Appointment history remains.

## Retention

The SQLite file is the record. Backups are copies of that file. See `docs/BACKUP.md`. Deleting a backup is a clinic decision.

## Public booking

The booking form requires a consent checkbox before the request is saved. The patient receives a reference and a manage token. The token is stored only as a hash.
