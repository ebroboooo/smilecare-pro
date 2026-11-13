import { Router } from 'express';
import { requireAuth, requireRoles } from '../auth.js';
import { getDb } from '../db.js';
import { writeAudit } from '../audit.js';
import { HttpError, parseId } from '../http.js';

export const privacyRouter = Router();
privacyRouter.use(requireAuth);

privacyRouter.get('/patients/:id/export', (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  const orgId = req.user!.orgId;
  const patient = getDb().prepare(
    `SELECT id, full_name, phone, email, notes, tags, status, total_spending, created_at, anonymized_at, medical_alerts, national_id
     FROM patients WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  ).get(id, orgId);
  if (!patient) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
  const appointments = getDb().prepare(
    `SELECT id, starts_at, ends_at, status, payment_status, payment_method, payment_amount, booking_ref, notes
     FROM appointments WHERE patient_id = ? AND org_id = ? ORDER BY starts_at`,
  ).all(id, orgId);
  const visits = getDb().prepare(
    `SELECT id, visited_on, complaint, diagnosis, treatment, notes FROM visits WHERE patient_id = ? ORDER BY visited_on`,
  ).all(id);
  const teeth = getDb().prepare('SELECT tooth, condition, note, updated_at FROM tooth_findings WHERE patient_id = ?').all(id);
  const payments = getDb().prepare('SELECT id, amount, method, note, paid_at FROM payments WHERE patient_id = ? ORDER BY paid_at').all(id);
  getDb()
    .prepare(
      `INSERT INTO patient_access_logs (org_id, patient_id, user_id, user_name, action, created_at)
       VALUES (?, ?, ?, ?, 'export', ?)`,
    )
    .run(orgId, id, req.user!.id, req.user!.name, new Date().toISOString());
  writeAudit(req.user!, 'patient_exported', `Exported patient ${id}`);
  res.json({ patient, appointments, visits, teeth, payments });
});

privacyRouter.post('/patients/:id/anonymize', requireRoles('owner'), (req, res) => {
  const id = parseId(req.params.id, 'Patient');
  const orgId = req.user!.orgId;
  const now = new Date().toISOString();
  const info = getDb().prepare(
    `UPDATE patients
     SET full_name = 'Anonymized patient', phone = 'anonymized', email = '', notes = '', tags = '[]',
         medical_alerts = '', national_id = '', anonymized_at = ?
     WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  ).run(now, id, orgId);
  if (info.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'Patient not found');
  getDb().prepare(`DELETE FROM telegram_links WHERE patient_id = ?`).run(id);
  writeAudit(req.user!, 'patient_anonymized', `Anonymized patient ${id}`);
  res.json({ id: String(id), anonymizedAt: now });
});
