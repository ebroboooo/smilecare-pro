import type { Request } from 'express';
import { getDb } from './db.js';
import { HttpError } from './http.js';

export type OrgPlan = 'pilot' | 'growth' | 'enterprise';
export type OrgStatus = 'active' | 'suspended' | 'closed';

export interface Organization {
  id: number;
  name: string;
  slug: string;
  country: string;
  plan: OrgPlan;
  status: OrgStatus;
  dataRetentionDays: number;
  pdplNoticeVersion: string;
  complianceMode: string;
}

interface OrgRow {
  id: number;
  name: string;
  slug: string;
  country: string;
  plan: OrgPlan;
  status: OrgStatus;
  data_retention_days: number;
  pdpl_notice_version: string;
  compliance_mode: string;
}

export function mapOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    country: row.country,
    plan: row.plan,
    status: row.status,
    dataRetentionDays: row.data_retention_days,
    pdplNoticeVersion: row.pdpl_notice_version,
    complianceMode: row.compliance_mode,
  };
}

export function publicOrgId(orgId: number): string {
  return String(orgId);
}

/** Authenticated staff always act inside one clinic organization. */
export function requireOrgId(req: Request): number {
  if (!req.user?.orgId) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
  }
  return req.user.orgId;
}

export function getOrganization(id: number): Organization | null {
  const row = getDb().prepare('SELECT * FROM organizations WHERE id = ?').get(id) as OrgRow | undefined;
  return row ? mapOrg(row) : null;
}

export function assertOrgActive(orgId: number): Organization {
  const org = getOrganization(orgId);
  if (!org || org.status !== 'active') {
    throw new HttpError(403, 'ORG_INACTIVE', 'This clinic organization is not active');
  }
  return org;
}

export function slugifyClinic(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'clinic';
}

export function uniqueOrgSlug(preferred: string): string {
  let slug = slugifyClinic(preferred);
  let n = 0;
  for (;;) {
    const candidate = n === 0 ? slug : `${slug}-${n}`;
    const exists = getDb().prepare('SELECT 1 FROM organizations WHERE slug = ?').get(candidate);
    if (!exists) return candidate;
    n += 1;
    if (n > 1000) throw new HttpError(500, 'SLUG', 'Could not allocate a clinic slug');
  }
}

export function createOrganization(input: {
  name: string;
  slug?: string;
  country?: string;
  plan?: OrgPlan;
}): { orgId: number; settingsId: number; branchId: number } {
  const now = new Date().toISOString();
  const slug = uniqueOrgSlug(input.slug || input.name);
  // Caller may already be inside a better-sqlite3 transaction; do not nest another.
  const orgInfo = getDb()
    .prepare(
      `INSERT INTO organizations (
         name, slug, country, plan, status, data_retention_days, pdpl_notice_version, compliance_mode, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', 2555, 'eg-pdpl-2026.1', 'egypt_pdpl_ready', ?, ?)`,
    )
    .run(input.name, slug, input.country || 'EG', input.plan || 'pilot', now, now);
  const orgId = Number(orgInfo.lastInsertRowid);

  const branchInfo = getDb()
    .prepare(
      `INSERT INTO branches (name, address, phone, email, timezone, is_active, created_at, org_id)
       VALUES ('Main Clinic', '', '', '', 'Africa/Cairo', 1, ?, ?)`,
    )
    .run(now, orgId);

  const settingsInfo = getDb()
    .prepare(
      `INSERT INTO settings (
         org_id, business_name, public_slug, address, phone, email, currency, language, is_rtl, timezone,
         features_json, booking_rules_json, telegram_enabled, telegram_bot_username, telegram_reminder_hours,
         whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_test_recipient, whatsapp_last_status,
         whatsapp_reminders_enabled, consent_version, updated_at
       ) VALUES (
         ?, ?, ?, '', '', '', 'EGP', 'ar', 1, 'Africa/Cairo',
         '{"waitlistEnabled":true,"telegramNotifications":false,"publicBookingEnabled":true,"whatsappReminders":false}',
         '{"minNoticeMinutes":60,"maxDaysAhead":90,"cancelWindowHours":24,"slotIntervalMinutes":30}',
         0, '', 24, '', '', '', '', 0, 'eg-pdpl-2026.1', ?
       )`,
    )
    .run(orgId, input.name, slug, now);

  return {
    orgId,
    settingsId: Number(settingsInfo.lastInsertRowid),
    branchId: Number(branchInfo.lastInsertRowid),
  };
}
