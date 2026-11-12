import { Router, type Response } from 'express';
import { z } from 'zod';
import { assertSlotAvailable, canTransition, slotsForDoctor } from '../availability.js';
import { writeAudit } from '../audit.js';
import { createPatientLink, queueAppointmentAlert, refreshTelegramBot, sendTelegramTest } from '../telegram.js';
import { sendWhatsAppTest } from '../whatsapp.js';
import { newBookingRef, requireAuth, requireRoles } from '../auth.js';
import { getDb } from '../db.js';
import { HttpError, asyncHandler, parseId } from '../http.js';
import { getClinicZone, localToUtc, minutesOf, utcToLocal } from '../time.js';

const staffWrite = requireRoles('owner', 'receptionist');

const paging = z.object({
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  branchId: z.string().regex(/^\d+$/).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employeeId: z.string().regex(/^\d+$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  duration: z.coerce.number().int().positive().max(480).optional(),
  excludeId: z.string().regex(/^\d+$/).optional(),
  status: z.string().max(40).optional(),
});

function likeTerm(q: string): string {
  return `%${q.replace(/[%_]/g, '')}%`;
}

function sendList(res: Response, rows: unknown[], total: number, page?: number, pageSize?: number) {
  if (page) {
    res.json({ items: rows, total, page, pageSize: pageSize ?? rows.length });
    return;
  }
  res.json(rows);
}

function pageClause(page?: number, pageSize?: number): { limit: number; offset: number } {
  if (!page) return { limit: 1000, offset: 0 };
  const size = pageSize ?? 25;
  return { limit: size, offset: (page - 1) * size };
}

const breakSchema = z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) });
const scheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  isWorking: z.boolean(),
  breaks: z.array(breakSchema).max(6).default([]),
});

function defaultSchedule() {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    dayOfWeek: day,
    start: '09:00',
    end: '17:00',
    isWorking: day !== 0 && day !== 6,
    breaks: [{ start: '12:00', end: '13:00' }],
  }));
}

function loadDoctor(id: number) {
  const row = getDb().prepare(`SELECT * FROM doctors WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | {
        id: number;
        name: string;
        role: string;
        email: string;
        phone: string;
        status: 'Active' | 'Inactive';
      }
    | undefined;
  if (!row) return null;
  const branches = getDb()
    .prepare('SELECT branch_id FROM doctor_branches WHERE doctor_id = ?')
    .all(id) as Array<{ branch_id: number }>;
  const schedule = getDb()
    .prepare(
      `SELECT day_of_week, start_time, end_time, is_working, breaks_json FROM doctor_schedules WHERE doctor_id = ? ORDER BY day_of_week`,
    )
    .all(id) as Array<{
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_working: number;
    breaks_json: string;
  }>;
  return {
    id: String(row.id),
    orgId: 'clinic',
    branchIds: branches.map((b) => String(b.branch_id)),
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    status: row.status,
    schedule: schedule.map((day) => ({
      dayOfWeek: day.day_of_week,
      start: day.start_time,
      end: day.end_time,
      isWorking: day.is_working === 1,
      breaks: JSON.parse(day.breaks_json) as Array<{ start: string; end: string }>,
    })),
  };
}

function replaceDoctorLinks(doctorId: number, branchIds: string[], schedule: z.infer<typeof scheduleSchema>[]) {
  const db = getDb();
  db.prepare('DELETE FROM doctor_branches WHERE doctor_id = ?').run(doctorId);
  const link = db.prepare('INSERT INTO doctor_branches (doctor_id, branch_id) VALUES (?, ?)');
  for (const branchId of branchIds) link.run(doctorId, Number(branchId));
  db.prepare('DELETE FROM doctor_schedules WHERE doctor_id = ?').run(doctorId);
  const insert = db.prepare(
    `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, is_working, breaks_json) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const day of schedule) {
    insert.run(doctorId, day.dayOfWeek, day.start, day.end, day.isWorking ? 1 : 0, JSON.stringify(day.breaks ?? []));
  }
}

