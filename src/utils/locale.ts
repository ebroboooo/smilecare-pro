import { translations, type Language } from './translations';

type Copy = typeof translations.en;

export function localeTag(lang: Language): string {
  return lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
}

export function formatNumber(value: number, lang: Language): string {
  return new Intl.NumberFormat(localeTag(lang)).format(value);
}

export function formatMoney(amount: number, currency: string, lang: Language): string {
  const code = currency || 'EGP';
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(localeTag(lang), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${formatNumber(amount, lang)} ${code}`;
  }
}

export function formatDate(isoDate: string, lang: Language): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat(localeTag(lang), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function formatTime(time: string, lang: Language): string {
  const [hour, minute] = time.split(':').map(Number);
  if (Number.isNaN(hour)) return time;
  const date = new Date();
  date.setHours(hour, minute || 0, 0, 0);
  return new Intl.DateTimeFormat(localeTag(lang), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDateTime(value: string | number | Date, lang: Language): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(localeTag(lang), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

const STATUS: Record<string, keyof Copy> = {
  Pending: 'statusPending',
  Confirmed: 'statusConfirmed',
  Completed: 'statusCompleted',
  Cancelled: 'statusCancelled',
  NoShow: 'statusNoShow',
  Active: 'active',
  Inactive: 'inactive',
  Cash: 'cash',
  Card: 'card',
  Paid: 'paid',
  Unpaid: 'unpaid',
  Authorized: 'authorized',
  Refunded: 'refunded',
  Sound: 'toothSound',
  Caries: 'toothCaries',
  Filled: 'toothFilled',
  Missing: 'toothMissing',
  Crown: 'toothCrown',
  RootCanal: 'toothRootCanal',
  owner: 'roleOwner',
  receptionist: 'roleReception',
  doctor: 'roleDoctor',
  New: 'stageNew',
  Contacted: 'stageContacted',
  Interested: 'stageInterested',
  Converted: 'stageConverted',
  Lost: 'stageLost',
};

export function statusText(t: Copy, status: string): string {
  const key = STATUS[status];
  return key ? t[key] : status;
}
