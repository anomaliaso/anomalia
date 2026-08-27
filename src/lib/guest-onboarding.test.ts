import { describe, expect, it } from 'vitest';
import { hasGuestOnboardingCookie, parseGuestOnboarding } from '$lib/guest-onboarding';

describe('parseGuestOnboarding', () => {
  it('accepts a website + platforms payload ready for analysis', () => {
    const parsed = parseGuestOnboarding({
      v: 1,
      url: 'acme.com',
      noWebsite: false,
      brandName: 'Acme',
      creatorNiche: '',
      selectedPlatforms: ['instagram', 'x'],
      handles: { instagram: 'acme' },
      readyForAnalysis: true
    });
    expect(parsed).toMatchObject({
      url: 'acme.com',
      selectedPlatforms: ['instagram', 'x'],
      handles: { instagram: 'acme' },
      readyForAnalysis: true
    });
  });

  it('rejects readyForAnalysis without platforms', () => {
    expect(
      parseGuestOnboarding({
        v: 1,
        url: 'acme.com',
        noWebsite: false,
        brandName: '',
        creatorNiche: '',
        selectedPlatforms: [],
        handles: {},
        readyForAnalysis: true
      })
    ).toBeNull();
  });

  it('rejects invalid websites', () => {
    expect(
      parseGuestOnboarding({
        v: 1,
        url: 'not a url',
        noWebsite: false,
        brandName: '',
        creatorNiche: '',
        selectedPlatforms: ['instagram'],
        handles: {},
        readyForAnalysis: false
      })
    ).toBeNull();
  });
});

describe('hasGuestOnboardingCookie', () => {
  it('is true only for the ready flag value', () => {
    expect(hasGuestOnboardingCookie('1')).toBe(true);
    expect(hasGuestOnboardingCookie('0')).toBe(false);
    expect(hasGuestOnboardingCookie(undefined)).toBe(false);
    expect(hasGuestOnboardingCookie(null)).toBe(false);
  });
});
