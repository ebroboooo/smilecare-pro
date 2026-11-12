import React from 'react';
import type { Language } from '../../utils/translations';

export const LanguageSwitch: React.FC<{
  lang: Language;
  onChange: (lang: Language) => void;
}> = ({ lang, onChange }) => (
  <div className="inline-flex rounded-xl border border-slate-200 bg-white overflow-hidden text-xs font-semibold" role="group" aria-label={lang === 'ar' ? 'اللغة' : 'Language'}>
    <button
      type="button"
      className={lang === 'en' ? 'bg-brand-600 text-white px-3 py-1.5' : 'px-3 py-1.5 text-slate-600 hover:bg-slate-50'}
      onClick={() => onChange('en')}
      aria-pressed={lang === 'en'}
    >
      English
    </button>
    <button
      type="button"
      className={lang === 'ar' ? 'bg-brand-600 text-white px-3 py-1.5' : 'px-3 py-1.5 text-slate-600 hover:bg-slate-50'}
      onClick={() => onChange('ar')}
      aria-pressed={lang === 'ar'}
    >
      العربية
    </button>
  </div>
);