function loadService(id: number) {
  const row = getDb().prepare(`SELECT * FROM services WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | {
        id: number;
        name: string;
        description: string;
        duration: number;
        price: number;
        category: string;
        status: 'Active' | 'Inactive';
      }
    | undefined;
  if (!row) return null;
  const branches = getDb()
    .prepare('SELECT branch_id FROM service_branches WHERE service_id = ?')
    .all(id) as Array<{ branch_id: number }>;
  return {
    id: String(row.id),
    orgId: 'clinic',
    branchIds: branches.map((b) => String(b.branch_id)),
    name: row.name,
    description: row.description,
    duration: row.duration,
    price: row.price,
    category: row.category,
    status: row.status,
  };
}

function mapPatient(row: {
  id: number;
  full_name: string;
  phone: string;
  email: string;
  notes: string;
  tags: string;
  status: 'Active' | 'Inactive';
  total_spending: number;
  created_at: string;
}) {
  return {
    id: String(row.id),
    orgId: 'clinic',
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    tags: JSON.parse(row.tags) as string[],
    status: row.status,
    totalSpending: row.total_spending,
    createdAt: row.created_at,
  };
}

interface ApptRow {
  id: number;
  branch_id: number;
  patient_id: number;
  service_id: number;
  doctor_id: number;
  starts_at: string;
  duration_min: number;
  notes: string;
  status: 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled' | 'NoShow';
  payment_status: 'Unpaid' | 'Authorized' | 'Paid' | 'Refunded';
  payment_method: string | null;
  payment_amount: number | null;
  payment_txn: string | null;
  paid_at: string | null;
  booking_ref: string;
  created_at: string;
}

function mapAppointment(row: ApptRow) {
  const local = utcToLocal(row.starts_at, getClinicZone());
  return {
    id: String(row.id),
    orgId: 'clinic',
    branchId: String(row.branch_id),
    customerId: String(row.patient_id),
    serviceId: String(row.service_id),
    employeeId: String(row.doctor_id),
    date: local.date,
    time: local.time,
    duration: row.duration_min,
    notes: row.notes,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentDetails: row.payment_method
      ? {
          method: row.payment_method,
          amount: row.payment_amount ?? 0,
          transactionId: row.payment_txn ?? undefined,
          paidAt: row.paid_at ?? undefined,
        }
      : undefined,
    bookingRef: row.booking_ref,
    createdAt: row.created_at,
  };
}


const paymentSchema = z
  .object({
    method: z.enum(['Cash', 'Card']),
    amount: z.number().nonnegative(),
    transactionId: z.string().max(80).optional(),
    paidAt: z.string().max(40).optional(),
  })
  .optional();

const appointmentBody = z.object({
  branchId: z.string().regex(/^\d+$/),
  customerId: z.string().regex(/^\d+$/),
  serviceId: z.string().regex(/^\d+$/),
  employeeId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.number().int().positive().max(480),
  notes: z.string().max(5000).optional().default(''),
  status: z.enum(['Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow']).optional().default('Confirmed'),
  paymentStatus: z.enum(['Unpaid', 'Authorized', 'Paid', 'Refunded']).optional().default('Unpaid'),
  paymentDetails: paymentSchema,
});

function mapSettings(row: {
  business_name: string;
  public_slug: string;
  logo_url: string | null;
  address: string;
  phone: string;
  email: string;
  currency: string;
  language: 'en' | 'ar';
  is_rtl: number;
  timezone: string;
  features_json: string;
  booking_rules_json: string;
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  telegram_enabled: number;
  telegram_bot_username?: string | null;
  telegram_reminder_hours?: number | null;
  whatsapp_phone_number_id?: string | null;
  whatsapp_access_token?: string | null;
  whatsapp_business_account_id?: string | null;
  whatsapp_test_recipient?: string | null;
  whatsapp_last_status?: string | null;
}) {
  return {
    orgId: 'clinic',
    businessName: row.business_name,
    publicSlug: row.public_slug,
    logoUrl: row.logo_url || undefined,
    address: row.address,
    phone: row.phone,
    email: row.email,
    currency: row.currency,
    language: row.language,
    isRtl: row.is_rtl === 1,
    timezone: row.timezone,
    features: JSON.parse(row.features_json) as {
      waitlistEnabled: boolean;
      telegramNotifications: boolean;
      publicBookingEnabled: boolean;
    },
    bookingRules: JSON.parse(row.booking_rules_json) as {
      minNoticeMinutes: number;
      maxDaysAhead: number;
      cancelWindowHours: number;
      slotIntervalMinutes: number;
    },
    telegramChatId: row.telegram_chat_id || '',
    telegramEnabled: row.telegram_enabled === 1,
    telegramTokenSet: Boolean(row.telegram_bot_token),
    telegramBotUsername: row.telegram_bot_username || '',
    telegramReminderHours: row.telegram_reminder_hours || 24,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id || '',
    whatsappBusinessAccountId: row.whatsapp_business_account_id || '',
    whatsappTestRecipient: row.whatsapp_test_recipient || '',
    whatsappTokenSet: Boolean(row.whatsapp_access_token),
    whatsappLastStatus: row.whatsapp_last_status || '',
  };
}

function readSettings() {
  const row = getDb().prepare('SELECT * FROM settings WHERE id = 1').get() as Parameters<typeof mapSettings>[0];
  return mapSettings(row);
}

export const clinicRouter = Router();
clinicRouter.use(requireAuth);

clinicRouter.get('/branches', (req, res) => {
  const query = paging.parse(req.query);
  const { limit, offset } = pageClause(query.page, query.pageSize);
  const where = query.q ? `WHERE name LIKE ?` : '';
  const params = query.q ? [likeTerm(query.q)] : [];
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM branches ${where}`).get(...params) as { c: number }).c;
  const rows = getDb()
    .prepare(`SELECT * FROM branches ${where} ORDER BY id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Array<{
    id: number;
    name: string;
    address: string;
    phone: string;
    email: string;
    timezone: string;
    is_active: number;
  }>;
  sendList(
    res,
    rows.map((row) => ({
      id: String(row.id),
      orgId: 'clinic',
      name: row.name,
      address: row.address,
      phone: row.phone,
      email: row.email,
      timezone: row.timezone,
      isActive: row.is_active === 1,
    })),
    total,
    query.page,
    query.pageSize,
  );
});

clinicRouter.get('/branches/:id', (req, res) => {
  const id = parseId(req.params.id, 'Branch');
  const row = getDb().prepare('SELECT * FROM branches WHERE id = ?').get(id) as
    | { id: number; name: string; address: string; phone: string; email: string; timezone: string; is_active: number }
    | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Branch not found');
  res.json({
    id: String(row.id),
    orgId: 'clinic',
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    timezone: row.timezone,
    isActive: row.is_active === 1,
  });
});

const branchBody = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().max(300).optional().default(''),
  phone: z.string().max(40).optional().default(''),
  email: z.string().max(200).optional().default(''),
  timezone: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional().default(true),
});

clinicRouter.post('/branches', staffWrite, validateBody(branchBody), (req, res) => {
  const body = req.body as z.infer<typeof branchBody>;
  const info = getDb()
    .prepare(
      `INSERT INTO branches (name, address, phone, email, timezone, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(body.name, body.address, body.phone, body.email, body.timezone || getClinicZone(), body.isActive ? 1 : 0, new Date().toISOString());
  writeAudit(req.user!, 'branch_created', `Created location ${body.name}`);
  res.status(201).json({
    id: String(info.lastInsertRowid),
    orgId: 'clinic',
    name: body.name,
    address: body.address,
    phone: body.phone,
    email: body.email,
    timezone: body.timezone || getClinicZone(),
    isActive: body.isActive,
  });
});

clinicRouter.patch('/branches/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Branch');
  const body = branchBody.partial().parse(req.body);
  const existing = getDb().prepare('SELECT * FROM branches WHERE id = ?').get(id) as
    | { name: string; address: string; phone: string; email: string; timezone: string; is_active: number }
    | undefined;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Branch not found');
  const next = {
    name: body.name ?? existing.name,
    address: body.address ?? existing.address,
    phone: body.phone ?? existing.phone,
    email: body.email ?? existing.email,
    timezone: body.timezone ?? existing.timezone,
    isActive: body.isActive ?? existing.is_active === 1,
  };
  getDb()
    .prepare(`UPDATE branches SET name = ?, address = ?, phone = ?, email = ?, timezone = ?, is_active = ? WHERE id = ?`)
    .run(next.name, next.address, next.phone, next.email, next.timezone, next.isActive ? 1 : 0, id);
  writeAudit(req.user!, 'branch_updated', `Updated location ${id}`);
  res.json({ id: String(id), orgId: 'clinic', ...next });
});

