import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smilecare-tg-'));
const dbFile = path.join(tmp, 'tg.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbFile;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secretxx';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const SECRET = '123456789:AA-test-token-not-real-value';

describe('telegram settings stay server-side', () => {
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

  it('stores a bot token without returning it, and sends a reminder only once', async () => {
    const owner = request.agent(app);
    const setup = await owner.post('/api/setup').set(CSRF).send({
      name: 'Owner',
      email: 'owner-tg@smilecare.test',
      password: 'OwnerPass123',
      businessName: 'Telegram Clinic',
    });
    expect(setup.status).toBe(201);

    const saved = await owner.patch('/api/settings').set(CSRF).send({
      telegramBotToken: SECRET,
      telegramChatId: '555',
      telegramEnabled: true,
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(SECRET);
    expect(saved.body.telegramTokenSet).toBe(true);
    expect(saved.body.telegramChatId).toBe('555');
    expect(saved.body.telegramEnabled).toBe(true);

    const WHATSAPP_SECRET = 'EAAB-whatsapp-token-not-a-real-secret-value';
    const messaging = await owner.patch('/api/settings').set(CSRF).send({
      telegramBotUsername: '@SmileCareClinicBot',
      telegramReminderHours: 12,
      whatsappPhoneNumberId: '123456789012345',
      whatsappAccessToken: WHATSAPP_SECRET,
      whatsappBusinessAccountId: '998877665544',
      whatsappTestRecipient: '201012345678',
    });
    expect(messaging.status).toBe(200);
    expect(JSON.stringify(messaging.body)).not.toContain(SECRET);
    expect(JSON.stringify(messaging.body)).not.toContain(WHATSAPP_SECRET);
    expect(messaging.body.telegramBotUsername).toBe('SmileCareClinicBot');
    expect(messaging.body.telegramReminderHours).toBe(12);
    expect(messaging.body.whatsappTokenSet).toBe(true);
    expect(messaging.body.whatsappPhoneNumberId).toBe('123456789012345');
    expect(messaging.body.whatsappLastStatus).toBe('');

    const notSent = await owner.post('/api/settings/whatsapp-test').set(CSRF);
    expect(notSent.status).toBe(501);
    expect(JSON.stringify(notSent.body)).not.toContain('"delivered":true');

    const again = await owner.get('/api/settings');
    expect(JSON.stringify(again.body)).not.toContain(SECRET);
    expect(JSON.stringify(again.body)).not.toContain(WHATSAPP_SECRET);
    expect(again.body.features.telegramNotifications).toBe(true);

    const branchId = (await owner.get('/api/branches')).body[0].id as string;
    const doctor = await owner.post('/api/doctors').set(CSRF).send({
      name: 'Dr. Telegram',
      role: 'Dentist',
      email: 'tg@smilecare.test',
      phone: '01000000031',
      branchIds: [branchId],
    });
    const service = await owner.post('/api/services').set(CSRF).send({
      name: 'Check',
      description: 'Check',
      duration: 30,
      price: 100,
      category: 'Preventive',
      branchIds: [branchId],
    });
    const patient = await owner.post('/api/patients').set(CSRF).send({
      fullName: 'Telegram Patient',
      phone: '01000000032',
      email: 'tg-patient@example.com',
    });
    const date = new Date();
    date.setDate(date.getDate() + 10);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const appointment = await owner.post('/api/appointments').set(CSRF).send({
      branchId,
      customerId: patient.body.id,
      serviceId: service.body.id,
      employeeId: doctor.body.id,
      date: day,
      time: '10:00',
      duration: 30,
      status: 'Pending',
      paymentStatus: 'Unpaid',
      paymentDetails: { method: 'Cash', amount: 100 },
    });
    expect(appointment.status).toBe(201);

    const link = await owner.post(`/api/patients/${patient.body.id}/telegram-link`).set(CSRF);
    expect(link.status).toBe(201);
    expect(link.body.token).toHaveLength(32);
    expect(link.body.instruction).toContain(`https://t.me/SmileCareClinicBot?start=${link.body.token}`);
    expect(JSON.stringify(again.body)).not.toContain(link.body.token);

    const { claimReminder } = await import('../src/telegram.js');
    expect(claimReminder(Number(appointment.body.id), 'upcoming', appointment.body.date)).toBe(true);
    expect(claimReminder(Number(appointment.body.id), 'upcoming', appointment.body.date)).toBe(false);
  });
});
