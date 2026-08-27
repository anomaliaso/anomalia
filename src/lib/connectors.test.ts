import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS } from '$lib/components/settings/platforms';
import { connectorsSettingsHref, searchConsoleSettingsHref } from './connectors';

describe('connector settings paths', () => {
  it('points Search Console at the dedicated settings page', () => {
    expect(searchConsoleSettingsHref('acme')).toBe('/app/acme/settings/search-console');
    expect(connectorsSettingsHref('acme')).toBe('/app/acme/settings/connectors');
  });

  it('is a registered settings section', () => {
    expect(SETTINGS_SECTIONS).toContain('connectors');
  });
});
