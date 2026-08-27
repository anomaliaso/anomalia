import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_BLOCKED_PLATFORMS,
  blockedPlatformExamples,
  blockedPlatformForUrl,
  platformTermsSystemSection
} from '$lib/platform-terms';

describe('blockedPlatformForUrl', () => {
  it('matches the platforms we refuse to sign into, including subdomains', () => {
    expect(blockedPlatformForUrl('https://www.instagram.com/accounts/login')?.label).toBe('Instagram');
    expect(blockedPlatformForUrl('https://business.facebook.com/login')?.label).toBe('Facebook');
    expect(blockedPlatformForUrl('https://www.linkedin.com/login')?.label).toBe('LinkedIn');
    expect(blockedPlatformForUrl('https://accounts.google.com/signin')?.label).toBe('Google');
    expect(blockedPlatformForUrl('https://x.com/i/flow/login')?.label).toBe('X / Twitter');
  });

  it('accepts a bare host without a scheme', () => {
    expect(blockedPlatformForUrl('tiktok.com/login')?.label).toBe('TikTok');
  });

  it('leaves the brand’s own product alone', () => {
    expect(blockedPlatformForUrl('https://app.acme.com/login')).toBeNull();
    expect(blockedPlatformForUrl('https://www.anomalia.so/login')).toBeNull();
    expect(blockedPlatformForUrl(null)).toBeNull();
    expect(blockedPlatformForUrl('not a url')).toBeNull();
  });

  it('does not match a lookalike domain that merely contains a platform name', () => {
    // instagram-tools.com is somebody else's product, not Instagram.
    expect(blockedPlatformForUrl('https://instagram-tools.com/login')).toBeNull();
    expect(blockedPlatformForUrl('https://myinstagram.com/login')).toBeNull();
  });
});

describe('platform terms system section', () => {
  const section = platformTermsSystemSection();

  it('forbids automated sign-in and browser publishing', () => {
    expect(section).toContain('THIRD-PARTY PLATFORM TERMS');
    expect(section).toMatch(/never drive a browser to sign in/i);
    expect(section).toMatch(/official APIs/i);
    expect(section).toMatch(/behind somebody else's login/i);
  });

  it('keeps public research explicitly allowed, so the model does not over-refuse', () => {
    expect(section).toMatch(/DO NOT OVER-REFUSE/);
    expect(section).toMatch(/PUBLIC page/);
    expect(section).toContain('capture_website');
  });

  it('names real platforms so the rule is not abstract', () => {
    expect(section).toContain('Instagram');
    expect(blockedPlatformExamples(2)).toBe('Instagram, Facebook');
  });

  it('covers every platform the product publishes to', () => {
    const ids = AUTOMATION_BLOCKED_PLATFORMS.map((p) => p.id);
    for (const id of ['instagram', 'facebook', 'tiktok', 'linkedin', 'x', 'youtube']) {
      expect(ids).toContain(id);
    }
  });
});
