-- Core clinic schema. Tables are ordered so foreign keys resolve.

CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE doctors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Doctor',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'receptionist', 'doctor')),
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  total_spending REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  anonymized_at TEXT
);

CREATE TABLE doctor_branches (
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, branch_id)
);

CREATE TABLE doctor_schedules (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_working INTEGER NOT NULL DEFAULT 1,
  breaks_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (doctor_id, day_of_week)
);

CREATE TABLE doctor_time_off (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE clinic_holidays (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  prevent_bookings INTEGER NOT NULL DEFAULT 1,
  UNIQUE (branch_id, date)
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  deleted_at TEXT
);

CREATE TABLE service_branches (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, branch_id)
);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow')),
  payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Authorized', 'Paid', 'Refunded')),
  payment_method TEXT,
  payment_amount REAL,
  payment_txn TEXT,
  paid_at TEXT,
  booking_ref TEXT NOT NULL UNIQUE,
  manage_token_hash TEXT,
  source TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE waitlist (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  doctor_id INTEGER REFERENCES doctors(id),
  date TEXT NOT NULL,
  time_pref TEXT NOT NULL CHECK (time_pref IN ('Morning', 'Afternoon', 'Evening', 'Any')),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting', 'Promoted', 'Cancelled')),
  created_at TEXT NOT NULL
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Website',
  status TEXT NOT NULL CHECK (status IN ('New', 'Contacted', 'Interested', 'Converted', 'Lost')),
  value REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
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
  updated_at TEXT NOT NULL
);

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (appointment_id, kind)
);

CREATE TABLE telegram_links (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  link_token_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_patients_name ON patients(full_name);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_appointments_doctor_time ON appointments(doctor_id, starts_at, ends_at);
CREATE INDEX idx_appointments_branch_time ON appointments(branch_id, starts_at);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

INSERT INTO settings (
  id, business_name, public_slug, address, phone, email, currency, language, is_rtl, timezone,
  features_json, booking_rules_json, telegram_enabled, updated_at
) VALUES (
  1,
  'My Dental Clinic',
  'smilecare-clinic',
  '',
  '',
  '',
  'EGP',
  'en',
  0,
  'Africa/Cairo',
  '{"waitlistEnabled":true,"telegramNotifications":false,"publicBookingEnabled":true}',
  '{"minNoticeMinutes":60,"maxDaysAhead":90,"cancelWindowHours":24,"slotIntervalMinutes":30}',
  0,
  '1970-01-01T00:00:00.000Z'
);

INSERT INTO branches (name, address, phone, email, timezone, is_active, created_at)
VALUES ('Main Clinic', '', '', '', 'Africa/Cairo', 1, '1970-01-01T00:00:00.000Z');
