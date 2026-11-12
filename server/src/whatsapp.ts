import { getDb } from './db.js';
import { HttpError } from './http.js';

export interface OutboundText {
  to: string;
  body: string;
}

export interface MessageTransport {
  post(url: string, body: unknown, token: string): Promise<{ status: number; json: unknown }>;
}

export interface WhatsAppConfig {
  phoneNumberId: string;
  token: string;
  businessAccountId: string;
  testRecipient: string;
  lastStatus: string;
}

const GRAPH_VERSION = 'v21.0';

export function readWhatsAppConfig(): WhatsAppConfig {
  const row = getDb().prepare(
    `SELECT whatsapp_phone_number_id, whatsapp_access_token, whatsapp_business_account_id,
            whatsapp_test_recipient, whatsapp_last_status
     FROM settings WHERE id = 1`,
  ).get() as {
    whatsapp_phone_number_id: string | null;
    whatsapp_access_token: string | null;
    whatsapp_business_account_id: string | null;
    whatsapp_test_recipient: string | null;
    whatsapp_last_status: string | null;
  };
  return {
    phoneNumberId: row.whatsapp_phone_number_id || '',
    token: row.whatsapp_access_token || '',
    businessAccountId: row.whatsapp_business_account_id || '',
    testRecipient: row.whatsapp_test_recipient || '',
    lastStatus: row.whatsapp_last_status || '',
  };
}

export function markWhatsAppTest(status: 'accepted' | 'rejected'): void {
  getDb().prepare(`UPDATE settings SET whatsapp_last_status = ? WHERE id = 1`).run(status);
}

function messageId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const messages = (payload as { messages?: Array<{ id?: string }> }).messages;
  const id = messages?.[0]?.id;
  return typeof id === 'string' ? id : '';
}

/**
 * Sends one WhatsApp Cloud API text. Resolves only when Meta returns a message id.
 * A network error or a non-success response is a failure, never a delivered message.
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

export async function sendWhatsAppTest(transport: MessageTransport = fetchTransport): Promise<{ providerMessageId: string }> {
  if (process.env.NODE_ENV === 'test' && transport === fetchTransport) {
    throw new HttpError(501, 'WHATSAPP', 'WhatsApp delivery is not run from the test runner, and it is not marked as sent.');
  }
  const config = readWhatsAppConfig();
  if (!config.testRecipient) {
    throw new HttpError(400, 'VALIDATION', 'Save the WhatsApp number that should receive the test');
  }
  try {
    const result = await deliverWhatsApp(config, {
      to: config.testRecipient,
      body: 'SmileCare test. WhatsApp accepted this message.',
    }, transport);
    markWhatsAppTest('accepted');
    return result;
  } catch (error) {
    if (config.phoneNumberId && config.token) markWhatsAppTest('rejected');
    throw error;
  }
}
