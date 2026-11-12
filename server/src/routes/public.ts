import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { assertSlotAvailable, readBookingRules, slotsForDoctor } from '../availability.js';
import { newBookingRef } from '../auth.js';
import { queueAppointmentAlert } from '../telegram.js';
import { getDb } from '../db.js';
import { HttpError } from '../http.js';
import { getClinicZone, localToUtc, utcToLocal } from '../time.js';

const skip = () => process.env.NODE_ENV === 'test';

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  skip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' } },
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function newManageToken(): string {
  return randomBytes(24).toString('hex');
}

const bookBody = z.object({
  companyWebsite: z.string().max(200).optional().default(''),
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(200),
  branchId: z.string().regex(/^\d+$/),
  doctorId: z.string().regex(/^\d+$/),
  serviceId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().max(2000).optional().default(''),
});

const leadBody = z.object({
  companyWebsite: z.string().max(200).optional().default(''),
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(200),
  message: z.string().max(2000).optional().default(''),
  branchId: z.string().regex(/^\d+$/).optional(),
});

export const publicRouter = Router();
publicRouter.use(publicLimiter);

publicRouter.get('/clinic', (_req, res) => {
  const settings = getDb().prepare(
    `SELECT business_name, public_slug, address, phone, email, currency, language, is_rtl, timezone, features_json FROM settings WHERE id = 1`,
  ).get() as {
    business_name: string;
    public_slug: string;
    address: string;
    phone: string;
    email: string;
    currency: string;
    language: string;
    is_rtl: number;
    timezone: string;
    features_json: string;
  };
  const features = JSON.parse(settings.features_json) as { publicBookingEnabled?: boolean };
  const branches = getDb().prepare(`SELECT id, name, address, phone, timezone FROM branches WHERE is_active = 1 ORDER BY id`).all();
  res.json({
    businessName: settings.business_name,
    publicSlug: settings.public_slug,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    currency: settings.currency,
    language: settings.language,
    isRtl: settings.is_rtl === 1,
    timezone: settings.timezone,
    publicBookingEnabled: features.publicBookingEnabled !== false,
    branches,
  });
});

publicRouter.get('/services', (req, res) => {
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : '';
  const rows = getDb().prepare(
    `SELECT s.id, s.name, s.description, s.duration, s.price, s.category
     FROM services s
     JOIN service_branches sb ON sb.service_id = s.id
     WHERE s.deleted_at IS NULL AND s.status = 'Active' AND (? = '' OR sb.branch_id = ?)
     GROUP BY s.id
     ORDER BY s.name`,
  ).all(branchId, branchId ? Number(branchId) : 0);
  res.json(rows);
});

publicRouter.get('/doctors', (req, res) => {
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : '';
  const rows = getDb().prepare(
    `SELECT d.id, d.name, d.role
     FROM doctors d
     JOIN doctor_branches dbn ON dbn.doctor_id = d.id
     WHERE d.deleted_at IS NULL AND d.status = 'Active' AND (? = '' OR dbn.branch_id = ?)
     GROUP BY d.id
     ORDER BY d.name`,
  ).all(branchId, branchId ? Number(branchId) : 0);
  res.json(rows);
});

publicRouter.get('/slots', (req, res) => {
  const doctorId = Number(req.query.doctorId);
  const serviceId = Number(req.query.serviceId);
  const branchId = Number(req.query.branchId);
  const date = String(req.query.date || '');
  if (!doctorId || !serviceId || !branchId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, 'VALIDATION', 'doctorId, serviceId, branchId, and date are required');
  }
  const service = getDb().prepare(`SELECT duration FROM services WHERE id = ? AND deleted_at IS NULL AND status = 'Active'`).get(serviceId) as { duration: number } | undefined;
  if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
  res.json({ slots: slotsForDoctor({ doctorId, branchId, date, duration: service.duration, enforceNotice: true }) });
});

publicRouter.post('/bookings', (req, res) => {
  const body = bookBody.parse(req.body);
  if (body.companyWebsite.trim()) {
    res.status(201).json({ reference: 'RECEIVED', manageToken: '' });
    return;
  }
  const features = JSON.parse((getDb().prepare('SELECT features_json FROM settings WHERE id = 1').get() as { features_json: string }).features_json) as { publicBookingEnabled?: boolean };
  if (features.publicBookingEnabled === false) throw new HttpError(403, 'CLOSED', 'Online booking is turned off');
  const service = getDb().prepare(`SELECT duration, price, name FROM services WHERE id = ? AND deleted_at IS NULL`).get(Number(body.serviceId)) as
    | { duration: number; price: number; name: string }
    | undefined;
  if (!service) throw new HttpError(400, 'VALIDATION', 'Choose a service');
  const token = newManageToken();
  const now = new Date().toISOString();
  const create = getDb().transaction(() => {
    assertSlotAvailable({
      doctorId: Number(body.doctorId),
      branchId: Number(body.branchId),
      date: body.date,
      time: body.time,
      duration: service.duration,
      enforceNotice: true,
    });
    const existingPatient = getDb().prepare(`SELECT id FROM patients WHERE phone = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`).get(body.phone) as { id: number } | undefined;
    let patientId = existingPatient?.id;
    if (!patientId) {
      const info = getDb()
        .prepare(`INSERT INTO patients (full_name, phone, email, notes, tags, status, total_spending, created_at) VALUES (?, ?, ?, '', '["Portal"]', 'Active', 0, ?)`)
        .run(body.fullName, body.phone, body.email, now);
      patientId = Number(info.lastInsertRowid);
    }
    const start = localToUtc(body.date, body.time, getClinicZone());
    const reference = newBookingRef();
    const info = getDb()
      .prepare(
        `INSERT INTO appointments (
          branch_id, patient_id, service_id, doctor_id, starts_at, ends_at, duration_min, notes, status,
          payment_status, payment_method, payment_amount, booking_ref, manage_token_hash, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Unpaid', 'Cash', ?, ?, ?, 'public', ?, ?)`,
      )
      .run(
        Number(body.branchId),
        patientId,
        Number(body.serviceId),
        Number(body.doctorId),
        start.toISO(),
        start.plus({ minutes: service.duration }).toISO(),
        service.duration,
        body.notes,
        service.price,
        reference,
        sha256(token),
        now,
        now,
      );
    getDb()
      .prepare(`INSERT INTO notifications (branch_id, title, message, read, type, created_at) VALUES (?, ?, ?, 0, 'BookingCreated', ?)`)
      .run(Number(body.branchId), 'New booking request', `${body.fullName} requested ${service.name}.`, now);
    return { id: Number(info.lastInsertRowid), reference };
  });
  const created = create.immediate();
  queueAppointmentAlert(created.id);
  res.status(201).json({ reference: created.reference, manageToken: token });
});

