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

  app.use(errorHandler);
  return app;
}
