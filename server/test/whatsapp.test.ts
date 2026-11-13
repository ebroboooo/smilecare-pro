import { describe, expect, it } from 'vitest';
import { buildBookingConfirmationBody, deliverWhatsApp, type WhatsAppConfig } from '../src/whatsapp.js';

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

describe('WhatsApp booking confirmation text', () => {
  it('includes reservation details for the patient', () => {
    const body = buildBookingConfirmationBody({
      businessName: 'SmileCare Dental Clinic',
      patientName: 'Sara',
      serviceName: 'Dental Cleaning',
      doctorName: 'Dr. Nabil',
      branchName: 'Zamalek',
      date: '2026-11-16',
      time: '10:00',
      reference: 'SC-ABC123',
    });
    expect(body).toContain('SmileCare Dental Clinic');
    expect(body).toContain('Sara');
    expect(body).toContain('Dental Cleaning');
    expect(body).toContain('Dr. Nabil');
    expect(body).toContain('Zamalek');
    expect(body).toContain('2026-11-16 at 10:00');
    expect(body).toContain('SC-ABC123');
  });
});
