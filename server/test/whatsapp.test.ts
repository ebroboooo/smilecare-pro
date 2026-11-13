import { describe, expect, it } from 'vitest';
import { deliverWhatsApp, type WhatsAppConfig } from '../src/whatsapp.js';

const config: WhatsAppConfig = {
  orgId: 1,
  phoneNumberId: '123456789012345',
  token: 'a-long-token-value-not-real',
  businessAccountId: '',
  testRecipient: '201012345678',
  lastStatus: '',
  remindersEnabled: false,
  reminderHours: 24,
};

describe('WhatsApp delivery is not invented', () => {
  it('returns a message id only when Meta confirms one', async () => {
    const result = await deliverWhatsApp(config, { to: '201012345678', body: 'Hello' }, {
      async post() {
        return { status: 200, json: { messages: [{ id: 'wamid.ABC' }] } };
      },
    });
    expect(result.providerMessageId).toBe('wamid.ABC');
  });

  it('does not report delivery when Meta rejects the token', async () => {
    await expect(deliverWhatsApp(config, { to: '201012345678', body: 'Hello' }, {
      async post() {
        return { status: 401, json: { error: { message: 'Invalid token' } } };
      },
    })).rejects.toThrow(/did not accept/);
  });

  it('does not report delivery when the success body has no message id', async () => {
    await expect(deliverWhatsApp(config, { to: '201012345678', body: 'Hello' }, {
      async post() {
        return { status: 200, json: { success: true } };
      },
    })).rejects.toThrow(/did not accept/);
  });

  it('does not report delivery when the network fails', async () => {
    await expect(deliverWhatsApp(config, { to: '201012345678', body: 'Hello' }, {
      async post() {
        throw new Error('offline');
      },
    })).rejects.toThrow(/could not be reached/);
  });
});
