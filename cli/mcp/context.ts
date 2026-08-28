import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request auth for HTTP transport (Bearer JWT). Stdio leaves this empty and uses the session file. */
export type RequestAuth = {
  access_token: string;
  user: { id: string; email: string };
  expires_at?: number;
  source: 'bearer' | 'session';
};

export const requestAuth = new AsyncLocalStorage<RequestAuth>();

export function getRequestAuth(): RequestAuth | undefined {
  return requestAuth.getStore();
}

export function runWithRequestAuth<T>(auth: RequestAuth, fn: () => T): T {
  return requestAuth.run(auth, fn);
}
