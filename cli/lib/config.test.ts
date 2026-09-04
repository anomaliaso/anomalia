import { afterEach, describe, expect, test } from 'bun:test';
import { appUrl, authServerUrl, PRODUCTION_URL } from './config.ts';

const original = process.env.PUBLIC_APP_URL;
afterEach(() => {
  if (original === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = original;
});

describe('appUrl', () => {
  // The apex 308s to www, and fetch drops Authorization across origins — every API call made
  // against the apex comes back 401 "Missing or invalid Authorization header".
  test('production base is the canonical www host, never the redirecting apex', () => {
    expect(PRODUCTION_URL).toBe('https://www.anomalia.so');
    delete process.env.PUBLIC_APP_URL;
    expect(appUrl()).toBe('https://www.anomalia.so');
  });

  test('an explicit PUBLIC_APP_URL wins, trailing slash stripped', () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:5173/';
    expect(appUrl()).toBe('http://localhost:5173');
  });
});

describe('authServerUrl', () => {
  test('never advertises the apex: it 308-redirects and discovery dies there', () => {
    delete process.env.PUBLIC_APP_URL;
    expect(authServerUrl()).toBe('https://www.anomalia.so');
    expect(authServerUrl()).toBe(appUrl());
  });

  test('follows a local dev server so local OAuth works', () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:5173';
    expect(authServerUrl()).toBe('http://localhost:5173');
  });
});