clinicRouter.delete('/branches/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Branch');
  const info = getDb().prepare('DELETE FROM branches WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Branch not found');
  writeAudit(req.user!, 'branch_deleted', `Deleted location ${id}`);
  res.json(true);
});

const patientBody = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().max(200).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
  status: z.enum(['Active', 'Inactive']).optional().default('Active'),
});

clinicRouter.get('/patients', (req, res) => {
  const query = paging.parse(req.query);
  const { limit, offset } = pageClause(query.page, query.pageSize);
  const filters = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (query.q) {
    filters.push('(full_name LIKE ? OR phone LIKE ? OR email LIKE ?)');
    const term = likeTerm(query.q);
    params.push(term, term, term);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM patients ${where}`).get(...params) as { c: number }).c;
  const rows = getDb()
    .prepare(`SELECT * FROM patients ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Parameters<typeof mapPatient>[0][];
  sendList(res, rows.map(mapPatient), total, query.page, query.pageSize);
});

clinicRouter.get('/patients/:id', (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  const row = getDb().prepare(`SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | Parameters<typeof mapPatient>[0]
    | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
  res.json(mapPatient(row));
});

clinicRouter.post('/patients', staffWrite, validateBody(patientBody), (req, res) => {
  const body = req.body as z.infer<typeof patientBody>;
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO patients (full_name, phone, email, notes, tags, status, total_spending, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(body.fullName, body.phone, body.email, body.notes, JSON.stringify(body.tags), body.status, now);
  writeAudit(req.user!, 'patient_created', 'Patient record created');
  res.status(201).json(
    mapPatient({
      id: Number(info.lastInsertRowid),
      full_name: body.fullName,
      phone: body.phone,
      email: body.email,
      notes: body.notes,
      tags: JSON.stringify(body.tags),
      status: body.status,
      total_spending: 0,
      created_at: now,
    }),
  );
});

clinicRouter.patch('/patients/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  const body = patientBody.partial().parse(req.body);
  const existing = getDb().prepare(`SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | Parameters<typeof mapPatient>[0]
    | undefined;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
  const next = {
    full_name: body.fullName ?? existing.full_name,
    phone: body.phone ?? existing.phone,
    email: body.email ?? existing.email,
    notes: body.notes ?? existing.notes,
    tags: body.tags ? JSON.stringify(body.tags) : existing.tags,
    status: body.status ?? existing.status,
  };
  getDb()
    .prepare(`UPDATE patients SET full_name = ?, phone = ?, email = ?, notes = ?, tags = ?, status = ? WHERE id = ?`)
    .run(next.full_name, next.phone, next.email, next.notes, next.tags, next.status, id);
  writeAudit(req.user!, 'patient_updated', `Updated patient ${id}`);
  res.json(mapPatient({ ...existing, ...next }));
});

clinicRouter.delete('/patients/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  const info = getDb()
    .prepare(`UPDATE patients SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(new Date().toISOString(), id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
  writeAudit(req.user!, 'patient_deleted', `Soft-deleted patient ${id}`);
  res.json(true);
});

const doctorBody = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(80).optional().default('Doctor'),
  email: z.string().trim().max(200).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  status: z.enum(['Active', 'Inactive']).optional().default('Active'),
  branchIds: z.array(z.string().regex(/^\d+$/)).max(20).optional().default([]),
  schedule: z.array(scheduleSchema).max(7).optional(),
});

clinicRouter.get('/doctors', (_req, res) => {
  const rows = getDb().prepare(`SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id`).all() as Array<{ id: number }>;
  res.json(rows.map((row) => loadDoctor(row.id)));
});

clinicRouter.get('/doctors/:id', (req, res) => {
  const doctor = loadDoctor(parseId(req.params.id, 'Doctor'));
  if (!doctor) throw new HttpError(404, 'NOT_FOUND', 'Doctor not found');
  res.json(doctor);
});

clinicRouter.post('/doctors', staffWrite, validateBody(doctorBody), (req, res) => {
  const body = req.body as z.infer<typeof doctorBody>;
  const now = new Date().toISOString();
  const create = getDb().transaction(() => {
    const info = getDb()
      .prepare(`INSERT INTO doctors (name, role, email, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(body.name, body.role, body.email, body.phone, body.status, now);
    const id = Number(info.lastInsertRowid);
    replaceDoctorLinks(id, body.branchIds, body.schedule ?? defaultSchedule());
    return id;
  });
  const id = create();
  writeAudit(req.user!, 'doctor_created', 'Doctor record created');
  res.status(201).json(loadDoctor(id));
});

clinicRouter.patch('/doctors/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Doctor');
  const existing = loadDoctor(id);
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Doctor not found');
  const body = doctorBody.partial().parse(req.body);
  const apply = getDb().transaction(() => {
    getDb()
      .prepare(`UPDATE doctors SET name = ?, role = ?, email = ?, phone = ?, status = ? WHERE id = ?`)
      .run(body.name ?? existing.name, body.role ?? existing.role, body.email ?? existing.email, body.phone ?? existing.phone, body.status ?? existing.status, id);
    if (body.branchIds || body.schedule) {
      replaceDoctorLinks(id, body.branchIds ?? existing.branchIds, body.schedule ?? existing.schedule);
    }
  });
  apply();
  writeAudit(req.user!, 'doctor_updated', `Updated doctor ${id}`);
  res.json(loadDoctor(id));
});

