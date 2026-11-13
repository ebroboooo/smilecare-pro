import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import {
  createSession,
  hashPassword,
  mapUser,
  publicUser,
  setSessionCookie,
  findUserByEmail,
} from '../auth.js';
import { getDb } from '../db.js';
import { asyncHandler, HttpError, validate } from '../http.js';
import { createOrganization, getOrganization, publicOrgId } from '../org.js';

const skipLimit = () => process.env.NODE_ENV === 'test';

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  skip: skipLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Try again later.' } },
});

const passwordSchema = z
  .string()
  .min(10)
  .max(200)
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/[0-9]/, 'Password must include a number');

const signupBody = z.object({
  clinicName: z.string().trim().min(2).max(160),
  ownerName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).transform((value) => value.toLowerCase()),
  password: passwordSchema,
  country: z.string().trim().length(2).default('EG'),
});

function requirePlatformKey(req: { headers: Record<string, unknown> }): void {
  const expected = process.env.PLATFORM_SETUP_KEY || '';
  if (!expected || expected.length < 16) {
    throw new HttpError(503, 'SAAS_DISABLED', 'Multi-clinic signup is not enabled on this server');
  }
  const provided = String(req.headers['x-platform-key'] || '');
  if (provided !== expected) {
    throw new HttpError(401, 'PLATFORM_KEY', 'Invalid platform key');
  }
}

export const platformRouter = Router();

platformRouter.get('/platform/status', (_req, res) => {
  const keyConfigured = Boolean(process.env.PLATFORM_SETUP_KEY && process.env.PLATFORM_SETUP_KEY.length >= 16);
  const orgCount = (getDb().prepare('SELECT COUNT(*) AS c FROM organizations').get() as { c: number }).c;
  res.json({
    saasSignupEnabled: keyConfigured,
    organizationCount: orgCount,
    compliance: {
      mode: 'egypt_pdpl_ready',
      certified: false,
      notice: 'SmileCare is built for Egypt PDPL-oriented controls. It is not a government or third-party certification.',
    },
  });
});

platformRouter.post(
  '/platform/organizations',
  signupLimiter,
  validate({ body: signupBody }),
  asyncHandler(async (req, res) => {
    requirePlatformKey(req);
    const body = req.body as z.infer<typeof signupBody>;
    if (findUserByEmail(body.email)) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'That email is already registered');
    }
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(body.password);
    let created: { orgId: number; branchId: number; userId: number };
    try {
      created = getDb().transaction(() => {
        const org = createOrganization({
          name: body.clinicName,
          country: body.country.toUpperCase(),
          plan: 'pilot',
        });
        const userInfo = getDb()
          .prepare(
            `INSERT INTO users (
               email, password_hash, name, role, org_id, is_active, must_change_password, created_at, updated_at
             ) VALUES (?, ?, ?, 'owner', ?, 1, 0, ?, ?)`,
          )
          .run(body.email, passwordHash, body.ownerName, org.orgId, now, now);
        return { orgId: org.orgId, branchId: org.branchId, userId: Number(userInfo.lastInsertRowid) };
      })();
    } catch (error) {
      throw new HttpError(500, 'ORG_CREATE', error instanceof Error ? error.message : 'Could not create organization');
    }

    const org = getOrganization(created.orgId)!;
    writeAudit(
      { id: created.userId, name: body.ownerName, orgId: created.orgId },
      'org_created',
      `Organization ${org.slug} created`,
    );
    const session = createSession(created.userId);
    setSessionCookie(res, session.token);
    const row = findUserByEmail(body.email)!;
    res.status(201).json({
      organization: {
        id: publicOrgId(org.id),
        name: org.name,
        slug: org.slug,
        country: org.country,
        plan: org.plan,
        complianceMode: org.complianceMode,
        certified: false,
      },
      user: publicUser(mapUser(row)),
    });
  }),
);
