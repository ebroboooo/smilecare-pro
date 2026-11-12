import React, { useEffect, useState } from 'react';
import { api } from '../../db/api';
import type { User, UserRole } from '../../types';

export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'receptionist' as UserRole,
  });

  const load = async () => {
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
      await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', email: '', password: '', role: 'receptionist' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    }
  };

  const toggleActive = async (user: User) => {
    setError('');
    try {
      await api(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the account');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Staff accounts</h2>
        <p className="text-xs text-slate-500">Owners create receptionist and doctor sign-ins. New passwords must be changed at first login.</p>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">{error}</p>}

      <form onSubmit={createUser} className="panel p-5 grid gap-3 md:grid-cols-2 max-w-3xl">
        <input className="input-field" required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input-field" required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="input-field" required type="password" minLength={10} placeholder="Temporary password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
          <option value="receptionist">Receptionist</option>
          <option value="doctor">Doctor</option>
          <option value="owner">Owner</option>
        </select>
        <button className="btn-primary md:col-span-2" type="submit">Create account</button>
      </form>

      <div className="panel divide-y divide-slate-100">
        {users.map((user) => (
          <div key={user.id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email} · {user.role}</p>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={() => toggleActive(user)}>
              {user.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
