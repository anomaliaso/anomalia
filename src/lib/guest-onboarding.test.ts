import { describe, expect, it } from 'vitest';
import { guestPostRow, hasGuestOnboardingCookie, parseGuestOnboarding } from '$lib/guest-onboarding';

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

  it('accepts readyForAnalysis without platforms, now that socials come after login', () => {
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
    ).toMatchObject({ url: 'acme.com', selectedPlatforms: [], readyForAnalysis: true });
  });

  it('carries the post generated before login', () => {
    const parsed = parseGuestOnboarding({
      v: 1,
      url: 'acme.com',
      noWebsite: false,
      brandName: 'Acme',
      creatorNiche: '',
      selectedPlatforms: [],
      handles: {},
      readyForAnalysis: true,
      post: {
        platform: 'instagram',
        format: 'single_image',
        caption: 'Fresh beans, every morning.',
        imageUrl: 'https://cdn.example.com/guest/a/b.jpg',
        imagePrompt: 'a warm espresso shot on a marble counter'
      }
    });
    expect(parsed?.post).toEqual({
      platform: 'instagram',
      format: 'single_image',
      caption: 'Fresh beans, every morning.',
      imageUrl: 'https://cdn.example.com/guest/a/b.jpg',
      imagePrompt: 'a warm espresso shot on a marble counter'
    });
  });

  it('drops a post whose image never rendered, so login never adopts an empty card', () => {
    const parsed = parseGuestOnboarding({
      v: 1,
      url: 'acme.com',
      noWebsite: false,
      brandName: 'Acme',
      creatorNiche: '',
      selectedPlatforms: [],
      handles: {},
      readyForAnalysis: true,
      post: { platform: 'instagram', format: 'single_image', caption: 'hi', imageUrl: '', imagePrompt: '' }
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.post).toBeUndefined();
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

describe('guestPostRow', () => {
  const post = {
    platform: 'instagram',
    format: 'single_image',
    caption: 'Fresh beans, every morning.',
    imageUrl: 'https://cdn.example.com/guest/a/b.jpg',
    imagePrompt: 'a warm espresso shot on a marble counter'
  };

  it('adopts the pre-login post as a real pending post of the brand', () => {
    expect(guestPostRow(post, 'brand-1')).toEqual({
      brand_id: 'brand-1',
      plan_id: null,
      platform: 'instagram',
      platforms: null,
      format: 'single_image',
      content_type: 'generated_image',
      source: 'guest_preview',
      caption: 'Fresh beans, every morning.',
      image_prompt: 'a warm espresso shot on a marble counter',
      media_url: 'https://cdn.example.com/guest/a/b.jpg',
      status: 'pending_user'
    });
  });

  it('keeps the image the visitor actually saw, never a regenerated one', () => {
    const row = guestPostRow(post, 'brand-1');
    expect(row.media_url).toBe(post.imageUrl);
  });
});
