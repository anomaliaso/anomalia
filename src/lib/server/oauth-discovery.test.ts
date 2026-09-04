import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const LOCAL_ORIGIN = 'http://localhost:5173';
const PREVIEW_ORIGIN = 'https://anomalia-git-branch.vercel.app';

const VERCEL_DOMAIN_REDIRECTS: Record<string, string> = {
  'https://anomalia.so': 'https://www.anomalia.so'
};

type AuthorizationServer = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};

async function advertisedAuthorizationServer(): Promise<string> {
  const { authServerUrl } = await import('../../../cli/lib/config');
  return authServerUrl();
}

async function authorizationServerMetadata(origin: string): Promise<AuthorizationServer> {
  const { GET } = await import('../../routes/.well-known/oauth-authorization-server/+server');
  const url = new URL(`${origin}/.well-known/oauth-authorization-server`);
  const res = await (GET as (event: { url: URL }) => Response)({ url });
  return res.json();
}

async function walkDiscovery() {
  const identifier = await advertisedAuthorizationServer();
  const servedBy = VERCEL_DOMAIN_REDIRECTS[identifier] ?? identifier;
  const server = await authorizationServerMetadata(servedBy);
  return { identifier, servedBy, server };
}

function configureApp(publicAppUrl: string) {
  vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: publicAppUrl } }));
}

function configureMcp(publicAppUrl: string | undefined) {
  if (publicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = publicAppUrl;
}

describe('oauth discovery, walked the way a client walks it', () => {
  const originalAppUrl = process.env.PUBLIC_APP_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('$env/dynamic/public');
    configureMcp(originalAppUrl);
  });

  it.each([
    ['apex', 'https://anomalia.so'],
    ['www', 'https://www.anomalia.so']
  ])(
    'advertises an identifier that serves its own metadata, PUBLIC_APP_URL=%s',
    async (_, configured) => {
      configureMcp(undefined);
      configureApp(configured);

      const { identifier, servedBy } = await walkDiscovery();

      expect(servedBy).toBe(identifier);
    }
  );

  it.each([
    ['apex', 'https://anomalia.so'],
    ['www', 'https://www.anomalia.so']
  ])('issues the identifier it advertised, PUBLIC_APP_URL=%s', async (_, configured) => {
    configureMcp(undefined);
    configureApp(configured);

    const { identifier, server } = await walkDiscovery();

    expect(server.issuer).toBe(identifier);
  });

  it('advertises endpoints on the origin it named as issuer', async () => {
    configureMcp(undefined);
    configureApp('https://anomalia.so');

    const { identifier, server } = await walkDiscovery();

    for (const endpoint of [
      server.authorization_endpoint,
      server.token_endpoint,
      server.registration_endpoint
    ]) {
      expect(new URL(endpoint).origin).toBe(identifier);
    }
  });

  it('keeps the whole walk on the dev server when PUBLIC_APP_URL is local', async () => {
    configureMcp(LOCAL_ORIGIN);
    configureApp(LOCAL_ORIGIN);

    const { identifier, servedBy, server } = await walkDiscovery();

    expect(identifier).toBe(LOCAL_ORIGIN);
    expect(servedBy).toBe(LOCAL_ORIGIN);
    expect(server.issuer).toBe(LOCAL_ORIGIN);
    expect(new URL(server.token_endpoint).origin).toBe(LOCAL_ORIGIN);
  });

  it('issues the preview origin to a client that discovered it there', async () => {
    configureApp('https://www.anomalia.so');

    const server = await authorizationServerMetadata(PREVIEW_ORIGIN);

    expect(server.issuer).toBe(PREVIEW_ORIGIN);
    expect(new URL(server.authorization_endpoint).origin).toBe(PREVIEW_ORIGIN);
  });
});
