import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smilecare-clinical-'));
const dbFile = path.join(tmp, 'clinical.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbFile;
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secretxx';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

describe('treatment plans and invoices', () => {
  let app: Express;
  let closeDatabase: () => void;
  let agent: ReturnType<typeof request.agent>;
  let patientId: string;

  beforeAll(async () => {
    const dbMod = await import('../src/db.js');
    const { createApp } = await import('../src/app.js');
    closeDatabase = dbMod.closeDatabase;
    dbMod.openDatabase(dbFile);
    dbMod.migrate(dbMod.getDb());
    app = createApp();
    agent = request.agent(app);
    const setup = await agent.post('/api/setup').set(CSRF).send({
      name: 'Owner',
      email: 'clinical-owner@smilecare.test',
      password: 'OwnerPass123',
      businessName: 'Clinical Clinic',
    });
    expect(setup.status).toBe(201);
    const patient = await agent.post('/api/patients').set(CSRF).send({
      fullName: 'Plan Patient',
      phone: '201033333333',
      medicalAlerts: 'Latex allergy',
    });
    expect(patient.status).toBe(201);
    patientId = patient.body.id;
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a treatment plan and an EGP invoice', async () => {
    const plan = await agent.post(`/api/patients/${patientId}/treatment-plans`).set(CSRF).send({
      title: 'Posterior restoration',
      status: 'Active',
      items: [
        { tooth: '16', description: 'Composite filling', fee: 800 },
        { description: 'Polish', fee: 200 },
      ],
    });
    expect(plan.status).toBe(201);
    expect(plan.body.estimatedTotal).toBe(1000);
    expect(plan.body.items).toHaveLength(2);

    const invoice = await agent.post('/api/invoices').set(CSRF).send({
      patientId,
      lines: [
        { description: 'Composite filling', amount: 800 },
        { description: 'Polish', amount: 200 },
      ],
      taxTotal: 0,
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.currency).toBe('EGP');
    expect(invoice.body.total).toBe(1000);
    expect(invoice.body.status).toBe('Issued');
    expect(invoice.body.invoiceNumber).toMatch(/^INV-/);

    const paid = await agent.post(`/api/invoices/${invoice.body.id}/mark-paid`).set(CSRF);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('Paid');
  });
});
