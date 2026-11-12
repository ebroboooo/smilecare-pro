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
