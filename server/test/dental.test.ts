import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smilecare-dental-'));
const dbFile = path.join(tmp, 'dental.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbFile;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secretxx';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

describe('dental chart, visits, and payments', () => {
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

  it('stores an FDI finding, a visit, and a payment balance', async () => {
    const owner = request.agent(app);
    await owner.post('/api/setup').set(CSRF).send({
      name: 'Owner',
      email: 'owner-dental@smilecare.test',
      password: 'OwnerPass123',
      businessName: 'Dental Chart',
    });
    const patient = await owner.post('/api/patients').set(CSRF).send({ fullName: 'Chart Patient', phone: '01000000041', email: 'chart@example.com' });
    const chart = await owner.put(`/api/patients/${patient.body.id}/odontogram`).set(CSRF).send({
      teeth: [{ tooth: '11', condition: 'Caries', note: 'Occlusal' }],
    });
    expect(chart.status).toBe(200);
    expect(chart.body.teeth).toEqual([expect.objectContaining({ tooth: '11', condition: 'Caries' })]);

    const visit = await owner.post(`/api/patients/${patient.body.id}/visits`).set(CSRF).send({
      visitedOn: '2026-11-12',
      complaint: 'Pain',
      diagnosis: 'Caries 11',
      treatment: 'Filling planned',
    });
    expect(visit.status).toBe(201);
    const visits = await owner.get(`/api/patients/${patient.body.id}/visits`);
    expect(visits.body[0].diagnosis).toBe('Caries 11');

    const paid = await owner.post(`/api/patients/${patient.body.id}/payments`).set(CSRF).send({ amount: 150, method: 'Cash', note: 'Deposit' });
    expect(paid.status).toBe(201);
    expect(paid.body.paid).toBe(150);
    expect(paid.body.balance).toBe(-150);

    const doctorUser = await owner.post('/api/users').set(CSRF).send({
      name: 'Dr Chart',
      email: 'doctor-chart@smilecare.test',
      password: 'TempPass123',
      role: 'doctor',
    });
    expect(doctorUser.status).toBe(201);
    const doctor = request.agent(app);
    const login = await doctor.post('/api/auth/login').set(CSRF).send({ email: 'doctor-chart@smilecare.test', password: 'TempPass123' });
    expect(login.status).toBe(200);
    await doctor.post('/api/auth/change-password').set(CSRF).send({ currentPassword: 'TempPass123', newPassword: 'DoctorPass123' });
    const forbidden = await doctor.post(`/api/patients/${patient.body.id}/payments`).set(CSRF).send({ amount: 10, method: 'Card' });
    expect(forbidden.status).toBe(403);
    const chartByDoctor = await doctor.put(`/api/patients/${patient.body.id}/odontogram`).set(CSRF).send({
      teeth: [{ tooth: '21', condition: 'Filled', note: '' }],
    });
    expect(chartByDoctor.status).toBe(200);
  });
});
