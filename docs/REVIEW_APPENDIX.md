# SmileCare Pro — Review Appendix

Generated 2026-11-12. Secrets redacted where present. Full source excerpts for independent review.

---

## `server/src/index.ts`

```
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDatabase, migrate, openDatabase } from './db.js';
import { logger } from './logger.js';
import { refreshTelegramBot, startReminderLoop, stopTelegram } from './telegram.js';

const config = loadConfig();
const database = openDatabase(config.databasePath);
migrate(database);

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'SmileCare API listening');
  void refreshTelegramBot();
  startReminderLoop();
});

function shutdown() {
  server.close(() => {
    void stopTelegram().finally(() => {
      closeDatabase();
      process.exit(0);
    });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

---

## `server/src/app.ts`

```
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { loadConfig } from './config.js';
import { errorHandler, requireCsrf } from './http.js';
import { loadSession } from './auth.js';
import { logger } from './logger.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { clinicRouter } from './routes/resources.js';
import { dentalRouter } from './routes/dental.js';
import { privacyRouter } from './routes/privacy.js';

export function createApp() {
  const config = loadConfig();
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: config.clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (config.isTest) return;
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });
  app.use(requireCsrf);
  app.use(loadSession);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api', clinicRouter);
  app.use('/api', dentalRouter);
  app.use('/api', privacyRouter);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
```

---

## `server/src/config.ts`

```
import fs from 'node:fs';
import path from 'node:path';

export const DEV_SESSION_SECRET=REDACTED';
export const CLINIC_ID = 'clinic';

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  isTest: boolean;
  sessionSecret: string;
  port: number;
  clientOrigin: string;
  databasePath: string;
  trustProxy: boolean;
  logLevel: string;
}

export function assertProductionSecret(nodeEnv: string, secret: string | undefined): void {
  if (nodeEnv !== 'production') return;
  if (!secret || secret === DEV_SESSION_SECRET || secret.length < 32) {
    throw new Error(
      'Refusing to start: SESSION_SECRET must be a unique value of at least 32 characters when NODE_ENV=production.',
    );
  }
}

function loadEnvFile(): void {
  for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'server', '.env')]) {
    if (!fs.existsSync(candidate)) continue;
    for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

export function loadConfig(): AppConfig {
  loadEnvFile();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const fromEnv = process.env.SESSION_SECRET;
  assertProductionSecret(nodeEnv, fromEnv);
  const sessionSecret = fromEnv && fromEnv.length > 0 ? fromEnv : DEV_SESSION_SECRET;
  const port = Number(process.env.PORT || 3001);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('PORT must be a positive number');
  }
  return {
    nodeEnv,
    isProd: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    sessionSecret,
    port,
    clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    databasePath: process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'smilecare.db'),
    trustProxy: process.env.TRUST_PROXY === '1',
    logLevel: process.env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
  };
}
```

---

## `server/src/auth.ts`

```
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { NextFunction, Request, Response } from 'express';
import { DateTime } from 'luxon';
import { getDb } from './db.js';
import { HttpError } from './http.js';

export type Role = 'owner' | 'receptionist' | 'doctor';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  branchId: number | null;
  doctorId: number | null;
  isActive: boolean;
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: number;
    }
  }
}

export const SESSION_COOKIE = 'sid';
const SESSION_HOURS = 12;
const LOCKOUT_FAILS = 5;
const LOCKOUT_MINUTES = 15;

const hashOptions = {
  type: argon2.argon2id,
  memoryCost: process.env.NODE_ENV === 'test' ? 8192 : 19456,
  timeCost: process.env.NODE_ENV === 'test' ? 1 : 2,
  parallelism: 1,
};

let dummyHash: string | null = null;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, hashOptions);
}

async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
  return dummyHash;
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  const target = hash ?? (await getDummyHash());
  try {
    const ok = await argon2.verify(target, password);
    return hash ? ok : false;
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newBookingRef(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) out += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length];
  return out;
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
  branch_id: number | null;
  doctor_id: number | null;
  is_active: number;
  must_change_password: number;
  failed_login_count: number;
  locked_until: string | null;
}

export function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    branchId: row.branch_id,
    doctorId: row.doctor_id,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
  };
}

