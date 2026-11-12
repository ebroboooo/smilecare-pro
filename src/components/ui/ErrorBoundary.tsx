import { Component, type ReactNode } from 'react';
import { translations, type Language } from '../../utils/translations';
import { readPublicLanguage } from '../../utils/publicLanguage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      const lang: Language = readPublicLanguage() ?? (document.documentElement.lang === 'ar' ? 'ar' : 'en');
      const t = translations[lang];
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <div className="panel max-w-md p-8 space-y-3 text-center">
            <h1 className="text-xl font-bold text-slate-900">{t.somethingWrong}</h1>
            <p className="text-sm text-slate-600">{t.somethingWrongHelp}</p>
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>{t.reload}</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
