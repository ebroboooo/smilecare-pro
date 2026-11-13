import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { db } from '../../db';
import { api, ApiError } from '../../db/api';
import { CLINIC_ID } from '../../types';
import { DEMO_MODE } from '../../db';
import { translations } from '../../utils/translations';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  Building,
  ToggleLeft,
  ToggleRight,
  ShieldAlert
} from 'lucide-react';

export const Settings: React.FC = () => {
  const { settings, refreshData, seedBusinessPreset, resetEmptyWorkspace, auditLogs, dispatchAuditLog } = useApp();
  const { success } = useToast();
  
  const lang = settings?.language || 'en';
  const t = translations[lang];

  const [telegram, setTelegram] = useState({ chatId: '', enabled: false, token: '', tokenSet: false, username: '', reminderHours: 24 });
  const [telegramError, setTelegramError] = useState('');
  const [whatsapp, setWhatsapp] = useState({
    phoneNumberId: '',
    businessAccountId: '',
    testRecipient: '',
    token: '',
    tokenSet: false,
    lastStatus: '',
    remindersEnabled: false,
  });
  const [whatsappError, setWhatsappError] = useState('');
  const [confirmFreshStart, setConfirmFreshStart] = useState(false);
  const [confirmDemoLoad, setConfirmDemoLoad] = useState(false);

  // Forms states
  const [profileData, setProfileData] = useState({
    businessName: settings?.businessName || '',
    address: settings?.address || '',
    phone: settings?.phone || '',
    email: settings?.email || '',
    currency: settings?.currency || 'USD',
    language: settings?.language || 'en',
    timezone: settings?.timezone || 'Africa/Cairo',
  });
  const [rules, setRules] = useState(settings?.bookingRules || {
    minNoticeMinutes: 60,
    maxDaysAhead: 90,
    cancelWindowHours: 24,
    slotIntervalMinutes: 30,
  });

  const [activeSubTab, setActiveSubTab] = useState<'profile' | 'preset' | 'modules' | 'audit'>('profile');

  useEffect(() => {
    if (settings) {
      setProfileData({
        businessName: settings.businessName,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        currency: settings.currency,
        language: settings.language,
        timezone: settings.timezone || 'Africa/Cairo',
      });
      setRules(settings.bookingRules);
      setTelegram((current) => ({
        chatId: settings.telegramChatId || '',
        enabled: settings.telegramEnabled === true,
        token: current.token,
        tokenSet: settings.telegramTokenSet === true,
        username: settings.telegramBotUsername || '',
        reminderHours: settings.telegramReminderHours || 24,
      }));
      setWhatsapp((current) => ({
        phoneNumberId: settings.whatsappPhoneNumberId || '',
        businessAccountId: settings.whatsappBusinessAccountId || '',
        testRecipient: settings.whatsappTestRecipient || '',
        token: current.token,
        tokenSet: settings.whatsappTokenSet === true,
        lastStatus: settings.whatsappLastStatus || '',
        remindersEnabled: settings.whatsappRemindersEnabled === true,
      }));
    }
  }, [settings]);

  const handleFreshStart = async () => {
    await resetEmptyWorkspace();
    success(t.workspaceReset);
    setConfirmFreshStart(false);
  };

  const handleDemoLoad = async () => {
    await seedBusinessPreset();
    success(t.demoDataLoaded);
    setConfirmDemoLoad(false);
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const org = CLINIC_ID;
    await db.settings.update(org, {
      ...profileData,
      isRtl: profileData.language === 'ar',
      bookingRules: rules,
    });

    await dispatchAuditLog("Settings Changed", `Updated clinic profile information.`);
    await refreshData();
    success(t.settingsSaved);
  };

  // Toggle individual integration features
  const handleToggleFeature = async (featureKey: 'waitlistEnabled' | 'publicBookingEnabled') => {
    if (!settings) return;
    const org = CLINIC_ID;
    const updatedFeatures = {
      ...settings.features,
      [featureKey]: !settings.features[featureKey],
    };

    await db.settings.update(org, { features: updatedFeatures });
    await dispatchAuditLog("Integration Toggled", `Updated toggle for feature integration: ${featureKey}`);
    await refreshData();
  };

  return (
    <div className="space-y-6">
      
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t.settings}</h2>
        <p className="text-xs text-slate-500">{t.settingsHelp}</p>
      </div>

      {/* Sub tabs nav bar */}
      <div className="flex border-b border-slate-200">
        {(['profile', 'preset', 'modules', 'audit'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            className={`py-2 px-4 text-xs font-bold border-b-2 transition-all capitalize ${
              activeSubTab === tab ? 'border-brand-500 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-800'
            }`}
          >
            {tab === 'preset' ? t.presetSeeding : tab === 'modules' ? t.tabIntegrations : tab === 'audit' ? t.auditLogs : t.tabProfile}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      
      {/* 1. Profile Settings Form */}
      {activeSubTab === 'profile' && (
        <div className="card p-6 rounded-2xl border-slate-200 max-w-lg">
          <form onSubmit={handleProfileSave} className="space-y-4">
            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-2">
              <Building className="h-4.5 w-4.5 text-brand-600" />
              <span>{t.contactInfo}</span>
            </h4>

            <div>
              <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.clinicName}</label>
              <input
                type="text"
                required
                value={profileData.businessName}
                onChange={(e) => setProfileData(prev => ({ ...prev, businessName: e.target.value }))}
                className="w-full input-field text-xs"
              />
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.address}</label>
              <input
                type="text"
                required
                value={profileData.address}
                onChange={(e) => setProfileData(prev => ({ ...prev, address: e.target.value }))}
                className="w-full input-field text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.phone}</label>
                <input
                  type="tel"
                  required
                  value={profileData.phone}
                  onChange={(e) => setProfileData(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full input-field text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.email}</label>
                <input
                  type="email"
                  required
                  value={profileData.email}
                  onChange={(e) => setProfileData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full input-field text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.currency}</label>
                <select
                  value={profileData.currency}
                  onChange={(e) => setProfileData(prev => ({ ...prev, currency: e.target.value }))}
                  className="w-full input-field text-xs"
                >
                  <option value="USD">USD ($)</option>
                  <option value="SAR">SAR (ر.س)</option>
                  <option value="AED">AED (د.إ)</option>
                  <option value="EGP">EGP (ج.م)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.language}</label>
                <select
                  value={profileData.language}
                  onChange={(e) => setProfileData(prev => ({ ...prev, language: e.target.value as any }))}
                  className="w-full input-field text-xs"
                >
                  <option value="en">{t.englishLtr}</option>
                  <option value="ar">{t.arabicRtl}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.timezone}</label>
              <input className="w-full input-field text-xs" value={profileData.timezone} onChange={(e) => setProfileData((prev) => ({ ...prev, timezone: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{t.minNoticeMinutes}
                <input type="number" min={0} className="mt-1 w-full input-field text-xs" value={rules.minNoticeMinutes} onChange={(e) => setRules({ ...rules, minNoticeMinutes: Number(e.target.value) })} />
              </label>
              <label className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{t.maxDaysAhead}
                <input type="number" min={1} className="mt-1 w-full input-field text-xs" value={rules.maxDaysAhead} onChange={(e) => setRules({ ...rules, maxDaysAhead: Number(e.target.value) })} />
              </label>
              <label className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{t.cancelWindowHours}
                <input type="number" min={0} className="mt-1 w-full input-field text-xs" value={rules.cancelWindowHours} onChange={(e) => setRules({ ...rules, cancelWindowHours: Number(e.target.value) })} />
              </label>
              <label className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{t.slotIntervalMinutes}
                <input type="number" min={5} className="mt-1 w-full input-field text-xs" value={rules.slotIntervalMinutes} onChange={(e) => setRules({ ...rules, slotIntervalMinutes: Number(e.target.value) })} />
              </label>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button type="submit" className="btn-primary px-5 py-2.5 text-xs">
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. Preset Layout Seeder presets */}
      {activeSubTab === 'preset' && !DEMO_MODE && (
        <div className="panel p-6 max-w-xl space-y-2">
          <h4 className="font-bold text-slate-900 text-sm">{t.clinicData}</h4>
          <p className="text-xs text-slate-500">{t.clinicDataHelp}</p>
        </div>
      )}

      {activeSubTab === 'preset' && DEMO_MODE && (
        <div className="space-y-6">
          <div className="max-w-xl">
            <h4 className="text-slate-900 font-bold text-sm">{t.presetSeeding}</h4>
            <p className="text-xs text-slate-500 mt-1">{t.presetSeedingDesc}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
            <div className="card p-5 rounded-2xl border-slate-200 flex flex-col justify-between hover:border-brand-300 transition-all border-brand-500/60 bg-brand-500/5">
              <div>
                <h5 className="font-bold text-slate-900 text-base">{t.demoClinicTitle}</h5>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  {t.demoClinicDesc}
                </p>
              </div>
              <button
                onClick={() => setConfirmDemoLoad(true)}
                className="btn-secondary py-2 text-xs font-bold mt-5 w-full"
              >
                {settings?.activePreset === 'Dental' ? t.reloadDemoData : t.loadDemoData}
              </button>
            </div>

            <div className="card p-5 rounded-2xl border-slate-200 flex flex-col justify-between">
              <div>
                <h5 className="font-bold text-slate-900 text-base">{t.freshStartTitle}</h5>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  {t.freshStartDesc}
                </p>
              </div>
              <button
                onClick={() => setConfirmFreshStart(true)}
                className="btn-secondary py-2 text-xs font-bold mt-5 w-full border-red-200 text-red-600 hover:bg-red-50"
              >
                {t.resetEmptyWorkspaceBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Integration Modules toggles */}
      {activeSubTab === 'modules' && (
        <div className="card p-6 rounded-2xl border-slate-200 max-w-xl space-y-5">
          <div>
            <h4 className="font-bold text-slate-900 text-sm">{t.clinicOptions}</h4>
            <p className="text-[10px] text-slate-500">{t.clinicOptionsHelp}</p>
          </div>

          {settings && (
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-xs font-bold text-slate-900">{t.waitlist}</p>
                  <p className="text-[10px] text-slate-400">{t.waitlistOption}</p>
                </div>
                <button type="button" onClick={() => handleToggleFeature('waitlistEnabled')}>
                  {settings.features.waitlistEnabled
                    ? <ToggleRight className="h-9 w-9 text-brand-600" />
                    : <ToggleLeft className="h-9 w-9 text-slate-400" />
                  }
                </button>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-xs font-bold text-slate-900">{t.onlineBooking}</p>
                  <p className="text-[10px] text-slate-400">{t.bookingOption}</p>
                </div>
                <button type="button" onClick={() => handleToggleFeature('publicBookingEnabled')}>
                  {settings.features.publicBookingEnabled
                    ? <ToggleRight className="h-9 w-9 text-brand-600" />
                    : <ToggleLeft className="h-9 w-9 text-slate-400" />
                  }
                </button>
              </div>
            </div>
          )}

          {!DEMO_MODE && (
            <form
              className="space-y-3 border-t border-slate-200 pt-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setTelegramError('');
                try {
                  await api('/api/settings', {
                    method: 'PATCH',
                    body: JSON.stringify({
                      telegramChatId: telegram.chatId,
                      telegramEnabled: telegram.enabled,
                      telegramBotUsername: telegram.username.replace(/^@/, ''),
                      telegramReminderHours: Number(telegram.reminderHours) || 24,
                      ...(telegram.token ? { telegramBotToken: telegram.token } : {}),
                    }),
                  });
                  setTelegram((current) => ({ ...current, token: '' }));
                  await refreshData();
                  success(t.telegramSaved);
                } catch (err) {
                  setTelegramError(err instanceof ApiError ? err.message : t.telegramFailed);
                }
              }}
            >
              <h4 className="font-bold text-slate-900 text-sm">{t.telegramAlerts}</h4>
              <p className="text-xs text-slate-500">{t.telegramHelp}</p>
              <label className="flex items-center justify-between text-sm font-medium text-slate-900">
                {t.sendAlerts}
                <input type="checkbox" checked={telegram.enabled} onChange={(event) => setTelegram({ ...telegram, enabled: event.target.checked })} />
              </label>
              <label className="block text-sm font-medium text-slate-700">{t.botUsername}</label>
              <input className="input-field text-sm" placeholder="SmileCareClinicBot" value={telegram.username} onChange={(event) => setTelegram({ ...telegram, username: event.target.value })} />
              <p className="text-xs text-slate-500">{t.botUsernameHint}</p>
              <label className="block text-sm font-medium text-slate-700">{t.staffChatId}</label>
              <input className="input-field text-sm" placeholder="123456789" value={telegram.chatId} onChange={(event) => setTelegram({ ...telegram, chatId: event.target.value })} />
              <label className="block text-sm font-medium text-slate-700">{t.reminderHours}</label>
              <input className="input-field text-sm" type="number" min={1} max={72} value={telegram.reminderHours} onChange={(event) => setTelegram({ ...telegram, reminderHours: Number(event.target.value) })} />
              <p className="text-xs text-slate-500">{t.reminderHoursHint}</p>
              <label className="block text-sm font-medium text-slate-700">{t.botToken}</label>
              <input className="input-field text-sm" type="password" autoComplete="new-password" placeholder={telegram.tokenSet ? t.tokenSaved : t.botToken} value={telegram.token} onChange={(event) => setTelegram({ ...telegram, token: event.target.value })} />
              {telegramError && <p className="text-sm text-red-600" role="alert">{telegramError}</p>}
              <div className="flex gap-2">
                <button className="btn-primary text-xs" type="submit">{t.saveTelegram}</button>
                <button
                  className="btn-secondary text-xs"
                  type="button"
                  onClick={async () => {
                    setTelegramError('');
                    try {
                      const result = await api<{ delivered?: boolean }>('/api/settings/telegram-test', { method: 'POST' });
                      if (result.delivered !== true) {
                        setTelegramError(t.testFailed);
                        return;
                      }
                      success(t.testSent);
                    } catch (err) {
                      setTelegramError(err instanceof ApiError ? err.message : t.testFailed);
                    }
                  }}
                >
                  {t.sendTest}
                </button>
              </div>
            </form>
          )}

          {DEMO_MODE && (
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <h4 className="font-bold text-slate-900 text-sm">{t.whatsappTitle}</h4>
              <p className="text-sm text-slate-700">{t.whatsappConfirmHint}</p>
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">{t.whatsappBookingConfirmNote}</p>
            </div>
          )}

          {!DEMO_MODE && (
            <form
              className="space-y-3 border-t border-slate-200 pt-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setWhatsappError('');
                try {
                  await api('/api/settings', {
                    method: 'PATCH',
                    body: JSON.stringify({
                      whatsappPhoneNumberId: whatsapp.phoneNumberId,
                      whatsappBusinessAccountId: whatsapp.businessAccountId,
                      whatsappTestRecipient: whatsapp.testRecipient,
                      whatsappRemindersEnabled: whatsapp.remindersEnabled,
                      ...(whatsapp.token ? { whatsappAccessToken: whatsapp.token } : {}),
                    }),
                  });
                  setWhatsapp((current) => ({ ...current, token: '' }));
                  await refreshData();
                  success(t.whatsappSaved);
                } catch (err) {
                  setWhatsappError(err instanceof ApiError ? err.message : t.whatsappFailed);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-900 text-sm">{t.whatsappTitle}</h4>
              </div>
              <p className="text-sm text-slate-700">{t.whatsappPatientNote}</p>
              <p className="text-xs text-slate-500">{t.whatsappHelp}</p>
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">{t.whatsappBookingConfirmNote}</p>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={whatsapp.remindersEnabled}
                  onChange={(event) => setWhatsapp({ ...whatsapp, remindersEnabled: event.target.checked })}
                />
                {t.whatsappRemindersEnabled}
              </label>
              <label className="block text-sm font-medium text-slate-700">{t.phoneNumberId}</label>
              <input className="input-field text-sm" inputMode="numeric" value={whatsapp.phoneNumberId} onChange={(event) => setWhatsapp({ ...whatsapp, phoneNumberId: event.target.value })} />
              <label className="block text-sm font-medium text-slate-700">{t.businessAccountId}</label>
              <input className="input-field text-sm" inputMode="numeric" value={whatsapp.businessAccountId} onChange={(event) => setWhatsapp({ ...whatsapp, businessAccountId: event.target.value })} />
              <label className="block text-sm font-medium text-slate-700">{t.testRecipient}</label>
              <input className="input-field text-sm" inputMode="numeric" placeholder="201012345678" value={whatsapp.testRecipient} onChange={(event) => setWhatsapp({ ...whatsapp, testRecipient: event.target.value })} />
              <p className="text-xs text-slate-500">{t.testRecipientHint}</p>
              <label className="block text-sm font-medium text-slate-700">{t.accessToken}</label>
              <input className="input-field text-sm" type="password" autoComplete="new-password" placeholder={whatsapp.tokenSet ? t.tokenSaved : t.accessToken} value={whatsapp.token} onChange={(event) => setWhatsapp({ ...whatsapp, token: event.target.value })} />
              {whatsapp.lastStatus === 'accepted' && <p className="text-xs text-emerald-700">{t.whatsappAccepted}</p>}
              {whatsapp.lastStatus === 'rejected' && <p className="text-xs text-amber-800">{t.whatsappRejected}</p>}
              {whatsappError && <p className="text-sm text-red-600" role="alert">{whatsappError}</p>}
              <div className="flex gap-2">
                <button className="btn-primary text-xs" type="submit">{t.save}</button>
                <button
                  className="btn-secondary text-xs"
                  type="button"
                  onClick={async () => {
                    setWhatsappError('');
                    try {
                      const result = await api<{ delivered?: boolean }>('/api/settings/whatsapp-test', { method: 'POST' });
                      if (result.delivered !== true) {
                        setWhatsappError(t.whatsappRejected);
                        return;
                      }
                      success(t.whatsappAccepted);
                      await refreshData();
                    } catch (err) {
                      setWhatsappError(err instanceof ApiError ? err.message : t.whatsappRejected);
                    }
                  }}
                >
                  {t.sendWhatsAppTest}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* 4. Audit Log list view */}
      {activeSubTab === 'audit' && (
        <div className="card p-5 rounded-2xl border-slate-200 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-200 pb-2 mb-3">
            <div>
              <h4 className="font-bold text-slate-900 text-sm">{t.auditLogs}</h4>
              <p className="text-[10px] text-slate-500">{t.activityHelp}</p>
            </div>
            <ShieldAlert className="h-5 w-5 text-slate-500" />
          </div>

          <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-3 bg-slate-50/40 border border-slate-200 rounded-xl text-xs space-y-1">
                <div className="flex justify-between font-bold text-[10px] text-slate-400 uppercase tracking-wider">
                  <span className="text-brand-700">{log.action}</span>
                  <span>{new Date(log.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-slate-900 font-semibold">{log.details}</p>
                <p className="text-[10px] text-slate-500">{t.auditTriggeredBy}: {log.userName}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmFreshStart}
        title={t.resetWorkspaceTitle}
        message={t.resetWorkspaceMessage}
        confirmLabel={t.resetWorkspaceConfirm}
        cancelLabel={t.cancel}
        pleaseWaitLabel={t.pleaseWait}
        variant="danger"
        onConfirm={handleFreshStart}
        onClose={() => setConfirmFreshStart(false)}
      />

      <ConfirmDialog
        isOpen={confirmDemoLoad}
        title={t.loadDemoTitle}
        message={t.loadDemoMessage}
        confirmLabel={t.loadDemoConfirm}
        cancelLabel={t.cancel}
        pleaseWaitLabel={t.pleaseWait}
        variant="warning"
        onConfirm={handleDemoLoad}
        onClose={() => setConfirmDemoLoad(false)}
      />
    </div>
  );
};
