import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, Smile } from 'lucide-react';
import { api, ApiError, toQuery } from '../../db/api';
import { BusinessNotFound } from './BusinessNotFound';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { translations, type Language } from '../../utils/translations';
import { formatMoney } from '../../utils/locale';
import { applyDocumentLanguage, readPublicLanguage, writePublicLanguage } from '../../utils/publicLanguage';
import { openBookingWhatsApp } from '../../utils/whatsappConfirm';
import { LanguageSwitch } from '../ui/LanguageSwitch';

interface PublicClinic {
  businessName: string;
  publicSlug: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  language: 'en' | 'ar';
  publicBookingEnabled: boolean;
  branches: Array<{ id: number; name: string; address: string; phone: string }>;
}

interface PublicService {
  id: number;
  name: string;
  duration: number;
  price: number;
}

interface PublicDoctor {
  id: number;
  name: string;
  role: string;
}

function dateKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export const PublicBooking: React.FC<{ slug: string }> = ({ slug }) => {
  const [params] = useSearchParams();
  const [clinic, setClinic] = useState<PublicClinic | null>(null);
  const [loadError, setLoadError] = useState('');
  const [lang, setLang] = useState<Language>(() => readPublicLanguage() ?? 'en');
  const [services, setServices] = useState<PublicService[]>([]);
  const [doctors, setDoctors] = useState<PublicDoctor[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [step, setStep] = useState(1);
  const [branchId, setBranchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(dateKey(1));
  const [time, setTime] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState(params.get('ref') || '');
  const [manageToken, setManageToken] = useState(params.get('token') || '');
  const [bookingStatus, setBookingStatus] = useState('');
  const [whatsappQueued, setWhatsappQueued] = useState(false);
  const [moveDate, setMoveDate] = useState(dateKey(1));
  const [moveTime, setMoveTime] = useState('10:00');

  const copy = translations[lang];
  const service = services.find((item) => String(item.id) === serviceId);
  const doctor = doctors.find((item) => String(item.id) === doctorId);
  const branch = clinic?.branches.find((item) => String(item.id) === branchId);

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  const chooseLang = (next: Language) => {
    writePublicLanguage(next);
    setLang(next);
  };

  useEffect(() => {
    let active = true;
    api<PublicClinic>('/api/public/clinic')
      .then((data) => {
        if (!active) return;
        setClinic(data);
        if (!readPublicLanguage()) setLang(data.language === 'ar' ? 'ar' : 'en');
        const first = data.branches[0];
        if (first) setBranchId(String(first.id));
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : copy.couldNotLoad);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!branchId) return;
    api<PublicService[]>(`/api/public/services${toQuery({ branchId })}`).then(setServices).catch(() => setServices([]));
    api<PublicDoctor[]>(`/api/public/doctors${toQuery({ branchId })}`).then(setDoctors).catch(() => setDoctors([]));
  }, [branchId]);

  useEffect(() => {
    if (!branchId || !serviceId || !doctorId || !date) {
      setSlots([]);
      return;
    }
    api<{ slots: string[] }>(`/api/public/slots${toQuery({ branchId, serviceId, doctorId, date })}`)
      .then((data) => {
        setSlots(data.slots);
        setTime((current) => (data.slots.includes(current) ? current : data.slots[0] || ''));
      })
      .catch(() => setSlots([]));
  }, [branchId, serviceId, doctorId, date]);

  useEffect(() => {
    if (!reference || !manageToken || reference === 'RECEIVED') return;
    api<{ status: string }>(`/api/public/bookings/${reference}${toQuery({ token: manageToken })}`)
      .then((row) => setBookingStatus(row.status))
      .catch((error: unknown) => setFormError(error instanceof Error ? error.message : copy.bookingNotFound));
  }, [reference, manageToken]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="panel p-6 max-w-md text-center">
          <p className="text-sm text-red-600">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!clinic) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingSpinner size="lg" label={copy.loadingBooking} />
      </div>
    );
  }

  if (clinic.publicSlug !== slug) return <BusinessNotFound slug={slug} />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!time) {
      setFormError(copy.landingNoSlots);
      return;
    }
    if (!consent) {
      setFormError(copy.landingConsent);
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ reference: string; manageToken: string; whatsappConfirmationQueued?: boolean }>('/api/public/bookings', {
        method: 'POST',
        body: JSON.stringify({
          companyWebsite,
          fullName,
          phone,
          email,
          branchId,
          doctorId,
          serviceId,
          date,
          time,
          notes,
          consent: true,
        }),
      });
      if (created.reference === 'RECEIVED') {
        setReference('');
        setManageToken('');
        setWhatsappQueued(false);
      } else {
        setReference(created.reference);
        setManageToken(created.manageToken);
        setWhatsappQueued(created.whatsappConfirmationQueued === true);
        openBookingWhatsApp(phone, {
          businessName: clinic.businessName,
          patientName: fullName,
          serviceName: service?.name || 'Appointment',
          doctorName: doctor?.name || 'Doctor',
          branchName: branch?.name,
          date,
          time,
          reference: created.reference,
        });
      }
      setBookingStatus('Pending');
      setStep(3);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : copy.couldNotBook);
    } finally {
      setBusy(false);
    }
  };

  const reschedule = async () => {
    setBusy(true);
    setFormError('');
    try {
      const moved = await api<{ date: string; time: string }>(`/api/public/bookings/${reference}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ token: manageToken, date: moveDate, time: moveTime }),
      });
      setDate(moved.date);
      setTime(moved.time);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : copy.couldNotMove);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setFormError('');
    try {
      const result = await api<{ status: string }>(`/api/public/bookings/${reference}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ token: manageToken }),
      });
      setBookingStatus(result.status);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : copy.couldNotCancel);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 py-8 px-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="bg-brand-600 p-2 rounded-xl text-white"><Smile className="h-5 w-5" /></div>
            <span className="font-display font-bold text-slate-900">{clinic.businessName}</span>
          </Link>
          <LanguageSwitch lang={lang} onChange={chooseLang} />
        </div>

        {!clinic.publicBookingEnabled && (
          <div className="panel p-6">
            <p className="text-sm text-slate-700">{copy.landingClosed}</p>
            {clinic.phone && <p className="mt-3 font-semibold">{clinic.phone}</p>}
          </div>
        )}

        {clinic.publicBookingEnabled && step < 3 && !params.get('ref') && (
          <div className="panel p-6 md:p-8 space-y-5">
            <h1 className="text-2xl font-display font-bold text-slate-900">{copy.landingBook}</h1>
            {step === 1 && (
              <>
                <label className="block text-xs font-semibold text-slate-500">{copy.branch}</label>
                <select className="input-field" value={branchId} onChange={(event) => { setBranchId(event.target.value); setServiceId(''); setDoctorId(''); }}>
                  {clinic.branches.map((branch) => (
                    <option key={branch.id} value={String(branch.id)}>{branch.name}</option>
                  ))}
                </select>
                <label className="block text-xs font-semibold text-slate-500">{copy.service}</label>
                <select className="input-field" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                  <option value="">{copy.service}</option>
                  {services.map((item) => (
                    <option key={item.id} value={String(item.id)}>{item.name} — {formatMoney(item.price, clinic.currency, lang)}</option>
                  ))}
                </select>
                <label className="block text-xs font-semibold text-slate-500">{copy.doctor}</label>
                <select className="input-field" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
                  <option value="">{copy.doctor}</option>
                  {doctors.map((item) => (
                    <option key={item.id} value={String(item.id)}>{item.name}</option>
                  ))}
                </select>
                <label className="block text-xs font-semibold text-slate-500">{copy.date}</label>
                <input className="input-field" type="date" value={date} min={dateKey(0)} onChange={(event) => setDate(event.target.value)} />
                <p className="text-xs font-semibold text-slate-500">{copy.time}</p>
                {slots.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">{copy.landingNoSlots}</p>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {slots.map((slot) => (
                      <button key={slot} type="button" onClick={() => setTime(slot)} className={`text-xs py-2.5 rounded-xl font-semibold border ${time === slot ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{slot}</button>
                    ))}
                  </div>
                )}
                <button type="button" className="btn-primary w-full" disabled={!serviceId || !doctorId || !time} onClick={() => setStep(2)}>
                  {copy.confirm} <ArrowRight className={`h-4 w-4 ${lang === 'ar' ? 'rotate-180' : ''}`} />
                </button>
              </>
            )}
            {step === 2 && (
              <form onSubmit={submit} className="space-y-4">
                <h2 className="text-lg font-semibold text-slate-900">{copy.yourDetails}</h2>
                <p className="text-sm text-slate-600">{service?.name} · {doctor?.name} · {date} {time}{service ? ` · ${formatMoney(service.price, clinic.currency, lang)}` : ''}</p>
                <p className="text-sm text-slate-600">{copy.landingPay}</p>
                <input className="absolute opacity-0 h-0 w-0" tabIndex={-1} autoComplete="off" value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} aria-hidden="true" />
                <label className="block text-xs font-semibold text-slate-500">{copy.landingFullName}</label>
                <input className="input-field" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
                <label className="block text-xs font-semibold text-slate-500">{copy.landingPhone}</label>
                <input className="input-field" value={phone} onChange={(event) => setPhone(event.target.value)} required />
                <label className="block text-xs font-semibold text-slate-500">{copy.landingEmail}</label>
                <input className="input-field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                <label className="block text-xs font-semibold text-slate-500">{copy.notes}</label>
                <textarea className="input-field" value={notes} onChange={(event) => setNotes(event.target.value)} />
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
                  <span>{copy.landingConsent} <Link to="/privacy" className="text-brand-700 underline">{copy.privacy}</Link></span>
                </label>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
                <div className="flex gap-3">
                  <button type="button" className="btn-secondary flex-1" onClick={() => setStep(1)}><ArrowLeft className={`h-4 w-4 ${lang === 'ar' ? 'rotate-180' : ''}`} /> {copy.back}</button>
                  <button type="submit" className="btn-primary flex-[2]" disabled={busy}>{busy ? copy.pleaseWait : copy.landingBook}</button>
                </div>
              </form>
            )}
          </div>
        )}

        {(step === 3 || params.get('ref')) && (
          <div className="panel p-8 text-center space-y-4">
            <CheckCircle className="h-10 w-10 text-emerald-600 mx-auto" />
            <h2 className="text-xl font-display font-bold">{bookingStatus === 'Cancelled' ? copy.landingCancelled : copy.landingRequest}</h2>
            {reference && <p className="text-sm text-slate-500">{copy.landingReference}</p>}
            {reference && <p className="font-mono text-lg font-bold">{reference}</p>}
            <p className="text-sm text-slate-600">{copy.landingPay}</p>
            {whatsappQueued && <p className="text-sm text-emerald-700">{copy.whatsappConfirmQueued}</p>}
            <p className="text-xs text-slate-500">{copy.whatsappConfirmHint}</p>
            {reference && bookingStatus !== 'Cancelled' && (
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => openBookingWhatsApp(phone, {
                  businessName: clinic.businessName,
                  patientName: fullName,
                  serviceName: service?.name || 'Appointment',
                  doctorName: doctor?.name || 'Doctor',
                  branchName: branch?.name,
                  date,
                  time,
                  reference,
                })}
              >
                {copy.whatsappOpenConfirm}
              </button>
            )}
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            {reference && date && time && <p className="text-sm text-slate-700">{date} {time}</p>}
            {bookingStatus !== 'Cancelled' && manageToken && (
              <div className="space-y-3 text-start">
                <p className="text-sm font-medium text-slate-700">{copy.moveAppointment}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-medium text-slate-600">{copy.newDate}
                    <input className="input-field mt-1" type="date" value={moveDate} onChange={(event) => setMoveDate(event.target.value)} />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">{copy.newTime}
                    <input className="input-field mt-1" type="time" value={moveTime} onChange={(event) => setMoveTime(event.target.value)} />
                  </label>
                </div>
                <div className="flex gap-3">
                  <button type="button" className="btn-primary flex-1" disabled={busy} onClick={reschedule}>{copy.reschedule}</button>
                  <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={cancel}>{copy.landingCancel}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
