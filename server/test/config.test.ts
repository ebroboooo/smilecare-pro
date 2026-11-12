import { describe, expect, it } from 'vitest';
import { assertProductionSecret, DEV_SESSION_SECRET } from '../src/config.js';

describe('production secret guard', () => {
  it('rejects a missing or default session secret in production', () => {
    expect(() => assertProductionSecret('production', undefined)).toThrow(/SESSION_SECRET/);
    expect(() => assertProductionSecret('production', DEV_SESSION_SECRET)).toThrow(/SESSION_SECRET/);
    expect(() => assertProductionSecret('production', 'short')).toThrow(/SESSION_SECRET/);
    expect(() => assertProductionSecret('production', 'a-real-production-secret-value-32')).not.toThrow();
    expect(() => assertProductionSecret('development', undefined)).not.toThrow();
  });
});
