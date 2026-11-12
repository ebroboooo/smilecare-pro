import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type SqlDatabase = Database.Database;

let database: SqlDatabase | null = null;

export function getDb(): SqlDatabase {
  if (!database) throw new Error('Database is not open');
  return database;
}

export function openDatabase(filePath: string): SqlDatabase {
  if (database) {
    database.close();
    database = null;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const instance = new Database(filePath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');
  database = instance;
  return instance;
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = null;
  }
}

export function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../migrations'),
    path.resolve(here, '../../migrations'),
    path.resolve(process.cwd(), 'migrations'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Migrations directory not found');
}

export function migrate(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => (row as { name: string }).name),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    });
    apply();
  }
}
