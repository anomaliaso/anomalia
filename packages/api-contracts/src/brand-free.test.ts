import { describe, expect, it } from 'vitest';
import { BRAND_ENDPOINTS, GENERATE_IMAGE, pathFor, pathWithoutBrand } from './index';

/**
 * Un generatore raggiungibile solo sotto un brand è un generatore che, per disegnare un gatto,
 * chiede a chi lo chiama di scegliere l'azienda a cui addebitarlo. Andrea l'ha visto: l'agente ha
 * risposto di non avere uno strumento per generare immagini, poi ha chiamato quel gatto uno
 * «spreco». Non aveva torto: leggeva quello che c'era scritto.
 *
 * Le due metà si tengono. Un `slug` opzionale che la descrizione non spiega viene riempito lo
 * stesso — con un brand a caso, i cui crediti sono di qualcun altro.
 */
describe('generate_image senza un brand', () => {
  it('dichiara una strada che non passa da nessun brand', () => {
    expect(pathWithoutBrand(GENERATE_IMAGE)).toBe('/api/v1/images');
  });

  it('tiene la strada del brand esattamente dov era', () => {
    expect(pathFor(GENERATE_IMAGE, 'demo')).toBe('/api/v1/brands/demo/media/images');
  });

  it('è l unico endpoint che dichiara di saperne fare a meno', () => {
    const brandFree = BRAND_ENDPOINTS.filter((e) => e.pathWithoutBrand);

    expect(brandFree.map((e) => e.tool)).toEqual(['generate_image']);
  });

  it('un endpoint che non lo dichiara non ha una strada senza brand', () => {
    const anchored = BRAND_ENDPOINTS.find((e) => e.tool === 'refine_image');

    expect(pathWithoutBrand(anchored!)).toBeNull();
  });
});

/**
 * La descrizione è metà del lavoro, e il test guarda le frasi che hanno prodotto il rifiuto.
 * «about 8 credits each» era una tariffa scritta a mano: invecchia, e intanto insegna al modello
 * che chiamare lo strumento è uno spreco. Il costo lo dice la risposta, misurato.
 */
describe('la descrizione di generate_image', () => {
  const text = GENERATE_IMAGE.description;

  it('non stampa una tariffa in crediti scritta a mano', () => {
    expect(text).not.toMatch(/\d+\s*credits/i);
  });

  /**
   * La prima riga è quella che un modello legge scorrendo `tools/list`. Deve contenere la domanda
   * dell'utente («genera un'immagine di un gatto»), non il posto dove l'asset finisce.
   */
  it('apre sul disegnare, con le parole della domanda', () => {
    const opening = text.slice(0, 80).toLowerCase();

    expect(opening).toMatch(/draw/);
    expect(opening).toMatch(/image of a cat/);
    expect(opening).not.toMatch(/library/);
  });

  it('dice che senza slug si genera e basta', () => {
    expect(text).toMatch(/WITHOUT slug/);
  });

  it('vieta di cercare un brand per decidere dove generare', () => {
    expect(text).toMatch(/Do NOT call list_brands/);
  });

  it('dice che senza brand l id non esiste e non c e niente per create_post', () => {
    expect(text).toMatch(/id comes back null/);
  });

  /**
   * Il look del brand NON raggiunge questo strumento: `runImageJob` passa solo
   * `{model, refineModel, baseImage, aspectRatio}`. Una descrizione che lascia credere il
   * contrario promette quello che il codice non fa.
   */
  it('nega esplicitamente che uno slug compri lo stile del brand', () => {
    expect(text).toMatch(/nothing about a brand.s look reaches the model/);
  });

  it('tiene la freccia al passo successivo per chi il brand ce l ha', () => {
    expect(text).toMatch(/create_post takes as media_ids/);
  });

  it('dice ancora che si paga, e dove leggere quanto', () => {
    expect(text).toMatch(/cost_usd/);
  });
});

describe('lo schema di generate_image', () => {
  it('non promette un id quando non c e una libreria dove metterlo', () => {
    const parsed = GENERATE_IMAGE.output.safeParse({
      ok: true,
      media: [{ id: null, kind: 'image', mime: 'image/png', width: 1, height: 1, url: 'https://x', storage_path: 'u/media/a.png' }],
      model: 'nano-banana-2-lite',
      renders: 1,
      organization: { id: 'org-1', name: 'Acme' },
      cost_usd: 0.0336
    });

    expect(parsed.success).toBe(true);
  });

  it('accetta ancora la risposta di oggi, con l id e senza organizzazione', () => {
    const parsed = GENERATE_IMAGE.output.safeParse({
      ok: true,
      media: [{ id: 'media-1', kind: 'image', mime: 'image/png', width: 1, height: 1, url: 'https://x', storage_path: null }],
      model: 'nano-banana-2-lite',
      renders: 1,
      organization: null,
      cost_usd: null
    });

    expect(parsed.success).toBe(true);
  });
});
