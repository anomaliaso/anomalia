import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { BRAND_ENDPOINTS } from '../lib/contracts/index.ts';

/**
 * Un tool si trova con le parole di chi lo cerca, non con le nostre.
 *
 * Ogni riga è una richiesta arrivata davvero in chat e il tool che avrebbe dovuto risponderle.
 * Se la descrizione non contiene quelle parole il modello scorre `tools/list` e non lo riconosce:
 * è così che «puoi generare la img di un gatto?» ha ricevuto «non ho uno strumento di generazione
 * immagini» con `generate_image` nella lista, e «rendi rossa questa foto» ha prodotto un disegno
 * nuovo con `refine_image` nella stessa lista.
 *
 * IL CONTROLLO VALE SU DUE SUPERFICI, non una. La skill si legge PRIMA dei contratti, quindi non
 * sono «il lavoro e il suo allineamento»: sono due prompt in concorrenza, e vince quello che
 * l'agente incontra per primo. Il terzo fallimento lo dimostra — «l'animazione è esposta solo per
 * la copertina di un post» veniva dalla skill, mentre `generate_video` diceva già la cosa giusta.
 * Un test sulle sole descrizioni sarebbe passato mentre l'agente si arrendeva.
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
  { tool: 'refine_image', question: 'make this photo red', words: ['change', 'photo', 'red'] },
  {
    tool: 'generate_video',
    question: 'animate this photo with a 5 second video',
    words: ['animate', 'photo', 'video', 'clip']
  },
  { tool: 'make_video', question: 'turn this post into a video', words: ['post', 'video', 'animate'] },
  {
    tool: 'generate_media',
    question: 'generate an image or a video',
    words: ['image', 'video', 'generate_image', 'generate_video']
  },
  {
    tool: 'render_post',
    question: 'this post has no image, draw it',
    words: ['image', 'post', 'prompt']
  },
  {
    tool: 'regenerate_post_media',
    question: 'change the image on this post',
    words: ['change', 'image', 'post', 'refine_image']
  },
  {
    tool: 'search_knowledge',
    question: 'what does this brand know about returns',
    words: ['question', 'documents', 'answer']
  },
  {
    tool: 'get_voice',
    question: 'how is this brand supposed to sound',
    words: ['sound', 'tone', 'brand']
  },
  {
    tool: 'geo_action',
    question: 'do assistants mention us when someone asks',
    words: ['chatgpt', 'brand', 'cited']
  },
  {
    tool: 'query',
    question: 'how many posts went out last month',
    words: ['table', 'count', 'read']
  }
];

const HAND_WRITTEN_TARIFF = /\b\d+\s*credits?\b/i;

/**
 * L'unica tariffa ancora scritta a mano, e perché non la tolgo qui: la descrizione di
 * `generate_image` viaggia insieme al lavoro che rende `slug` opzionale, su un altro branch —
 * un parametro opzionale che la descrizione non spiega viene riempito lo stesso. Riscriverla in
 * due posti sarebbe un conflitto garantito.
 *
 * L'eccezione è dichiarata e si verifica da sola: il test pretende che la tariffa sia ANCORA lì.
 * Quando quel branch atterra il test diventa rosso e chiede di cancellare questa riga, invece di
 * lasciare un'esenzione che sopravvive al motivo che l'aveva giustificata.
 */
const TARIFF_OWNED_ELSEWHERE = ['generate_image'];

const SKILL_DIR = fileURLToPath(new URL('./anomalia/', import.meta.url));
const skillProse = [
  readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'),
  readFileSync(join(SKILL_DIR, 'references', 'tools.md'), 'utf8')
]
  .join('\n')
  .toLowerCase();

const describing = (tool: string): string => {
  const found = BRAND_ENDPOINTS.find((e) => e.tool === tool);
  if (!found) throw new Error(`missing endpoint ${tool}`);
  return found.description;
};

describe('una descrizione si legge cercando il proprio problema', () => {
  for (const { tool, question, words } of ASKED_FOR) {
    test(`«${question}» trova ${tool} nella lista dei tool`, () => {
      const description = describing(tool).toLowerCase();

      for (const word of words) {
        expect(description, `${tool} ← ${word}`).toContain(word);
      }
    });

    test(`«${question}» trova ${tool} anche nella skill, che si legge prima`, () => {
      for (const word of words) {
        expect(skillProse, `skill ← ${tool} ← ${word}`).toContain(word);
      }
    });
  }

  test('nessuna descrizione scrive una tariffa a mano: il prezzo lo misura la risposta', () => {
    for (const endpoint of BRAND_ENDPOINTS) {
      if (TARIFF_OWNED_ELSEWHERE.includes(endpoint.tool)) continue;

      expect(HAND_WRITTEN_TARIFF.test(endpoint.description), endpoint.tool).toBe(false);
    }
  });

  test('l’unica esenzione è ancora vera, o va cancellata invece che ereditata', () => {
    for (const tool of TARIFF_OWNED_ELSEWHERE) {
      expect(HAND_WRITTEN_TARIFF.test(describing(tool)), `${tool}: togli la riga`).toBe(true);
    }
  });

  /**
   * Il rovescio della regola sulle tariffe: se il prezzo non si scrive, la SPESA va dichiarata,
   * sempre e con le stesse parole. Un agente prudente evita cio` di cui non conosce il prezzo, e
   * un tool che tace su una spesa reale e` peggio di uno che la annuncia. Il registro sa gia` chi
   * paga: `credits_exhausted` fra i suoi rifiuti.
   */
  test('ogni tool che puo` restare senza crediti dice che spende', () => {
    for (const endpoint of BRAND_ENDPOINTS) {
      if (TARIFF_OWNED_ELSEWHERE.includes(endpoint.tool)) continue;
      if (!endpoint.failures.some((f) => f.error === 'credits_exhausted')) continue;

      expect(endpoint.description, endpoint.tool).toMatch(/spends? credits/i);
    }
  });

  test('nemmeno la skill la scrive: le due superfici dicono la stessa cosa', () => {
    expect(HAND_WRITTEN_TARIFF.test(skillProse)).toBe(false);
  });
});
