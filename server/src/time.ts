import { DateTime } from 'luxon';
import { getDb } from './db.js';
import { HttpError } from './http.js';

export function clinicNow(zone: string): DateTime {
  return DateTime.now().setZone(zone);
}

export function localToUtc(date: string, time: string, zone: string): DateTime {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) throw new HttpError(400, 'VALIDATION', 'Invalid date or time');
  return dt.toUTC();
}

export function utcToLocal(iso: string, zone: string): { date: string; time: string } {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  if (!dt.isValid) throw new HttpError(500, 'INTERNAL', 'Stored appointment time is invalid');
  return { date: dt.toFormat('yyyy-MM-dd'), time: dt.toFormat('HH:mm') };
}

export function getClinicZone(): string {
  const row = getDb().prepare('SELECT timezone FROM settings WHERE id = 1').get() as { timezone: string } | undefined;
  return row?.timezone || 'Africa/Cairo';
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h! * 60 + m!;
}

export function timeOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
