import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import {
  clearFailedLogin,
  clearSessionCookie,
  createSession,
  findUserByEmail,
  findUserById,
  hashPassword,
  isLocked,
  mapUser,
  publicUser,
  recordFailedLogin,
  requireAuth,
  requireRoles,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
  verifyPassword,
  type Role,
} from '../auth.js';
import { getDb } from '../db.js';
import { asyncHandler, HttpError, validate } from '../http.js';

const passwordSchema = z
  .string()
  .min(10)
  .max(200)
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/[0-9]/, 'Password must include a number');

const emailSchema = z.string().trim().email().max(200).transform((value) => value.toLowerCase());

const skipLimit = () => process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skip: skipLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Try again later.' } },
});

const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  skip: skipLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Try again later.' } },
});

const setupBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  businessName: z.string().trim().min(2).max(160),
});

const loginBody = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const changeBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

const userBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['owner', 'receptionist', 'doctor']),
  branchId: z.string().regex(/^\d+$/).nullable().optional(),
  doctorId: z.string().regex(/^\d+$/).nullable().optional(),
});

const userPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['owner', 'receptionist', 'doctor']).optional(),
  isActive: z.boolean().optional(),
  branchId: z.string().regex(/^\d+$/).nullable().optional(),
  doctorId: z.string().regex(/^\d+$/).nullable().optional(),
});

function userCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  return row.c;
}

function activeOwners(exceptId = -1): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND is_active = 1 AND id != ?`)
    .get(exceptId) as { c: number };
  return row.c;
}

export const authRouter = Router();

authRouter.get('/setup/status', (_req, res) => {
  res.json({ needsSetup: userCount() === 0 });
});

authRouter.post(
  '/setup',
  setupLimiter,
  validate({ body: setupBody }),
  asyncHandler(async (req, res) => {
    if (userCount() > 0) throw new HttpError(409, 'SETUP_CLOSED', 'Setup is already complete');
    const body = req.body as z.infer<typeof setupBody>;
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(body.password);
    const create = getDb().transaction(() => {
      const info = getDb()
        .prepare(
          `INSERT INTO users (email, password_hash, name, role, is_active, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, 'owner', 1, 0, ?, ?)`,
        )
        .run(body.email, passwordHash, body.name, now, now);
      getDb()
        .prepare(`UPDATE settings SET business_name = ?, updated_at = ? WHERE id = 1`)
        .run(body.businessName, now);
      return Number(info.lastInsertRowid);
    });
    const userId = create();
    const row = findUserByEmail(body.email)!;
    writeAudit({ id: userId, name: body.name }, 'setup', 'Clinic owner account created');
    const session = createSession(userId);
    setSessionCookie(res, session.token);
    res.status(201).json({ user: publicUser(mapUser(row)) });
  }),
);

authRouter.post(
  '/auth/login',
  loginLimiter,
  validate({ body: loginBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof loginBody>;
    const user = findUserByEmail(body.email);
    const generic = new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (!user || user.is_active !== 1 || isLocked(user)) {
      if (user && !isLocked(user)) recordFailedLogin(user);
      writeAudit(null, 'login_failed', 'Sign-in attempt failed');
      throw generic;
    }
    const ok = await verifyPassword(user.password_hash, body.password);
    if (!ok) {
      recordFailedLogin(user);
      writeAudit(null, 'login_failed', 'Sign-in attempt failed');
      throw generic;
    }
    clearFailedLogin(user.id);
    const session = createSession(user.id);
    setSessionCookie(res, session.token);
    writeAudit({ id: user.id, name: user.name }, 'login', 'Staff signed in');
    const mapped = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      branchId: user.branch_id,
      doctorId: user.doctor_id,
      isActive: true,
      mustChangePassword: user.must_change_password === 1,
    };
    res.json({ user: publicUser(mapped) });
  }),
);

authRouter.post('/auth/logout', requireAuth, (req, res) => {
  if (req.sessionId) revokeSession(req.sessionId);
  writeAudit(req.user!, 'logout', 'Staff signed out');
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.post('/auth/logout-all', requireAuth, (req, res) => {
  revokeAllSessions(req.user!.id);
  writeAudit(req.user!, 'logout_all', 'All sessions revoked');
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

authRouter.post(
  '/auth/change-password',
  requireAuth,
  validate({ body: changeBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof changeBody>;
    const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    const ok = await verifyPassword(row.password_hash, body.currentPassword);
    if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    const nextHash = await hashPassword(body.newPassword);
    const now = new Date().toISOString();
    getDb()
      .prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`)
      .run(nextHash, now, req.user!.id);
    writeAudit(req.user!, 'password_changed', 'Password updated');
    req.user!.mustChangePassword = false;
    res.json({ user: publicUser(req.user!) });
  }),
);

