-- Multi-clinic SaaS foundation + Egypt PDPL-ready scaffolding.
-- This does not claim legal certification. It adds tenant isolation and compliance tooling.

CREATE TABLE organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'EG',
  plan TEXT NOT NULL DEFAULT 'pilot' CHECK (plan IN ('pilot', 'growth', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  data_retention_days INTEGER NOT NULL DEFAULT 2555,
  pdpl_notice_version TEXT NOT NULL DEFAULT 'eg-pdpl-2026.1',
  compliance_mode TEXT NOT NULL DEFAULT 'egypt_pdpl_ready'
    CHECK (compliance_mode IN ('egypt_pdpl_ready', 'custom')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO organizations (
  id, name, slug, country, plan, status, data_retention_days, pdpl_notice_version, compliance_mode, created_at, updated_at
)
SELECT
  1,
  business_name,
  public_slug,
  'EG',
  'pilot',
  'active',
  2555,
  'eg-pdpl-2026.1',
  'egypt_pdpl_ready',
  updated_at,
  updated_at
FROM settings
WHERE id = 1;

-- SQLite forbids ALTER ADD COLUMN with REFERENCES + non-NULL default; enforce org scope in app queries.
ALTER TABLE users ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE branches ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE doctors ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE patients ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE services ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE appointments ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE waitlist ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE leads ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notifications ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audit_logs ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clinic_holidays ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE doctor_time_off ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;

ALTER TABLE patients ADD COLUMN medical_alerts TEXT NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN national_id TEXT NOT NULL DEFAULT '';

CREATE TABLE settings_v3 (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  public_slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EGP',
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar')),
  is_rtl INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  features_json TEXT NOT NULL,
  booking_rules_json TEXT NOT NULL,
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  telegram_enabled INTEGER NOT NULL DEFAULT 0,
  telegram_bot_username TEXT NOT NULL DEFAULT '',
  telegram_reminder_hours INTEGER NOT NULL DEFAULT 24,
  whatsapp_phone_number_id TEXT NOT NULL DEFAULT '',
  whatsapp_access_token TEXT,
  whatsapp_business_account_id TEXT NOT NULL DEFAULT '',
  whatsapp_test_recipient TEXT NOT NULL DEFAULT '',
  whatsapp_last_status TEXT NOT NULL DEFAULT '',
  whatsapp_reminders_enabled INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL DEFAULT 'eg-pdpl-2026.1',
  updated_at TEXT NOT NULL
);

INSERT INTO settings_v3 (
  id, org_id, business_name, public_slug, logo_url, address, phone, email, currency, language, is_rtl, timezone,
  features_json, booking_rules_json, telegram_bot_token, telegram_chat_id, telegram_enabled,
  telegram_bot_username, telegram_reminder_hours, whatsapp_phone_number_id, whatsapp_access_token,
  whatsapp_business_account_id, whatsapp_test_recipient, whatsapp_last_status, whatsapp_reminders_enabled,
  consent_version, updated_at
)
SELECT
  id, 1, business_name, public_slug, logo_url, address, phone, email, currency, language, is_rtl, timezone,
  features_json, booking_rules_json, telegram_bot_token, telegram_chat_id, telegram_enabled,
  COALESCE(telegram_bot_username, ''), COALESCE(telegram_reminder_hours, 24),
  COALESCE(whatsapp_phone_number_id, ''), whatsapp_access_token,
  COALESCE(whatsapp_business_account_id, ''), COALESCE(whatsapp_test_recipient, ''),
  COALESCE(whatsapp_last_status, ''), 0, 'eg-pdpl-2026.1', updated_at
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_v3 RENAME TO settings;

CREATE TABLE patient_access_logs (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE treatment_plans (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Active', 'Completed', 'Cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  estimated_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE treatment_plan_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  tooth TEXT,
  description TEXT NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned', 'InProgress', 'Done', 'Skipped')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Issued', 'Paid', 'Void')),
  currency TEXT NOT NULL DEFAULT 'EGP',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  issued_at TEXT,
  paid_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (org_id, invoice_number)
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_patients_org ON patients(org_id);
CREATE INDEX idx_appointments_org ON appointments(org_id, starts_at);
CREATE INDEX idx_settings_org ON settings(org_id);
CREATE INDEX idx_patient_access_org ON patient_access_logs(org_id, patient_id, created_at);
CREATE INDEX idx_treatment_plans_patient ON treatment_plans(patient_id, status);
CREATE INDEX idx_invoices_org ON invoices(org_id, created_at);