clinicRouter.delete('/doctors/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Doctor');
  const info = getDb().prepare(`UPDATE doctors SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(new Date().toISOString(), id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Doctor not found');
  writeAudit(req.user!, 'doctor_deleted', `Soft-deleted doctor ${id}`);
  res.json(true);
});

const serviceBody = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional().default(''),
  duration: z.number().int().positive().max(480),
  price: z.number().nonnegative(),
  category: z.string().max(80).optional().default('General'),
  status: z.enum(['Active', 'Inactive']).optional().default('Active'),
  branchIds: z.array(z.string().regex(/^\d+$/)).max(20).optional().default([]),
});

clinicRouter.get('/services', (_req, res) => {
  const rows = getDb().prepare(`SELECT id FROM services WHERE deleted_at IS NULL ORDER BY id`).all() as Array<{ id: number }>;
  res.json(rows.map((row) => loadService(row.id)));
});

clinicRouter.get('/services/:id', (req, res) => {
  const service = loadService(parseId(req.params.id, 'Service'));
  if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
  res.json(service);
});

clinicRouter.post('/services', staffWrite, validateBody(serviceBody), (req, res) => {
  const body = req.body as z.infer<typeof serviceBody>;
  const create = getDb().transaction(() => {
    const info = getDb()
      .prepare(`INSERT INTO services (name, description, duration, price, category, status) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(body.name, body.description, body.duration, body.price, body.category, body.status);
    const id = Number(info.lastInsertRowid);
    const link = getDb().prepare('INSERT INTO service_branches (service_id, branch_id) VALUES (?, ?)');
    for (const branchId of body.branchIds) link.run(id, Number(branchId));
    return id;
  });
  const id = create();
  writeAudit(req.user!, 'service_created', 'Service created');
  res.status(201).json(loadService(id));
});

clinicRouter.patch('/services/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Service');
  const existing = loadService(id);
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
  const body = serviceBody.partial().parse(req.body);
  const apply = getDb().transaction(() => {
    getDb()
      .prepare(`UPDATE services SET name = ?, description = ?, duration = ?, price = ?, category = ?, status = ? WHERE id = ?`)
      .run(
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.duration ?? existing.duration,
        body.price ?? existing.price,
        body.category ?? existing.category,
        body.status ?? existing.status,
        id,
      );
    if (body.branchIds) {
      getDb().prepare('DELETE FROM service_branches WHERE service_id = ?').run(id);
      const link = getDb().prepare('INSERT INTO service_branches (service_id, branch_id) VALUES (?, ?)');
      for (const branchId of body.branchIds) link.run(id, Number(branchId));
    }
  });
  apply();
  writeAudit(req.user!, 'service_updated', `Updated service ${id}`);
  res.json(loadService(id));
});

