import { describe, expect, it } from 'vitest';
import { isCsrfForbidden } from './csrf';

const url = (path: string) => new URL(`https://www.anomalia.so${path}`);

function req(init: { method?: string; type?: string; origin?: string } = {}) {
  const headers = new Headers();
  if (init.type) headers.set('content-type', init.type);
  if (init.origin) headers.set('origin', init.origin);
  return new Request('https://www.anomalia.so/x', { method: init.method ?? 'POST', headers });
}

const FORM = 'application/x-www-form-urlencoded';

describe('isCsrfForbidden', () => {
  it('blocks a form POST with a foreign origin', () => {
    expect(isCsrfForbidden(req({ type: FORM, origin: 'https://evil.com' }), url('/login'))).toBe(true);
  });

  it('blocks a form POST with no origin at all', () => {
    expect(isCsrfForbidden(req({ type: FORM }), url('/login'))).toBe(true);
  });

  it('allows a same-origin form POST, charset and casing included', () => {
    const same = { type: `${FORM}; charset=UTF-8`.toUpperCase(), origin: 'https://www.anomalia.so' };
    expect(isCsrfForbidden(req(same), url('/oauth/authorize'))).toBe(false);
  });

  it('allows JSON bodies — not a form content type', () => {
    expect(isCsrfForbidden(req({ type: 'application/json' }), url('/api/v1/thing'))).toBe(false);
  });

  it('allows GET', () => {
    expect(isCsrfForbidden(req({ method: 'GET', type: FORM }), url('/login'))).toBe(false);
  });

  // The whole point: an OAuth CLI client posts form-encoded with no Origin header.
  it('exempts /oauth/token', () => {
    expect(isCsrfForbidden(req({ type: FORM }), url('/oauth/token'))).toBe(false);
  });

  it('does not exempt anything else under /oauth', () => {
    expect(isCsrfForbidden(req({ type: FORM }), url('/oauth/authorize'))).toBe(true);
  });
});
