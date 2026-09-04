import { describe, expect, it } from 'vitest';
import {
  ADD_BLOG_TERM,
  BLOG_ANALYTICS_PROVIDERS,
  BLOG_FONTS,
  BLOG_TERM_KINDS,
  GET_BLOG_SETTINGS,
  REMOVE_BLOG_TERM,
  SET_BLOG_SETTINGS,
  blogAnalyticsIdOk
} from './blog-settings';
import { BRAND_ENDPOINTS, statusForFailure } from './index';

const ALL = [GET_BLOG_SETTINGS, SET_BLOG_SETTINGS, ADD_BLOG_TERM, REMOVE_BLOG_TERM];

describe('le impostazioni del blog come contratto', () => {
  it('stanno tutte nel registry, o nessun agente le vede', () => {
    for (const endpoint of ALL) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('cambia solo i campi nominati, e una richiesta vuota è un rifiuto dichiarato', () => {
    expect(SET_BLOG_SETTINGS.input.safeParse({ title: 'Il blog' }).success).toBe(true);
    expect(statusForFailure(SET_BLOG_SETTINGS, 'no_fields')).toBe(400);
  });

  it('accetta solo i font e i layout che il sito sa rendere', () => {
    expect(SET_BLOG_SETTINGS.input.safeParse({ font: 'serif' }).success).toBe(true);
    expect(SET_BLOG_SETTINGS.input.safeParse({ font: 'comic-sans' }).success).toBe(false);
    expect(SET_BLOG_SETTINGS.input.safeParse({ layout: 'carousel' }).success).toBe(false);
    expect(BLOG_FONTS).toContain('sans');
  });

  it('la cadenza si azzera con null, non con una stringa vuota', () => {
    expect(SET_BLOG_SETTINGS.input.safeParse({ articles_per_week: null }).success).toBe(true);
    expect(SET_BLOG_SETTINGS.input.safeParse({ articles_per_week: '3' }).success).toBe(false);
  });

  /**
   * La cadenza viene RIDOTTA al tetto del piano invece di essere rifiutata — è ciò che fa il form
   * del browser, e due comportamenti diversi per lo stesso campo sarebbero una divergenza. Ma un
   * agente che non rilegge crederebbe di aver salvato il numero che ha chiesto: per questo la
   * risposta riporta la configurazione, e la descrizione dice di rileggerla.
   */
  it('dice che la cadenza viene ridotta al tetto, non rifiutata', () => {
    expect(SET_BLOG_SETTINGS.description).toMatch(/CLAMPED to the plan/);
    expect(Object.keys(SET_BLOG_SETTINGS.output.shape)).toContain('config');
  });

  it('dice cosa lascia dietro ogni cancellazione, che è diversa per ognuna', () => {
    // Categoria e autore staccano un riferimento; un tag sparisce da ogni articolo che lo aveva.
    // Sono tre conseguenze diverse, e l'agente le deve poter riferire prima di eseguire.
    expect(REMOVE_BLOG_TERM.description).toMatch(/CATEGORY leaves its articles filed under nothing/);
    expect(REMOVE_BLOG_TERM.description).toMatch(/TAG takes that tag off every article/);
    expect(REMOVE_BLOG_TERM.description).toMatch(/AUTHOR clears\s+the byline/);
  });

  it('cancellare è distruttivo, creare e configurare no', () => {
    expect(REMOVE_BLOG_TERM.destructive).toBe(true);
    expect(ADD_BLOG_TERM.destructive).toBe(false);
    expect(SET_BLOG_SETTINGS.destructive).toBe(false);
  });

  it('conosce le tre liste e nessun’altra', () => {
    for (const kind of BLOG_TERM_KINDS) {
      expect(ADD_BLOG_TERM.input.safeParse({ term: kind, name: 'x' }).success, kind).toBe(true);
    }
    expect(ADD_BLOG_TERM.input.safeParse({ term: 'series', name: 'x' }).success).toBe(false);
    expect(ADD_BLOG_TERM.input.safeParse({ term: 'tag', name: '' }).success).toBe(false);
  });

  it('uno slug già preso è un conflitto, non un secondo record silenzioso', () => {
    expect(statusForFailure(ADD_BLOG_TERM, 'slug_taken')).toBe(409);
    expect(statusForFailure(ADD_BLOG_TERM, 'empty_slug')).toBe(400);
    expect(statusForFailure(ADD_BLOG_TERM, 'field_not_for_term')).toBe(400);
  });

  it('non promette di poter caricare immagini da qui', () => {
    // Icona del blog e avatar di un autore sono file: un campo che li accettasse come stringa
    // farebbe salvare una URL che nessuno ha verificato.
    expect(Object.keys(SET_BLOG_SETTINGS.input.shape)).not.toContain('icon_url');
    expect(Object.keys(ADD_BLOG_TERM.input.shape)).not.toContain('avatar_url');
    expect(ADD_BLOG_TERM.description).toMatch(/avatar is an image and cannot be/);
  });

  /**
   * Il campo che Andrea ha chiesto — "script js nell'head" — esiste SOLO come elenco chiuso di
   * fornitori con un id. Un campo `<script>` libero sarebbe esecuzione di codice arbitrario sulle
   * pagine del cliente, e su `/blog/<slug>` anche sulla nostra origine.
   */
  it('non esiste nessun campo che accetti markup o codice', () => {
    const fields = Object.keys(SET_BLOG_SETTINGS.input.shape);
    for (const forbidden of ['head_scripts', 'head_html', 'custom_script', 'scripts', 'html']) {
      expect(fields, forbidden).not.toContain(forbidden);
    }
    expect(SET_BLOG_SETTINGS.input.safeParse({ analytics: [{ provider: 'ga4', id: 'G-ABC123' }] }).success).toBe(true);
    expect(
      SET_BLOG_SETTINGS.input.safeParse({ analytics: [{ provider: 'custom', id: '<script>x</script>' }] }).success
    ).toBe(false);
  });

  it('un id di misurazione non può contenere niente che chiuda un tag o una stringa', () => {
    // L'id finisce dentro uno snippet del fornitore: se accettasse una virgoletta o un `<`,
    // l'elenco chiuso non servirebbe a niente.
    expect(blogAnalyticsIdOk('ga4', 'G-ABC1234567')).toBe(true);
    expect(blogAnalyticsIdOk('ga4', "G-X';alert(1);//")).toBe(false);
    expect(blogAnalyticsIdOk('ga4', 'G-X</script><script>alert(1)</script>')).toBe(false);
    expect(blogAnalyticsIdOk('meta_pixel', '1234567890')).toBe(true);
    expect(blogAnalyticsIdOk('meta_pixel', 'abc')).toBe(false);
    expect(blogAnalyticsIdOk('plausible', 'example.com')).toBe(true);
    expect(blogAnalyticsIdOk('plausible', 'example.com"/><img onerror=x>')).toBe(false);
    expect(blogAnalyticsIdOk('hotjar', '3512345')).toBe(true);
    expect(blogAnalyticsIdOk('hotjar', '35_12345')).toBe(false);
  });

  it('lo schema rifiuta un id sbagliato per il fornitore, non lo salva e basta', () => {
    expect(SET_BLOG_SETTINGS.input.safeParse({ analytics: [{ provider: 'ga4', id: '1234' }] }).success).toBe(false);
    expect(SET_BLOG_SETTINGS.input.safeParse({ analytics: [{ provider: 'hotjar', id: 'G-ABC123' }] }).success).toBe(
      false
    );
  });

  it('la descrizione dice dove gli script girano davvero, perché non è dove sembra', () => {
    expect(SET_BLOG_SETTINGS.description).toMatch(/verified custom domain/);
    expect(BLOG_ANALYTICS_PROVIDERS).toContain('ga4');
  });

  it('la lettura porta i limiti del piano, non solo la configurazione', () => {
    const parsed = GET_BLOG_SETTINGS.output.safeParse({
      brand: 'demo',
      plan: 'starter',
      config: {
        enabled: true,
        title: null,
        description: null,
        accent: '#111111',
        font: 'sans',
        layout: 'navbar',
        show_blog_link: true,
        humanizer_enabled: true,
        backlink_network: true,
        style_instructions: null,
        articles_per_week: null,
        default_locale: 'it',
        locales: [],
        navbar_links: [],
        icon_url: null,
        analytics: [{ provider: 'ga4', id: 'G-ABC1234567' }]
      },
      limits: { articles_per_week_max: 8, translation_languages: 0, custom_domain: true },
      choices: { fonts: [...BLOG_FONTS], layouts: ['navbar', 'sidebar'], locales: ['it', 'en'] },
      categories: [{ id: 'c1', name: 'Caffè', slug: 'caffe', description: null }],
      tags: [{ id: 't1', name: 'Espresso', slug: 'espresso' }],
      authors: [{ id: 'a1', name: 'Ada', slug: 'ada', role: 'writer', bio: null, avatar_url: null }]
    });
    expect(parsed.success).toBe(true);
  });
});
