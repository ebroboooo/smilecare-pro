import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRoles } from '../auth.js';
import { getDb } from '../db.js';
import { writeAudit } from '../audit.js';
import { HttpError, asyncHandler, parseId } from '../http.js';
import { requireOrgId } from '../org.js';

const staffWrite = requireRoles('owner', 'receptionist');
const toothSchema = z.string().regex(/^[1-4][1-8]$/);
const conditionSchema = z.enum(['Sound', 'Caries', 'Filled', 'Missing', 'Crown', 'RootCanal']);

const chartBody = z.object({
  teeth: z.array(z.object({
    tooth: toothSchema,
    condition: conditionSchema,
    note: z.string().max(300).optional().default(''),
  })).max(32),
});

const visitBody = z.object({
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  doctorId: z.string().regex(/^\d+$/).optional(),
  appointmentId: z.string().regex(/^\d+$/).optional(),
  complaint: z.string().max(2000).optional().default(''),
  diagnosis: z.string().max(2000).optional().default(''),
  treatment: z.string().max(2000).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
});

const paymentBody = z.object({
  amount: z.number().positive().max(1_000_000),
  method: z.enum(['Cash', 'Card']),
  appointmentId: z.string().regex(/^\d+$/).optional(),
  note: z.string().max(300).optional().default(''),
  paidAt: z.string().datetime().optional(),
});

function requirePatient(id: number, orgId: number) {
  const row = getDb()
    .prepare('SELECT id FROM patients WHERE id = ? AND org_id = ? AND deleted_at IS NULL')
    .get(id, orgId);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
}

export const dentalRouter = Router();
dentalRouter.use(requireAuth);

dentalRouter.get('/patients/:id/odontogram', (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  requirePatient(id, requireOrgId(req));
  const rows = getDb().prepare('SELECT tooth, condition, note, updated_at FROM tooth_findings WHERE patient_id = ? ORDER BY tooth').all(id);
  res.json({ teeth: rows });
});

dentalRouter.put('/patients/:id/odontogram', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  requirePatient(id, requireOrgId(req));
  const body = chartBody.parse(req.body);
  const now = new Date().toISOString();
  const save = getDb().transaction(() => {
    const upsert = getDb().prepare(
      `INSERT INTO tooth_findings (patient_id, tooth, condition, note, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(patient_id, tooth) DO UPDATE SET condition = excluded.condition, note = excluded.note, updated_at = excluded.updated_at`,
    );
    for (const tooth of body.teeth) upsert.run(id, tooth.tooth, tooth.condition, tooth.note, now);
  });
  save();
  writeAudit(req.user!, 'odontogram_updated', `Updated tooth chart for patient ${id}`);
  const rows = getDb().prepare('SELECT tooth, condition, note, updated_at FROM tooth_findings WHERE patient_id = ? ORDER BY tooth').all(id);
  res.json({ teeth: rows });
}));

dentalRouter.get('/patients/:id/visits', (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  requirePatient(id, requireOrgId(req));
  const rows = getDb().prepare(
    `SELECT v.*, d.name AS doctor_name FROM visits v
     LEFT JOIN doctors d ON d.id = v.doctor_id
     WHERE v.patient_id = ? ORDER BY v.visited_on DESC, v.id DESC`,
  ).all(id) as Array<Record<string, unknown>>;
  res.json(rows.map((row) => ({
    id: String(row.id),
    patientId: String(row.patient_id),
    doctorId: row.doctor_id == null ? null : String(row.doctor_id),
    doctorName: row.doctor_name || '',
    appointmentId: row.appointment_id == null ? null : String(row.appointment_id),
    visitedOn: row.visited_on,
    complaint: row.complaint,
    diagnosis: row.diagnosis,
    treatment: row.treatment,
    notes: row.notes,
  })));
});

dentalRouter.post('/patients/:id/visits', (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  requirePatient(id, requireOrgId(req));
  const body = visitBody.parse(req.body);
  const info = getDb().prepare(
    `INSERT INTO visits (patient_id, appointment_id, doctor_id, visited_on, complaint, diagnosis, treatment, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    body.appointmentId ? Number(body.appointmentId) : null,
    body.doctorId ? Number(body.doctorId) : null,
    body.visitedOn,
    body.complaint,
    body.diagnosis,
    body.treatment,
    body.notes,
    new Date().toISOString(),
  );
  writeAudit(req.user!, 'visit_recorded', `Recorded a visit for patient ${id}`);
  res.status(201).json({ id: String(info.lastInsertRowid) });
});

function balanceFor(patientId: number) {
  const charges = getDb().prepare(
    `SELECT COALESCE(SUM(payment_amount), 0) AS total FROM appointments
     WHERE patient_id = ? AND status != 'Cancelled' AND payment_amount IS NOT NULL`,
  ).get(patientId) as { total: number };
  const paid = getDb().prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE patient_id = ?').get(patientId) as { total: number };
  return { charges: charges.total, paid: paid.total, balance: Math.round((charges.total - paid.total) * 100) / 100 };
}

dentalRouter.get('/patients/:id/balance', (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  requirePatient(id, requireOrgId(req));
  res.json(balanceFor(id));
});

dentalRouter.get('/patients/:id/payments', (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  requirePatient(id, requireOrgId(req));
  const rows = getDb().prepare('SELECT * FROM payments WHERE patient_id = ? ORDER BY paid_at DESC, id DESC').all(id) as Array<{
    id: number; amount: number; method: string; note: string; paid_at: string; appointment_id: number | null;
  }>;
  res.json({
    ...balanceFor(id),
    payments: rows.map((row) => ({
      id: String(row.id),
      amount: row.amount,
      method: row.method,
      note: row.note,
      paidAt: row.paid_at,
      appointmentId: row.appointment_id == null ? null : String(row.appointment_id),
    })),
  });
});

dentalRouter.post('/patients/:id/payments', staffWrite, (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  requirePatient(id, requireOrgId(req));
  const body = paymentBody.parse(req.body);
  const paidAt = body.paidAt || new Date().toISOString();
  const info = getDb().prepare(
    `INSERT INTO payments (patient_id, appointment_id, amount, method, note, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, body.appointmentId ? Number(body.appointmentId) : null, body.amount, body.method, body.note, paidAt, new Date().toISOString());
  if (body.appointmentId) {
    const appointmentId = Number(body.appointmentId);
    const fee = getDb().prepare('SELECT payment_amount FROM appointments WHERE id = ? AND patient_id = ?').get(appointmentId, id) as { payment_amount: number | null } | undefined;
    const collected = getDb().prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE appointment_id = ?').get(appointmentId) as { total: number };
    if (fee?.payment_amount != null && collected.total >= fee.payment_amount) {
      getDb().prepare(`UPDATE appointments SET payment_status = 'Paid', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), appointmentId);
    }
  }
  writeAudit(req.user!, 'payment_recorded', `Recorded a ${body.method} payment for patient ${id}`);
  res.status(201).json({ id: String(info.lastInsertRowid), ...balanceFor(id) });
});
