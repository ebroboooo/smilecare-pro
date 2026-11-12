import React, { Suspense, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { PageLoader } from './components/ui/LoadingSpinner';
import { RouteTitle } from './components/ui/RouteTitle';
import { NotFoundPage } from './components/ui/NotFoundPage';
import { DEMO_MODE } from './db';
import { mockDbInstance } from './db/mockRepository';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LanguageSwitch } from './components/ui/LanguageSwitch';
import { Smile, UserCheck } from 'lucide-react';
import type { UserRole } from './types';
import { translations, type Language } from './utils/translations';
import { applyDocumentLanguage, readPublicLanguage, writePublicLanguage } from './utils/publicLanguage';

const DashboardLayout = React.lazy(() => import('./components/Layout/DashboardLayout').then(m => ({ default: m.DashboardLayout })));
const Dashboard = React.lazy(() => import('./components/Dashboard/Dashboard').then(m => ({ default: m.Dashboard })));
const SmartCalendar = React.lazy(() => import('./components/Calendar/SmartCalendar').then(m => ({ default: m.SmartCalendar })));
const WaitlistQueue = React.lazy(() => import('./components/Waitlist/WaitlistQueue').then(m => ({ default: m.WaitlistQueue })));
const CustomerDatabase = React.lazy(() => import('./components/Customers/CustomerDatabase').then(m => ({ default: m.CustomerDatabase })));
const LeadsPipeline = React.lazy(() => import('./components/Leads/LeadsPipeline').then(m => ({ default: m.LeadsPipeline })));
const ServicesManagement = React.lazy(() => import('./components/Services/ServicesManagement').then(m => ({ default: m.ServicesManagement })));
const EmployeeManagement = React.lazy(() => import('./components/Employees/EmployeeManagement').then(m => ({ default: m.EmployeeManagement })));
const Reports = React.lazy(() => import('./components/Reports/Reports').then(m => ({ default: m.Reports })));
const Settings = React.lazy(() => import('./components/Settings/Settings').then(m => ({ default: m.Settings })));
const UserManagement = React.lazy(() => import('./components/Users/UserManagement').then(m => ({ default: m.UserManagement })));
const BookingPortal = React.lazy(() => import('./components/BookingPortal/BookingPortal').then(m => ({ default: m.BookingPortal })));
const LandingPage = React.lazy(() => import('./components/Landing/LandingPage').then(m => ({ default: m.LandingPage })));
const PrivacyPage = React.lazy(() => import('./components/Landing/PrivacyPage').then(m => ({ default: m.PrivacyPage })));

const LazyFallback = () => <PageLoader />;

const GuestOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (currentUser) return <Navigate to="/admin/dashboard" replace />;
  return <>{children}</>;
};

const ProtectedAdminRoute: React.FC = () => {
  const { currentUser, isLoading } = useAuth();

  if (isLoading) return <PageLoader />;
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.mustChangePassword) return <ChangePassword />;

  return (
    <Suspense fallback={<LazyFallback />}>
      <DashboardLayout>
        <Suspense fallback={<LazyFallback />}>
          <Outlet />
        </Suspense>
      </DashboardLayout>
    </Suspense>
  );
};

const RequireRole: React.FC<{ role: UserRole; children: React.ReactNode }> = ({ role, children }) => {
  const { hasPermission } = useAuth();
  if (!hasPermission(role)) return <Navigate to="/admin/dashboard" replace />;
  return <>{children}</>;
};

