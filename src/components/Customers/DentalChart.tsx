import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../db/api';
import { useApp } from '../../context/AppContext';
import { translations } from '../../utils/translations';
import { formatMoney, statusText } from '../../utils/locale';

const TEETH = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41',
  '31', '32', '33', '34', '35', '36', '37', '38',
];

const CONDITIONS = ['Sound', 'Caries', 'Filled', 'Missing', 'Crown', 'RootCanal'] as const;
type Condition = typeof CONDITIONS[number];

const COLORS: Record<Condition, string> = {
  Sound: 'bg-white text-slate-700 border-slate-200',
  Caries: 'bg-red-100 text-red-800 border-red-200',
  Filled: 'bg-sky-100 text-sky-800 border-sky-200',
  Missing: 'bg-slate-200 text-slate-500 border-slate-300',
  Crown: 'bg-amber-100 text-amber-800 border-amber-200',
  RootCanal: 'bg-violet-100 text-violet-800 border-violet-200',
};

interface ToothRow { tooth: string; condition: Condition; note: string }
interface VisitRow { id: string; visitedOn: string; doctorName: string; complaint: string; diagnosis: string; treatment: string }
interface PaymentRow { id: string; amount: number; method: string; paidAt: string; note: string }

export const DentalChart: React.FC<{ patientId: string }> = ({ patientId }) => {
  const { settings } = useApp();
  const lang = settings?.language || 'en';
  const t = translations[lang];
  const currency = settings?.currency || 'EGP';
  const [teeth, setTeeth] = useState<Record<string, ToothRow>>({});
  const [selected, setSelected] = useState('11');
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [balance, setBalance] = useState<{ charges: number; paid: number; balance: number } | null>(null);
  const [error, setError] = useState('');
  const [visit, setVisit] = useState({ visitedOn: new Date().toISOString().slice(0, 10), complaint: '', diagnosis: '', treatment: '' });
  const [payment, setPayment] = useState({ amount: '', method: 'Cash' as 'Cash' | 'Card', note: '' });

  const load = useCallback(async () => {
    const [chart, visitRows, money] = await Promise.all([
      api<{ teeth: ToothRow[] }>(`/api/patients/${patientId}/odontogram`),
      api<VisitRow[]>(`/api/patients/${patientId}/visits`),
      api<{ charges: number; paid: number; balance: number; payments: PaymentRow[] }>(`/api/patients/${patientId}/payments`),
    ]);
    const next: Record<string, ToothRow> = {};
    for (const row of chart.teeth) next[row.tooth] = row;
    setTeeth(next);
    setVisits(visitRows);
    setPayments(money.payments);
    setBalance(money);
  }, [patientId]);

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : t.couldNotLoadChart));
  }, [load]);

  const condition = teeth[selected]?.condition || 'Sound';

  const saveTooth = async (nextCondition: Condition) => {
    setError('');
    try {
      await api(`/api/patients/${patientId}/odontogram`, {
        method: 'PUT',
        body: JSON.stringify({ teeth: [{ tooth: selected, condition: nextCondition, note: teeth[selected]?.note || '' }] }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSaveTooth);
    }
  };

  const saveVisit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await api(`/api/patients/${patientId}/visits`, { method: 'POST', body: JSON.stringify(visit) });
      setVisit({ ...visit, complaint: '', diagnosis: '', treatment: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSaveVisit);
    }
  };

  const savePayment = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await api(`/api/patients/${patientId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(payment.amount), method: payment.method, note: payment.note }),
      });
      setPayment({ amount: '', method: 'Cash', note: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotRecordPayment);
    }
  };

  return (
    <div className="space-y-6">
      <div className="panel p-5 space-y-4">
        <h3 className="font-semibold text-slate-900">{t.toothChart}</h3>
        <div className="grid grid-cols-8 gap-1 max-w-xl">
          {TEETH.slice(0, 16).map((tooth) => (
            <button key={tooth} type="button" onClick={() => setSelected(tooth)} className={`rounded-lg border px-1 py-2 text-[10px] font-bold ${COLORS[teeth[tooth]?.condition || 'Sound']} ${selected === tooth ? 'ring-2 ring-brand-500' : ''}`}>{tooth}</button>
          ))}
        </div>
        <div className="grid grid-cols-8 gap-1 max-w-xl">
          {TEETH.slice(16).map((tooth) => (
            <button key={tooth} type="button" onClick={() => setSelected(tooth)} className={`rounded-lg border px-1 py-2 text-[10px] font-bold ${COLORS[teeth[tooth]?.condition || 'Sound']} ${selected === tooth ? 'ring-2 ring-brand-500' : ''}`}>{tooth}</button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{t.toothLabel} {selected}: {statusText(t, condition)}</p>
        <div className="flex flex-wrap gap-2">
          {CONDITIONS.map((item) => (
            <button key={item} type="button" className="btn-secondary text-xs" onClick={() => saveTooth(item)}>{statusText(t, item)}</button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={saveVisit} className="panel p-5 space-y-3">
          <h3 className="font-semibold text-slate-900">{t.visitRecord}</h3>
          <input className="input-field" type="date" value={visit.visitedOn} onChange={(event) => setVisit({ ...visit, visitedOn: event.target.value })} required />
          <input className="input-field" placeholder={t.complaint} value={visit.complaint} onChange={(event) => setVisit({ ...visit, complaint: event.target.value })} />
          <input className="input-field" placeholder={t.diagnosis} value={visit.diagnosis} onChange={(event) => setVisit({ ...visit, diagnosis: event.target.value })} />
          <input className="input-field" placeholder={t.treatment} value={visit.treatment} onChange={(event) => setVisit({ ...visit, treatment: event.target.value })} />
          <button className="btn-primary text-xs" type="submit">{t.saveVisit}</button>
          {visits.length === 0 && <p className="text-xs text-slate-500">{t.noVisits}</p>}
          <ul className="text-sm space-y-2">
            {visits.map((row) => (
              <li key={row.id} className="border border-slate-100 rounded-xl p-2">
                <p className="font-semibold">{row.visitedOn} {row.doctorName}</p>
                <p className="text-slate-600">{row.complaint} {row.diagnosis} {row.treatment}</p>
              </li>
            ))}
          </ul>
        </form>

        <form onSubmit={savePayment} className="panel p-5 space-y-3">
          <h3 className="font-semibold text-slate-900">{t.payments}</h3>
          {balance && (
            <p className="text-sm text-slate-700">{t.charges} {formatMoney(balance.charges, currency, lang)} · {t.paid} {formatMoney(balance.paid, currency, lang)} · {t.balance} {formatMoney(balance.balance, currency, lang)}</p>
          )}
          <input className="input-field" type="number" min="0.01" step="0.01" placeholder={t.amount} value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} required />
          <select className="input-field" value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value as 'Cash' | 'Card' })}>
            <option value="Cash">{t.cash}</option>
            <option value="Card">{t.card}</option>
          </select>
          <input className="input-field" placeholder={t.paymentNote} value={payment.note} onChange={(event) => setPayment({ ...payment, note: event.target.value })} />
          <button className="btn-primary text-xs" type="submit">{t.recordPayment}</button>
          {payments.length === 0 && <p className="text-xs text-slate-500">{t.noPayments}</p>}
          <ul className="text-sm space-y-2">
            {payments.map((row) => (
              <li key={row.id}>{row.paidAt.slice(0, 10)} · {formatMoney(row.amount, currency, lang)} {statusText(t, row.method)} {row.note}</li>
            ))}
          </ul>
        </form>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
};