clinicRouter.delete('/services/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Service');
  const info = getDb().prepare(`UPDATE services SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(new Date().toISOString(), id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
  writeAudit(req.user!, 'service_deleted', `Soft-deleted service ${id}`);
  res.json(true);
});

clinicRouter.get(
  '/appointments/conflict',
  (req, res) => {
    const query = paging.parse(req.query);
    if (!query.employeeId || !query.date || !query.time || !query.duration) {
      throw new HttpError(400, 'VALIDATION', 'employeeId, date, time, and duration are required');
    }
    const linked = getDb()
      .prepare('SELECT branch_id FROM doctor_branches WHERE doctor_id = ? LIMIT 1')
      .get(Number(query.employeeId)) as { branch_id: number } | undefined;
    const branchId = query.branchId ? Number(query.branchId) : linked?.branch_id;
    if (!branchId) {
      res.json({ conflict: true });
      return;
    }
    const slots = slotsForDoctor({
      doctorId: Number(query.employeeId),
      branchId,
      date: query.date,
      duration: query.duration,
      excludeId: query.excludeId ? Number(query.excludeId) : undefined,
      enforceNotice: false,
    });
    res.json({ conflict: !slots.includes(query.time) });
  },
);

clinicRouter.get('/appointments', (req, res) => {
  const query = paging.parse(req.query);
  const { limit, offset } = pageClause(query.page, query.pageSize);
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.branchId) {
    filters.push('branch_id = ?');
    params.push(Number(query.branchId));
  }
  if (query.start) {
    filters.push('starts_at >= ?');
    params.push(localToUtc(query.start, '00:00', getClinicZone()).toISO());
  }
  if (query.end) {
    filters.push('starts_at < ?');
    params.push(localToUtc(query.end, '00:00', getClinicZone()).plus({ days: 1 }).toISO());
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM appointments ${where}`).get(...params) as { c: number }).c;
  const rows = getDb()
    .prepare(`SELECT * FROM appointments ${where} ORDER BY starts_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as ApptRow[];
  sendList(res, rows.map(mapAppointment), total, query.page, query.pageSize);
});

clinicRouter.get('/appointments/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(parseId(req.params.id, 'Appointment')) as ApptRow | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Appointment not found');
  res.json(mapAppointment(row));
});

clinicRouter.post('/appointments', staffWrite, validateBody(appointmentBody), (req, res) => {
  const body = req.body as z.infer<typeof appointmentBody>;
  const start = localToUtc(body.date, body.time, getClinicZone());
  const end = start.plus({ minutes: body.duration });
  const now = new Date().toISOString();
  const create = getDb().transaction(() => {
    if (body.status !== 'Cancelled') {
      assertSlotAvailable({
        doctorId: Number(body.employeeId),
        branchId: Number(body.branchId),
        date: body.date,
        time: body.time,
        duration: body.duration,
        enforceNotice: false,
      });
    }
    const info = getDb()
      .prepare(
        `INSERT INTO appointments (
          branch_id, patient_id, service_id, doctor_id, starts_at, ends_at, duration_min, notes,
          status, payment_status, payment_method, payment_amount, payment_txn, paid_at, booking_ref, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?)`,
      )
      .run(
        Number(body.branchId),
        Number(body.customerId),
        Number(body.serviceId),
        Number(body.employeeId),
        start.toISO(),
        end.toISO(),
        body.duration,
        body.notes,
        body.status,
        body.paymentStatus,
        body.paymentDetails?.method ?? null,
        body.paymentDetails?.amount ?? null,
        body.paymentDetails?.transactionId ?? null,
        body.paymentDetails?.paidAt ?? null,
        newBookingRef(),
        now,
        now,
      );
    return Number(info.lastInsertRowid);
  });
  let id: number;
  try {
    id = create.immediate();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (String(error).includes('FOREIGN KEY')) throw new HttpError(400, 'VALIDATION', 'Appointment references a missing record');
    throw error;
  }
  writeAudit(req.user!, 'appointment_created', `Created appointment ${id}`);
  queueAppointmentAlert(id);
  const row = getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(id) as ApptRow;
  res.status(201).json(mapAppointment(row));
});

clinicRouter.patch('/appointments/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Appointment');
  const existing = getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(id) as ApptRow | undefined;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Appointment not found');
  const body = appointmentBody.partial().parse(req.body);
  const current = mapAppointment(existing);
  const date = body.date ?? current.date;
  const time = body.time ?? current.time;
  const duration = body.duration ?? existing.duration_min;
  const doctorId = body.employeeId ? Number(body.employeeId) : existing.doctor_id;
  const start = localToUtc(date, time, getClinicZone());
  const end = start.plus({ minutes: duration });
  const status = body.status ?? existing.status;
  if (!canTransition(existing.status, status)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot change an appointment from ${existing.status} to ${status}`);
  }
  const apply = getDb().transaction(() => {
    if (status !== 'Cancelled') {
      assertSlotAvailable({
        doctorId,
        branchId: body.branchId ? Number(body.branchId) : existing.branch_id,
        date,
        time,
        duration,
        excludeId: id,
        enforceNotice: false,
      });
    }
    getDb()
      .prepare(
        `UPDATE appointments SET branch_id = ?, patient_id = ?, service_id = ?, doctor_id = ?, starts_at = ?, ends_at = ?,
         duration_min = ?, notes = ?, status = ?, payment_status = ?, payment_method = ?, payment_amount = ?, payment_txn = ?, paid_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        body.branchId ? Number(body.branchId) : existing.branch_id,
        body.customerId ? Number(body.customerId) : existing.patient_id,
        body.serviceId ? Number(body.serviceId) : existing.service_id,
        doctorId,
        start.toISO(),
        end.toISO(),
        duration,
        body.notes ?? existing.notes,
        status,
        body.paymentStatus ?? existing.payment_status,
        body.paymentDetails ? body.paymentDetails.method : existing.payment_method,
        body.paymentDetails ? body.paymentDetails.amount : existing.payment_amount,
        body.paymentDetails ? (body.paymentDetails.transactionId ?? null) : existing.payment_txn,
        body.paymentDetails ? (body.paymentDetails.paidAt ?? null) : existing.paid_at,
        new Date().toISOString(),
        id,
      );
  });
  try {
    apply.immediate();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw error;
  }
  writeAudit(req.user!, 'appointment_updated', `Updated appointment ${id}`);
  res.json(mapAppointment(getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(id) as ApptRow));
});

clinicRouter.delete('/appointments/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Appointment');
  const info = getDb().prepare('DELETE FROM appointments WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Appointment not found');
  writeAudit(req.user!, 'appointment_deleted', `Deleted appointment ${id}`);
  res.json(true);
});

const leadBody = z.object({
  branchId: z.string().regex(/^\d+$/),
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().max(200).optional().default(''),
  source: z.string().max(80).optional().default('Staff'),
  status: z.enum(['New', 'Contacted', 'Interested', 'Converted', 'Lost']).optional().default('New'),
  value: z.number().nonnegative().optional().default(0),
  notes: z.string().max(5000).optional().default(''),
});

function mapLead(row: {
  id: number;
  branch_id: number;
  full_name: string;
  phone: string;
  email: string;
  source: string;
  status: 'New' | 'Contacted' | 'Interested' | 'Converted' | 'Lost';
  value: number;
  notes: string;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: String(row.id),
    orgId: 'clinic',
    branchId: String(row.branch_id),
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    source: row.source,
    status: row.status,
    value: row.value,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

clinicRouter.get('/leads', (req, res) => {
  const query = paging.parse(req.query);
  const { limit, offset } = pageClause(query.page, query.pageSize);
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.q) {
    filters.push('(full_name LIKE ? OR phone LIKE ?)');
    const term = likeTerm(query.q);
    params.push(term, term);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM leads ${where}`).get(...params) as { c: number }).c;
  const rows = getDb().prepare(`SELECT * FROM leads ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  sendList(res, (rows as Parameters<typeof mapLead>[0][]).map(mapLead), total, query.page, query.pageSize);
});

clinicRouter.post('/leads', staffWrite, validateBody(leadBody), (req, res) => {
  const body = req.body as z.infer<typeof leadBody>;
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO leads (branch_id, full_name, phone, email, source, status, value, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(Number(body.branchId), body.fullName, body.phone, body.email, body.source, body.status, body.value, body.notes, now, now);
  writeAudit(req.user!, 'lead_created', 'Inquiry captured');
  res.status(201).json(mapLead({ id: Number(info.lastInsertRowid), branch_id: Number(body.branchId), full_name: body.fullName, phone: body.phone, email: body.email, source: body.source, status: body.status, value: body.value, notes: body.notes, created_at: now, updated_at: now }));
});

clinicRouter.patch('/leads/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Lead');
  const existing = getDb().prepare('SELECT * FROM leads WHERE id = ?').get(id) as Parameters<typeof mapLead>[0] | undefined;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Lead not found');
  const body = leadBody.partial().parse(req.body);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE leads SET branch_id = ?, full_name = ?, phone = ?, email = ?, source = ?, status = ?, value = ?, notes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      body.branchId ? Number(body.branchId) : existing.branch_id,
      body.fullName ?? existing.full_name,
      body.phone ?? existing.phone,
      body.email ?? existing.email,
      body.source ?? existing.source,
      body.status ?? existing.status,
      body.value ?? existing.value,
      body.notes ?? existing.notes,
      now,
      id,
    );
  writeAudit(req.user!, 'lead_updated', `Updated inquiry ${id}`);
  res.json(mapLead(getDb().prepare('SELECT * FROM leads WHERE id = ?').get(id) as Parameters<typeof mapLead>[0]));
});

clinicRouter.delete('/leads/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Lead');
  const info = getDb().prepare('DELETE FROM leads WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Lead not found');
  writeAudit(req.user!, 'lead_deleted', `Deleted inquiry ${id}`);
  res.json(true);
});

const waitBody = z.object({
  branchId: z.string().regex(/^\d+$/),
  customerId: z.string().regex(/^\d+$/),
  serviceId: z.string().regex(/^\d+$/),
  employeeId: z.string().regex(/^\d+$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeSlotPreference: z.enum(['Morning', 'Afternoon', 'Evening', 'Any']),
  notes: z.string().max(2000).optional().default(''),
  status: z.enum(['Waiting', 'Promoted', 'Cancelled']).optional().default('Waiting'),
});

function mapWait(row: {
  id: number;
  branch_id: number;
  patient_id: number;
  service_id: number;
  doctor_id: number | null;
  date: string;
  time_pref: 'Morning' | 'Afternoon' | 'Evening' | 'Any';
  notes: string;
  status: 'Waiting' | 'Promoted' | 'Cancelled';
  created_at: string;
}) {
  return {
    id: String(row.id),
    orgId: 'clinic',
    branchId: String(row.branch_id),
    customerId: String(row.patient_id),
    serviceId: String(row.service_id),
    employeeId: row.doctor_id == null ? undefined : String(row.doctor_id),
    date: row.date,
    timeSlotPreference: row.time_pref,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
  };
}

clinicRouter.get('/waitlist', (req, res) => {
  const query = paging.parse(req.query);
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.branchId) {
    filters.push('branch_id = ?');
    params.push(Number(query.branchId));
  }
  if (query.status) {
    filters.push('status = ?');
    params.push(query.status);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT * FROM waitlist ${where} ORDER BY id DESC LIMIT 1000`).all(...params) as Parameters<typeof mapWait>[0][];
  res.json(rows.map(mapWait));
});