const Login: React.FC = () => {
  const { login, setup, currentUser, needsSetup } = useAuth();
  const navigate = useNavigate();
  const [lang, setLang] = useState<Language>(() => readPublicLanguage() ?? 'en');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('SmileCare Dental Clinic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const t = translations[lang];

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  const chooseLang = (next: Language) => {
    writePublicLanguage(next);
    setLang(next);
  };

  useEffect(() => {
    if (currentUser) navigate('/admin/dashboard', { replace: true });
  }, [currentUser, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      if (needsSetup) {
        await setup({ name, email, password, businessName });
      } else {
        await login(email, password);
      }
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.signInError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDemo = () => {
    if (window.confirm(t.resetDemoConfirm)) {
      mockDbInstance.resetPreset('Dental');
      window.location.reload();
    }
  };

  return (
    <RouteTitle title={needsSetup ? t.setupTitle : t.loginTitle}>
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-brand-50 pointer-events-none" />

        <div className="panel w-full max-w-md p-8 shadow-elevated relative space-y-6">
          <div className="flex justify-end">
            <LanguageSwitch lang={lang} onChange={chooseLang} />
          </div>
          {DEMO_MODE && (
            <p className="text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
              {t.demoBanner}
            </p>
          )}
          <div className="text-center space-y-2">
            <div className="bg-brand-600 p-2.5 rounded-2xl w-fit mx-auto text-white shadow-lg">
              <Smile className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-display font-bold text-slate-900 tracking-tight">SmileCare Pro</h2>
            <p className="text-sm text-slate-600">
              {needsSetup ? t.setupSubtitle : t.loginSubtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsSetup && (
              <>
                <div>
                  <label htmlFor="setup-business" className="block text-sm font-medium text-slate-700 mb-1.5">{t.clinicName}</label>
                  <input id="setup-business" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="input-field" />
                </div>
                <div>
                  <label htmlFor="setup-name" className="block text-sm font-medium text-slate-700 mb-1.5">{t.yourName}</label>
                  <input id="setup-name" required value={name} onChange={(e) => setName(e.target.value)} className="input-field" autoComplete="name" />
                </div>
              </>
            )}
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">{t.email}</label>
              <input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" autoComplete="email" />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">{t.password}</label>
              <input id="login-password" type="password" required minLength={needsSetup ? 10 : 4} value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" autoComplete={needsSetup ? 'new-password' : 'current-password'} />
            </div>

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">{error}</p>
            )}

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3">
              <UserCheck className="h-4 w-4" />
              {isSubmitting ? t.pleaseWait : needsSetup ? t.createOwner : t.signIn}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 text-center space-y-3">
            {!needsSetup && <p className="text-sm text-slate-500">{t.forgotPassword}</p>}
            {DEMO_MODE && (
              <button onClick={handleResetDemo} type="button" className="text-xs bg-brand-50 border border-brand-200 text-brand-700 font-semibold px-4 py-2 rounded-xl hover:bg-brand-100 transition-all">
                {t.resetDemo}
              </button>
            )}
            <div>
              <a href="/" className="text-sm text-slate-500 hover:text-brand-600 transition-colors">{t.backToSite}</a>
            </div>
          </div>
        </div>
      </div>
    </RouteTitle>
  );
};

const ChangePassword: React.FC = () => {
  const { changePassword, logout } = useAuth();
  const { settings } = useApp();
  const lang: Language = settings?.language === 'ar' ? 'ar' : (readPublicLanguage() ?? 'en');
  const t = translations[lang];
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.passwordError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <form onSubmit={handleSubmit} className="panel w-full max-w-md p-8 space-y-4">
        <h1 className="text-xl font-bold text-slate-900">{t.changePasswordTitle}</h1>
        <p className="text-sm text-slate-600">{t.changePasswordHelp}</p>
        <label className="block text-sm font-medium text-slate-700">{t.tempPassword}</label>
        <input className="input-field" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        <label className="block text-sm font-medium text-slate-700">{t.newPassword}</label>
        <input className="input-field" type="password" required minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={isSubmitting} type="submit">{isSubmitting ? t.pleaseWait : t.savePassword}</button>
        <button className="btn-secondary w-full" type="button" onClick={() => void logout()}>{t.logout}</button>
      </form>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
    <Router>
      <AuthProvider>
        <ToastProvider>
          <AppProvider>
            <Suspense fallback={<LazyFallback />}>
              <Routes>
                <Route path="/" element={
                  <GuestOnlyRoute>
                    <RouteTitle title="Dental Clinic Management">
                      <LandingPage />
                    </RouteTitle>
                  </GuestOnlyRoute>
                } />
                <Route path="/login" element={
                  <GuestOnlyRoute>
                    <Login />
                  </GuestOnlyRoute>
                } />

                <Route element={<ProtectedAdminRoute />}>
                  <Route path="/admin/dashboard" element={<RouteTitle title="Dashboard"><Dashboard /></RouteTitle>} />
                  <Route path="/admin/calendar" element={<RouteTitle title="Appointments Calendar"><SmartCalendar /></RouteTitle>} />
                  <Route path="/admin/waitlist" element={<RouteTitle title="Waitlist"><WaitlistQueue /></RouteTitle>} />
                  <Route path="/admin/customers" element={<RouteTitle title="Patients"><CustomerDatabase /></RouteTitle>} />
                  <Route path="/admin/leads" element={<RouteTitle title="Patient Inquiries"><LeadsPipeline /></RouteTitle>} />
                  <Route path="/admin/services" element={<RouteTitle title="Dental Services"><ServicesManagement /></RouteTitle>} />
                  <Route path="/admin/employees" element={<RouteTitle title="Doctors"><EmployeeManagement /></RouteTitle>} />
                  <Route path="/admin/reports" element={<RequireRole role="owner"><RouteTitle title="Reports"><Reports /></RouteTitle></RequireRole>} />
                  <Route path="/admin/settings" element={<RequireRole role="owner"><RouteTitle title="Settings"><Settings /></RouteTitle></RequireRole>} />
                  <Route path="/admin/users" element={<RequireRole role="owner"><RouteTitle title="Staff Accounts"><UserManagement /></RouteTitle></RequireRole>} />
                </Route>

                <Route path="/privacy" element={
                  <RouteTitle title="Privacy">
                    <PrivacyPage />
                  </RouteTitle>
                } />
                <Route path="/book/:slug" element={
                  <RouteTitle title="Book Appointment">
                    <BookingPortal />
                  </RouteTitle>
                } />

                <Route path="*" element={
                  <RouteTitle title="Page Not Found">
                    <NotFoundPage />
                  </RouteTitle>
                } />
              </Routes>
            </Suspense>
          </AppProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
    </ErrorBoundary>
  );
};

export default App;
