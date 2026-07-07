import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCrmConfig } from './config.js';

describe('deriveCrmConfig', () => {
  it('returns config when both url and key are set', () => {
    expect(deriveCrmConfig({ CRM_API_URL: 'https://crm.test', CRM_API_KEY: 'lgk_live_x' })).toEqual(
      { apiUrl: 'https://crm.test', apiKey: 'lgk_live_x' },
    );
  });

  it('returns undefined when the key is missing', () => {
    expect(deriveCrmConfig({ CRM_API_URL: 'https://crm.test' })).toBeUndefined();
  });

  it('returns undefined when the url is missing', () => {
    expect(deriveCrmConfig({ CRM_API_KEY: 'lgk_live_x' })).toBeUndefined();
  });

  it('returns undefined when both are empty', () => {
    expect(deriveCrmConfig({})).toBeUndefined();
  });
});

describe('config load with blank CRM env (regression: empty-string CRM_API_URL must not crash)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not throw and leaves crm undefined when CRM_API_URL is an empty string', async () => {
    vi.stubEnv('CRM_API_URL', '');
    vi.stubEnv('CRM_API_KEY', '');
    vi.resetModules();
    const mod = await import('./config.js');
    const cfg = mod.loadMultiConfig();
    expect(cfg.crm).toBeUndefined();
  });
});