clinicRouter.post('/waitlist', staffWrite, validateBody(waitBody), (req, res) => {
  const body = req.body as z.infer<typeof waitBody>;
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO waitlist (branch_id, patient_id, service_id, doctor_id, date, time_pref, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Number(body.branchId),
      Number(body.customerId),
      Number(body.serviceId),
      body.employeeId ? Number(body.employeeId) : null,
      body.date,
      body.timeSlotPreference,
      body.notes,
      body.status,
      now,
    );
  writeAudit(req.user!, 'waitlist_created', 'Waitlist entry created');
  res.status(201).json(
    mapWait({
      id: Number(info.lastInsertRowid),
      branch_id: Number(body.branchId),
      patient_id: Number(body.customerId),
      service_id: Number(body.serviceId),
      doctor_id: body.employeeId ? Number(body.employeeId) : null,
      date: body.date,
      time_pref: body.timeSlotPreference,
      notes: body.notes,
      status: body.status,
      created_at: now,
    }),
  );
});

clinicRouter.patch('/waitlist/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Waitlist entry');
  const existing = getDb().prepare('SELECT * FROM waitlist WHERE id = ?').get(id) as Parameters<typeof mapWait>[0] | undefined;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Waitlist entry not found');
  const body = waitBody.partial().parse(req.body);
  getDb()
    .prepare(`UPDATE waitlist SET status = ?, notes = ?, date = ?, time_pref = ?, doctor_id = ? WHERE id = ?`)
    .run(
      body.status ?? existing.status,
      body.notes ?? existing.notes,
      body.date ?? existing.date,
      body.timeSlotPreference ?? existing.time_pref,
      body.employeeId ? Number(body.employeeId) : existing.doctor_id,
      id,
    );
  writeAudit(req.user!, 'waitlist_updated', `Updated waitlist ${id}`);
  res.json(mapWait(getDb().prepare('SELECT * FROM waitlist WHERE id = ?').get(id) as Parameters<typeof mapWait>[0]));
});

clinicRouter.delete('/waitlist/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Waitlist entry');
  const info = getDb().prepare('DELETE FROM waitlist WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Waitlist entry not found');
  writeAudit(req.user!, 'waitlist_deleted', `Deleted waitlist ${id}`);
  res.json(true);
});

clinicRouter.post('/waitlist/:id/promote', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Waitlist entry');
  const item = getDb().prepare('SELECT * FROM waitlist WHERE id = ?').get(id) as Parameters<typeof mapWait>[0] | undefined;
  if (!item || item.status !== 'Waiting') throw new HttpError(404, 'NOT_FOUND', 'Waitlist entry not found');
  const service = getDb().prepare('SELECT duration, price FROM services WHERE id = ? AND deleted_at IS NULL').get(item.service_id) as
    | { duration: number; price: number }
    | undefined;
  if (!service) throw new HttpError(409, 'UNAVAILABLE', 'The requested service is no longer available');
  const doctorId = item.doctor_id
    ?? (getDb().prepare(`SELECT id FROM doctors WHERE deleted_at IS NULL AND status = 'Active' ORDER BY id LIMIT 1`).get() as { id: number } | undefined)?.id;
  if (!doctorId) throw new HttpError(409, 'UNAVAILABLE', 'No doctor is available');
  const slots = slotsForDoctor({
    doctorId,
    branchId: item.branch_id,
    date: item.date,
    duration: service.duration,
    enforceNotice: false,
  });
  const windows: Record<string, [number, number]> = {
    Morning: [0, 12 * 60],
    Afternoon: [12 * 60, 17 * 60],
    Evening: [17 * 60, 24 * 60],
    Any: [0, 24 * 60],
  };
  const [from, to] = windows[item.time_pref] ?? windows.Any!;
  const slot = slots.find((time) => {
    const minute = minutesOf(time);
    return minute >= from && minute < to;
  });
  if (!slot) throw new HttpError(409, 'UNAVAILABLE', 'No open slot matches this waitlist preference');
  const start = localToUtc(item.date, slot, getClinicZone());
  const end = start.plus({ minutes: service.duration });
  const now = new Date().toISOString();
  const create = getDb().transaction(() => {
    assertSlotAvailable({
      doctorId,
      branchId: item.branch_id,
      date: item.date,
      time: slot,
      duration: service.duration,
      enforceNotice: false,
    });
    const info = getDb()
      .prepare(
        `INSERT INTO appointments (
          branch_id, patient_id, service_id, doctor_id, starts_at, ends_at, duration_min, notes,
          status, payment_status, payment_method, payment_amount, booking_ref, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Unpaid', 'Cash', ?, ?, 'waitlist', ?, ?)`,
      )
      .run(item.branch_id, item.patient_id, item.service_id, doctorId, start.toISO(), end.toISO(), service.duration, `Promoted from waitlist. ${item.notes}`, service.price, newBookingRef(), now, now);
    getDb().prepare(`UPDATE waitlist SET status = 'Promoted' WHERE id = ?`).run(id);
    return Number(info.lastInsertRowid);
  });
  const appointmentId = create.immediate();
  writeAudit(req.user!, 'waitlist_promoted', `Promoted waitlist ${id} to appointment ${appointmentId}`);
  res.status(201).json(mapAppointment(getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId) as ApptRow));
});

const timeOffBody = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().max(200).optional().default(''),
  branchId: z.string().regex(/^\d+$/).optional(),
});