export function publicUser(user: AuthUser) {
  return {
    id: String(user.id),
    orgId: 'clinic',
    email: user.email,
    role: user.role,
    name: user.name,
    branchId: user.branchId == null ? null : String(user.branchId),
    doctorId: user.doctorId == null ? null : String(user.doctorId),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = newToken();
  const now = DateTime.utc();
  const expiresAt = now.plus({ hours: SESSION_HOURS }).toISO()!;
  getDb()
    .prepare(
      `INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(userId, sha256(token), expiresAt, now.toISO());
  return { token, expiresAt };
}

export function sessionCookieOptions(maxAgeMs: number) {
  const prod = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: prod,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(SESSION_HOURS * 60 * 60 * 1000));
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

export function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== 'string') {
    next();
    return;
  }
  const row = getDb()
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
              u.id, u.email, u.password_hash, u.name, u.role, u.branch_id, u.doctor_id,
              u.is_active, u.must_change_password, u.failed_login_count, u.locked_until
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as (UserRow & { session_id: number; expires_at: string; revoked_at: string | null }) | undefined;

  if (!row || row.revoked_at || row.is_active !== 1) {
    next();
    return;
  }
  if (row.expires_at < new Date().toISOString()) {
    next();
    return;
  }
  req.user = mapUser(row);
  req.sessionId = row.session_id;
  next();
}

const PASSWORD_CHANGE_ALLOW = new Set([
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/logout-all',
]);

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in required'));
    return;
  }
  const pathOnly = (req.originalUrl || req.path).split('?')[0] || req.path;
  if (req.user.mustChangePassword && !PASSWORD_CHANGE_ALLOW.has(pathOnly)) {
    next(new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password before continuing'));
    return;
  }
  next();
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource'));
      return;
    }
    next();
  };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function recordFailedLogin(user: UserRow | undefined) {
  if (!user) return;
  const fails = user.failed_login_count + 1;
  const lockedUntil = fails >= LOCKOUT_FAILS ? DateTime.utc().plus({ minutes: LOCKOUT_MINUTES }).toISO() : null;
  getDb()
    .prepare('UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?')
    .run(fails, lockedUntil, new Date().toISOString(), user.id);
}

export function clearFailedLogin(userId: number) {
  getDb()
    .prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), userId);
}

export function isLocked(user: UserRow): boolean {
  return Boolean(user.locked_until && user.locked_until > new Date().toISOString());
}

export function revokeSession(sessionId: number) {
  getDb().prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(new Date().toISOString(), sessionId);
}

export function revokeAllSessions(userId: number) {
  getDb().prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(new Date().toISOString(), userId);
}
```

---

## `server/src/http.ts`

```
import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function validate(schema: { body?: ZodType; query?: ZodType; params?: ZodType }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query) as Request['query'];
      if (schema.params) req.params = schema.params.parse(req.params) as Request['params'];
      next();
    } catch (error) {
      next(error);
    }
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    next(new HttpError(403, 'CSRF', 'Missing required request header'));
    return;
  }
  next();
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Invalid request',
        details: err.flatten(),
      },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const config = loadConfig();
  logger.error({ err }, 'request failed');
  const message = config.isProd ? 'Internal server error' : err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: { code: 'INTERNAL', message } });
}

export function parseId(value: string, label = 'Record'): number {
  if (!/^\d+$/.test(value)) throw new HttpError(404, 'NOT_FOUND', `${label} not found`);
  return Number(value);
}
```

---

## `server/src/routes/auth.ts`

```
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
```

---

## `server/src/availability.ts`

```
import { DateTime } from 'luxon';
import { getDb } from './db.js';
import { HttpError } from './http.js';
import { getClinicZone, localToUtc, minutesOf, timeOf } from './time.js';

export interface BookingRules {
  minNoticeMinutes: number;
  maxDaysAhead: number;
  cancelWindowHours: number;
  slotIntervalMinutes: number;
}

interface ScheduleRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_working: number;
  breaks_json: string;
}

export function readBookingRules(): BookingRules {
  const row = getDb().prepare('SELECT booking_rules_json FROM settings WHERE id = 1').get() as { booking_rules_json: string };
  return JSON.parse(row.booking_rules_json) as BookingRules;
}

export function clinicWeekday(date: string, zone: string): number {
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) throw new HttpError(400, 'VALIDATION', 'Invalid date');
  return dt.weekday % 7;
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart;
}

export function slotsForDoctor(input: {
  doctorId: number;
  branchId: number;
  date: string;
  duration: number;
  excludeId?: number;
  enforceNotice: boolean;
}): string[] {
  const zone = getClinicZone();
  const rules = readBookingRules();
  const holiday = getDb()
    .prepare(`SELECT id FROM clinic_holidays WHERE branch_id = ? AND date = ? AND prevent_bookings = 1`)
    .get(input.branchId, input.date);
  if (holiday) return [];

  const schedule = getDb()
    .prepare(`SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?`)
    .get(input.doctorId, clinicWeekday(input.date, zone)) as ScheduleRow | undefined;
  if (!schedule || schedule.is_working !== 1) return [];

  const breaks = JSON.parse(schedule.breaks_json) as Array<{ start: string; end: string }>;
  const workStart = minutesOf(schedule.start_time);
  const workEnd = minutesOf(schedule.end_time);
  const interval = rules.slotIntervalMinutes || 30;
  const nowLimit = DateTime.utc().plus({ minutes: input.enforceNotice ? rules.minNoticeMinutes : 0 });
  const horizon = DateTime.now().setZone(zone).startOf('day').plus({ days: rules.maxDaysAhead });
  if (input.enforceNotice && input.date > horizon.toFormat('yyyy-MM-dd')) return [];

  const dayStart = localToUtc(input.date, '00:00', zone).toISO()!;
  const dayEnd = localToUtc(input.date, '00:00', zone).plus({ days: 1 }).toISO()!;
  const timeOff = getDb()
    .prepare(
      `SELECT starts_at, ends_at FROM doctor_time_off
       WHERE doctor_id = ? AND starts_at < ? AND ends_at > ?`,
    )
    .all(input.doctorId, dayEnd, dayStart) as Array<{ starts_at: string; ends_at: string }>;
  const appointments = getDb()
    .prepare(
      `SELECT id, starts_at, ends_at FROM appointments
       WHERE doctor_id = ? AND status != 'Cancelled' AND starts_at < ? AND ends_at > ?`,
    )
    .all(input.doctorId, dayEnd, dayStart) as Array<{ id: number; starts_at: string; ends_at: string }>;

  const slots: string[] = [];
  for (let cursor = workStart; cursor + input.duration <= workEnd; cursor += interval) {
    const label = timeOf(cursor);
    const slotEnd = cursor + input.duration;
    if (breaks.some((brk) => overlaps(cursor, slotEnd, minutesOf(brk.start), minutesOf(brk.end)))) continue;
    const start = localToUtc(input.date, label, zone);
    const end = start.plus({ minutes: input.duration });
    if (input.enforceNotice && start < nowLimit) continue;
    if (!input.enforceNotice && start < DateTime.utc().minus({ days: 1 })) {
      // Staff can record recent visits, not arbitrary history.
    }
    const startIso = start.toISO()!;
    const endIso = end.toISO()!;
    if (timeOff.some((row) => row.starts_at < endIso && row.ends_at > startIso)) continue;
    if (appointments.some((row) => row.id !== input.excludeId && row.starts_at < endIso && row.ends_at > startIso)) continue;
    slots.push(label);
  }
  return slots;
}

export function assertSlotAvailable(input: {
  doctorId: number;
  branchId: number;
  date: string;
  time: string;
  duration: number;
  excludeId?: number;
  enforceNotice: boolean;
}) {
  const slots = slotsForDoctor(input);
  if (!slots.includes(input.time)) {
    throw new HttpError(409, 'UNAVAILABLE', 'That time is not available');
  }
}

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed: Record<string, string[]> = {
    Pending: ['Confirmed', 'Cancelled'],
    Confirmed: ['Completed', 'Cancelled', 'NoShow'],
    Completed: [],
    Cancelled: [],
    NoShow: [],
  };
  return (allowed[from] ?? []).includes(to);
}
```

---

## `server/src/routes/public.ts`

```
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { assertSlotAvailable, readBookingRules, slotsForDoctor } from '../availability.js';
import { newBookingRef } from '../auth.js';
import { queueAppointmentAlert } from '../telegram.js';
import { getDb } from '../db.js';
import { HttpError } from '../http.js';
import { getClinicZone, localToUtc, utcToLocal } from '../time.js';

const skip = () => process.env.NODE_ENV === 'test';

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  skip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' } },
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function newManageToken(): string {
  return randomBytes(24).toString('hex');
}

const bookBody = z.object({
  companyWebsite: z.string().max(200).optional().default(''),
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(200),
  branchId: z.string().regex(/^\d+$/),
  doctorId: z.string().regex(/^\d+$/),
  serviceId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().max(2000).optional().default(''),
  consent: z.literal(true),
});

const leadBody = z.object({
  companyWebsite: z.string().max(200).optional().default(''),
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(200),
  message: z.string().max(2000).optional().default(''),
  branchId: z.string().regex(/^\d+$/).optional(),
});

export const publicRouter = Router();
publicRouter.use(publicLimiter);

publicRouter.get('/clinic', (_req, res) => {
  const settings = getDb().prepare(
    `SELECT business_name, public_slug, address, phone, email, currency, language, is_rtl, timezone, features_json FROM settings WHERE id = 1`,
  ).get() as {
    business_name: string;
    public_slug: string;
    address: string;
    phone: string;
    email: string;
    currency: string;
    language: string;
    is_rtl: number;
    timezone: string;
    features_json: string;
  };
  const features = JSON.parse(settings.features_json) as { publicBookingEnabled?: boolean };
  const branches = getDb().prepare(`SELECT id, name, address, phone, timezone FROM branches WHERE is_active = 1 ORDER BY id`).all();
  res.json({
    businessName: settings.business_name,
    publicSlug: settings.public_slug,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    currency: settings.currency,
    language: settings.language,
    isRtl: settings.is_rtl === 1,
    timezone: settings.timezone,
    publicBookingEnabled: features.publicBookingEnabled !== false,
    branches,
  });
});

publicRouter.get('/services', (req, res) => {
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : '';
  const rows = getDb().prepare(
    `SELECT s.id, s.name, s.description, s.duration, s.price, s.category
     FROM services s
     JOIN service_branches sb ON sb.service_id = s.id
     WHERE s.deleted_at IS NULL AND s.status = 'Active' AND (? = '' OR sb.branch_id = ?)
     GROUP BY s.id
     ORDER BY s.name`,
  ).all(branchId, branchId ? Number(branchId) : 0);
  res.json(rows);
});

publicRouter.get('/doctors', (req, res) => {
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : '';
  const rows = getDb().prepare(
    `SELECT d.id, d.name, d.role
     FROM doctors d
     JOIN doctor_branches dbn ON dbn.doctor_id = d.id
     WHERE d.deleted_at IS NULL AND d.status = 'Active' AND (? = '' OR dbn.branch_id = ?)
     GROUP BY d.id
     ORDER BY d.name`,
  ).all(branchId, branchId ? Number(branchId) : 0);
  res.json(rows);
});

publicRouter.get('/slots', (req, res) => {
  const doctorId = Number(req.query.doctorId);
  const serviceId = Number(req.query.serviceId);
  const branchId = Number(req.query.branchId);
  const date = String(req.query.date || '');
  if (!doctorId || !serviceId || !branchId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, 'VALIDATION', 'doctorId, serviceId, branchId, and date are required');
  }
  const service = getDb().prepare(`SELECT duration FROM services WHERE id = ? AND deleted_at IS NULL AND status = 'Active'`).get(serviceId) as { duration: number } | undefined;
  if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
  res.json({ slots: slotsForDoctor({ doctorId, branchId, date, duration: service.duration, enforceNotice: true }) });
});

publicRouter.post('/bookings', (req, res) => {
  const body = bookBody.parse(req.body);
  if (body.companyWebsite.trim()) {
    res.status(201).json({ reference: 'RECEIVED', manageToken: '' });
    return;
  }
  const features = JSON.parse((getDb().prepare('SELECT features_json FROM settings WHERE id = 1').get() as { features_json: string }).features_json) as { publicBookingEnabled?: boolean };
  if (features.publicBookingEnabled === false) throw new HttpError(403, 'CLOSED', 'Online booking is turned off');
  const service = getDb().prepare(`SELECT duration, price, name FROM services WHERE id = ? AND deleted_at IS NULL`).get(Number(body.serviceId)) as
    | { duration: number; price: number; name: string }
    | undefined;
  if (!service) throw new HttpError(400, 'VALIDATION', 'Choose a service');
  const token = newManageToken();
  const now = new Date().toISOString();
  const create = getDb().transaction(() => {
    assertSlotAvailable({
      doctorId: Number(body.doctorId),
      branchId: Number(body.branchId),
      date: body.date,
      time: body.time,
      duration: service.duration,
      enforceNotice: true,
    });
    const existingPatient = getDb().prepare(`SELECT id FROM patients WHERE phone = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`).get(body.phone) as { id: number } | undefined;
    let patientId = existingPatient?.id;
    if (!patientId) {
      const info = getDb()
        .prepare(`INSERT INTO patients (full_name, phone, email, notes, tags, status, total_spending, created_at) VALUES (?, ?, ?, '', '["Portal"]', 'Active', 0, ?)`)
        .run(body.fullName, body.phone, body.email, now);
      patientId = Number(info.lastInsertRowid);
    }
    const start = localToUtc(body.date, body.time, getClinicZone());
    const reference = newBookingRef();
    const info = getDb()
      .prepare(
        `INSERT INTO appointments (
          branch_id, patient_id, service_id, doctor_id, starts_at, ends_at, duration_min, notes, status,
          payment_status, payment_method, payment_amount, booking_ref, manage_token_hash, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Unpaid', 'Cash', ?, ?, ?, 'public', ?, ?)`,
      )
      .run(
        Number(body.branchId),
        patientId,
        Number(body.serviceId),
        Number(body.doctorId),
        start.toISO(),
        start.plus({ minutes: service.duration }).toISO(),
        service.duration,
        body.notes,
        service.price,
        reference,
        sha256(token),
        now,
        now,
      );
    getDb()
      .prepare(`INSERT INTO notifications (branch_id, title, message, read, type, created_at) VALUES (?, ?, ?, 0, 'BookingCreated', ?)`)
      .run(Number(body.branchId), 'New booking request', `${body.fullName} requested ${service.name}.`, now);
    return { id: Number(info.lastInsertRowid), reference };
  });
  const created = create.immediate();
  queueAppointmentAlert(created.id);
  res.status(201).json({ reference: created.reference, manageToken: token });
});

