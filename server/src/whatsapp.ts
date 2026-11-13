import { getDb } from './db.js';
import { HttpError } from './http.js';
import { logger } from './logger.js';
import { claimReminder } from './reminders.js';
import { getClinicZone, utcToLocal } from './time.js';

export interface OutboundText {
  to: string;
  body: string;
}

export interface MessageTransport {
  post(url: string, body: unknown, token: string): Promise<{ status: number; json: unknown }>;
}

export interface WhatsAppConfig {
  orgId: number;
  phoneNumberId: string;
  token: string;
  businessAccountId: string;
  testRecipient: string;
  lastStatus: string;
  remindersEnabled: boolean;
  reminderHours: number;
}

const GRAPH_VERSION = 'v21.0';
let reminderTimer: NodeJS.Timeout | undefined;

export function readWhatsAppConfig(orgId = 1): WhatsAppConfig {
  const row = getDb().prepare(
    `SELECT org_id, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_business_account_id,
            whatsapp_test_recipient, whatsapp_last_status, whatsapp_reminders_enabled, telegram_reminder_hours
     FROM settings WHERE org_id = ?`,
  ).get(orgId) as {
    org_id: number;
    whatsapp_phone_number_id: string | null;
    whatsapp_access_token: string | null;
    whatsapp_business_account_id: string | null;
    whatsapp_test_recipient: string | null;
    whatsapp_last_status: string | null;
    whatsapp_reminders_enabled: number | null;
    telegram_reminder_hours: number | null;
  } | undefined;
  if (!row) {
    return {
      orgId,
      phoneNumberId: '',
      token: '',
      businessAccountId: '',
      testRecipient: '',
      lastStatus: '',
      remindersEnabled: false,
      reminderHours: 24,
    };
  }
  const hours = Number(row.telegram_reminder_hours || 24);
  return {
    orgId: row.org_id,
    phoneNumberId: row.whatsapp_phone_number_id || '',
    token: row.whatsapp_access_token || '',
    businessAccountId: row.whatsapp_business_account_id || '',
    testRecipient: row.whatsapp_test_recipient || '',
    lastStatus: row.whatsapp_last_status || '',
    remindersEnabled: row.whatsapp_reminders_enabled === 1,
    reminderHours: Number.isFinite(hours) ? Math.min(72, Math.max(1, hours)) : 24,
  };
}

export function markWhatsAppTest(status: 'accepted' | 'rejected', orgId = 1): void {
  getDb().prepare(`UPDATE settings SET whatsapp_last_status = ? WHERE org_id = ?`).run(status, orgId);
}

function messageId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const messages = (payload as { messages?: Array<{ id?: string }> }).messages;
  const id = messages?.[0]?.id;
  return typeof id === 'string' ? id : '';
}

/**
 * Sends one WhatsApp Cloud API text. Resolves only when Meta returns a message id.
 * Production clinics should move to an approved Meta template for reminders outside the customer-care window.
 */
