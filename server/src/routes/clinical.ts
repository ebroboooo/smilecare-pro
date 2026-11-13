import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { requireAuth, requireRoles } from '../auth.js';
import { getDb } from '../db.js';
import { HttpError, parseId } from '../http.js';
import { publicOrgId, requireOrgId } from '../org.js';

const staffWrite = requireRoles('owner', 'receptionist');
const clinicalWrite = requireRoles('owner', 'receptionist', 'doctor');

function requireOrgPatient(patientId: number, orgId: number) {
  const row = getDb()
    .prepare(`SELECT id FROM patients WHERE id = ? AND org_id = ? AND deleted_at IS NULL`)
    .get(patientId, orgId);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
}

const planItemSchema = z.object({
  tooth: z.string().regex(/^[1-4][1-8]$/).nullable().optional(),
  description: z.string().trim().min(1).max(300),
  fee: z.number().nonnegative().max(1_000_000).optional().default(0),
  status: z.enum(['Planned', 'InProgress', 'Done', 'Skipped']).optional().default('Planned'),
  sortOrder: z.number().int().min(0).max(500).optional().default(0),
});

const planBody = z.object({
  title: z.string().trim().min(1).max(160),
  status: z.enum(['Draft', 'Active', 'Completed', 'Cancelled']).optional().default('Draft'),
  notes: z.string().max(5000).optional().default(''),
  items: z.array(planItemSchema).max(100).optional().default([]),
});

const invoiceBody = z.object({
  patientId: z.string().regex(/^\d+$/),
  appointmentId: z.string().regex(/^\d+$/).optional(),
  notes: z.string().max(2000).optional().default(''),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        amount: z.number().nonnegative().max(1_000_000),
      }),
    )
    .min(1)
    .max(50),
  taxTotal: z.number().nonnegative().max(1_000_000).optional().default(0),
  markIssued: z.boolean().optional().default(true),
});

function nextInvoiceNumber(orgId: number): string {
  const year = new Date().getUTCFullYear();
  const count = (
    getDb()
      .prepare(`SELECT COUNT(*) AS c FROM invoices WHERE org_id = ? AND invoice_number LIKE ?`)
      .get(orgId, `INV-${year}-%`) as { c: number }
  ).c;
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

function loadPlan(id: number, orgId: number) {
  const row = getDb().prepare(`SELECT * FROM treatment_plans WHERE id = ? AND org_id = ?`).get(id, orgId) as
    | {
        id: number;
        org_id: number;
        patient_id: number;
        title: string;
        status: string;
        notes: string;
        estimated_total: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const items = getDb()
    .prepare(
      `SELECT id, tooth, description, fee, status, sort_order FROM treatment_plan_items WHERE plan_id = ? ORDER BY sort_order, id`,
    )
    .all(id) as Array<{
    id: number;
    tooth: string | null;
    description: string;
    fee: number;
    status: string;
    sort_order: number;
  }>;
  return {
    id: String(row.id),
    orgId: publicOrgId(row.org_id),
    patientId: String(row.patient_id),
    title: row.title,
    status: row.status,
    notes: row.notes,
    estimatedTotal: row.estimated_total,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item) => ({
      id: String(item.id),
      tooth: item.tooth,
      description: item.description,
      fee: item.fee,
      status: item.status,
      sortOrder: item.sort_order,
    })),
  };
}

export const clinicalRouter = Router();
clinicalRouter.use(requireAuth);

clinicalRouter.get('/patients/:id/treatment-plans', (req, res) => {
  const orgId = requireOrgId(req);
  const patientId = parseId(req.params.id, 'Patient');
  requireOrgPatient(patientId, orgId);
  const rows = getDb()
    .prepare(`SELECT id FROM treatment_plans WHERE patient_id = ? AND org_id = ? ORDER BY id DESC`)
    .all(patientId, orgId) as Array<{ id: number }>;
  res.json(rows.map((row) => loadPlan(row.id, orgId)));
});