clinicRouter.get('/doctors/:id/time-off', (req, res) => {
  const id = parseId(req.params.id, 'Doctor');
  const rows = getDb()
    .prepare('SELECT * FROM doctor_time_off WHERE doctor_id = ? ORDER BY starts_at')
    .all(id) as Array<{ id: number; starts_at: string; ends_at: string; reason: string; branch_id: number | null }>;
  res.json(rows.map((row) => ({
    id: String(row.id),
    doctorId: String(id),
    branchId: row.branch_id == null ? null : String(row.branch_id),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
  })));
});

clinicRouter.post('/doctors/:id/time-off', staffWrite, validateBody(timeOffBody), (req, res) => {
  const id = parseId(req.params.id, 'Doctor');
  const body = req.body as z.infer<typeof timeOffBody>;
  if (body.endsAt <= body.startsAt) throw new HttpError(400, 'VALIDATION', 'Time off must end after it starts');
  const info = getDb()
    .prepare(`INSERT INTO doctor_time_off (doctor_id, branch_id, starts_at, ends_at, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, body.branchId ? Number(body.branchId) : null, body.startsAt, body.endsAt, body.reason, new Date().toISOString());
  writeAudit(req.user!, 'time_off_created', `Added time off for doctor ${id}`);
  res.status(201).json({ id: String(info.lastInsertRowid), doctorId: String(id), startsAt: body.startsAt, endsAt: body.endsAt, reason: body.reason });
});

clinicRouter.delete('/time-off/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Time off');
  const info = getDb().prepare('DELETE FROM doctor_time_off WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Time off not found');
  res.json(true);
});

const holidayBody = z.object({
  branchId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().trim().min(1).max(120),
  preventBookings: z.boolean().optional().default(true),
});

clinicRouter.get('/holidays', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM clinic_holidays ORDER BY date').all() as Array<{
    id: number; branch_id: number; date: string; label: string; prevent_bookings: number;
  }>;
  res.json(rows.map((row) => ({
    id: String(row.id),
    orgId: 'clinic',
    branchId: String(row.branch_id),
    date: row.date,
    label: row.label,
    preventBookings: row.prevent_bookings === 1,
  })));
});

clinicRouter.post('/holidays', staffWrite, validateBody(holidayBody), (req, res) => {
  const body = req.body as z.infer<typeof holidayBody>;
  try {
    const info = getDb()
      .prepare(`INSERT INTO clinic_holidays (branch_id, date, label, prevent_bookings) VALUES (?, ?, ?, ?)`)
      .run(Number(body.branchId), body.date, body.label, body.preventBookings ? 1 : 0);
    writeAudit(req.user!, 'holiday_created', `Closed ${body.date}`);
    res.status(201).json({ id: String(info.lastInsertRowid), orgId: 'clinic', branchId: body.branchId, date: body.date, label: body.label, preventBookings: body.preventBookings });
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'CONFLICT', 'That date is already closed');
    throw error;
  }
});

clinicRouter.delete('/holidays/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Holiday');
  const info = getDb().prepare('DELETE FROM clinic_holidays WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Holiday not found');
  res.json(true);
});

const noteBody = z.object({
  branchId: z.string().regex(/^\d+$/).nullable().optional(),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2000),
  read: z.boolean().optional().default(false),
  type: z.enum(['BookingCreated', 'BookingCancelled', 'LeadCreated', 'System']).optional().default('System'),
});

function mapNote(row: {
  id: number;
  branch_id: number | null;
  title: string;
  message: string;
  read: number;
  type: 'BookingCreated' | 'BookingCancelled' | 'LeadCreated' | 'System';
  created_at: string;
}) {
  return {
    id: String(row.id),
    orgId: 'clinic',
    branchId: row.branch_id == null ? null : String(row.branch_id),
    title: row.title,
    message: row.message,
    read: row.read === 1,
    type: row.type,
    createdAt: row.created_at,
  };
}

clinicRouter.get('/notifications/unread-count', (_req, res) => {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0').get() as { c: number };
  res.json({ count: row.c });
});

clinicRouter.post('/notifications/mark-all-read', staffWrite, (_req, res) => {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  res.status(204).end();
});

clinicRouter.get('/notifications', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 200').all() as Parameters<typeof mapNote>[0][];
  res.json(rows.map(mapNote));
});

clinicRouter.post('/notifications', staffWrite, validateBody(noteBody), (req, res) => {
  const body = req.body as z.infer<typeof noteBody>;
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(`INSERT INTO notifications (branch_id, title, message, read, type, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(body.branchId ? Number(body.branchId) : null, body.title, body.message, body.read ? 1 : 0, body.type, now);
  res.status(201).json(
    mapNote({
      id: Number(info.lastInsertRowid),
      branch_id: body.branchId ? Number(body.branchId) : null,
      title: body.title,
      message: body.message,
      read: body.read ? 1 : 0,
      type: body.type,
      created_at: now,
    }),
  );
});

clinicRouter.patch('/notifications/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Notification');
  const body = z.object({ read: z.boolean() }).parse(req.body);
  const info = getDb().prepare('UPDATE notifications SET read = ? WHERE id = ?').run(body.read ? 1 : 0, id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Notification not found');
  res.json(mapNote(getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Parameters<typeof mapNote>[0]));
});

clinicRouter.delete('/notifications/:id', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Notification');
  const info = getDb().prepare('DELETE FROM notifications WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Notification not found');
  res.json(true);
});

clinicRouter.get('/settings', (_req, res) => {
  res.json(readSettings());
});

const settingsPatch = z.object({
  businessName: z.string().trim().min(1).max(160).optional(),
  publicSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(200).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  language: z.enum(['en', 'ar']).optional(),
  isRtl: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  features: z
    .object({
      waitlistEnabled: z.boolean().optional(),
      telegramNotifications: z.boolean().optional(),
      publicBookingEnabled: z.boolean().optional(),
    })
    .optional(),
  bookingRules: z
    .object({
      minNoticeMinutes: z.number().int().min(0).max(10080).optional(),
      maxDaysAhead: z.number().int().min(1).max(365).optional(),
      cancelWindowHours: z.number().int().min(0).max(720).optional(),
      slotIntervalMinutes: z.number().int().min(5).max(180).optional(),
    })
    .optional(),
  telegramBotToken: z.string().trim().min(20).max(200).optional(),
  telegramChatId: z.string().trim().max(40).optional(),
  telegramEnabled: z.boolean().optional(),
  telegramBotUsername: z.string().trim().max(33).regex(/^$|^@?[A-Za-z][A-Za-z0-9_]{3,31}$/).optional(),
  telegramReminderHours: z.number().int().min(1).max(72).optional(),
  whatsappPhoneNumberId: z.string().trim().max(30).regex(/^$|^\d{5,30}$/).optional(),
  whatsappAccessToken: z.string().trim().min(20).max(500).optional(),
  whatsappBusinessAccountId: z.string().trim().max(40).regex(/^$|^\d{5,40}$/).optional(),
  whatsappTestRecipient: z.string().trim().max(20).regex(/^$|^\d{8,15}$/).optional(),
});