function loadByToken(reference: string, token: string) {
  const row = getDb().prepare('SELECT * FROM appointments WHERE booking_ref = ?').get(reference) as {
    id: number;
    manage_token_hash: string | null;
    starts_at: string;
    status: string;
    service_id: number;
    doctor_id: number;
    duration_min: number;
  } | undefined;
  if (!row || !row.manage_token_hash || row.manage_token_hash !== sha256(token)) {
    throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
  }
  return row;
}

publicRouter.get('/bookings/:ref', (req, res) => {
  const token = String(req.query.token || '');
  const row = loadByToken(req.params.ref, token);
  const service = getDb().prepare('SELECT name FROM services WHERE id = ?').get(row.service_id) as { name: string };
  const doctor = getDb().prepare('SELECT name FROM doctors WHERE id = ?').get(row.doctor_id) as { name: string };
  const local = utcToLocal(row.starts_at, getClinicZone());
  res.json({ reference: req.params.ref, status: row.status, date: local.date, time: local.time, serviceName: service.name, doctorName: doctor.name });
});

publicRouter.post('/bookings/:ref/cancel', (req, res) => {
  const body = z.object({ token: z.string().min(10) }).parse(req.body);
  const row = loadByToken(req.params.ref, body.token);
  if (row.status === 'Cancelled') {
    res.json({ status: 'Cancelled' });
    return;
  }
  if (row.status !== 'Pending' && row.status !== 'Confirmed') {
    throw new HttpError(409, 'INVALID_TRANSITION', 'This booking can no longer be cancelled online');
  }
  const rules = readBookingRules();
  const starts = DateTime.fromISO(row.starts_at, { zone: 'utc' });
  if (starts < DateTime.utc().plus({ hours: rules.cancelWindowHours })) {
    throw new HttpError(409, 'TOO_LATE', 'This booking is inside the cancellation window. Please call the clinic.');
  }
  getDb().prepare(`UPDATE appointments SET status = 'Cancelled', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
  res.json({ status: 'Cancelled' });
});

publicRouter.post('/bookings/:ref/reschedule', (req, res) => {
  const body = z.object({
    token: z.string().min(10),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  }).parse(req.body);
  const row = loadByToken(req.params.ref, body.token);
  if (row.status !== 'Pending' && row.status !== 'Confirmed') {
    throw new HttpError(409, 'INVALID_TRANSITION', 'This booking can no longer be rescheduled online');
  }
  const full = getDb().prepare('SELECT branch_id, doctor_id FROM appointments WHERE id = ?').get(row.id) as { branch_id: number; doctor_id: number };
  const start = localToUtc(body.date, body.time, getClinicZone());
  const apply = getDb().transaction(() => {
    assertSlotAvailable({
      doctorId: full.doctor_id,
      branchId: full.branch_id,
      date: body.date,
      time: body.time,
      duration: row.duration_min,
      excludeId: row.id,
      enforceNotice: true,
    });
    getDb()
      .prepare(`UPDATE appointments SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?`)
      .run(start.toISO(), start.plus({ minutes: row.duration_min }).toISO(), new Date().toISOString(), row.id);
  });
  apply.immediate();
  res.json({ reference: req.params.ref, date: body.date, time: body.time, status: row.status });
});

publicRouter.post('/leads', (req, res) => {
  const body = leadBody.parse(req.body);
  if (body.companyWebsite.trim()) {
    res.status(201).json({ ok: true });
    return;
  }
  const branch = body.branchId
    ? Number(body.branchId)
    : (getDb().prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get() as { id: number }).id;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO leads (branch_id, full_name, phone, email, source, status, value, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Website', 'New', 0, ?, ?, ?)`,
    )
    .run(branch, body.fullName, body.phone, body.email, body.message, now, now);
  getDb()
    .prepare(`INSERT INTO notifications (branch_id, title, message, read, type, created_at) VALUES (?, 'New inquiry', ?, 0, 'LeadCreated', ?)`)
    .run(branch, `${body.fullName} sent a message from the website.`, now);
  res.status(201).json({ ok: true });
});