function loadByToken(reference: string, token: string) {
  const row = getDb().prepare('SELECT * FROM appointments WHERE booking_ref = ?').get(reference) as {
    id: number;
    manage_token_hash: string | null;
    starts_at: string;
    status: string;
    service_id: number;
    doctor_id: number;
    duration_min: number;
  } | undefined;
  if (!row || !row.manage_token_hash || row.manage_token_hash !== sha256(token)) {
    throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
  }
  return row;
}

publicRouter.get('/bookings/:ref', (req, res) => {
  const token = String(req.query.token || '');
  const row = loadByToken(req.params.ref, token);
  const service = getDb().prepare('SELECT name FROM services WHERE id = ?').get(row.service_id) as { name: string };
  const doctor = getDb().prepare('SELECT name FROM doctors WHERE id = ?').get(row.doctor_id) as { name: string };
  const local = utcToLocal(row.starts_at, getClinicZone());
  res.json({ reference: req.params.ref, status: row.status, date: local.date, time: local.time, serviceName: service.name, doctorName: doctor.name });
});

publicRouter.post('/bookings/:ref/cancel', (req, res) => {
  const body = z.object({ token: z.string().min(10) }).parse(req.body);
  const row = loadByToken(req.params.ref, body.token);
  if (row.status === 'Cancelled') {
    res.json({ status: 'Cancelled' });
    return;
  }
  if (row.status !== 'Pending' && row.status !== 'Confirmed') {
    throw new HttpError(409, 'INVALID_TRANSITION', 'This booking can no longer be cancelled online');
  }
  const rules = readBookingRules();
  const starts = DateTime.fromISO(row.starts_at, { zone: 'utc' });
  if (starts < DateTime.utc().plus({ hours: rules.cancelWindowHours })) {
    throw new HttpError(409, 'TOO_LATE', 'This booking is inside the cancellation window. Please call the clinic.');
  }
  getDb().prepare(`UPDATE appointments SET status = 'Cancelled', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
  res.json({ status: 'Cancelled' });
});

publicRouter.post('/bookings/:ref/reschedule', (req, res) => {
  const body = z.object({
    token: z.string().min(10),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  }).parse(req.body);
  const row = loadByToken(req.params.ref, body.token);
  if (row.status !== 'Pending' && row.status !== 'Confirmed') {
    throw new HttpError(409, 'INVALID_TRANSITION', 'This booking can no longer be rescheduled online');
  }
  const full = getDb().prepare('SELECT branch_id, doctor_id FROM appointments WHERE id = ?').get(row.id) as { branch_id: number; doctor_id: number };
  const start = localToUtc(body.date, body.time, getClinicZone());
  const apply = getDb().transaction(() => {
    assertSlotAvailable({
      doctorId: full.doctor_id,
      branchId: full.branch_id,
      date: body.date,
      time: body.time,
      duration: row.duration_min,
      excludeId: row.id,
      enforceNotice: true,
    });
    getDb()
      .prepare(`UPDATE appointments SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?`)
      .run(start.toISO(), start.plus({ minutes: row.duration_min }).toISO(), new Date().toISOString(), row.id);
  });
  apply.immediate();
  res.json({ reference: req.params.ref, date: body.date, time: body.time, status: row.status });
});

publicRouter.post('/leads', (req, res) => {
  const body = leadBody.parse(req.body);
  if (body.companyWebsite.trim()) {
    res.status(201).json({ ok: true });
    return;
  }
  const branch = body.branchId
    ? Number(body.branchId)
    : (getDb().prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get() as { id: number }).id;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO leads (branch_id, full_name, phone, email, source, status, value, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Website', 'New', 0, ?, ?, ?)`,
    )
    .run(branch, body.fullName, body.phone, body.email, body.message, now, now);
  getDb()
    .prepare(`INSERT INTO notifications (branch_id, title, message, read, type, created_at) VALUES (?, 'New inquiry', ?, 0, 'LeadCreated', ?)`)
    .run(branch, `${body.fullName} sent a message from the website.`, now);
  res.status(201).json({ ok: true });
});
```

---

## `server/migrations/001_core.sql`

```
-- Core clinic schema. Tables are ordered so foreign keys resolve.

CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE doctors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Doctor',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'receptionist', 'doctor')),
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  total_spending REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  anonymized_at TEXT
);

CREATE TABLE doctor_branches (
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, branch_id)
);

CREATE TABLE doctor_schedules (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_working INTEGER NOT NULL DEFAULT 1,
  breaks_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (doctor_id, day_of_week)
);

CREATE TABLE doctor_time_off (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE clinic_holidays (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  prevent_bookings INTEGER NOT NULL DEFAULT 1,
  UNIQUE (branch_id, date)
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  deleted_at TEXT
);

CREATE TABLE service_branches (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, branch_id)
);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow')),
  payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Authorized', 'Paid', 'Refunded')),
  payment_method TEXT,
  payment_amount REAL,
  payment_txn TEXT,
  paid_at TEXT,
  booking_ref TEXT NOT NULL UNIQUE,
  manage_token_hash TEXT,
  source TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE waitlist (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  doctor_id INTEGER REFERENCES doctors(id),
  date TEXT NOT NULL,
  time_pref TEXT NOT NULL CHECK (time_pref IN ('Morning', 'Afternoon', 'Evening', 'Any')),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting', 'Promoted', 'Cancelled')),
  created_at TEXT NOT NULL
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Website',
  status TEXT NOT NULL CHECK (status IN ('New', 'Contacted', 'Interested', 'Converted', 'Lost')),
  value REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL,
  public_slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EGP',
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar')),
  is_rtl INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  features_json TEXT NOT NULL,
  booking_rules_json TEXT NOT NULL,
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  telegram_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (appointment_id, kind)
);

