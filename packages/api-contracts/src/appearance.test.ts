import { describe, expect, it } from 'vitest';
import { GET_APPEARANCE, SET_APPEARANCE } from './appearance';
import { BRAND_ENDPOINTS, statusForFailure } from './index';

describe('il look del brand come contratto', () => {
  it('sta nel registry, o nessun agente lo vede', () => {
    expect(BRAND_ENDPOINTS).toContain(GET_APPEARANCE);
    expect(BRAND_ENDPOINTS).toContain(SET_APPEARANCE);
  });

  /**
   * Il campo si chiama `logo_url` ma non e' una URL che salviamo: la scarichiamo. Se la salvassimo,
   * ogni grafica del brand mostrerebbe un'immagine che un altro puo' cambiare o togliere dopo.
   */
  it('dice che il logo viene scaricato, non collegato', () => {
    expect(SET_APPEARANCE.description).toMatch(/DOWNLOADED and kept in our storage, not linked/);
  });

  it('rifiuta un indirizzo che non e’ un indirizzo', () => {
    expect(SET_APPEARANCE.input.safeParse({ logo_url: 'not a url' }).success).toBe(false);
    expect(SET_APPEARANCE.input.safeParse({ logo_url: 'https://cdn.example.com/logo.png' }).success).toBe(true);
  });

  it('non ha un campo per caricare byte: quello resta il form', () => {
    const fields = Object.keys(SET_APPEARANCE.input.shape);
    for (const forbidden of ['file', 'logo', 'image', 'bytes', 'base64']) {
      expect(fields, forbidden).not.toContain(forbidden);
    }
  });

  it('mettere e togliere il logo nella stessa richiesta e’ un rifiuto dichiarato', () => {
    expect(statusForFailure(SET_APPEARANCE, 'logo_conflict')).toBe(400);
  });

  it('un font che Google Fonts non serve e’ un rifiuto, non un Inter silenzioso', () => {
    expect(statusForFailure(SET_APPEARANCE, 'font_not_available')).toBe(400);
    expect(SET_APPEARANCE.description).toMatch(/renders as Inter with nothing said/);
  });

  it('una richiesta vuota e’ un rifiuto dichiarato', () => {
    expect(statusForFailure(SET_APPEARANCE, 'no_fields')).toBe(400);
  });

  it('dice che scrivere il brief visivo lo blocca', () => {
    expect(SET_APPEARANCE.description).toMatch(/LOCKS it/);
    expect(Object.keys(GET_APPEARANCE.output.shape)).toContain('appearance');
  });

  it('leggere non e’ scrivere, e nessuno dei due e’ distruttivo', () => {
    expect(GET_APPEARANCE.method).toBe('GET');
    expect(SET_APPEARANCE.method).toBe('PUT');
    expect(GET_APPEARANCE.destructive).toBe(false);
    expect(SET_APPEARANCE.destructive).toBe(false);
  });
});
