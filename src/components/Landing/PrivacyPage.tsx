import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { translations, type Language } from '../../utils/translations';
import { applyDocumentLanguage, readPublicLanguage, writePublicLanguage } from '../../utils/publicLanguage';
import { LanguageSwitch } from '../ui/LanguageSwitch';

export const PrivacyPage: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => readPublicLanguage() ?? 'en');
  const t = translations[lang];

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  const chooseLang = (next: Language) => {
    writePublicLanguage(next);
    setLang(next);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="text-sm text-brand-700">{t.privacyBack}</Link>
          <LanguageSwitch lang={lang} onChange={chooseLang} />
        </div>
        <h1 className="text-3xl font-display font-bold text-slate-900">{t.privacyTitle}</h1>
        <p className="text-sm text-slate-600 leading-relaxed">{t.privacyIntro}</p>
        <h2 className="text-xl font-semibold text-slate-900">{t.privacyStoredTitle}</h2>
        <ul className="text-sm text-slate-700 list-disc ps-5 space-y-1">
          <li>{t.privacyStoredStaff}</li>
          <li>{t.privacyStoredPatients}</li>
          <li>{t.privacyStoredClinical}</li>
          <li>{t.privacyStoredPayments}</li>
        </ul>
        <h2 className="text-xl font-semibold text-slate-900">{t.privacyWhoTitle}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{t.privacyWhoBody}</p>
        <h2 className="text-xl font-semibold text-slate-900">{t.privacyBookingTitle}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{t.privacyBookingBody}</p>
        <p className="text-sm text-slate-500">{t.privacyFooter}</p>
      </div>
    </div>
  );
};
