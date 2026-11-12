import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../../db/api';
import { useApp } from '../../context/AppContext';
import { translations } from '../../utils/translations';
import type { Branch, Employee } from '../../types';

interface Holiday {
  id: string;
  branchId: string;
  date: string;
  label: string;
}

interface TimeOff {
  id: string;
  doctorId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export const ClinicClosures: React.FC<{ branches: Branch[]; employees: Employee[] }> = ({ branches, employees }) => {
  const { settings } = useApp();
  const t = translations[settings?.language === 'ar' ? 'ar' : 'en'];
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [doctorId, setDoctorId] = useState(employees[0]?.id || '');
  const [error, setError] = useState('');
  const [holiday, setHoliday] = useState({ branchId: branches[0]?.id || '', date: '', label: '' });
  const [off, setOff] = useState({ startsAt: '', endsAt: '', reason: '' });

  const load = async (nextDoctor = doctorId) => {
    const rows = await api<Holiday[]>('/api/holidays');
    setHolidays(rows);
    if (nextDoctor) {
      const blocks = await api<TimeOff[]>(`/api/doctors/${nextDoctor}/time-off`);
      setTimeOff(blocks);
    }
  };

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load closures'));
  }, []);

  const addHoliday = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await api('/api/holidays', { method: 'POST', body: JSON.stringify({ ...holiday, preventBookings: true }) });
      setHoliday({ ...holiday, date: '', label: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the closure');
    }
  };

  const addTimeOff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!doctorId) return;
    setError('');
    try {
      await api(`/api/doctors/${doctorId}/time-off`, {
        method: 'POST',
        body: JSON.stringify({
          startsAt: new Date(off.startsAt).toISOString(),
          endsAt: new Date(off.endsAt).toISOString(),
          reason: off.reason,
        }),
      });
      setOff({ startsAt: '', endsAt: '', reason: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save time off');
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <form onSubmit={addHoliday} className="panel p-5 space-y-3">
        <h3 className="font-semibold text-slate-900">{t.closures}</h3>
        <select className="input-field" value={holiday.branchId} onChange={(event) => setHoliday({ ...holiday, branchId: event.target.value })}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <input className="input-field" type="date" required value={holiday.date} onChange={(event) => setHoliday({ ...holiday, date: event.target.value })} />
        <input className="input-field" required placeholder={t.closureLabel} value={holiday.label} onChange={(event) => setHoliday({ ...holiday, label: event.target.value })} />
        <button className="btn-primary text-xs" type="submit">{t.addClosure}</button>
        <ul className="text-sm space-y-2">
          {holidays.length === 0 && <li className="text-slate-500">{t.noClosures}</li>}
          {holidays.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <span>{row.date} · {row.label}</span>
              <button type="button" className="text-xs text-red-600" onClick={() => api(`/api/holidays/${row.id}`, { method: 'DELETE' }).then(() => load())}>{t.remove}</button>
            </li>
          ))}
        </ul>
      </form>
      <form onSubmit={addTimeOff} className="panel p-5 space-y-3">
        <h3 className="font-semibold text-slate-900">{t.timeOff}</h3>
        <select className="input-field" value={doctorId} onChange={(event) => { setDoctorId(event.target.value); load(event.target.value).catch(() => undefined); }}>
          {employees.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
        </select>
        <input className="input-field" type="datetime-local" required value={off.startsAt} onChange={(event) => setOff({ ...off, startsAt: event.target.value })} />
        <input className="input-field" type="datetime-local" required value={off.endsAt} onChange={(event) => setOff({ ...off, endsAt: event.target.value })} />
        <input className="input-field" placeholder={t.timeOffReason} value={off.reason} onChange={(event) => setOff({ ...off, reason: event.target.value })} />
        <button className="btn-primary text-xs" type="submit">{t.addTimeOff}</button>
        <ul className="text-sm space-y-2">
          {timeOff.length === 0 && <li className="text-slate-500">{t.noTimeOff}</li>}
          {timeOff.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <span>{row.startsAt.slice(0, 16).replace('T', ' ')} · {row.reason || t.timeOff}</span>
              <button type="button" className="text-xs text-red-600" onClick={() => api(`/api/time-off/${row.id}`, { method: 'DELETE' }).then(() => load())}>{t.remove}</button>
            </li>
          ))}
        </ul>
      </form>
      {error && <p className="text-sm text-red-600 lg:col-span-2">{error}</p>}
    </div>
  );
};
