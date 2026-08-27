import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test' } }));

import { isPrivateAddress } from './tool-guard';

describe('isPrivateAddress', () => {
  it('blocks every range an SSRF payload would aim at', () => {
    // The cloud metadata endpoint is the one that actually leaks credentials.
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('100.64.0.1')).toBe(true); // CGNAT
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
    expect(isPrivateAddress('224.0.0.1')).toBe(true); // multicast
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });

  it('allows public addresses, including the ones adjacent to blocked ranges', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    // 172.15 and 172.32 sit just outside the private /12 — a sloppy regex catches these.
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('192.169.0.1')).toBe(false);
    expect(isPrivateAddress('169.253.0.1')).toBe(false);
    expect(isPrivateAddress('100.63.0.1')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });
});
