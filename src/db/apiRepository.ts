import type {
  AuditLog,
  Branch,
  Customer,
  Employee,
  Lead,
  Notification,
  Reservation,
  Service,
  SystemSettings,
  WaitlistRecord,
} from '../types';
import { ApiError, api, toQuery } from './api';
import type {
  CreateAuditLogInput,
  CreateBranchInput,
  CreateCustomerInput,
  CreateEmployeeInput,
  CreateLeadInput,
  CreateNotificationInput,
  CreateReservationInput,
  CreateServiceInput,
  CreateWaitlistInput,
  IAuditLogRepository,
  IBranchRepository,
  ICustomerRepository,
  IEmployeeRepository,
  ILeadRepository,
  INotificationRepository,
  IReservationRepository,
  IServiceRepository,
  ISettingsRepository,
  IWaitlistRepository,
  ListQuery,
} from './interfaces';

async function byId<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function list<T>(path: string, query?: ListQuery): Promise<T[]> {
  const data = await api<T[] | { items: T[] }>(`${path}${toQuery({
    q: query?.q,
    page: query?.page,
    pageSize: query?.pageSize,
    status: query?.status,
    branchId: query?.branchId,
    start: query?.start,
    end: query?.end,
  })}`);
  return Array.isArray(data) ? data : data.items;
}

export class ApiCustomerRepository implements ICustomerRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<Customer>('/api/patients', query);
  getById = (_orgId: string, id: string) => byId<Customer>(`/api/patients/${id}`);
  create = (_orgId: string, data: CreateCustomerInput) => api<Customer>('/api/patients', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<Customer>) => api<Customer>(`/api/patients/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/patients/${id}`, { method: 'DELETE' });
}

export class ApiReservationRepository implements IReservationRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<Reservation>('/api/appointments', query);
  getById = (_orgId: string, id: string) => byId<Reservation>(`/api/appointments/${id}`);
  create = (_orgId: string, data: CreateReservationInput) => api<Reservation>('/api/appointments', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<Reservation>) => api<Reservation>(`/api/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/appointments/${id}`, { method: 'DELETE' });
  getByDateRange = (_orgId: string, branchId: string, start: string, end: string) =>
    list<Reservation>('/api/appointments', { branchId, start, end });
  async checkConflict(_orgId: string, _branchId: string, employeeId: string, date: string, time: string, duration: number, excludeId?: string) {
    const result = await api<{ conflict: boolean }>(`/api/appointments/conflict${toQuery({ branchId: _branchId, employeeId, date, time, duration, excludeId })}`);
    return result.conflict;
  }
}

export class ApiServiceRepository implements IServiceRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<Service>('/api/services', query);
  getById = (_orgId: string, id: string) => byId<Service>(`/api/services/${id}`);
  create = (_orgId: string, data: CreateServiceInput) => api<Service>('/api/services', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<Service>) => api<Service>(`/api/services/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/services/${id}`, { method: 'DELETE' });
}

export class ApiEmployeeRepository implements IEmployeeRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<Employee>('/api/doctors', query);
  getById = (_orgId: string, id: string) => byId<Employee>(`/api/doctors/${id}`);
  create = (_orgId: string, data: CreateEmployeeInput) => api<Employee>('/api/doctors', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<Employee>) => api<Employee>(`/api/doctors/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/doctors/${id}`, { method: 'DELETE' });
}

export class ApiBranchRepository implements IBranchRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<Branch>('/api/branches', query);
  getById = (_orgId: string, id: string) => byId<Branch>(`/api/branches/${id}`);
  create = (_orgId: string, data: CreateBranchInput) => api<Branch>('/api/branches', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<Branch>) => api<Branch>(`/api/branches/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/branches/${id}`, { method: 'DELETE' });
}

export class ApiLeadRepository implements ILeadRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<Lead>('/api/leads', query);
  getById = (_orgId: string, id: string) => byId<Lead>(`/api/leads/${id}`);
  create = (_orgId: string, data: CreateLeadInput) => api<Lead>('/api/leads', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<Lead>) => api<Lead>(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/leads/${id}`, { method: 'DELETE' });
}

export class ApiNotificationRepository implements INotificationRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<Notification>('/api/notifications', query);
  getById = (_orgId: string, id: string) => byId<Notification>(`/api/notifications/${id}`);
  create = (_orgId: string, data: CreateNotificationInput) => api<Notification>('/api/notifications', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<Notification>) => api<Notification>(`/api/notifications/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/notifications/${id}`, { method: 'DELETE' });
  async getUnreadCount(_orgId: string) {
    const result = await api<{ count: number }>('/api/notifications/unread-count');
    return result.count;
  }
  markAllAsRead = (_orgId: string) => api<void>('/api/notifications/mark-all-read', { method: 'POST' });
}

export class ApiWaitlistRepository implements IWaitlistRepository {
  getAll = (_orgId: string, query?: ListQuery) => list<WaitlistRecord>('/api/waitlist', query);
  getById = (_orgId: string, id: string) => byId<WaitlistRecord>(`/api/waitlist/${id}`);
  create = (_orgId: string, data: CreateWaitlistInput) => api<WaitlistRecord>('/api/waitlist', { method: 'POST', body: JSON.stringify(data) });
  update = (_orgId: string, id: string, data: Partial<WaitlistRecord>) => api<WaitlistRecord>(`/api/waitlist/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  delete = (_orgId: string, id: string) => api<boolean>(`/api/waitlist/${id}`, { method: 'DELETE' });
  getWaiting = (_orgId: string, branchId: string) => list<WaitlistRecord>('/api/waitlist', { branchId, status: 'Waiting' });
}

export class ApiAuditLogRepository implements IAuditLogRepository {
  getAll = (_orgId: string) => api<AuditLog[]>('/api/audit');
  create = (_orgId: string, log: CreateAuditLogInput) =>
    api<AuditLog>('/api/audit', { method: 'POST', body: JSON.stringify({ action: log.action, details: log.details }) });
}

export class ApiSettingsRepository implements ISettingsRepository {
  get = (_orgId: string) => api<SystemSettings>('/api/settings');
  update = (_orgId: string, settings: Partial<SystemSettings>) =>
    api<SystemSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(settings) });
}
