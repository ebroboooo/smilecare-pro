import { DateTime } from 'luxon';
import { getDb } from './db.js';
import { HttpError } from './http.js';
import { getClinicZone, localToUtc, minutesOf, timeOf } from './time.js';

export interface BookingRules {
  minNoticeMinutes: number;
  maxDaysAhead: number;
  cancelWindowHours: number;
  slotIntervalMinutes: number;
}

interface ScheduleRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_working: number;
  breaks_json: string;
}

export function readBookingRules(): BookingRules {
  const row = getDb().prepare('SELECT booking_rules_json FROM settings WHERE org_id = 1').get() as { booking_rules_json: string };
  return JSON.parse(row.booking_rules_json) as BookingRules;
}

export function clinicWeekday(date: string, zone: string): number {
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) throw new HttpError(400, 'VALIDATION', 'Invalid date');
  return dt.weekday % 7;
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart;
}

export function slotsForDoctor(input: {
  doctorId: number;
  branchId: number;
  date: string;
  duration: number;
  excludeId?: number;
  enforceNotice: boolean;
}): string[] {
  const zone = getClinicZone();
  const rules = readBookingRules();
  const holiday = getDb()
    .prepare(`SELECT id FROM clinic_holidays WHERE branch_id = ? AND date = ? AND prevent_bookings = 1`)
    .get(input.branchId, input.date);
  if (holiday) return [];

  const schedule = getDb()
    .prepare(`SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?`)
    .get(input.doctorId, clinicWeekday(input.date, zone)) as ScheduleRow | undefined;
  if (!schedule || schedule.is_working !== 1) return [];

  const breaks = JSON.parse(schedule.breaks_json) as Array<{ start: string; end: string }>;
  const workStart = minutesOf(schedule.start_time);
  const workEnd = minutesOf(schedule.end_time);
  const interval = rules.slotIntervalMinutes || 30;
  const nowLimit = DateTime.utc().plus({ minutes: input.enforceNotice ? rules.minNoticeMinutes : 0 });
  const horizon = DateTime.now().setZone(zone).startOf('day').plus({ days: rules.maxDaysAhead });
  if (input.enforceNotice && input.date > horizon.toFormat('yyyy-MM-dd')) return [];

  const dayStart = localToUtc(input.date, '00:00', zone).toISO()!;
  const dayEnd = localToUtc(input.date, '00:00', zone).plus({ days: 1 }).toISO()!;
  const timeOff = getDb()
    .prepare(
      `SELECT starts_at, ends_at FROM doctor_time_off
       WHERE doctor_id = ? AND starts_at < ? AND ends_at > ?`,
    )
    .all(input.doctorId, dayEnd, dayStart) as Array<{ starts_at: string; ends_at: string }>;
  const appointments = getDb()
    .prepare(
      `SELECT id, starts_at, ends_at FROM appointments
       WHERE doctor_id = ? AND status != 'Cancelled' AND starts_at < ? AND ends_at > ?`,
    )
    .all(input.doctorId, dayEnd, dayStart) as Array<{ id: number; starts_at: string; ends_at: string }>;

  const slots: string[] = [];
  for (let cursor = workStart; cursor + input.duration <= workEnd; cursor += interval) {
    const label = timeOf(cursor);
    const slotEnd = cursor + input.duration;
    if (breaks.some((brk) => overlaps(cursor, slotEnd, minutesOf(brk.start), minutesOf(brk.end)))) continue;
    const start = localToUtc(input.date, label, zone);
    const end = start.plus({ minutes: input.duration });
    if (input.enforceNotice && start < nowLimit) continue;
    if (!input.enforceNotice && start < DateTime.utc().minus({ days: 1 })) {
      // Staff can record recent visits, not arbitrary history.
    }
    const startIso = start.toISO()!;
    const endIso = end.toISO()!;
    if (timeOff.some((row) => row.starts_at < endIso && row.ends_at > startIso)) continue;
    if (appointments.some((row) => row.id !== input.excludeId && row.starts_at < endIso && row.ends_at > startIso)) continue;
    slots.push(label);
  }
  return slots;
}

export function assertSlotAvailable(input: {
  doctorId: number;
  branchId: number;
  date: string;
  time: string;
  duration: number;
  excludeId?: number;
  enforceNotice: boolean;
}) {
  const slots = slotsForDoctor(input);
  if (!slots.includes(input.time)) {
    throw new HttpError(409, 'UNAVAILABLE', 'That time is not available');
  }
}

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed: Record<string, string[]> = {
    Pending: ['Confirmed', 'Cancelled'],
    Confirmed: ['Completed', 'Cancelled', 'NoShow'],
    Completed: [],
    Cancelled: [],
    NoShow: [],
  };
  return (allowed[from] ?? []).includes(to);
}
