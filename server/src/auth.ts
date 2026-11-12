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
