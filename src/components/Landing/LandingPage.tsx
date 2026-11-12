import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, ChevronDown, Mail, MapPin, Menu, Phone, Smile, X } from 'lucide-react';
import { api, toQuery } from '../../db/api';
import { DEMO_MODE } from '../../db';
import { DEFAULT_PUBLIC_BOOKING_SLUG } from '../../types';
import { translations, type Language } from '../../utils/translations';

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
  description: string;
  duration: number;
  price: number;
}

interface PublicDoctor {
  id: number;
  name: string;
  role: string;
}

export const LandingPage: React.FC = () => {
  const [lang, setLang] = useState<Language>('en');
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [clinic, setClinic] = useState<PublicClinic | null>(null);
  const [services, setServices] = useState<PublicService[]>([]);
  const [doctors, setDoctors] = useState<PublicDoctor[]>([]);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState('');
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', message: '', companyWebsite: '' });
  const copy = translations[lang];
  const slug = clinic?.publicSlug || DEFAULT_PUBLIC_BOOKING_SLUG;
  const bookable = clinic?.publicBookingEnabled !== false;

  useEffect(() => {
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  useEffect(() => {
    if (DEMO_MODE) return;
    api<PublicClinic>('/api/public/clinic')
      .then((data) => {
        setClinic(data);
        setLang(data.language === 'ar' ? 'ar' : 'en');
        const branchId = data.branches[0] ? String(data.branches[0].id) : '';
        if (!branchId) return;
        api<PublicService[]>(`/api/public/services${toQuery({ branchId })}`).then(setServices).catch(() => setServices([]));
        api<PublicDoctor[]>(`/api/public/doctors${toQuery({ branchId })}`).then(setDoctors).catch(() => setDoctors([]));
      })
      .catch(() => setClinic(null));
  }, []);

  const nav = [
    { label: copy.landingServices, href: '#services' },
    { label: copy.landingDoctors, href: '#doctors' },
    { label: copy.landingFaq, href: '#faq' },
    { label: copy.landingContact, href: '#contact' },
  ];

  const sendLead = async (event: React.FormEvent) => {
    event.preventDefault();
    setSendError('');
    if (DEMO_MODE) {
      setSendError('Demo mode does not send inquiries to a clinic.');
      return;
    }
    try {
      await api('/api/public/leads', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          branchId: clinic?.branches[0] ? String(clinic.branches[0].id) : undefined,
        }),
      });
      setSent(true);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not send');
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-800" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 bg-brand-600 rounded-xl flex items-center justify-center"><Smile className="h-5 w-5 text-white" /></div>
            <span className="font-display font-bold text-lg text-slate-900">{clinic?.businessName || copy.appName}</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            {nav.map((link) => <a key={link.href} href={link.href} className="text-sm font-medium text-slate-600 hover:text-brand-600">{link.label}</a>)}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button type="button" className="btn-ghost text-sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{lang === 'en' ? 'العربية' : 'English'}</button>
            <Link to="/login" className="btn-ghost text-sm">{copy.landingLogin}</Link>
            {bookable ? <Link to={`/book/${slug}`} className="btn-primary text-sm py-2 px-5">{copy.landingBook}</Link> : <a href="#contact" className="btn-primary text-sm py-2 px-5">{copy.landingCall}</a>}
          </div>
          <button className="md:hidden p-2" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden bg-white border-t border-slate-100 px-4 py-4 space-y-3">
            {nav.map((link) => <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="block text-sm font-medium text-slate-600 py-2">{link.label}</a>)}
            <Link to="/login" className="btn-secondary text-sm w-full">{copy.landingLogin}</Link>
          </div>
        )}
      </nav>

      <section className="pt-24 pb-16 md:pt-32 md:pb-24 bg-gradient-to-br from-brand-50 via-white to-dental-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl space-y-6">
          <h1 className="text-4xl md:text-6xl font-display font-bold text-slate-900 leading-tight">{copy.landingHero}</h1>
          <p className="text-lg text-slate-600 leading-relaxed">{copy.landingSubtitle}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            {bookable && (
              <Link to={`/book/${slug}`} className="btn-primary text-base py-3 px-8">
                <Calendar className="h-5 w-5" />
                {copy.landingBook}
              </Link>
            )}
            <a href="#services" className="btn-secondary text-base py-3 px-8">{copy.landingExplore}</a>
          </div>
          {clinic?.phone && <p className="text-sm text-slate-600">{clinic.phone}</p>}
        </div>
      </section>

      <section id="services" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-display font-bold text-slate-900 mb-8">{copy.landingServices}</h2>
          {services.length === 0 ? (
            <p className="text-sm text-slate-500">{copy.landingCall}</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service) => (
                <div key={service.id} className="card p-6">
                  <h3 className="font-semibold text-slate-900">{service.name}</h3>
                  <p className="text-sm text-slate-600 mt-2">{service.description}</p>
                  <p className="text-sm font-semibold text-brand-700 mt-4">{service.price} {clinic?.currency} · {service.duration} min</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="doctors" className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-display font-bold text-slate-900 mb-8">{copy.landingDoctors}</h2>
          {doctors.length === 0 ? (
            <p className="text-sm text-slate-500">{copy.landingCall}</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {doctors.map((doctor) => (
                <div key={doctor.id} className="card p-6">
                  <h3 className="font-semibold text-slate-900">{doctor.name}</h3>
                  <p className="text-sm text-slate-500 mt-1">{doctor.role}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="faq" className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 space-y-3">
          <h2 className="text-3xl font-display font-bold text-slate-900 mb-8">{copy.landingFaq}</h2>
          {[{ q: copy.faqBookQ, a: copy.faqBookA }, { q: copy.faqPayQ, a: copy.faqPayA }].map((faq, index) => (
            <div key={faq.q} className="card overflow-hidden">
              <button type="button" className="w-full flex items-center justify-between p-5 text-start" onClick={() => setOpenFaq(openFaq === index ? null : index)}>
                <span className="font-semibold text-sm text-slate-900">{faq.q}</span>
                <ChevronDown className={`h-5 w-5 text-slate-400 ${openFaq === index ? 'rotate-180' : ''}`} />
              </button>
              {openFaq === index && <p className="px-5 pb-5 text-sm text-slate-600">{faq.a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section id="contact" className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-3xl font-display font-bold text-slate-900">{copy.landingContact}</h2>
            {clinic?.branches.map((branch) => (
              <div key={branch.id} className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-brand-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{branch.name}</p>
                  <p className="text-sm text-slate-600">{branch.address || clinic.address}</p>
                  {branch.phone && <p className="text-sm text-slate-600">{branch.phone}</p>}
                </div>
              </div>
            ))}
            {clinic?.phone && <p className="flex items-center gap-2 text-sm text-slate-700"><Phone className="h-4 w-4 text-brand-600" /> {clinic.phone}</p>}
            {clinic?.email && <p className="flex items-center gap-2 text-sm text-slate-700"><Mail className="h-4 w-4 text-brand-600" /> {clinic.email}</p>}
            <Link to="/privacy" className="text-sm text-brand-700 underline">Privacy</Link>
            <p className="text-sm text-slate-600">{copy.landingPay}</p>
          </div>
          <form onSubmit={sendLead} className="card p-8 space-y-4">
            <input className="absolute opacity-0 h-0 w-0" tabIndex={-1} autoComplete="off" value={form.companyWebsite} onChange={(event) => setForm({ ...form, companyWebsite: event.target.value })} aria-hidden="true" />
            <label className="block text-xs font-semibold text-slate-500">{copy.landingFullName}</label>
            <input className="input-field" required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
            <label className="block text-xs font-semibold text-slate-500">{copy.landingPhone}</label>
            <input className="input-field" required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <label className="block text-xs font-semibold text-slate-500">{copy.landingEmail}</label>
            <input className="input-field" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <label className="block text-xs font-semibold text-slate-500">{copy.landingMessage}</label>
            <textarea className="input-field min-h-[100px]" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
            {sent ? <p className="text-sm text-emerald-700">{copy.landingSent}</p> : <button className="btn-primary w-full" type="submit">{copy.landingSend}</button>}
            {sendError && <p className="text-sm text-red-600">{sendError}</p>}
          </form>
        </div>
      </section>
    </div>
  );
};
