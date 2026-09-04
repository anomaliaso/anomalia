import { describe, it, expect } from 'vitest';
import {
  isKnownTimezone,
  normalizeHashtags,
  normalizeWebsite,
  sanitizeBrandColors
} from './brand-fields';

/**
 * Queste tre funzioni esistono per una ragione sola: il form dello Studio e i tool della chat
 * scrivono le STESSE colonne, e finché validavano in due modi diversi l'agente poteva salvare
 * valori che la UI avrebbe rifiutato. Il guaio è che nessuno di quei valori fallisce a valle —
 * escono stampati su un'immagine o pubblicati in una caption. Quindi si prova qui.
 */

describe('sanitizeBrandColors', () => {
  it('tiene solo la notazione hex, come il campo del form', () => {
    expect(sanitizeBrandColors(['#FF5733', 'rgb(1,2,3)', 'red', '#abc', ' #00FF00 '])).toEqual([
      '#FF5733',
      '#abc',
      '#00FF00'
    ]);
  });

  it('taglia a 8: è il numero di swatch che la UI mostra, non un dettaglio', () => {
    const forty = Array.from({ length: 40 }, (_, i) => `#${String(i).padStart(6, '0')}`);
    expect(sanitizeBrandColors(forty)).toHaveLength(8);
  });

  it('non esplode su qualcosa che non è una lista', () => {
    expect(sanitizeBrandColors('#fff')).toEqual([]);
    expect(sanitizeBrandColors(null)).toEqual([]);
  });
});

describe('normalizeWebsite', () => {
  it('mette lo schema a un dominio nudo', () => {
    expect(normalizeWebsite('anomalia.so')).toBe('https://anomalia.so');
  });

  it('lascia stare un URL che ce l’ha già', () => {
    expect(normalizeWebsite('http://anomalia.so/x')).toBe('http://anomalia.so/x');
  });

  it('vuoto è null, non stringa vuota: la colonna deve poter essere "non impostata"', () => {
    expect(normalizeWebsite('   ')).toBeNull();
  });
});

describe('normalizeHashtags', () => {
  it('toglie spazi e punteggiatura, deduplica, mette un solo #', () => {
    expect(normalizeHashtags('#brand summer, ##Promo! brand')).toEqual(['#brand', '#summer', '#Promo']);
  });

  it('si ferma a 30: un solo campo non può diventare un muro di tag', () => {
    const many = Array.from({ length: 50 }, (_, i) => `#t${i}`).join(' ');
    expect(normalizeHashtags(many)).toHaveLength(30);
  });
});

describe('il fuso orario del brand', () => {
  it('accetta una zona IANA vera', () => {
    expect(isKnownTimezone('Europe/Rome')).toBe(true);
    expect(isKnownTimezone('America/New_York')).toBe(true);
  });

  it('accetta anche gli alias storici, che restano fusi validi', () => {
    // `Asia/Calcutta` non è nell'elenco moderno ma ICU lo risolve: rifiutarlo direbbe "non
    // esiste" a un brand che ce l'ha salvato da anni.
    expect(isKnownTimezone('Asia/Calcutta')).toBe(true);
  });

  it('rifiuta ciò che non è un fuso, invece di salvarlo e romperlo dopo', () => {
    // La colonna decide l'ora locale di ogni slot futuro: una stringa qualunque non fallisce al
    // salvataggio, fallisce quando il calendario prova a calcolare un orario.
    expect(isKnownTimezone('Europe/Atlantide')).toBe(false);
    expect(isKnownTimezone('CET+1')).toBe(false);
    expect(isKnownTimezone('')).toBe(false);
    expect(isKnownTimezone('   ')).toBe(false);
  });
});