clinicRouter.patch('/settings', requireRoles('owner'), (req, res) => {
  const body = settingsPatch.parse(req.body);
  const current = readSettings();
  const features = {
    ...current.features,
    ...(body.features ?? {}),
    ...(body.telegramEnabled === undefined ? {} : { telegramNotifications: body.telegramEnabled }),
  };
  const bookingRules = { ...current.bookingRules, ...(body.bookingRules ?? {}) };
  const next = {
    businessName: body.businessName ?? current.businessName,
    publicSlug: body.publicSlug ?? current.publicSlug,
    logoUrl: body.logoUrl === undefined ? current.logoUrl ?? null : body.logoUrl,
    address: body.address ?? current.address,
    phone: body.phone ?? current.phone,
    email: body.email ?? current.email,
    currency: body.currency ?? current.currency,
    language: body.language ?? current.language,
    isRtl: body.isRtl ?? (body.language ? body.language === 'ar' : current.isRtl),
    timezone: body.timezone ?? current.timezone,
  };
  try {
    getDb()
      .prepare(
        `UPDATE settings SET business_name = ?, public_slug = ?, logo_url = ?, address = ?, phone = ?, email = ?,
         currency = ?, language = ?, is_rtl = ?, timezone = ?, features_json = ?, booking_rules_json = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        next.businessName,
        next.publicSlug,
        next.logoUrl,
        next.address,
        next.phone,
        next.email,
        next.currency,
        next.language,
        next.isRtl ? 1 : 0,
        next.timezone,
        JSON.stringify(features),
        JSON.stringify(bookingRules),
        new Date().toISOString(),
      );
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'CONFLICT', 'That public booking link is already in use');
    throw error;
  }
  if (body.telegramBotToken) {
    getDb().prepare('UPDATE settings SET telegram_bot_token = ? WHERE id = 1').run(body.telegramBotToken);
  }
  if (body.telegramChatId !== undefined) {
    getDb().prepare('UPDATE settings SET telegram_chat_id = ? WHERE id = 1').run(body.telegramChatId);
  }
  if (body.telegramEnabled !== undefined) {
    getDb().prepare('UPDATE settings SET telegram_enabled = ? WHERE id = 1').run(body.telegramEnabled ? 1 : 0);
  }
  if (body.telegramBotUsername !== undefined) {
    getDb().prepare('UPDATE settings SET telegram_bot_username = ? WHERE id = 1').run(body.telegramBotUsername.replace(/^@/, ''));
  }
  if (body.telegramReminderHours !== undefined) {
    getDb().prepare('UPDATE settings SET telegram_reminder_hours = ? WHERE id = 1').run(body.telegramReminderHours);
  }
  if (body.whatsappPhoneNumberId !== undefined) {
    getDb().prepare('UPDATE settings SET whatsapp_phone_number_id = ? WHERE id = 1').run(body.whatsappPhoneNumberId);
  }
  if (body.whatsappAccessToken) {
    getDb().prepare('UPDATE settings SET whatsapp_access_token = ? WHERE id = 1').run(body.whatsappAccessToken);
  }
  if (body.whatsappBusinessAccountId !== undefined) {
    getDb().prepare('UPDATE settings SET whatsapp_business_account_id = ? WHERE id = 1').run(body.whatsappBusinessAccountId);
  }
  if (body.whatsappTestRecipient !== undefined) {
    getDb().prepare('UPDATE settings SET whatsapp_test_recipient = ? WHERE id = 1').run(body.whatsappTestRecipient);
  }
  void refreshTelegramBot();
  writeAudit(req.user!, 'settings_updated', 'Clinic settings updated');
  res.json(readSettings());
});

clinicRouter.post('/settings/telegram-test', requireRoles('owner'), asyncHandler(async (_req, res) => {
  await sendTelegramTest();
  res.json({ delivered: true });
}));

clinicRouter.post('/settings/whatsapp-test', requireRoles('owner'), asyncHandler(async (_req, res) => {
  const result = await sendWhatsAppTest();
  res.json({ delivered: true, providerMessageId: result.providerMessageId });
}));

clinicRouter.post('/patients/:id/telegram-link', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  const patient = getDb().prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!patient) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
  const link = createPatientLink(id);
  writeAudit(req.user!, 'telegram_link_created', `Created a Telegram link for patient ${id}`);
  res.status(201).json({ token: link.token, instruction: link.instruction });
});

clinicRouter.get('/audit', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500')
    .all() as Array<{ id: number; user_id: number | null; user_name: string; action: string; details: string; created_at: string }>;
  res.json(
    rows.map((row) => ({
      id: String(row.id),
      orgId: 'clinic',
      userId: row.user_id == null ? 'system' : String(row.user_id),
      userName: row.user_name,
      timestamp: row.created_at,
      action: row.action,
      details: row.details,
    })),
  );
});

clinicRouter.post(
  '/audit',
  validateBody(z.object({ action: z.string().trim().min(1).max(120), details: z.string().max(2000) })),
  (req, res) => {
    const body = req.body as { action: string; details: string };
    writeAudit(req.user!, body.action, body.details);
    const row = getDb().prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1').get() as {
      id: number;
      user_id: number | null;
      user_name: string;
      action: string;
      details: string;
      created_at: string;
    };
    res.status(201).json({
      id: String(row.id),
      orgId: 'clinic',
      userId: String(row.user_id),
      userName: row.user_name,
      timestamp: row.created_at,
      action: row.action,
      details: row.details,
    });
  },
);

function validateBody<T extends z.ZodType>(schema: T) {
  return (req: import('express').Request, _res: Response, next: import('express').NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}
