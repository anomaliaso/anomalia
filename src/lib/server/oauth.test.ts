import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { env } from '$env/dynamic/private';

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_APP_URL: 'https://www.anomalia.so' }
}));

// Firmare è fail-closed di proposito: senza `APP_SECRET` nessun token esce. Il segreto se lo dà
// il test, o la suite è verde solo su chi ha un `.env` completo e rossa in CI.
env.APP_SECRET = 'test-app-secret-non-quello-di-default';

import {
  isAllowedRedirectUri,
  issueClientId,
  issueCode,
  readClientId,
  readCode,
  redirectUriMatches,
  verifyPkce
} from './oauth';
import { GET as discovery } from '../../routes/.well-known/oauth-authorization-server/+server';

const client = { uris: ['http://127.0.0.1:8976/callback'], name: 'opencode' };

describe('client ids', () => {
  it('round-trips a registration', () => {
    expect(readClientId(issueClientId(client))).toEqual(client);
  });

  it('rejects a tampered client id', () => {
    const id = issueClientId(client);
    expect(readClientId(id.slice(0, -3) + 'aaa')).toBeNull();
    expect(readClientId('nonsense')).toBeNull();
  });
});

describe('redirect uris', () => {
  it('allows https anywhere and http only on loopback', () => {
    expect(isAllowedRedirectUri('https://example.com/cb')).toBe(true);
    expect(isAllowedRedirectUri('https://www.cursor.com/agents/mcp/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:1234/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:1234/cb')).toBe(true);
    // URL().hostname keeps the brackets on IPv6 — easy to get wrong, so pin it.
    expect(isAllowedRedirectUri('http://[::1]:1234/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://evil.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
  });

  it('allows the Cursor MCP custom-scheme callback, not arbitrary custom schemes', () => {
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('cursor://evil.app/oauth/callback')).toBe(false);
    expect(isAllowedRedirectUri('myapp://callback')).toBe(false);
  });

  it('ignores the port for loopback, not for anything else', () => {
    expect(redirectUriMatches(client, 'http://127.0.0.1:51234/callback')).toBe(true);
    expect(redirectUriMatches(client, 'http://127.0.0.1:51234/other')).toBe(false);
    expect(redirectUriMatches({ uris: ['https://a.com/cb'], name: 'x' }, 'https://a.com:8443/cb')).toBe(false);
    expect(
      redirectUriMatches(
        { uris: ['cursor://anysphere.cursor-mcp/oauth/callback'], name: 'cursor' },
        'cursor://anysphere.cursor-mcp/oauth/callback'
      )
    ).toBe(true);
  });
});

describe('authorization codes', () => {
  const payload = { email: 'a@b.c', cid: 'cid', uri: 'http://127.0.0.1/cb', chal: 'x' };

  it('round-trips', () => {
    expect(readCode(issueCode(payload))).toMatchObject(payload);
  });

  it('rejects a tampered code', () => {
    const code = issueCode(payload);
    const [body, sig] = code.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...payload, email: 'attacker@evil.com', e: Date.now() + 60_000 })
    ).toString('base64url');
    expect(readCode(`${forged}.${sig}`)).toBeNull();
    expect(readCode(body)).toBeNull();
  });
});

describe('PKCE', () => {
  const verifier = 'a'.repeat(64);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  it('accepts the matching verifier', () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a wrong or too-short verifier', () => {
    expect(verifyPkce('b'.repeat(64), challenge)).toBe(false);
    expect(verifyPkce('short', challenge)).toBe(false);
    expect(verifyPkce(verifier, 'not-the-challenge')).toBe(false);
  });
});

// Il documento di discovery è l'unica cosa che un client MCP legge prima di sapere come
// autenticarsi: se issuer ed endpoint non stanno sullo stesso host che ha servito il JSON,
// il client o segue un redirect cross-origin o si arrende. Smithery si arrendeva (HTTP 308
// sull'apex). Questi test bloccano la regressione dov'era: nella forma dei metadata.
describe('discovery metadata (RFC 8414)', () => {
  const metadata = async (origin: string) => {
    const url = new URL(`${origin}/.well-known/oauth-authorization-server`);
    const res = (await discovery({ url } as never)) as Response;
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };

  it('names the host that served the document, apex-free and without trailing slash', async () => {
    const m = await metadata('https://www.anomalia.so');
    expect(m.issuer).toBe('https://www.anomalia.so');
    expect(m.issuer).not.toMatch(/\/$/);
  });

  it('keeps every endpoint absolute and on the issuer origin', async () => {
    for (const origin of ['https://www.anomalia.so', 'http://localhost:5173']) {
      const m = await metadata(origin);
      expect(m.issuer).toBe(origin);
      for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
        expect(new URL(String(m[key])).origin).toBe(m.issuer);
      }
    }
  });

  it('carries what an MCP client needs to start the code+PKCE flow', async () => {
    const m = await metadata('https://www.anomalia.so');
    expect(m.response_types_supported).toContain('code');
    expect(m.code_challenge_methods_supported).toContain('S256');
    expect(m.grant_types_supported).toContain('authorization_code');
    expect(m.registration_endpoint).toBeTruthy();
  });
});
