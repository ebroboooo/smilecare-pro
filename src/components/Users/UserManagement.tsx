import React, { useEffect, useState } from 'react';
import { api } from '../../db/api';
import { DEMO_MODE } from '../../db';
import { createDemoUser, listDemoUsers, setDemoUserActive } from '../../db/demoUsers';
import type { User, UserRole } from '../../types';
import { useApp } from '../../context/AppContext';
import { translations } from '../../utils/translations';
import { statusText } from '../../utils/locale';

export const UserManagement: React.FC = () => {
  const { settings } = useApp();
  const t = translations[settings?.language || 'en'];
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'receptionist' as UserRole,
  });

  const load = async () => {
    if (DEMO_MODE) {
      setUsers(await listDemoUsers());
      return;
    }
    const rows = await api<User[]>('/api/users');
    setUsers(rows);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((err: Error) => setError(err.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      if (DEMO_MODE) {
        await createDemoUser(form);
      } else {
        await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
      }
      setForm({ name: '', email: '', password: '', role: 'receptionist' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.couldNotCreateAccount);
    }
  };

  const toggleActive = async (user: User) => {
    setError('');
    try {
      if (DEMO_MODE) {
        await setDemoUserActive(user.id, !user.isActive);
      } else {
        await api(`/api/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !user.isActive }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.couldNotUpdateAccount);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t.staffAccounts}</h2>
        <p className="text-sm text-slate-500">{t.staffHelp}</p>
        {DEMO_MODE && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            Demo staff accounts stay in this browser only.
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">{error}</p>}

      <form onSubmit={createUser} className="panel p-5 grid gap-3 md:grid-cols-2 max-w-3xl">
        <input className="input-field" required placeholder={t.fullName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input-field" required type="email" placeholder={t.email} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="input-field" required type="password" minLength={10} placeholder={t.tempPassword} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
          <option value="receptionist">{t.roleReception}</option>
          <option value="doctor">{t.roleDoctor}</option>
          <option value="owner">{t.roleOwner}</option>
        </select>
        <button className="btn-primary md:col-span-2" type="submit">{t.createAccount}</button>
      </form>

      <div className="panel divide-y divide-slate-100">
        {users.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No staff accounts yet.</p>
        ) : (
          users.map((user) => (
            <div key={user.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email} · {statusText(t, user.role)}</p>
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={() => toggleActive(user)}>
                {user.isActive ? t.deactivate : t.activate}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