export async function deliverWhatsApp(
  config: WhatsAppConfig,
  message: OutboundText,
  transport: MessageTransport,
): Promise<{ providerMessageId: string }> {
  if (!config.phoneNumberId || !config.token) {
    throw new HttpError(400, 'VALIDATION', 'Save a phone number ID and an access token first');
  }
  const to = message.to.replace(/\D/g, '');
  if (to.length < 8) throw new HttpError(400, 'VALIDATION', 'The WhatsApp number must include the country code');
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.phoneNumberId}/messages`;
  let response: { status: number; json: unknown };
  try {
    response = await transport.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: message.body },
    }, config.token);
  } catch {
    throw new HttpError(502, 'WHATSAPP', 'WhatsApp could not be reached. The message was not sent.');
  }
  const id = messageId(response.json);
  if (response.status < 200 || response.status >= 300 || !id) {
    throw new HttpError(502, 'WHATSAPP', 'WhatsApp did not accept the message. Nothing was delivered.');
  }
  return { providerMessageId: id };
}

export const fetchTransport: MessageTransport = {
  async post(url, body, token) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  },
};

export async function sendWhatsAppTest(
  transport: MessageTransport = fetchTransport,
  orgId = 1,
): Promise<{ providerMessageId: string }> {
  if (process.env.NODE_ENV === 'test' && transport === fetchTransport) {
    throw new HttpError(501, 'WHATSAPP', 'WhatsApp delivery is not run from the test runner, and it is not marked as sent.');
  }
  const config = readWhatsAppConfig(orgId);
  if (!config.testRecipient) {
    throw new HttpError(400, 'VALIDATION', 'Save the WhatsApp number that should receive the test');
  }
  try {
    const result = await deliverWhatsApp(config, {
      to: config.testRecipient,
      body: 'SmileCare test. WhatsApp accepted this message.',
    }, transport);
    markWhatsAppTest('accepted', orgId);
    return result;
  } catch (error) {
    if (config.phoneNumberId && config.token) markWhatsAppTest('rejected', orgId);
    throw error;
  }
}

function setReminderStatus(appointmentId: number, kind: string, status: string) {
  getDb()
    .prepare(`UPDATE reminders SET status = ?, sent_at = ? WHERE appointment_id = ? AND kind = ?`)
    .run(status, status === 'sent' ? new Date().toISOString() : null, appointmentId, kind);
}

async function deliverPatientReminder(
  appointmentId: number,
  config: WhatsAppConfig,
  transport: MessageTransport,
): Promise<void> {
  const row = getDb().prepare(
    `SELECT a.starts_at, a.booking_ref, p.phone, p.full_name, s.name AS service_name, st.business_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN services s ON s.id = a.service_id
     JOIN settings st ON st.org_id = a.org_id
     WHERE a.id = ? AND a.org_id = ?`,
  ).get(appointmentId, config.orgId) as {
    starts_at: string;
    booking_ref: string;
    phone: string;
    full_name: string;
    service_name: string;
    business_name: string;
  } | undefined;
  if (!row?.phone) return;
  if (!claimReminder(appointmentId, 'whatsapp_upcoming', row.starts_at)) return;
  const local = utcToLocal(row.starts_at, getClinicZone());
  const body =
    `${row.business_name}: reminder for ${row.full_name}. ` +
    `${row.service_name} on ${local.date} at ${local.time}. Ref ${row.booking_ref}.`;
  try {
    await deliverWhatsApp(config, { to: row.phone, body }, transport);
    setReminderStatus(appointmentId, 'whatsapp_upcoming', 'sent');
  } catch {
    setReminderStatus(appointmentId, 'whatsapp_upcoming', 'failed');
    logger.warn({ appointmentId, orgId: config.orgId }, 'WhatsApp patient reminder was not sent');
  }
}

export async function sendDueWhatsAppReminders(transport: MessageTransport = fetchTransport): Promise<void> {
  const orgs = getDb()
    .prepare(
      `SELECT org_id FROM settings
       WHERE whatsapp_reminders_enabled = 1
         AND whatsapp_phone_number_id != ''
         AND whatsapp_access_token IS NOT NULL
         AND whatsapp_access_token != ''`,
    )
    .all() as Array<{ org_id: number }>;
  for (const org of orgs) {
    const config = readWhatsAppConfig(org.org_id);
    if (!config.remindersEnabled || !config.token) continue;
    const now = new Date();
    const soon = new Date(now.getTime() + config.reminderHours * 60 * 60 * 1000).toISOString();
    const rows = getDb().prepare(
      `SELECT a.id FROM appointments a
       WHERE a.org_id = ?
         AND a.status IN ('Pending', 'Confirmed')
         AND a.starts_at > ?
         AND a.starts_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM reminders r
           WHERE r.appointment_id = a.id AND r.kind = 'whatsapp_upcoming' AND r.status = 'sent'
         )`,
    ).all(org.org_id, now.toISOString(), soon) as Array<{ id: number }>;
    for (const row of rows) {
      await deliverPatientReminder(row.id, config, transport);
    }
  }
}

export function buildBookingConfirmationBody(input: {
  businessName: string;
  patientName: string;
  serviceName: string;
  doctorName: string;
  branchName?: string;
  date: string;
  time: string;
  reference: string;
}): string {
  const lines = [
    `${input.businessName} — appointment confirmation`,
    `Hi ${input.patientName},`,
    `Your visit is booked.`,
    `Service: ${input.serviceName}`,
    `Doctor: ${input.doctorName}`,
    input.branchName ? `Clinic: ${input.branchName}` : '',
    `When: ${input.date} at ${input.time}`,
    `Reference: ${input.reference}`,
    `Please pay at the clinic. Reply if you need to change the time.`,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Sends one booking confirmation to the patient phone via WhatsApp Cloud API.
 * Skips quietly when WhatsApp is not configured or the patient has no phone.
 */
export async function sendBookingWhatsAppConfirmation(
  appointmentId: number,
  transport: MessageTransport = fetchTransport,
): Promise<{ sent: boolean; providerMessageId?: string }> {
  const row = getDb().prepare(
    `SELECT a.id, a.org_id, a.starts_at, a.booking_ref, a.status,
            p.phone, p.full_name,
            s.name AS service_name,
            d.name AS doctor_name,
            b.name AS branch_name,
            st.business_name,
            st.whatsapp_phone_number_id, st.whatsapp_access_token
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN services s ON s.id = a.service_id
     JOIN doctors d ON d.id = a.doctor_id
     LEFT JOIN branches b ON b.id = a.branch_id
     JOIN settings st ON st.org_id = a.org_id
     WHERE a.id = ?`,
  ).get(appointmentId) as {
    id: number;
    org_id: number;
    starts_at: string;
    booking_ref: string;
    status: string;
    phone: string;
    full_name: string;
    service_name: string;
    doctor_name: string;
    branch_name: string | null;
    business_name: string;
    whatsapp_phone_number_id: string | null;
    whatsapp_access_token: string | null;
  } | undefined;

  if (!row?.phone) return { sent: false };
  if (row.status === 'Cancelled') return { sent: false };
  if (!row.whatsapp_phone_number_id || !row.whatsapp_access_token) return { sent: false };
  if (!claimReminder(appointmentId, 'whatsapp_booking_confirm', row.starts_at)) {
    return { sent: false };
  }

  const config = readWhatsAppConfig(row.org_id);
  const local = utcToLocal(row.starts_at, getClinicZone());
  const body = buildBookingConfirmationBody({
    businessName: row.business_name || 'SmileCare',
    patientName: row.full_name,
    serviceName: row.service_name,
    doctorName: row.doctor_name,
    branchName: row.branch_name || undefined,
    date: local.date,
    time: local.time,
    reference: row.booking_ref,
  });

  try {
    const result = await deliverWhatsApp(config, { to: row.phone, body }, transport);
    setReminderStatus(appointmentId, 'whatsapp_booking_confirm', 'sent');
    return { sent: true, providerMessageId: result.providerMessageId };
  } catch {
    setReminderStatus(appointmentId, 'whatsapp_booking_confirm', 'failed');
    logger.warn({ appointmentId, orgId: row.org_id }, 'WhatsApp booking confirmation was not sent');
    return { sent: false };
  }
}

/** Fire-and-forget after a booking is saved. Never blocks the HTTP response. */
export function queueBookingWhatsAppConfirmation(appointmentId: number): void {
  if (process.env.NODE_ENV === 'test') return;
  void sendBookingWhatsAppConfirmation(appointmentId);
}

export function startWhatsAppReminderLoop(): void {
  if (process.env.NODE_ENV === 'test' || reminderTimer) return;
  reminderTimer = setInterval(() => {
    void sendDueWhatsAppReminders();
  }, 60_000);
  reminderTimer.unref?.();
}

export function stopWhatsAppReminders(): void {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = undefined;
}
