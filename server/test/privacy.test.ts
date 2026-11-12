import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smilecare-privacy-'));
const dbFile = path.join(tmp, 'privacy.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbFile;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secretxx';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

describe('patient export and anonymize', () => {
  let app: Express;
  let closeDatabase: () => void;

  beforeAll(async () => {
    const dbMod = await import('../src/db.js');
    const { createApp } = await import('../src/app.js');
    closeDatabase = dbMod.closeDatabase;
    const database = dbMod.openDatabase(dbFile);
    dbMod.migrate(database);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports a patient file and lets only the owner remove contact details', async () => {
    const owner = request.agent(app);
    await owner.post('/api/setup').set(CSRF).send({
      name: 'Owner',
      email: 'owner-privacy@smilecare.test',
      password: 'OwnerPass123',
      businessName: 'Privacy Clinic',
    });
    const patient = await owner.post('/api/patients').set(CSRF).send({
      fullName: 'Private Person',
      phone: '01077778888',
      email: 'private@example.com',
    });
    const exported = await owner.get(`/api/patients/${patient.body.id}/export`);
    expect(exported.status).toBe(200);
    expect(JSON.stringify(exported.body)).toContain('01077778888');
    expect(JSON.stringify(exported.body)).not.toContain('manage_token');

    const doctorUser = await owner.post('/api/users').set(CSRF).send({
      name: 'Dr Privacy',
      email: 'doctor-privacy@smilecare.test',
      password: 'TempPass123',
      role: 'doctor',
    });
    expect(doctorUser.status).toBe(201);
    const doctor = request.agent(app);
    await doctor.post('/api/auth/login').set(CSRF).send({ email: 'doctor-privacy@smilecare.test', password: 'TempPass123' });
    await doctor.post('/api/auth/change-password').set(CSRF).send({ currentPassword: 'TempPass123', newPassword: 'DoctorPass123' });
    expect((await doctor.post(`/api/patients/${patient.body.id}/anonymize`).set(CSRF)).status).toBe(403);

    const cleared = await owner.post(`/api/patients/${patient.body.id}/anonymize`).set(CSRF);
    expect(cleared.status).toBe(200);
    const after = await owner.get(`/api/patients/${patient.body.id}/export`);
    expect(JSON.stringify(after.body)).not.toContain('01077778888');
    expect(JSON.stringify(after.body)).not.toContain('private@example.com');
    expect(after.body.patient.full_name).toBe('Anonymized patient');
  });

  it('rejects a public booking that does not include consent', async () => {
    const clinic = await request(app).get('/api/public/clinic');
    const branch = String(clinic.body.branches[0].id);
    const sent = await request(app).post('/api/public/bookings').set(CSRF).send({
      fullName: 'No Consent',
      phone: '01000000077',
      email: 'noconsent@example.com',
      branchId: branch,
      doctorId: '1',
      serviceId: '1',
      date: '2026-12-01',
      time: '10:00',
      consent: false,
    });
    expect(sent.status).toBe(400);
  });
});
