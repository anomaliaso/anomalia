import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {};
  const flags = { dev: false };
  const requestWith = (headers: Record<string, string>) =>
    new Request('https://anomalia.so/api/v1/tick', { headers });
  return { env, flags, requestWith };
});

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$app/environment', () => ({
  browser: false,
  get dev() {
    return mocks.flags.dev;
  }
}));

import { cronAuthorized } from './cron-auth';

describe('cronAuthorized', () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.env)) delete mocks.env[key];
    mocks.flags.dev = false;
  });

  it('nega quando nessun secret è configurato, anche con un token presente', () => {
    expect(cronAuthorized(mocks.requestWith({ authorization: 'Bearer qualunque' }))).toBe(false);
  });

  it('accetta il Bearer token giusto quando CRON_SECRET è configurato', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    expect(cronAuthorized(mocks.requestWith({ authorization: 'Bearer cron-secret' }))).toBe(true);
  });

  it('nega un Bearer token sbagliato', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    expect(cronAuthorized(mocks.requestWith({ authorization: 'Bearer sbagliato' }))).toBe(false);
  });

  it('nega quando l\'header Authorization manca', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    expect(cronAuthorized(mocks.requestWith({}))).toBe(false);
  });

  it('nega una Authorization senza il prefisso Bearer', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    expect(cronAuthorized(mocks.requestWith({ authorization: 'cron-secret' }))).toBe(false);
  });

  it('nega un secret configurato come stringa vuota', () => {
    mocks.env.CRON_SECRET = '';
    expect(cronAuthorized(mocks.requestWith({ authorization: 'Bearer ' }))).toBe(false);
  });

  it('accetta x-autopilot-secret giusto quando AUTOPILOT_SECRET è configurato', () => {
    mocks.env.AUTOPILOT_SECRET = 'autopilot-secret';
    expect(cronAuthorized(mocks.requestWith({ 'x-autopilot-secret': 'autopilot-secret' }))).toBe(true);
  });

  it('nega x-autopilot-secret sbagliato', () => {
    mocks.env.AUTOPILOT_SECRET = 'autopilot-secret';
    expect(cronAuthorized(mocks.requestWith({ 'x-autopilot-secret': 'sbagliato' }))).toBe(false);
  });

  it('nega quando AUTOPILOT_SECRET è configurato ma l\'header manca', () => {
    mocks.env.AUTOPILOT_SECRET = 'autopilot-secret';
    expect(cronAuthorized(mocks.requestWith({}))).toBe(false);
  });

  it('nega una Authorization "Bearer" senza lo spazio prima del token', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    expect(cronAuthorized(mocks.requestWith({ authorization: 'Bearer' }))).toBe(false);
  });

  it('nega una Authorization con il prefisso bearer minuscolo', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    expect(cronAuthorized(mocks.requestWith({ authorization: 'bearer cron-secret' }))).toBe(false);
  });

  it('nega un Bearer con doppio spazio: il token non coincide con quello configurato', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    expect(cronAuthorized(mocks.requestWith({ authorization: 'Bearer  cron-secret' }))).toBe(false);
  });

  it('nega il canale autopilot quando AUTOPILOT_SECRET è configurato come stringa vuota', () => {
    mocks.env.AUTOPILOT_SECRET = '';
    expect(cronAuthorized(mocks.requestWith({ 'x-autopilot-secret': 'autopilot-secret' }))).toBe(false);
  });

  it('nega un header x-autopilot-secret presente ma vuoto', () => {
    mocks.env.AUTOPILOT_SECRET = 'autopilot-secret';
    expect(cronAuthorized(mocks.requestWith({ 'x-autopilot-secret': '' }))).toBe(false);
  });

  it('accetta se uno dei due canali è valido', () => {
    mocks.env.CRON_SECRET = 'cron-secret';
    mocks.env.AUTOPILOT_SECRET = 'autopilot-secret';
    expect(
      cronAuthorized(mocks.requestWith({ 'x-autopilot-secret': 'autopilot-secret' }))
    ).toBe(true);
    expect(cronAuthorized(mocks.requestWith({ authorization: 'Bearer cron-secret' }))).toBe(true);
  });

  it('accetta sempre in dev, anche senza header e senza secret', () => {
    mocks.flags.dev = true;
    expect(cronAuthorized(mocks.requestWith({}))).toBe(true);
  });
});
