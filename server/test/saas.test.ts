import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeDatabase, migrate, openDatabase } from '../src/db.js';
import { deliverWhatsApp, sendDueWhatsAppReminders, type MessageTransport } from '../src/whatsapp.js';
import { getDb } from '../src/db.js';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const KEY = 'test-platform-key-123456';

describe('multi-clinic SaaS foundation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smilecare-saas-'));
  const dbPath = path.join(dir, 'test.db');
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars';
    process.env.PLATFORM_SETUP_KEY = KEY;
    openDatabase(dbPath);
    migrate(getDb());
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.PLATFORM_SETUP_KEY;
  });

  it('reports PDPL-ready mode without claiming certification', async () => {
    const res = await request(app).get('/api/platform/status');
    expect(res.status).toBe(200);
    expect(res.body.compliance.certified).toBe(false);
    expect(res.body.compliance.mode).toBe('egypt_pdpl_ready');
    expect(res.body.saasSignupEnabled).toBe(true);
  });

  it('creates a second clinic that cannot see the first clinic patients', async () => {
    const setup = await request(app)
      .post('/api/setup')
      .set(CSRF)
      .send({
        name: 'Owner One',
        email: 'owner1@example.com',
        password: 'Password1ab',
        businessName: 'Clinic One',
      });
    expect(setup.status).toBe(201);
    const cookie1 = setup.headers['set-cookie'][0] as string;

    const patient = await request(app)
      .post('/api/patients')
      .set('Cookie', cookie1)
      .set(CSRF)
      .send({ fullName: 'Private Patient', phone: '201011111111', medicalAlerts: 'Penicillin allergy' });
    expect(patient.status).toBe(201);
    expect(patient.body.medicalAlerts).toBe('Penicillin allergy');
    expect(patient.body.orgId).toBe('1');

    const second = await request(app)
      .post('/api/platform/organizations')
      .set(CSRF)
      .set('X-Platform-Key', KEY)
      .send({
        clinicName: 'Clinic Two',
        ownerName: 'Owner Two',
        email: 'owner2@example.com',
        password: 'Password2ab',
        country: 'EG',
      });
    expect(second.status).toBe(201);
    expect(second.body.organization.certified).toBe(false);
    expect(second.body.user.orgId).not.toBe('1');
    const cookie2 = second.headers['set-cookie'][0] as string;

    const leaked = await request(app).get('/api/patients').set('Cookie', cookie2);
    expect(leaked.status).toBe(200);
    const items = Array.isArray(leaked.body) ? leaked.body : leaked.body.items;
    expect(items.some((p: { fullName: string }) => p.fullName === 'Private Patient')).toBe(false);

    const cross = await request(app).get(`/api/patients/${patient.body.id}`).set('Cookie', cookie2);
    expect(cross.status).toBe(404);
  });

  it('claims WhatsApp patient reminders once when Meta accepts', async () => {
    const transport: MessageTransport = {
      async post() {
        return { status: 200, json: { messages: [{ id: 'wamid.REMINDER' }] } };
      },
    };
    const now = Date.now();
    const starts = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    const ends = new Date(now + 2.5 * 60 * 60 * 1000).toISOString();
    getDb().prepare(
      `UPDATE settings SET whatsapp_reminders_enabled = 1, whatsapp_phone_number_id = '123', whatsapp_access_token = 'token-value-long-enough' WHERE org_id = 1`,
    ).run();
    const patientId = Number(
      getDb().prepare(`INSERT INTO patients (full_name, phone, email, notes, tags, status, total_spending, created_at, org_id)
        VALUES ('WA Patient', '201022222222', '', '', '[]', 'Active', 0, ?, 1)`).run(new Date().toISOString()).lastInsertRowid,
    );
    const serviceId = Number(
      getDb().prepare(`INSERT INTO services (name, description, duration, price, category, status, org_id)
        VALUES ('Exam', '', 30, 100, '', 'Active', 1)`).run().lastInsertRowid,
    );
    const doctorId = Number(
      getDb().prepare(`INSERT INTO doctors (name, role, email, phone, status, created_at, org_id)
        VALUES ('Dr', 'Doctor', '', '', 'Active', ?, 1)`).run(new Date().toISOString()).lastInsertRowid,
    );
    const apptId = Number(
      getDb().prepare(
        `INSERT INTO appointments (
           branch_id, patient_id, service_id, doctor_id, starts_at, ends_at, duration_min, notes, status,
           payment_status, booking_ref, source, created_at, updated_at, org_id
         ) VALUES (1, ?, ?, ?, ?, ?, 30, '', 'Confirmed', 'Unpaid', 'ABCDEF123456', 'staff', ?, ?, 1)`,
      ).run(patientId, serviceId, doctorId, starts, ends, new Date().toISOString(), new Date().toISOString()).lastInsertRowid,
    );

    await sendDueWhatsAppReminders(transport);
    await sendDueWhatsAppReminders(transport);
    const row = getDb()
      .prepare(`SELECT status FROM reminders WHERE appointment_id = ? AND kind = 'whatsapp_upcoming'`)
      .get(apptId) as { status: string };
    expect(row.status).toBe('sent');
    const accepted = await deliverWhatsApp(
      {
        orgId: 1,
        phoneNumberId: '123',
        token: 'token-value-long-enough',
        businessAccountId: '',
        testRecipient: '',
        lastStatus: '',
        remindersEnabled: true,
        reminderHours: 24,
      },
      { to: '201022222222', body: 'x' },
      transport,
    );
    expect(accepted.providerMessageId).toBe('wamid.REMINDER');
  });
});
