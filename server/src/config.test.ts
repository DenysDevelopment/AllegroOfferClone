import { describe, expect, it } from 'vitest';
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
