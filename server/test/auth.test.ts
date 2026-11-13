import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smilecare-'));
const dbFile = path.join(tmp, 'phase1.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbFile;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secretxx';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ownerPassword = 'OwnerPass123';
const doctorPassword = 'DoctorPass123';
const deskPassword = 'DeskPass1234';

describe('phase 1 auth and persistence', () => {
  let app: Express;
  let closeDatabase: () => void;
  let openDatabase: (file: string) => unknown;
  let migrate: (db: unknown) => void;
  let getDb: () => { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };

  beforeAll(async () => {
    const dbMod = await import('../src/db.js');
    const { createApp } = await import('../src/app.js');
    openDatabase = dbMod.openDatabase as (file: string) => unknown;
    migrate = dbMod.migrate as (db: unknown) => void;
    closeDatabase = dbMod.closeDatabase;
    getDb = dbMod.getDb as typeof getDb;
    const database = openDatabase(dbFile);
    migrate(database);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function agent() {
    return request.agent(app);
  }

  it('refuses a second setup and keeps the owner session', async () => {
    const owner = agent();
    const setup = await owner.post('/api/setup').set(CSRF).send({
      name: 'Clinic Owner',
      email: 'owner@smilecare.test',
      password: ownerPassword,
      businessName: 'SmileCare Test',
    });
    expect(setup.status).toBe(201);
    expect(setup.body.user.role).toBe('owner');

    const again = await request(app).post('/api/setup').set(CSRF).send({
      name: 'Other',
      email: 'other@smilecare.test',
      password: ownerPassword,
      businessName: 'Other',
    });
    expect(again.status).toBe(409);

    const me = await owner.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('owner@smilecare.test');
  });

  it('rejects login without the CSRF header and locks the account after five failures', async () => {
    const missing = await request(app).post('/api/auth/login').send({
      email: 'owner@smilecare.test',
      password: ownerPassword,
    });
    expect(missing.status).toBe(403);

    const owner = agent();
    const created = await owner.post('/api/auth/login').set(CSRF).send({
      email: 'owner@smilecare.test',
      password: ownerPassword,
    });
    expect(created.status).toBe(200);

    const staff = await owner.post('/api/users').set(CSRF).send({
      name: 'Front Desk',
      email: 'desk@smilecare.test',
      password: deskPassword,
      role: 'receptionist',
    });
    expect(staff.status).toBe(201);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request(app).post('/api/auth/login').set(CSRF).send({
        email: 'desk@smilecare.test',
        password: 'wrong-password-1',
      });
      expect(failed.status).toBe(401);
      expect(failed.body.error.message).toBe('Invalid email or password');
    }

    const locked = await request(app).post('/api/auth/login').set(CSRF).send({
      email: 'desk@smilecare.test',
      password: deskPassword,
    });
    expect(locked.status).toBe(401);
  });

  it('returns 403 when a doctor calls owner and receptionist endpoints', async () => {
    const owner = agent();
    await owner.post('/api/auth/login').set(CSRF).send({
      email: 'owner@smilecare.test',
      password: ownerPassword,
    });
    const created = await owner.post('/api/users').set(CSRF).send({
      name: 'Dr. Test',
      email: 'doctor@smilecare.test',
      password: doctorPassword,
      role: 'doctor',
    });
    expect(created.status).toBe(201);

    const doctor = agent();
    const login = await doctor.post('/api/auth/login').set(CSRF).send({
      email: 'doctor@smilecare.test',
      password: doctorPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    const changed = await doctor.post('/api/auth/change-password').set(CSRF).send({
      currentPassword: doctorPassword,
      newPassword: 'DoctorPass456',
    });
    expect(changed.status).toBe(200);

    expect((await doctor.get('/api/users')).status).toBe(403);
    expect((await doctor.patch('/api/settings').set(CSRF).send({ businessName: 'Hacked' })).status).toBe(403);
    expect((await doctor.post('/api/patients').set(CSRF).send({
      fullName: 'Blocked Patient',
      phone: '01000000000',
      email: 'blocked@example.com',
    })).status).toBe(403);

    const settings = await doctor.get('/api/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.businessName).toBeTruthy();
    expect(settings.body.telegramChatId).toBeUndefined();
    expect(settings.body.telegramTokenSet).toBeUndefined();
    expect(settings.body.whatsappPhoneNumberId).toBeUndefined();
  });

  it('persists a patient and appointment across a database reopen', async () => {
    const owner = agent();
    await owner.post('/api/auth/login').set(CSRF).send({
      email: 'owner@smilecare.test',
      password: ownerPassword,
    });
    const branches = await owner.get('/api/branches');
    expect(branches.status).toBe(200);
    const branchId = branches.body[0].id as string;

    const doctor = await owner.post('/api/doctors').set(CSRF).send({
      name: 'Dr. Sara Nabil',
      role: 'General Dentist',
      email: 'sara@smilecare.test',
      phone: '01011111111',
      branchIds: [branchId],
    });
    expect(doctor.status).toBe(201);

    const service = await owner.post('/api/services').set(CSRF).send({
      name: 'Exam',
      description: 'Checkup',
      duration: 30,
      price: 500,
      category: 'Preventive',
      branchIds: [branchId],
    });
    expect(service.status).toBe(201);

    const patient = await owner.post('/api/patients').set(CSRF).send({
      fullName: 'Nour Ali',
      phone: '01022222222',
      email: 'nour@example.com',
      notes: 'First visit',
      tags: ['New'],
    });
    expect(patient.status).toBe(201);

    const appointment = await owner.post('/api/appointments').set(CSRF).send({
      branchId,
      customerId: patient.body.id,
      serviceId: service.body.id,
      employeeId: doctor.body.id,
      date: '2026-12-01',
      time: '11:00',
      duration: 30,
      notes: 'Cleaning',
      status: 'Confirmed',
      paymentStatus: 'Unpaid',
      paymentDetails: { method: 'Cash', amount: 500 },
    });
    expect(appointment.status).toBe(201);
    expect(appointment.body.date).toBe('2026-12-01');
    expect(appointment.body.time).toBe('11:00');
    expect(appointment.body.bookingRef).toHaveLength(12);

    closeDatabase();
    const reopened = openDatabase(dbFile);
    migrate(reopened);
    const saved = getDb().prepare('SELECT full_name FROM patients WHERE id = ?').get(Number(patient.body.id)) as { full_name: string };
    const savedAppt = getDb().prepare('SELECT booking_ref FROM appointments WHERE id = ?').get(Number(appointment.body.id)) as { booking_ref: string };
    expect(saved.full_name).toBe('Nour Ali');
    expect(savedAppt.booking_ref).toBe(appointment.body.bookingRef);
  });

  it('rejects an unauthenticated patient list', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(401);
  });
});
