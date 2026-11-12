import { createHash, randomBytes } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import { canTransition } from './availability.js';
import { getDb } from './db.js';
import { HttpError } from './http.js';
import { logger } from './logger.js';
import { getClinicZone, utcToLocal } from './time.js';

let bot: Bot | null = null;
let activeToken = '';
let reminderTimer: NodeJS.Timeout | undefined;

interface TelegramConfig {
  token: string;
  chatId: string;
  enabled: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readTelegramConfig(): TelegramConfig {
  const row = getDb().prepare('SELECT telegram_bot_token, telegram_chat_id, telegram_enabled FROM settings WHERE id = 1').get() as {
    telegram_bot_token: string | null;
    telegram_chat_id: string | null;
    telegram_enabled: number;
  };
  return {
    token: row.telegram_bot_token || '',
    chatId: row.telegram_chat_id || '',
    enabled: row.telegram_enabled === 1,
  };
}

export function claimReminder(appointmentId: number, kind: string, scheduledFor: string): boolean {
  const info = getDb()
    .prepare(`INSERT INTO reminders (appointment_id, kind, scheduled_for, status) VALUES (?, ?, ?, 'pending') ON CONFLICT(appointment_id, kind) DO NOTHING`)
    .run(appointmentId, kind, scheduledFor);
  return info.changes === 1;
}

function reminderStatus(appointmentId: number, kind: string): string | undefined {
  const row = getDb().prepare('SELECT status FROM reminders WHERE appointment_id = ? AND kind = ?').get(appointmentId, kind) as { status: string } | undefined;
  return row?.status;
}

function setReminderStatus(appointmentId: number, kind: string, status: string) {
  getDb().prepare(`UPDATE reminders SET status = ?, sent_at = ? WHERE appointment_id = ? AND kind = ?`).run(status, status === 'sent' ? new Date().toISOString() : null, appointmentId, kind);
}

async function stopBot() {
  const current = bot;
  bot = null;
  activeToken = '';
  if (current) {
    try {
      await current.stop();
    } catch {
      logger.warn('Telegram bot stop was ignored');
    }
  }
}

function attachHandlers(next: Bot) {
  next.command('start', async (ctx) => {
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!payload) {
      await ctx.reply('SmileCare will send appointment reminders in this chat after the clinic links it.');
      return;
    }
    const info = getDb()
      .prepare(`UPDATE telegram_links SET chat_id = ?, link_token_hash = NULL WHERE link_token_hash = ? AND chat_id = 'pending'`)
      .run(String(ctx.chat.id), sha256(payload));
    await ctx.reply(info.changes > 0 ? 'This chat is linked. Appointment reminders will arrive here.' : 'This link is no longer valid.');
  });

