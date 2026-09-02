import { describe, expect, it } from 'vitest';
import { appBrandSlug, isThreadPath, shellShimmerFor } from './shell-nav';

const nav = (from: string | null, to: string | null, brand = 'acme') => ({
  from,
  to,
  fromSearch: '',
  toSearch: '',
  brandSlug: brand
});

describe('appBrandSlug', () => {
  it('il primo segmento di /app/… è il brand', () => {
    expect(appBrandSlug('/app/acme/calendar')).toBe('acme');
    expect(appBrandSlug('/app/acme')).toBe('acme');
  });

  it('le rotte sorelle di /app non sono brand', () => {
    expect(appBrandSlug('/app/onboarding')).toBeNull();
    expect(appBrandSlug('/login')).toBeNull();
    expect(appBrandSlug(null)).toBeNull();
  });
});

describe('isThreadPath', () => {
  it('un thread aperto sì, il composer vuoto no', () => {
    expect(isThreadPath('/app/acme/chat/abc')).toBe(true);
    expect(isThreadPath('/app/acme/chat/new')).toBe(false);
    expect(isThreadPath('/app/acme')).toBe(false);
    expect(isThreadPath(null)).toBe(false);
  });
});

describe('shellShimmerFor', () => {
  it('ferma non è una navigazione', () => {
    expect(shellShimmerFor(nav(null, null))).toBeNull();
  });

  /**
   * La Panoramica È il composer: uno scheletro qui lo smonterebbe con l'invio in volo dentro, e
   * il turno appena spedito sparirebbe. Si tiene la pagina viva fino a fine load.
   */
  it('Panoramica → thread: nessuno scheletro', () => {
    expect(shellShimmerFor(nav('/app/acme', '/app/acme/chat/abc'))).toBeNull();
  });

  /**
   * Riportato il 2/9: due agenti «riportano gli stessi identici 3 messaggi». Passando da una chat
   * all'altra la testata cambia al clic (viene dallo store) e il transcript solo a load finita
   * (viene dal server): nel mezzo si legge la conversazione di PRIMA sotto il nome dell'agente
   * NUOVO. Lo scheletro è ciò che impedisce di leggere una cosa falsa.
   */
  it('thread → un ALTRO thread: scheletro della chat', () => {
    expect(shellShimmerFor(nav('/app/acme/chat/aaa', '/app/acme/chat/bbb'))).toBe('chat');
  });

  it('thread → LO STESSO thread: niente da ricaricare', () => {
    expect(shellShimmerFor(nav('/app/acme/chat/aaa', '/app/acme/chat/aaa'))).toBeNull();
  });

  it('cambio di brand: scheletro anche verso un thread, o resterebbe la pagina del brand vecchio', () => {
    expect(shellShimmerFor(nav('/app/acme/chat/aaa', '/app/altro/chat/bbb'))).toBe('chat');
    expect(shellShimmerFor(nav('/app/acme/calendar', '/app/altro'))).toBe('overview');
  });

  it('le pagine con uno scheletro loro', () => {
    expect(shellShimmerFor(nav('/app/acme', '/app/acme/calendar'))).toBe('calendar');
    expect(shellShimmerFor(nav('/app/acme', '/app/acme/motion-video'))).toBe('media');
    expect(shellShimmerFor(nav('/app/acme/calendar', '/app/acme/seo'))).toBe('page');
  });

  it('fuori dalla shell del brand non si disegna niente', () => {
    expect(shellShimmerFor(nav('/app/acme', '/app/onboarding'))).toBeNull();
    expect(shellShimmerFor(nav('/app/acme', '/app/acme/success'))).toBeNull();
  });

  it('stessa pagina e stessa query: nessuno scheletro', () => {
    expect(
      shellShimmerFor({ ...nav('/app/acme/calendar', '/app/acme/calendar'), fromSearch: '?w=1', toSearch: '?w=1' })
    ).toBeNull();
    expect(
      shellShimmerFor({ ...nav('/app/acme/calendar', '/app/acme/calendar'), fromSearch: '?w=1', toSearch: '?w=2' })
    ).toBe('calendar');
  });
});
