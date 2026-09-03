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
