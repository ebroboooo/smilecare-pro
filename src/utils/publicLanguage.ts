import type { Language } from './translations';

const KEY = 'smilecare-public-lang';

export function readPublicLanguage(): Language | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'ar' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

export function writePublicLanguage(lang: Language): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* The page still switches for this visit. */
  }
}

export function applyDocumentLanguage(lang: Language): void {
  document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', lang);
}