authRouter.get('/users', requireAuth, requireRoles('owner'), (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, email, name, role, branch_id, doctor_id, is_active, must_change_password
       FROM users ORDER BY id`,
    )
    .all() as Array<{
    id: number;
    email: string;
    name: string;
    role: Role;
    branch_id: number | null;
    doctor_id: number | null;
    is_active: number;
    must_change_password: number;
  }>;
  res.json(
    rows.map((row) =>
      publicUser({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        branchId: row.branch_id,
        doctorId: row.doctor_id,
        isActive: row.is_active === 1,
        mustChangePassword: row.must_change_password === 1,
      }),
    ),
  );
});

authRouter.post(
  '/users',
  requireAuth,
  requireRoles('owner'),
  validate({ body: userBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof userBody>;
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(body.password);
    try {
      const info = getDb()
        .prepare(
          `INSERT INTO users (email, password_hash, name, role, branch_id, doctor_id, is_active, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        )
        .run(
          body.email,
          passwordHash,
          body.name,
          body.role,
          body.branchId ? Number(body.branchId) : null,
          body.doctorId ? Number(body.doctorId) : null,
          now,
          now,
        );
      writeAudit(req.user!, 'user_created', `Created staff account role ${body.role}`);
      const created = findUserByEmail(body.email)!;
      res.status(201).json({
        user: publicUser({
          id: Number(info.lastInsertRowid),
          email: created.email,
          name: created.name,
          role: created.role,
          branchId: created.branch_id,
          doctorId: created.doctor_id,
          isActive: true,
          mustChangePassword: true,
        }),
      });
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, 'CONFLICT', 'An account with that email already exists');
      throw error;
    }
  }),
);

authRouter.patch(
  '/users/:id',
  requireAuth,
  requireRoles('owner'),
  validate({
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    body: userPatch,
  }),
  (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof userPatch>;
    const existing = findUserById(id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'User not found');
    const nextRole = body.role ?? existing.role;
    const nextActive = body.isActive ?? existing.is_active === 1;
    if (existing.role === 'owner' && (nextRole !== 'owner' || !nextActive) && activeOwners(id) === 0) {
      throw new HttpError(409, 'CONFLICT', 'The clinic must keep one active owner');
    }
    const branchId = body.branchId === undefined ? existing.branch_id : body.branchId ? Number(body.branchId) : null;
    const doctorId = body.doctorId === undefined ? existing.doctor_id : body.doctorId ? Number(body.doctorId) : null;
    getDb()
      .prepare(
        `UPDATE users SET name = ?, role = ?, is_active = ?, branch_id = ?, doctor_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(body.name ?? existing.name, nextRole, nextActive ? 1 : 0, branchId, doctorId, new Date().toISOString(), id);
    if (!nextActive) revokeAllSessions(id);
    writeAudit(req.user!, 'user_updated', `Updated staff account ${id}`);
    res.json({ user: publicUser(mapUser(findUserById(id)!)) });
  },
);

authRouter.post(
  '/users/:id/reset-password',
  requireAuth,
  requireRoles('owner'),
  validate({
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    body: z.object({ password: passwordSchema }),
  }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'User not found');
    const body = req.body as { password: string };
    const passwordHash = await hashPassword(body.password);
    getDb()
      .prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`)
      .run(passwordHash, new Date().toISOString(), id);
    revokeAllSessions(id);
    writeAudit(req.user!, 'password_reset', `Reset password for staff account ${id}`);
    res.status(204).end();
  }),
);
