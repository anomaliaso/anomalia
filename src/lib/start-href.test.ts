import { describe, expect, it } from 'vitest';
import { marketingStartHref } from './start-href';

describe('marketingStartHref', () => {
  it('sends logged-in users to /app', () => {
    expect(marketingStartHref({ loggedIn: true })).toBe('/app');
    expect(marketingStartHref({ loggedIn: true, waitlistActive: true })).toBe('/app');
  });

  it('sends guests to /app so navbar can reach login', () => {
    expect(marketingStartHref({ loggedIn: false })).toBe('/app');
  });

  it('keeps waitlisted guests on /waitlist', () => {
    expect(marketingStartHref({ loggedIn: false, waitlistActive: true })).toBe('/waitlist');
  });
});