clinicalRouter.post('/patients/:id/treatment-plans', clinicalWrite, (req, res) => {
  const orgId = requireOrgId(req);
  const patientId = parseId(req.params.id, 'Patient');
  requireOrgPatient(patientId, orgId);
  const body = planBody.parse(req.body);
  const now = new Date().toISOString();
  const estimated = body.items.reduce((sum, item) => sum + (item.fee || 0), 0);
  const create = getDb().transaction(() => {
    const info = getDb()
      .prepare(
        `INSERT INTO treatment_plans (org_id, patient_id, title, status, notes, estimated_total, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(orgId, patientId, body.title, body.status, body.notes, estimated, now, now);
    const planId = Number(info.lastInsertRowid);
    const insertItem = getDb().prepare(
      `INSERT INTO treatment_plan_items (plan_id, tooth, description, fee, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    body.items.forEach((item, index) => {
      insertItem.run(planId, item.tooth ?? null, item.description, item.fee, item.status, item.sortOrder ?? index);
    });
    return planId;
  });
  const planId = create();
  writeAudit(req.user!, 'treatment_plan_created', `Created treatment plan ${planId}`);
  res.status(201).json(loadPlan(planId, orgId));
});

clinicalRouter.patch('/treatment-plans/:id', clinicalWrite, (req, res) => {
  const orgId = requireOrgId(req);
  const id = parseId(req.params.id, 'Treatment plan');
  const existing = loadPlan(id, orgId);
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Treatment plan not found');
  const body = planBody.partial().parse(req.body);
  const now = new Date().toISOString();
  const apply = getDb().transaction(() => {
    const title = body.title ?? existing.title;
    const status = body.status ?? existing.status;
    const notes = body.notes ?? existing.notes;
    let estimated = existing.estimatedTotal;
    if (body.items) {
      getDb().prepare('DELETE FROM treatment_plan_items WHERE plan_id = ?').run(id);
      const insertItem = getDb().prepare(
        `INSERT INTO treatment_plan_items (plan_id, tooth, description, fee, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      estimated = body.items.reduce((sum, item) => sum + (item.fee || 0), 0);
      body.items.forEach((item, index) => {
        insertItem.run(id, item.tooth ?? null, item.description, item.fee, item.status, item.sortOrder ?? index);
      });
    }
    getDb()
      .prepare(
        `UPDATE treatment_plans SET title = ?, status = ?, notes = ?, estimated_total = ?, updated_at = ? WHERE id = ? AND org_id = ?`,
      )
      .run(title, status, notes, estimated, now, id, orgId);
  });
  apply();
  writeAudit(req.user!, 'treatment_plan_updated', `Updated treatment plan ${id}`);
  res.json(loadPlan(id, orgId));
});

clinicalRouter.get('/invoices', (req, res) => {
  const orgId = requireOrgId(req);
  const patientId = typeof req.query.patientId === 'string' ? Number(req.query.patientId) : null;
  const params: unknown[] = [orgId];
  let where = 'WHERE org_id = ?';
  if (patientId) {
    where += ' AND patient_id = ?';
    params.push(patientId);
  }
  const rows = getDb()
    .prepare(
      `SELECT id, org_id, patient_id, appointment_id, invoice_number, status, currency, subtotal, tax_total, total, issued_at, paid_at, notes, created_at
       FROM invoices ${where} ORDER BY id DESC LIMIT 200`,
    )
    .all(...params) as Array<{
    id: number;
    org_id: number;
    patient_id: number;
    appointment_id: number | null;
    invoice_number: string;
    status: string;
    currency: string;
    subtotal: number;
    tax_total: number;
    total: number;
    issued_at: string | null;
    paid_at: string | null;
    notes: string;
    created_at: string;
  }>;
  res.json(
    rows.map((row) => ({
      id: String(row.id),
      orgId: publicOrgId(row.org_id),
      patientId: String(row.patient_id),
      appointmentId: row.appointment_id == null ? null : String(row.appointment_id),
      invoiceNumber: row.invoice_number,
      status: row.status,
      currency: row.currency,
      subtotal: row.subtotal,
      taxTotal: row.tax_total,
      total: row.total,
      issuedAt: row.issued_at,
      paidAt: row.paid_at,
      notes: row.notes,
      createdAt: row.created_at,
    })),
  );
});

clinicalRouter.post('/invoices', staffWrite, (req, res) => {
  const orgId = requireOrgId(req);
  const body = invoiceBody.parse(req.body);
  const patientId = Number(body.patientId);
  requireOrgPatient(patientId, orgId);
  if (body.appointmentId) {
    const appt = getDb()
      .prepare(`SELECT id FROM appointments WHERE id = ? AND org_id = ?`)
      .get(Number(body.appointmentId), orgId);
    if (!appt) throw new HttpError(400, 'VALIDATION', 'Appointment not found in this clinic');
  }
  const settings = getDb().prepare(`SELECT currency FROM settings WHERE org_id = ?`).get(orgId) as { currency: string };
  const subtotal = body.lines.reduce((sum, line) => sum + line.amount, 0);
  const taxTotal = body.taxTotal;
  const total = subtotal + taxTotal;
  const now = new Date().toISOString();
  const number = nextInvoiceNumber(orgId);
  const info = getDb()
    .prepare(
      `INSERT INTO invoices (
         org_id, patient_id, appointment_id, invoice_number, status, currency, subtotal, tax_total, total,
         issued_at, paid_at, notes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      orgId,
      patientId,
      body.appointmentId ? Number(body.appointmentId) : null,
      number,
      body.markIssued ? 'Issued' : 'Draft',
      settings?.currency || 'EGP',
      subtotal,
      taxTotal,
      total,
      body.markIssued ? now : null,
      body.notes,
      now,
    );
  writeAudit(req.user!, 'invoice_created', `Created invoice ${number}`);
  res.status(201).json({
    id: String(info.lastInsertRowid),
    orgId: publicOrgId(orgId),
    patientId: String(patientId),
    appointmentId: body.appointmentId ?? null,
    invoiceNumber: number,
    status: body.markIssued ? 'Issued' : 'Draft',
    currency: settings?.currency || 'EGP',
    subtotal,
    taxTotal,
    total,
    issuedAt: body.markIssued ? now : null,
    paidAt: null,
    notes: body.notes,
    createdAt: now,
    lines: body.lines,
  });
});

clinicalRouter.post('/invoices/:id/mark-paid', staffWrite, (req, res) => {
  const orgId = requireOrgId(req);
  const id = parseId(req.params.id, 'Invoice');
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `UPDATE invoices SET status = 'Paid', paid_at = ? WHERE id = ? AND org_id = ? AND status IN ('Issued', 'Draft')`,
    )
    .run(now, id, orgId);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found or already closed');
  writeAudit(req.user!, 'invoice_paid', `Marked invoice ${id} paid`);
  const row = getDb().prepare(`SELECT * FROM invoices WHERE id = ?`).get(id) as {
    id: number;
    org_id: number;
    patient_id: number;
    appointment_id: number | null;
    invoice_number: string;
    status: string;
    currency: string;
    subtotal: number;
    tax_total: number;
    total: number;
    issued_at: string | null;
    paid_at: string | null;
    notes: string;
    created_at: string;
  };
  res.json({
    id: String(row.id),
    orgId: publicOrgId(row.org_id),
    patientId: String(row.patient_id),
    appointmentId: row.appointment_id == null ? null : String(row.appointment_id),
    invoiceNumber: row.invoice_number,
    status: row.status,
    currency: row.currency,
    subtotal: row.subtotal,
    taxTotal: row.tax_total,
    total: row.total,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
    notes: row.notes,
    createdAt: row.created_at,
  });
});
