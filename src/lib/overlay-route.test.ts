import { describe, expect, it } from 'vitest';
import { isSettingsRoute, overlayRoute } from './overlay-route';
import { SETTINGS_MODAL_DEFAULT } from './components/settings/platforms';

const BASE = '/app/acme';

describe('overlayRoute', () => {
  it('classifica le due famiglie della sovrapposizione', () => {
    expect(overlayRoute(`${BASE}/calendar`, BASE)).toBe('calendar');
    expect(overlayRoute(`${BASE}/ads/social`, BASE)).toBe('ads/social');
    expect(overlayRoute(`${BASE}/settings/profile`, BASE)).toBe('settings/profile');
    expect(overlayRoute(`${BASE}/settings/ads/accounts`, BASE)).toBe('settings/ads/accounts');
    expect(overlayRoute(`${BASE}/settings`, BASE)).toBe(`settings/${SETTINGS_MODAL_DEFAULT}`);
  });

  it('null per ciò che non ci vive dentro: la home, la chat, le rotte piene', () => {
    expect(overlayRoute(BASE, BASE)).toBeNull();
    expect(overlayRoute(`${BASE}/chat/abc`, BASE)).toBeNull();
    expect(overlayRoute(`${BASE}/settings/facebook`, BASE)).toBeNull();
    expect(overlayRoute('/app/other/calendar', BASE)).toBeNull();
  });

  it('la barra finale non cambia la risposta', () => {
    expect(overlayRoute(`${BASE}/calendar/`, BASE)).toBe('calendar');
    expect(overlayRoute(`${BASE}/settings/`, `${BASE}/`)).toBe(`settings/${SETTINGS_MODAL_DEFAULT}`);
  });

  it('isSettingsRoute separa il rail delle impostazioni da quello delle pagine', () => {
    expect(isSettingsRoute('settings/profile')).toBe(true);
    expect(isSettingsRoute('calendar')).toBe(false);
    expect(isSettingsRoute(null)).toBe(false);
  });
});
