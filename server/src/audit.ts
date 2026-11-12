import type { AuthUser } from './auth.js';
import { getDb } from './db.js';

export function writeAudit(user: Pick<AuthUser, 'id' | 'name'> | null, action: string, details: string) {
  getDb()
    .prepare(`INSERT INTO audit_logs (user_id, user_name, action, details, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(user?.id ?? null, user?.name ?? 'system', action, details.slice(0, 2000), new Date().toISOString());
}