  next.on('callback_query:data', async (ctx) => {
    const match = /^appt:(confirm|cancel):(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const nextStatus = match[1] === 'confirm' ? 'Confirmed' : 'Cancelled';
    const id = Number(match[2]);
    const row = getDb().prepare('SELECT status FROM appointments WHERE id = ?').get(id) as { status: string } | undefined;
    if (!row || !canTransition(row.status, nextStatus)) {
      await ctx.answerCallbackQuery({ text: 'This appointment can no longer be changed' });
      return;
    }
    getDb().prepare(`UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, new Date().toISOString(), id);
    await ctx.answerCallbackQuery({ text: nextStatus });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      logger.warn('Telegram keyboard was already cleared');
    }
  });
}

export async function refreshTelegramBot(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const config = readTelegramConfig();
  if (!config.enabled || !config.token) {
    await stopBot();
    return;
  }
  if (bot && activeToken === config.token) return;
  await stopBot();
  const next = new Bot(config.token);
  attachHandlers(next);
  bot = next;
  activeToken = config.token;
  void next.start({
    onStart: () => logger.info('Telegram bot is polling'),
  }).catch(() => {
    logger.error('Telegram bot could not start');
    if (bot === next) {
      bot = null;
      activeToken = '';
    }
  });
}

async function sendText(chatId: string, text: string, appointmentId?: number) {
  const config = readTelegramConfig();
  const client = bot ?? (config.token ? new Bot(config.token) : null);
  if (!client) return;
  const keyboard = appointmentId
    ? new InlineKeyboard().text('Confirm', `appt:confirm:${appointmentId}`).text('Cancel', `appt:cancel:${appointmentId}`)
    : undefined;
  await client.api.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : undefined);
}

export function queueAppointmentAlert(appointmentId: number): void {
  if (process.env.NODE_ENV === 'test') return;
  void notifyAppointment(appointmentId).catch(() => logger.warn('Telegram appointment alert was not sent'));
}

async function notifyAppointment(appointmentId: number) {
  const config = readTelegramConfig();
  if (!config.enabled || !config.chatId) return;
  const row = getDb().prepare(
    `SELECT a.starts_at, a.booking_ref, p.full_name, s.name AS service_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN services s ON s.id = a.service_id
     WHERE a.id = ?`,
  ).get(appointmentId) as { starts_at: string; booking_ref: string; full_name: string; service_name: string } | undefined;
  if (!row) return;
  const local = utcToLocal(row.starts_at, getClinicZone());
  await sendText(config.chatId, `New appointment: ${row.full_name}, ${row.service_name}, ${local.date} ${local.time}. Reference ${row.booking_ref}.`, appointmentId);
}

export async function sendTelegramTest(): Promise<void> {
  const config = readTelegramConfig();
  if (!config.token || !config.chatId) throw new HttpError(400, 'VALIDATION', 'Save a bot token and a chat id first');
  try {
    await sendText(config.chatId, 'SmileCare test message. Telegram is connected.');
  } catch {
    throw new HttpError(502, 'TELEGRAM', 'Telegram did not accept the test message');
  }
}

export function createPatientLink(patientId: number): { token: string } {
  const token = randomBytes(16).toString('hex');
  getDb()
    .prepare(`INSERT INTO telegram_links (patient_id, chat_id, link_token_hash, created_at) VALUES (?, 'pending', ?, ?)`)
    .run(patientId, sha256(token), new Date().toISOString());
  return { token };
}

async function deliverReminder(appointmentId: number) {
  const config = readTelegramConfig();
  if (!config.enabled || !config.token) return;
  if (reminderStatus(appointmentId, 'upcoming') === 'sent') return;
  const row = getDb().prepare(
    `SELECT a.starts_at, a.booking_ref, a.patient_id, p.full_name, s.name AS service_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN services s ON s.id = a.service_id
     WHERE a.id = ?`,
  ).get(appointmentId) as { starts_at: string; booking_ref: string; patient_id: number; full_name: string; service_name: string } | undefined;
  if (!row) return;
  if (reminderStatus(appointmentId, 'upcoming') === undefined && !claimReminder(appointmentId, 'upcoming', row.starts_at)) return;
  const local = utcToLocal(row.starts_at, getClinicZone());
  try {
    if (config.chatId) {
      await sendText(config.chatId, `Reminder: ${row.full_name} has ${row.service_name} on ${local.date} at ${local.time}. Reference ${row.booking_ref}.`);
    }
    const links = getDb().prepare(`SELECT chat_id FROM telegram_links WHERE patient_id = ? AND chat_id != 'pending'`).all(row.patient_id) as Array<{ chat_id: string }>;
    for (const link of links) {
      await sendText(link.chat_id, `Reminder: your ${row.service_name} appointment is ${local.date} at ${local.time}. Reference ${row.booking_ref}.`);
    }
    setReminderStatus(appointmentId, 'upcoming', 'sent');
  } catch {
    setReminderStatus(appointmentId, 'upcoming', 'failed');
    logger.warn('Telegram reminder was not sent');
  }
}

export async function sendDueReminders(): Promise<void> {
  const config = readTelegramConfig();
  if (!config.enabled || !config.token) return;
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rows = getDb().prepare(
    `SELECT a.id FROM appointments a
     WHERE a.status IN ('Pending', 'Confirmed')
       AND a.starts_at > ?
       AND a.starts_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM reminders r WHERE r.appointment_id = a.id AND r.kind = 'upcoming' AND r.status = 'sent'
       )`,
  ).all(now.toISOString(), soon) as Array<{ id: number }>;
  for (const row of rows) {
    await deliverReminder(row.id);
  }
}

export function startReminderLoop(): void {
  if (process.env.NODE_ENV === 'test' || reminderTimer) return;
  reminderTimer = setInterval(() => {
    void sendDueReminders();
  }, 60_000);
  reminderTimer.unref?.();
}

export async function stopTelegram(): Promise<void> {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = undefined;
  await stopBot();
}
