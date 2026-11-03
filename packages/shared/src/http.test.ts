import { describe, expect, it } from 'vitest';
import { API_PREFIX, WEBHOOK_PATHS, resolveApiUrl } from './http';

describe('resolveApiUrl', () => {
  it('fails fast in production when API_URL is missing', () => {
    expect(() => resolveApiUrl({ NODE_ENV: 'production' })).toThrow(/API_URL is not set/);
    expect(() => resolveApiUrl({ NODE_ENV: 'production', API_URL: '  ' })).toThrow(/API_URL is not set/);
  });
  it('rejects invalid or non-http URLs in every environment', () => {
    expect(() => resolveApiUrl({ NODE_ENV: 'development', API_URL: 'api.example.com' })).toThrow(/not a valid URL/);
    expect(() => resolveApiUrl({ NODE_ENV: 'production', API_URL: 'ftp://api.example.com' })).toThrow(/http\(s\)/);
  });
  it('falls back to the local API only outside production', () => {
    expect(resolveApiUrl({ NODE_ENV: 'development' })).toBe('http://localhost:4000');
    expect(resolveApiUrl({ NODE_ENV: 'test' })).toBe('http://localhost:4000');
  });
  it('strips trailing slashes', () => {
    expect(resolveApiUrl({ NODE_ENV: 'production', API_URL: 'https://api.vyra.in//' })).toBe('https://api.vyra.in');
  });
  it('keeps webhook exemptions exact and under the API prefix', () => {
    expect(API_PREFIX).toBe('/api/v1');
    for (const p of WEBHOOK_PATHS) expect(p.startsWith(`${API_PREFIX}/`)).toBe(true);
    expect(WEBHOOK_PATHS.some((p) => p.endsWith('*') || p.endsWith('/'))).toBe(false);
  });
});
