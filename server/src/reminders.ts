import { getDb } from './db.js';

export function claimReminder(appointmentId: number, kind: string, scheduledFor: string): boolean {
  const info = getDb()
    .prepare(
      `INSERT INTO reminders (appointment_id, kind, scheduled_for, status) VALUES (?, ?, ?, 'pending')
       ON CONFLICT(appointment_id, kind) DO NOTHING`,
    )
    .run(appointmentId, kind, scheduledFor);
  return info.changes === 1;
}
