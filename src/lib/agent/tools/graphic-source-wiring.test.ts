import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Il resolver della CHAT decide su cosa lavorano grep/read/replace/write_source. Finché nominava
 * solo `post_id`, una grafica senza post aveva un sorgente che nessuno sapeva aprire: modificabile
 * a parole con `design_graphic`, non correggibile di una parola. Questa guardia sta qui perché il
 * difetto era nel CABLAGGIO, non nelle funzioni — che erano gia` a posto e testate.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * IL CABLAGGIO NON BASTA SE LA DESCRIZIONE LO NASCONDE.
 *
 * Reso `media_id` accettabile dalle quattro tool, in chat non cambiava NIENTE: l'agente continuava
 * a rifare la grafica intera da un brief di 900 caratteri, un solo tool call. La riga che dice
 * QUANDO preferire la strada chirurgica finiva con «(pass post_id)» — su una grafica senza post il
 * modello leggeva che quella strada non era disponibile, e ripiegava.
 *
 * Un tool raggiungibile e non annunciato è un tool che non esiste.
 */
describe('la strada chirurgica viene offerta anche senza post', () => {
  it('la descrizione di design_graphic nomina media_id accanto a post_id', () => {
    const src = read('./create-content-tools.ts');
    const line = src
      .split('\n')
      .find((l) => l.includes('prefer grep_source') || l.includes('For a copy/color/spacing patch on an existing graphic'));

    expect(line).toBeDefined();
    expect(line).toMatch(/media_id/);
    expect(line).not.toMatch(/\(pass post_id\)/);
  });

  it('il prompt di sistema dice che le quattro tool valgono su entrambi', () => {
    const src = read('../../server/chat/agents.ts');
    const line = src.split('\n').find((l) => l.includes('Graphics are editable source'));

    expect(line).toBeDefined();
    expect(line).toMatch(/media_id/);
  });
});

describe('la chat sa raggiungere una grafica senza post', () => {
  it('il resolver accetta media_id e risolve sull\'asset di libreria', () => {
    const src = read('./index.ts');
    const start = src.indexOf('createGraphicSourceEditTools(');
    const block = src.slice(start, src.indexOf('requirePostId: true', start));

    expect(block).toMatch(/media_id/);
    expect(block).toMatch(/media_generator_items/);
    expect(block).toMatch(/mediaId: media_id/);
    // Un bersaglio va nominato: senza nessuno dei due l'errore lo dice, invece di indovinare.
    expect(block).toMatch(/post_id.*media_id|media_id.*post_id/s);
  });
});
