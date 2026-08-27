import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('appOrigin', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('$env/dynamic/public');
  });

  async function loadWith(publicAppUrl: string) {
    vi.doMock('$env/dynamic/public', () => ({
      env: { PUBLIC_APP_URL: publicAppUrl }
    }));
    return (await import('./app-url')).appOrigin;
  }

  it('keeps localhost on the request origin', async () => {
    const appOrigin = await loadWith('https://anomalia.so');
    expect(appOrigin(new URL('http://localhost:5173/login'))).toBe('http://localhost:5173');
  });

  it('uses www request origin when PUBLIC_APP_URL is apex', async () => {
    const appOrigin = await loadWith('https://anomalia.so');
    expect(appOrigin(new URL('https://www.anomalia.so/login?next=onboarding'))).toBe(
      'https://www.anomalia.so'
    );
  });

  it('uses apex request origin when PUBLIC_APP_URL is www', async () => {
    const appOrigin = await loadWith('https://www.anomalia.so');
    expect(appOrigin(new URL('https://anomalia.so/login'))).toBe('https://anomalia.so');
  });

  it('uses the vercel preview origin', async () => {
    const appOrigin = await loadWith('https://anomalia.so');
    expect(appOrigin(new URL('https://anomalia-git-x.vercel.app/login'))).toBe(
      'https://anomalia-git-x.vercel.app'
    );
  });
});
