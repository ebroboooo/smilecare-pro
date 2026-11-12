import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Smile, Home, Calendar } from 'lucide-react';
import { DEFAULT_PUBLIC_BOOKING_SLUG } from '../../types';
import { translations, type Language } from '../../utils/translations';
import { applyDocumentLanguage, readPublicLanguage, writePublicLanguage } from '../../utils/publicLanguage';
import { LanguageSwitch } from './LanguageSwitch';

export const NotFoundPage: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => readPublicLanguage() ?? 'en');
  const t = translations[lang];

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="panel w-full max-w-md p-8 shadow-elevated text-center space-y-6">
        <div className="flex justify-center"><LanguageSwitch lang={lang} onChange={(next) => { writePublicLanguage(next); setLang(next); }} /></div>
        <div className="bg-brand-600 p-2.5 rounded-2xl w-fit mx-auto text-white shadow-lg">
          <Smile className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <p className="text-6xl font-display font-bold text-brand-600">404</p>
          <h1 className="text-xl font-display font-bold text-slate-900">{t.pageNotFound}</h1>
          <p className="text-sm text-slate-500 leading-relaxed">{t.pageNotFoundHelp}</p>
        </div>
        <div className="flex flex-col gap-3 pt-2">
          <Link to="/" className="btn-primary w-full py-3 flex items-center justify-center gap-2">
            <Home className="h-4 w-4" />
            {t.backHome}
          </Link>
          <Link to={`/book/${DEFAULT_PUBLIC_BOOKING_SLUG}`} className="btn-secondary w-full py-3 flex items-center justify-center gap-2">
            <Calendar className="h-4 w-4" />
            {t.landingBook}
          </Link>
        </div>
      </div>
    </div>
  );
};
