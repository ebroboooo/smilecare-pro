import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { db } from '../../db';
import { CLINIC_ID, type Employee, type EmployeeSchedule } from '../../types';
import { Plus, Edit3, Trash2, Phone, Mail } from 'lucide-react';
import { translations, type TranslationKeys } from '../../utils/translations';

const DAY_KEYS: TranslationKeys[] = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'];

export const EmployeeManagement: React.FC = () => {
  const { employees, branches, reservations, refreshData, dispatchAuditLog, settings } = useApp();
  const t = translations[settings?.language === 'ar' ? 'ar' : 'en'];

  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'schedule'>('profile');
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    role: '',
    email: '',
    phone: '',
    status: 'Active' as 'Active' | 'Inactive',
    selectedBranches: [] as string[],
    schedule: [] as EmployeeSchedule[]
  });

  const handleOpenCreate = () => {
    const defaultSchedule: EmployeeSchedule[] = [0, 1, 2, 3, 4, 5, 6].map(day => ({
      dayOfWeek: day,
      start: "09:00",
      end: "17:00",
      isWorking: day !== 0 && day !== 6,
      breaks: [{ start: "12:00", end: "13:00" }]
    }));

    setFormData({
      id: '',
      name: '',
      role: '',
      email: '',
      phone: '',
      status: 'Active',
      selectedBranches: branches.map(b => b.id),
      schedule: defaultSchedule
    });
    setActiveTab('profile');
    setModalOpen(true);
  };

  const handleOpenEdit = (emp: Employee) => {
    setFormData({
      id: emp.id,
      name: emp.name,
      role: emp.role,
      email: emp.email,
      phone: emp.phone,
      status: emp.status,
      selectedBranches: emp.branchIds || [],
      schedule: emp.schedule || []
    });
    setActiveTab('profile');
    setModalOpen(true);
  };

  const handleBranchToggle = (branchId: string) => {
    setFormData(prev => {
      const active = prev.selectedBranches.includes(branchId)
        ? prev.selectedBranches.filter(id => id !== branchId)
        : [...prev.selectedBranches, branchId];
      return { ...prev, selectedBranches: active };
    });
  };

  const handleScheduleDayToggle = (dayIndex: number) => {
    setFormData(prev => {
      const sched = prev.schedule.map(s => {
        if (s.dayOfWeek === dayIndex) {
          return { ...s, isWorking: !s.isWorking };
        }
        return s;
      });
      return { ...prev, schedule: sched };
    });
  };

  const handleScheduleTimeChange = (dayIndex: number, field: 'start' | 'end', val: string) => {
    setFormData(prev => {
      const sched = prev.schedule.map(s => {
        if (s.dayOfWeek === dayIndex) {
          return { ...s, [field]: val };
        }
        return s;
      });
      return { ...prev, schedule: sched };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const org = CLINIC_ID;
    const payload = {
      name: formData.name,
      role: formData.role,
      email: formData.email,
      phone: formData.phone,
      status: formData.status,
      branchIds: formData.selectedBranches,
      schedule: formData.schedule
    };

    if (formData.id) {
      await db.employees.update(org, formData.id, payload);
      await dispatchAuditLog("Doctor Updated", `Modified doctor schedule and profile for ${formData.name}`);
    } else {
      await db.employees.create(org, payload);
      await dispatchAuditLog("Doctor Added", `Registered new doctor: ${formData.name}`);
    }

    setModalOpen(false);
    await refreshData();
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`${t.deleteDoctorConfirm}\n${name}`)) {
      const org = CLINIC_ID;
      await db.employees.delete(org, id);
      await dispatchAuditLog("Doctor Deactivated", `Deactivated doctor: ${name}`);
      await refreshData();
    }
  };

  const getStaffMetrics = (employeeId: string) => {
    const staffRes = reservations.filter(r => r.employeeId === employeeId && r.status === 'Completed');
    const revenue = staffRes.reduce((sum, r) => sum + (r.paymentDetails?.amount || 0), 0);
    return {
      completedCount: staffRes.length,
      revenueGenerated: revenue
    };
  };

  const getDayName = (dayNum: number) => t[DAY_KEYS[dayNum]];

  return (
    <div className="space-y-6">
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t.doctorsTitle}</h2>
          <p className="text-xs text-slate-500">{t.doctorsHelp}</p>
        </div>
        
        <button 
          onClick={handleOpenCreate}
          className="btn-primary px-3 py-2 text-xs flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          <span>{t.addEmployee}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {employees.map(emp => {
          const metrics = getStaffMetrics(emp.id);
          const branchCount = emp.branchIds?.length || 0;
          return (
            <div key={emp.id} className="card p-5 rounded-2xl border-slate-200 flex flex-col justify-between hover:border-brand-300 transition-all group">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <h4 className="font-bold text-slate-900 text-base">{emp.name}</h4>
                    <span className="text-[10px] text-brand-600 font-semibold">{emp.role}</span>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${emp.status === 'Active' ? 'bg-green-500' : 'bg-slate-600'}`} />
                </div>

                <div className="space-y-2 text-xs text-slate-400">
                  <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-slate-500" /> {emp.phone}</p>
                  <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-slate-500" /> <span className="truncate">{emp.email}</span></p>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-slate-50/40 p-3 rounded-xl border border-slate-200 text-center">
                  <div>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{t.completedVisits}</p>
                    <p className="text-sm font-bold text-slate-800 mt-0.5">{metrics.completedCount}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{t.collected}</p>
                    <p className="text-sm font-bold text-green-400 mt-0.5">{metrics.revenueGenerated.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mt-6 pt-3 border-t border-slate-200">
                <span className="text-[10px] text-slate-500 font-medium">
                  {t.assignedTo} {branchCount} {t.locations}
                </span>
                
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleOpenEdit(emp)}
                    className="p-1.5 bg-slate-100 hover:bg-slate-700/80 text-slate-700 hover:text-slate-900 rounded-lg text-xs"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(emp.id, emp.name)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-slate-50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-6 shadow-2xl relative animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            
            <div className="flex border-b border-slate-200 mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className={`py-2 px-4 text-sm font-bold border-b-2 transition-all ${
                  activeTab === 'profile' ? 'border-brand-500 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-800'
                }`}
              >
                {t.profileTab}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                className={`py-2 px-4 text-sm font-bold border-b-2 transition-all ${
                  activeTab === 'schedule' ? 'border-brand-500 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-800'
                }`}
              >
                {t.scheduleTab}
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 flex-1 overflow-y-auto pr-1">
              {activeTab === 'profile' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.doctorName}</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full input-field text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.jobTitle}</label>
                    <input
                      type="text"
                      required
                      value={formData.role}
                      onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                      className="w-full input-field text-xs"
                      placeholder={t.jobTitleHint}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.phone}</label>
                      <input
                        type="tel"
                        required
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full input-field text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.email}</label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full input-field text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">{t.assignToBranches}</label>
                    <div className="space-y-2 mt-2 max-h-24 overflow-y-auto border border-slate-200 p-2 rounded-xl">
                      {branches.map(b => (
                        <label key={b.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 select-none cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.selectedBranches.includes(b.id)}
                            onChange={() => handleBranchToggle(b.id)}
                            className="rounded bg-slate-50 border-slate-200 text-brand-500 focus:ring-brand-500/30"
                          />
                          <span>{b.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <p className="text-[11px] text-slate-500">{t.scheduleHelp}</p>
                  
                  {formData.schedule.map((day, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 p-2 bg-slate-50/40 border border-slate-200 rounded-xl">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 min-w-[70px] select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={day.isWorking}
                          onChange={() => handleScheduleDayToggle(day.dayOfWeek)}
                          className="rounded bg-slate-50 border-slate-200 text-brand-500 focus:ring-brand-500/30"
                        />
                        <span>{getDayName(day.dayOfWeek)}</span>
                      </label>

                      {day.isWorking ? (
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <input
                            type="time"
                            value={day.start}
                            onChange={(e) => handleScheduleTimeChange(day.dayOfWeek, 'start', e.target.value)}
                            className="bg-white border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-800"
                          />
                          <span className="text-slate-500">{t.to}</span>
                          <input
                            type="time"
                            value={day.end}
                            onChange={(e) => handleScheduleTimeChange(day.dayOfWeek, 'end', e.target.value)}
                            className="bg-white border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-800"
                          />
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-500 italic font-bold">{t.restDay}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 mt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-secondary px-4 py-2 text-xs"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="btn-primary px-4 py-2 text-xs"
                >
                  {t.saveChanges}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
