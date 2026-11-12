import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smilecare-book-'));
const dbFile = path.join(tmp, 'book.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbFile;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secretxx';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

function upcomingWeekday(): string {
  const date = new Date();
  date.setDate(date.getDate() + 10);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

describe('booking integrity and public portal', () => {
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

  it('allows only one of two simultaneous bookings and does not leak other patients', async () => {
    const owner = request.agent(app);
    const setup = await owner.post('/api/setup').set(CSRF).send({
      name: 'Owner',
      email: 'owner-book@smilecare.test',
      password: 'OwnerPass123',
      businessName: 'Book Test',
    });
    expect(setup.status).toBe(201);
    const branchId = (await owner.get('/api/branches')).body[0].id as string;
    const doctor = await owner.post('/api/doctors').set(CSRF).send({
      name: 'Dr. Book',
      role: 'Dentist',
      email: 'book@smilecare.test',
      phone: '01000000001',
      branchIds: [branchId],
    });
    const service = await owner.post('/api/services').set(CSRF).send({
      name: 'Exam',
      description: 'Check',
      duration: 30,
      price: 400,
      category: 'Preventive',
      branchIds: [branchId],
    });
    expect(doctor.status).toBe(201);
    expect(service.status).toBe(201);

    const date = upcomingWeekday();
    const payload = {
      fullName: 'First Patient',
      phone: '01000000011',
      email: 'first@example.com',
      branchId,
      doctorId: doctor.body.id,
      serviceId: service.body.id,
      date,
      time: '10:00',
      notes: '',
      companyWebsite: '',
      consent: true,
    };
    const [first, second] = await Promise.all([
      request(app).post('/api/public/bookings').set(CSRF).send(payload),
      request(app).post('/api/public/bookings').set(CSRF).send({ ...payload, fullName: 'Second Patient', phone: '01000000022', email: 'second@example.com' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    expect(winner.body.reference).toHaveLength(12);
    expect(JSON.stringify(winner.body)).not.toContain('Second Patient');
    expect(JSON.stringify(winner.body)).not.toContain('01000000022');

    const clinic = await request(app).get('/api/public/clinic');
    expect(clinic.status).toBe(200);
    expect(JSON.stringify(clinic.body)).not.toContain('First Patient');
    expect(JSON.stringify(clinic.body)).not.toContain('01000000011');

    const view = await request(app).get(`/api/public/bookings/${winner.body.reference}`).query({ token: winner.body.manageToken });
    expect(view.status).toBe(200);
    expect(view.body.date).toBe(date);
    expect(view.body).not.toHaveProperty('phone');

    const cancelled = await request(app).post(`/api/public/bookings/${winner.body.reference}/cancel`).set(CSRF).send({ token: winner.body.manageToken });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('Cancelled');
  });

  it('ignores a public booking when the honeypot is filled', async () => {
    const clinic = await request(app).get('/api/public/clinic');
    const branch = String(clinic.body.branches[0].id);
    const doctors = await request(app).get('/api/public/doctors').query({ branchId: branch });
    const services = await request(app).get('/api/public/services').query({ branchId: branch });
    const date = upcomingWeekday();
    const query = { doctorId: doctors.body[0].id, serviceId: services.body[0].id, branchId: branch, date };
    const before = await request(app).get('/api/public/slots').query(query);
    expect(before.body.slots).toContain('11:00');
    const sent = await request(app).post('/api/public/bookings').set(CSRF).send({
      companyWebsite: 'https://spam.example',
      fullName: 'Bot Person',
      phone: '01000000999',
      email: 'bot@example.com',
      branchId: branch,
      doctorId: String(doctors.body[0].id),
      serviceId: String(services.body[0].id),
      date,
      time: '11:00',
      consent: true,
    });
    expect(sent.status).toBe(201);
    expect(sent.body.reference).toBe('RECEIVED');
    const after = await request(app).get('/api/public/slots').query(query);
    expect(after.body.slots).toContain('11:00');
  });
});
