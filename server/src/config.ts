import path from 'node:path';

export const DEV_SESSION_SECRET = 'dev-only-change-me';
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

export function loadConfig(): AppConfig {
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
