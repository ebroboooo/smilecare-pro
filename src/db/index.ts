import type {
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
} from './interfaces';
import {
  ApiAuditLogRepository,
  ApiBranchRepository,
  ApiCustomerRepository,
  ApiEmployeeRepository,
  ApiLeadRepository,
  ApiNotificationRepository,
  ApiReservationRepository,
  ApiServiceRepository,
  ApiSettingsRepository,
  ApiWaitlistRepository,
} from './apiRepository';
import {
  MockAuditLogRepository,
  MockBranchRepository,
  MockCustomerRepository,
  MockEmployeeRepository,
  MockLeadRepository,
  MockNotificationRepository,
  MockReservationRepository,
  MockServiceRepository,
  MockSettingsRepository,
  MockWaitlistRepository,
} from './mockRepository';

const envDemo = import.meta.env.VITE_DEMO_MODE;
const hostLooksStatic =
  typeof window !== 'undefined' &&
  (/\.vercel\.app$/i.test(window.location.hostname) ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1');

/** Vercel SPA and local preview have no Express API — always use the in-browser demo store. */
export const DEMO_MODE = envDemo === 'true' || envDemo === true || hostLooksStatic;

class RepositoryProvider {
  public branches: IBranchRepository;
  public customers: ICustomerRepository;
  public reservations: IReservationRepository;
  public services: IServiceRepository;
  public employees: IEmployeeRepository;
  public leads: ILeadRepository;
  public notifications: INotificationRepository;
  public waitlist: IWaitlistRepository;
  public auditLogs: IAuditLogRepository;
  public settings: ISettingsRepository;

  constructor() {
    if (DEMO_MODE) {
      this.branches = new MockBranchRepository();
      this.customers = new MockCustomerRepository();
      this.reservations = new MockReservationRepository();
      this.services = new MockServiceRepository();
      this.employees = new MockEmployeeRepository();
      this.leads = new MockLeadRepository();
      this.notifications = new MockNotificationRepository();
      this.waitlist = new MockWaitlistRepository();
      this.auditLogs = new MockAuditLogRepository();
      this.settings = new MockSettingsRepository();
    } else {
      this.branches = new ApiBranchRepository();
      this.customers = new ApiCustomerRepository();
      this.reservations = new ApiReservationRepository();
      this.services = new ApiServiceRepository();
      this.employees = new ApiEmployeeRepository();
      this.leads = new ApiLeadRepository();
      this.notifications = new ApiNotificationRepository();
      this.waitlist = new ApiWaitlistRepository();
      this.auditLogs = new ApiAuditLogRepository();
      this.settings = new ApiSettingsRepository();
    }
  }
}

export const db = new RepositoryProvider();
