import { hashPassword, newBookingRef } from './auth.js';
import { loadConfig } from './config.js';
import { closeDatabase, getDb, migrate, openDatabase } from './db.js';
import { localToUtc } from './time.js';

const config = loadConfig();
openDatabase(config.databasePath);
migrate(getDb());

const db = getDb();
const patientCount = (db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c;
if (patientCount > 0) {
  console.log('Demo seed skipped: patients already exist.');
} else {
  const branch = (db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get() as { id: number }).id;
  const now = new Date().toISOString();
  const zone = 'Africa/Cairo';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const schedule = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    working: day !== 5 && day !== 6,
    start: '09:00',
    end: '17:00',
  }));

  const seed = db.transaction(() => {
    db.prepare(
      `UPDATE settings SET business_name = ?, public_slug = ?, address = ?, phone = ?, email = ?, currency = ?, timezone = ?, updated_at = ? WHERE org_id = 1`,
    ).run('SmileCare Dental Clinic', 'smilecare-clinic', '12 Nile Corniche', '+20 2 0000 0000', 'hello@smilecare.example', 'EGP', zone, now);

    db.prepare(`UPDATE branches SET name = ?, address = ?, phone = ?, email = ?, timezone = ? WHERE id = ?`).run(
      'SmileCare Downtown',
      '12 Nile Corniche',
      '+20 2 0000 0000',
      'downtown@smilecare.example',
      zone,
      branch,
    );
    const north = db
      .prepare(`INSERT INTO branches (name, address, phone, email, timezone, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .run('SmileCare North', '78 Wellness Plaza', '+20 2 0000 0001', 'north@smilecare.example', zone, now);

    const services = [
      ['Dental Cleaning & Exam', 'Cleaning, polishing, and an oral exam.', 45, 1200, 'Preventive'],
      ['Root Canal Treatment', 'Treatment to save an infected tooth.', 90, 4500, 'Restorative'],
      ['Teeth Whitening', 'In-office whitening.', 60, 2500, 'Cosmetic'],
    ] as const;
    const serviceIds: number[] = [];
    for (const [name, description, duration, price, category] of services) {
      const info = db
        .prepare(`INSERT INTO services (name, description, duration, price, category, status) VALUES (?, ?, ?, ?, ?, 'Active')`)
        .run(name, description, duration, price, category);
      const id = Number(info.lastInsertRowid);
      serviceIds.push(id);
      db.prepare('INSERT INTO service_branches (service_id, branch_id) VALUES (?, ?)').run(id, branch);
      db.prepare('INSERT INTO service_branches (service_id, branch_id) VALUES (?, ?)').run(id, Number(north.lastInsertRowid));
    }

    const doctors = [
      ['Dr. Amanda Ross', 'General Dentist', 'amanda@smilecare.example', '+20 100 000 0001'],
      ['Dr. Khalid Mansoor', 'Orthodontist', 'khalid@smilecare.example', '+20 100 000 0002'],
    ] as const;
    const doctorIds: number[] = [];
    for (const [name, role, email, phone] of doctors) {
      const info = db
        .prepare(`INSERT INTO doctors (name, role, email, phone, status, created_at) VALUES (?, ?, ?, ?, 'Active', ?)`)
        .run(name, role, email, phone, now);
      const id = Number(info.lastInsertRowid);
      doctorIds.push(id);
      db.prepare('INSERT INTO doctor_branches (doctor_id, branch_id) VALUES (?, ?)').run(id, branch);
      for (const day of schedule) {
        db.prepare(
          `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, is_working, breaks_json) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, day.day, day.start, day.end, day.working ? 1 : 0, JSON.stringify([{ start: '13:00', end: '14:00' }]));
      }
    }

    const patients = [
      ['Sara Hassan', '+20 100 111 2233', 'sara@example.com', 'Mild dental anxiety.', '["Regular"]'],
      ['Omar Farouk', '+20 100 222 3344', 'omar@example.com', 'Prefers afternoon visits.', '["New"]'],
    ] as const;
    const patientIds: number[] = [];
    for (const [name, phone, email, notes, tags] of patients) {
      const info = db
        .prepare(
          `INSERT INTO patients (full_name, phone, email, notes, tags, status, total_spending, created_at) VALUES (?, ?, ?, ?, ?, 'Active', 0, ?)`,
        )
        .run(name, phone, email, notes, tags, now);
      patientIds.push(Number(info.lastInsertRowid));
    }

    const firstStart = localToUtc(today, '10:00', zone);
    db.prepare(
      `INSERT INTO appointments (
        branch_id, patient_id, service_id, doctor_id, starts_at, ends_at, duration_min, notes, status,
        payment_status, payment_method, payment_amount, booking_ref, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', 'Unpaid', 'Cash', 1200, ?, 'staff', ?, ?)`,
    ).run(
      branch,
      patientIds[0],
      serviceIds[0],
      doctorIds[0],
      firstStart.toISO(),
      firstStart.plus({ minutes: 45 }).toISO(),
      45,
      'Six-month cleaning.',
      newBookingRef(),
      now,
      now,
    );

    db.prepare(
      `INSERT INTO leads (branch_id, full_name, phone, email, source, status, value, notes, created_at, updated_at)
       VALUES (?, 'Mona Adel', '+20 100 555 6677', 'mona@example.com', 'Website', 'New', 2500, 'Asked about whitening.', ?, ?)`,
    ).run(branch, now, now);
  });
  seed();
  console.log('Demo clinical data loaded. Create the owner from the first-run screen, or set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD.');
}

const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
const ownerPassword = process.env.SEED_OWNER_PASSWORD;
if (ownerEmail && ownerPassword) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
  if (!existing) {
    const passwordHash = await hashPassword(ownerPassword);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active, must_change_password, created_at, updated_at)
       VALUES (?, ?, 'Clinic Owner', 'owner', 1, 0, ?, ?)`,
    ).run(ownerEmail, passwordHash, now, now);
    console.log(`Owner account created for ${ownerEmail}.`);
  }
}

closeDatabase();
