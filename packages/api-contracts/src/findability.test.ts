import { describe, expect, it } from 'vitest';
import { BRAND_ENDPOINTS, type BrandEndpoint } from './index';

/**
 * Un tool si trova con le parole di chi lo cerca, non con le nostre.
 *
 * Ogni riga è una richiesta arrivata davvero in chat e il tool che avrebbe dovuto risponderle.
 * Se la descrizione non contiene quelle parole il modello scorre `tools/list` e non lo riconosce:
 * è così che «puoi generare la img di un gatto?» ha ricevuto «non ho uno strumento di generazione
 * immagini» con `generate_image` nella lista, e «rendi rossa questa foto» ha prodotto un disegno
 * nuovo con `refine_image` nella stessa lista.
 *
 * La seconda regola è la tariffa. «about 8 credits each» è il numero che ha fatto chiamare
 * «spreco» una generazione richiesta dall'utente, ed è pure sbagliato: il prezzo lo dice la
 * risposta, misurato, non la descrizione, stimato. Che il tool spenda va detto; quanto, no.
 *
 * Il divieto vale QUI e nella prosa della skill — le superfici che un agente legge per decidere —
 * e non nel codice né nella storia: `content-cost.ts` documenta mediane di produzione misurate e
 * i changelog citano cifre perché quelle cifre SONO l'argomento di una decisione presa.
 */
const ASKED_FOR: ReadonlyArray<{ tool: string; question: string; words: readonly string[] }> = [
  {
    tool: 'refine_image',
    question: 'make this photo red',
    words: ['change', 'photo', 'already', 'red']
  },
  {
    tool: 'generate_video',
    question: 'animate this photo with a 5 second video',
    words: ['animate', 'photo', 'video', 'clip']
  },
  {
    tool: 'make_video',
    question: 'turn this post into a video',
    words: ['post', 'video', 'animate', 'cover']
  },
  {
    tool: 'generate_media',
    question: 'generate an image or a video',
    words: ['image', 'video', 'generate_image', 'generate_video']
  }
];

const HAND_WRITTEN_TARIFF = /\b\d+\s*credits?\b/i;

const byTool = (tool: string): BrandEndpoint => {
  const found = BRAND_ENDPOINTS.find((e) => e.tool === tool);
  if (!found) throw new Error(`missing endpoint ${tool}`);
  return found;
};

describe('una descrizione si legge cercando il proprio problema', () => {
  for (const { tool, question, words } of ASKED_FOR) {
    it(`«${question}» trova ${tool}`, () => {
      const description = byTool(tool).description.toLowerCase();

      for (const word of words) {
        expect(description, `${tool} ← ${word}`).toContain(word);
      }
    });
  }

  it('nessuna di loro scrive una tariffa a mano: il prezzo lo misura la risposta', () => {
    for (const { tool } of ASKED_FOR) {
      expect(HAND_WRITTEN_TARIFF.test(byTool(tool).description), tool).toBe(false);
    }
  });
});