CREATE TABLE telegram_links (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  link_token_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_patients_name ON patients(full_name);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_appointments_doctor_time ON appointments(doctor_id, starts_at, ends_at);
CREATE INDEX idx_appointments_branch_time ON appointments(branch_id, starts_at);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

INSERT INTO settings (
  id, business_name, public_slug, address, phone, email, currency, language, is_rtl, timezone,
  features_json, booking_rules_json, telegram_enabled, updated_at
) VALUES (
  1,
  'My Dental Clinic',
  'smilecare-clinic',
  '',
  '',
  '',
  'EGP',
  'en',
  0,
  'Africa/Cairo',
  '{"waitlistEnabled":true,"telegramNotifications":false,"publicBookingEnabled":true}',
  '{"minNoticeMinutes":60,"maxDaysAhead":90,"cancelWindowHours":24,"slotIntervalMinutes":30}',
  0,
  '1970-01-01T00:00:00.000Z'
);

INSERT INTO branches (name, address, phone, email, timezone, is_active, created_at)
VALUES ('Main Clinic', '', '', '', 'Africa/Cairo', 1, '1970-01-01T00:00:00.000Z');
```

---

## `server/migrations/002_dental.sql`

```
CREATE TABLE tooth_findings (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth TEXT NOT NULL CHECK (tooth GLOB '[1-4][1-8]'),
  condition TEXT NOT NULL CHECK (condition IN ('Sound', 'Caries', 'Filled', 'Missing', 'Crown', 'RootCanal')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (patient_id, tooth)
);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
  visited_on TEXT NOT NULL,
  complaint TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  treatment TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('Cash', 'Card')),
  note TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_visits_patient ON visits(patient_id, visited_on);
CREATE INDEX idx_payments_patient ON payments(patient_id, paid_at);
```

---

## `server/migrations/002_messaging.sql`

```
ALTER TABLE settings ADD COLUMN telegram_bot_username TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN telegram_reminder_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE settings ADD COLUMN whatsapp_phone_number_id TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN whatsapp_access_token TEXT;
ALTER TABLE settings ADD COLUMN whatsapp_business_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN whatsapp_test_recipient TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN whatsapp_last_status TEXT NOT NULL DEFAULT '';
```

---

## `server/src/telegram.ts`

```
import { createHash, randomBytes } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import { canTransition } from './availability.js';
import { getDb } from './db.js';
import { HttpError } from './http.js';
import { logger } from './logger.js';
import { getClinicZone, utcToLocal } from './time.js';

let bot: Bot | null = null;
let activeToken = '';
let reminderTimer: NodeJS.Timeout | undefined;

interface TelegramConfig {
  token: string;
  chatId: string;
  enabled: boolean;
  username: string;
  reminderHours: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readTelegramConfig(): TelegramConfig {
  const row = getDb().prepare(
    `SELECT telegram_bot_token, telegram_chat_id, telegram_enabled, telegram_bot_username, telegram_reminder_hours
     FROM settings WHERE id = 1`,
  ).get() as {
    telegram_bot_token=REDACTED
    telegram_chat_id: string | null;
    telegram_enabled: number;
    telegram_bot_username: string | null;
    telegram_reminder_hours: number | null;
  };
  const hours = Number(row.telegram_reminder_hours || 24);
  return {
    token: row.telegram_bot_token || '',
    chatId: row.telegram_chat_id || '',
    enabled: row.telegram_enabled === 1,
    username: (row.telegram_bot_username || '').replace(/^@/, ''),
    reminderHours: Number.isFinite(hours) ? Math.min(72, Math.max(1, hours)) : 24,
  };
}

export function claimReminder(appointmentId: number, kind: string, scheduledFor: string): boolean {
  const info = getDb()
    .prepare(`INSERT INTO reminders (appointment_id, kind, scheduled_for, status) VALUES (?, ?, ?, 'pending') ON CONFLICT(appointment_id, kind) DO NOTHING`)
    .run(appointmentId, kind, scheduledFor);
  return info.changes === 1;
}

function reminderStatus(appointmentId: number, kind: string): string | undefined {
  const row = getDb().prepare('SELECT status FROM reminders WHERE appointment_id = ? AND kind = ?').get(appointmentId, kind) as { status: string } | undefined;
  return row?.status;
}

function setReminderStatus(appointmentId: number, kind: string, status: string) {
  getDb().prepare(`UPDATE reminders SET status = ?, sent_at = ? WHERE appointment_id = ? AND kind = ?`).run(status, status === 'sent' ? new Date().toISOString() : null, appointmentId, kind);
}

async function stopBot() {
  const current = bot;
  bot = null;
  activeToken = '';
  if (current) {
    try {
      await current.stop();
    } catch {
      logger.warn('Telegram bot stop was ignored');
    }
  }
}

function attachHandlers(next: Bot) {
  next.command('start', async (ctx) => {
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!payload) {
      await ctx.reply('SmileCare will send appointment reminders in this chat after the clinic links it.');
      return;
    }
    const info = getDb()
      .prepare(`UPDATE telegram_links SET chat_id = ?, link_token_hash = NULL WHERE link_token_hash = ? AND chat_id = 'pending'`)
      .run(String(ctx.chat.id), sha256(payload));
    await ctx.reply(info.changes > 0 ? 'This chat is linked. Appointment reminders will arrive here.' : 'This link is no longer valid.');
  });

  next.on('callback_query:data', async (ctx) => {
    const match = /^appt:(confirm|cancel):(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const nextStatus = match[1] === 'confirm' ? 'Confirmed' : 'Cancelled';
    const id = Number(match[2]);
    const row = getDb().prepare('SELECT status FROM appointments WHERE id = ?').get(id) as { status: string } | undefined;
    if (!row || !canTransition(row.status, nextStatus)) {
      await ctx.answerCallbackQuery({ text: 'This appointment can no longer be changed' });
      return;
    }
    getDb().prepare(`UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, new Date().toISOString(), id);
    await ctx.answerCallbackQuery({ text: nextStatus });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      logger.warn('Telegram keyboard was already cleared');
    }
  });
}

export async function refreshTelegramBot(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const config = readTelegramConfig();
  if (!config.enabled || !config.token) {
    await stopBot();
    return;
  }
  if (bot && activeToken === config.token) return;
  await stopBot();
  const next = new Bot(config.token);
  attachHandlers(next);
  bot = next;
  activeToken = config.token;
  void next.start({
    onStart: () => logger.info('Telegram bot is polling'),
  }).catch(() => {
    logger.error('Telegram bot could not start');
    if (bot === next) {
      bot = null;
      activeToken = '';
    }
  });
}

async function sendText(chatId: string, text: string, appointmentId?: number) {
  const config = readTelegramConfig();
  const client = bot ?? (config.token ? new Bot(config.token) : null);
  if (!client) return;
  const keyboard = appointmentId
    ? new InlineKeyboard().text('Confirm', `appt:confirm:${appointmentId}`).text('Cancel', `appt:cancel:${appointmentId}`)
    : undefined;
  await client.api.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : undefined);
}

export function queueAppointmentAlert(appointmentId: number): void {
  if (process.env.NODE_ENV === 'test') return;
  void notifyAppointment(appointmentId).catch(() => logger.warn('Telegram appointment alert was not sent'));
}

async function notifyAppointment(appointmentId: number) {
  const config = readTelegramConfig();
  if (!config.enabled || !config.chatId) return;
  const row = getDb().prepare(
    `SELECT a.starts_at, a.booking_ref, p.full_name, s.name AS service_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN services s ON s.id = a.service_id
     WHERE a.id = ?`,
  ).get(appointmentId) as { starts_at: string; booking_ref: string; full_name: string; service_name: string } | undefined;
  if (!row) return;
  const local = utcToLocal(row.starts_at, getClinicZone());
  await sendText(config.chatId, `New appointment: ${row.full_name}, ${row.service_name}, ${local.date} ${local.time}. Reference ${row.booking_ref}.`, appointmentId);
}

export async function sendTelegramTest(): Promise<void> {
  const config = readTelegramConfig();
  if (!config.token || !config.chatId) throw new HttpError(400, 'VALIDATION', 'Save a bot token and a chat id first');
  try {
    await sendText(config.chatId, 'SmileCare test message. Telegram is connected.');
  } catch {
    throw new HttpError(502, 'TELEGRAM', 'Telegram did not accept the test message');
  }
}

export function createPatientLink(patientId: number): { token: string; instruction: string } {
  const token = randomBytes(16).toString('hex');
  getDb()
    .prepare(`INSERT INTO telegram_links (patient_id, chat_id, link_token_hash, created_at) VALUES (?, 'pending', ?, ?)`)
    .run(patientId, sha256(token), new Date().toISOString());
  const username = readTelegramConfig().username;
  const instruction = username
    ? `Ask the patient to open https://t.me/${username}?start=${token}`
    : `Ask the patient to open the clinic bot and send /start ${token}`;
  return { token, instruction };
}

async function deliverReminder(appointmentId: number) {
  const config = readTelegramConfig();
  if (!config.enabled || !config.token) return;
  if (reminderStatus(appointmentId, 'upcoming') === 'sent') return;
  const row = getDb().prepare(
    `SELECT a.starts_at, a.booking_ref, a.patient_id, p.full_name, s.name AS service_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN services s ON s.id = a.service_id
     WHERE a.id = ?`,
  ).get(appointmentId) as { starts_at: string; booking_ref: string; patient_id: number; full_name: string; service_name: string } | undefined;
  if (!row) return;
  if (reminderStatus(appointmentId, 'upcoming') === undefined && !claimReminder(appointmentId, 'upcoming', row.starts_at)) return;
  const local = utcToLocal(row.starts_at, getClinicZone());
  try {
    if (config.chatId) {
      await sendText(config.chatId, `Reminder: ${row.full_name} has ${row.service_name} on ${local.date} at ${local.time}. Reference ${row.booking_ref}.`);
    }
    const links = getDb().prepare(`SELECT chat_id FROM telegram_links WHERE patient_id = ? AND chat_id != 'pending'`).all(row.patient_id) as Array<{ chat_id: string }>;
    for (const link of links) {
      await sendText(link.chat_id, `Reminder: your ${row.service_name} appointment is ${local.date} at ${local.time}. Reference ${row.booking_ref}.`);
    }
    setReminderStatus(appointmentId, 'upcoming', 'sent');
  } catch {
    setReminderStatus(appointmentId, 'upcoming', 'failed');
    logger.warn('Telegram reminder was not sent');
  }
}

export async function sendDueReminders(): Promise<void> {
  const config = readTelegramConfig();
  if (!config.enabled || !config.token) return;
  const now = new Date();
  const soon = new Date(now.getTime() + config.reminderHours * 60 * 60 * 1000).toISOString();
  const rows = getDb().prepare(
    `SELECT a.id FROM appointments a
     WHERE a.status IN ('Pending', 'Confirmed')
       AND a.starts_at > ?
       AND a.starts_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM reminders r WHERE r.appointment_id = a.id AND r.kind = 'upcoming' AND r.status = 'sent'
       )`,
  ).all(now.toISOString(), soon) as Array<{ id: number }>;
  for (const row of rows) {
    await deliverReminder(row.id);
  }
}

export function startReminderLoop(): void {
  if (process.env.NODE_ENV === 'test' || reminderTimer) return;
  reminderTimer = setInterval(() => {
    void sendDueReminders();
  }, 60_000);
  reminderTimer.unref?.();
}

export async function stopTelegram(): Promise<void> {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = undefined;
  await stopBot();
}
```

---

## `server/src/backup.ts`

```
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const source = path.resolve(process.env.DATABASE_PATH || './data/smilecare.db');
if (!fs.existsSync(source)) {
  console.error(`Database not found: ${source}`);
  process.exit(1);
}

const directory = path.resolve('./data/backups');
fs.mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(directory, `smilecare-${stamp}.db`);
const database = new Database(source, { readonly: true, fileMustExist: true });
await database.backup(destination);
database.close();
console.log(destination);
```

---

## `src/db/index.ts`

```
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

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

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
```

---

## `src/db/apiRepository.ts`

```
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
```

---

## `.env.example`

```
# SmileCare Pro — Environment

Copy what you need. Do not commit a filled `.env`.

## Web (Vite)

```
# Leave unset for the clinic API. Set to true only for the browser-only demo.
# VITE_DEMO_MODE=true
```

The dev server proxies `/api` to the API on port 3001.

## API

See `server/.env.example`.

```
NODE_ENV=development
PORT=3001
SESSION_SECRET=REDACTED
CLIENT_ORIGIN=http://localhost:5173
DATABASE_PATH=./data/smilecare.db
TRUST_PROXY=0
LOG_LEVEL=info
```

`SESSION_SECRET` must be a unique value of at least 32 characters when `NODE_ENV=production`. The API refuses to start otherwise.
```

---

## `server/.env.example`

```
# SmileCare Pro API. Copy to server/.env for local overrides.
# Never commit real secrets.

NODE_ENV=development
PORT=3001
# Required in production: at least 32 characters, not the dev default.
SESSION_SECRET=REDACTED
CLIENT_ORIGIN=http://localhost:5173
# SQLite file. Created automatically. Keep this path outside git.
DATABASE_PATH=./data/smilecare.db
# Set to 1 when the API sits behind a reverse proxy.
TRUST_PROXY=0
LOG_LEVEL=info

# Optional: create an owner while seeding demo clinical data.
# Leave blank so the first-run setup screen creates the owner.
# SEED_OWNER_EMAIL=
# SEED_OWNER_PASSWORD=
```

---

## `package.json`

```
{
  "name": "smilecare-pro",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "workspaces": [
    "server"
  ],
  "scripts": {
    "dev": "concurrently -k -n api,web -c cyan,magenta \"npm run dev -w smilecare-server\" \"vite\"",
    "dev:web": "vite",
    "dev:api": "npm run dev -w smilecare-server",
    "build": "tsc -b && vite build && npm run build -w smilecare-server",
    "typecheck": "tsc -b --pretty false && npm run typecheck -w smilecare-server",
    "lint": "oxlint",
    "test": "npm run test -w smilecare-server",
    "preview": "vite preview",
    "seed:demo": "npm run seed:demo -w smilecare-server",
    "start": "npm run start -w smilecare-server"
  },
  "dependencies": {
    "lucide-react": "^1.21.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-router-dom": "^7.18.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.1",
    "@types/node": "^24.13.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "autoprefixer": "^10.5.1",
    "oxlint": "^1.69.0",
    "postcss": "^8.5.15",
    "tailwindcss": "^4.3.1",
    "concurrently": "^9.2.1",
    "typescript": "~6.0.2",
    "vite": "^8.1.0"
  }
}
```

---

## `server/package.json`

```
{
  "name": "smilecare-server",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run",
    "seed:demo": "tsx src/seed.ts",
    "backup": "tsx src/backup.ts"
  },
  "dependencies": {
    "argon2": "^0.43.0",
    "better-sqlite3": "^12.4.1",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "grammy": "^1.46.0",
    "helmet": "^8.3.0",
    "luxon": "^3.6.1",
    "pino": "^9.7.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/cookie-parser": "^1.4.8",
    "@types/cors": "^2.8.18",
    "@types/express": "^4.17.21",
    "@types/luxon": "^3.6.2",
    "@types/supertest": "^6.0.3",
    "supertest": "^7.1.1",
    "tsx": "^4.20.3",
    "typescript": "~6.0.2",
    "vitest": "^3.2.4"
  }
}
```

---

## `Dockerfile`

```
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/smilecare.db
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "smilecare-server"]
```

---

## `docker-compose.yml`

```
services:
  smilecare:
    build: .
    ports:
      - "8080:3001"
    environment:
      NODE_ENV: production
      PORT: "3001"
      CLIENT_ORIGIN: https://clinic.example.com
      SESSION_SECRET=REDACTED
      DATABASE_PATH: /data/smilecare.db
      TRUST_PROXY: "1"
    volumes:
      - smilecare-data:/data

volumes:
  smilecare-data:
```

---

## `.github/workflows/ci.yml`

```
name: CI

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

---

## `docs/PERMISSIONS.md`

```
# Permission matrix

Roles are `owner`, `receptionist`, and `doctor`. Every API route below is enforced on the server. The browser hides some screens, but hiding a screen is not the security control.

| Capability | Owner | Receptionist | Doctor |
|---|---|---|---|
| First-run setup | Public, once | Public, once | Public, once |
| Sign in, sign out, own password | Yes | Yes | Yes |
| Create and deactivate staff | Yes | No | No |
| Reset another person's password | Yes | No | No |
| Change clinic settings | Yes | No | No |
| Read patients, doctors, services, branches | Yes | Yes | Yes |
| Create or edit patients | Yes | Yes | No |
| Create or edit appointments | Yes | Yes | No |
| Create or edit services, doctors, waitlist, inquiries | Yes | Yes | No |
| Read the activity log | Yes | Yes | Yes |
| Add an activity entry | Yes | Yes | Yes |
| Delete or edit an activity entry | No | No | No |
| Update the tooth chart or a visit note | Yes | Yes | Yes |
| Record a payment | Yes | Yes | No |
| Export one patient record | Yes | Yes | Yes |
| Anonymize a patient | Yes | No | No |
| Save Telegram settings or send a test | Yes | No | No |

A doctor who calls an owner or receptionist route receives **403**. A signed-out request receives **401**. A temporary password must be changed before any other clinic route will succeed.

Activity entries are append-only. There is no update or delete API for them.
```

---

## API route list (generated from route source greps)

| Method+path pattern | Required role (from code) |
|---|---|
| GET /api/health | Public |
| GET /api/setup/status | Public |
| POST /api/setup | Public once |
| POST /api/auth/login | Public |
| POST /api/auth/logout | Auth |
| POST /api/auth/logout-all | Auth |
| GET /api/auth/me | Auth |
| POST /api/auth/change-password | Auth |
| GET/POST/PATCH users | owner |
| GET branches/patients/doctors/services/appointments/leads/waitlist/notifications/settings/audit/holidays | Auth (any role) |
| POST/PATCH/DELETE patients, appointments, services, doctors, waitlist, leads, holidays, time-off | owner, receptionist |
| PATCH /api/settings, telegram-test, whatsapp-test | owner |
| Dental odontogram/visits GET+PUT/POST | Auth; payments POST owner/receptionist |
| GET export patient | Auth; POST anonymize owner |
| /api/public/* | Public + rate limit |
