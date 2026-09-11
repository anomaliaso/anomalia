import { describe, expect, it } from 'vitest';
import {
  BRAND_ENDPOINTS,
  GENERATE_CAROUSEL,
  GENERATE_IMAGE,
  GENERATE_VIDEO,
  REFINE_MEDIA,
  pathFor,
  pathWithoutBrand
} from './index';

/**
 * Un generatore raggiungibile solo sotto un brand è un generatore che, per disegnare un gatto,
 * chiede a chi lo chiama di scegliere l'azienda a cui addebitarlo. Andrea l'ha visto: l'agente ha
 * risposto di non avere uno strumento per generare immagini, poi ha chiamato quel gatto uno
 * «spreco». Non aveva torto: leggeva quello che c'era scritto.
 *
 * Le due metà si tengono. Un `slug` opzionale che la descrizione non spiega viene riempito lo
 * stesso — con un brand a caso, i cui crediti sono di qualcun altro.
 */
describe('generare senza un brand', () => {
  it('ogni motore dichiara una strada che non passa da nessun brand', () => {
    expect(pathWithoutBrand(GENERATE_IMAGE)).toBe('/api/v1/images');
    expect(pathWithoutBrand(GENERATE_VIDEO)).toBe('/api/v1/videos');
    expect(pathWithoutBrand(GENERATE_CAROUSEL)).toBe('/api/v1/carousel');
    expect(pathWithoutBrand(REFINE_MEDIA)).toBe('/api/v1/refine');
  });

  it('tiene le strade del brand esattamente dov erano', () => {
    expect(pathFor(GENERATE_IMAGE, 'demo')).toBe('/api/v1/brands/demo/media/images');
    expect(pathFor(GENERATE_VIDEO, 'demo')).toBe('/api/v1/brands/demo/media/videos');
    expect(pathFor(GENERATE_CAROUSEL, 'demo')).toBe('/api/v1/brands/demo/media/carousel');
    expect(pathFor(REFINE_MEDIA, 'demo')).toBe('/api/v1/brands/demo/media/refine');
  });

  /**
   * I quattro motori, e soltanto loro. Un `slug` opzionale sparso altrove toglierebbe il confine
   * invece di aprire una porta: `pathWithoutBrand` è ciò che rende opzionale lo slug su MCP.
   */
  it('sono i quattro motori a saperne fare a meno, e nessun altro', () => {
    const brandFree = BRAND_ENDPOINTS.filter((e) => e.pathWithoutBrand);

    expect(brandFree.map((e) => e.tool).sort()).toEqual([
      'generate_carousel',
      'generate_image',
      'generate_video',
      'refine_media'
    ]);
  });

  /**
   * Gli editor di un post restano ancorati, e non per dimenticanza: lavorano su una riga di
   * `posts`, che appartiene a un brand. Senza brand non c'è il post da modificare, quindi non c'è
   * niente da aprire — dichiararli sarebbe una porta su una stanza che non esiste.
   */
  it('chi lavora su un post resta ancorato al brand del post', () => {
    for (const tool of ['regenerate_slide', 'reorder_slides', 'regenerate_post_media', 'make_video']) {
      const anchored = BRAND_ENDPOINTS.find((e) => e.tool === tool);

      expect(pathWithoutBrand(anchored!), tool).toBeNull();
    }
  });
});

/**
 * La descrizione è metà del lavoro: uno slug reso opzionale senza dirlo nel campo è il difetto già
 * pagato — un modello lo riempie comunque, scegliendo un brand a caso, con i crediti di qualcun
 * altro. Ogni motore deve dire che cosa cambia quando lo slug non c'è.
 */
describe('le descrizioni dicono che cosa cambia senza slug', () => {
  for (const endpoint of [GENERATE_IMAGE, GENERATE_VIDEO, GENERATE_CAROUSEL, REFINE_MEDIA]) {
    it(`${endpoint.tool} dice che senza slug non c e un brand`, () => {
      expect(endpoint.description).toMatch(/WITHOUT slug/);
    });

    it(`${endpoint.tool} vieta di cercare un brand per decidere dove generare`, () => {
      expect(endpoint.description).toMatch(/Do NOT call list_brands/);
    });
  }

  it('generate_video dice dove si ritrova un clip che nessuna libreria reclama', () => {
    expect(GENERATE_VIDEO.description).toMatch(/GET \/api\/v1\/videos/);
  });

  it('refine_media dice che la sorgente è la maniglia consegnata, non un indirizzo', () => {
    expect(REFINE_MEDIA.input.shape.base_media_id.description).toMatch(/storage_path/);
    expect(REFINE_MEDIA.description).toMatch(/never a web address/);
  });
});

/**
 * Chi paga viene DETTO, su ogni strada senza brand: il chiamante non l'ha scelto, e un addebito
 * che nessuno ha nominato è un addebito che nessuno controlla.
 */
describe('chi paga è nominato in ogni risposta', () => {
  for (const endpoint of [GENERATE_IMAGE, GENERATE_VIDEO, GENERATE_CAROUSEL, REFINE_MEDIA]) {
    it(`${endpoint.tool} porta l organizzazione nella risposta`, () => {
      expect((endpoint.output as { shape: Record<string, unknown> }).shape.organization).toBeDefined();
    });

    it(`${endpoint.tool} dichiara i rifiuti della strada senza brand`, () => {
      const errors = endpoint.failures.map((f) => f.error);

      expect(errors).toContain('brand_scoped_key');
      expect(errors).toContain('no_organization');
    });
  }
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
   * Prima il look del brand non raggiungeva questo strumento nemmeno con lo slug, e la
   * descrizione lo diceva. Ora `runImageJob` legge `loadBrandVisualContext`, quindi la promessa
   * si e' capovolta: con lo slug si applica, senza non c'e' un brand da cui prenderlo, e
   * `brand_style: ignore` lo spegne. Le tre cose stanno insieme perche' e' la coppia
   * slug/parametro a decidere, non una sola delle due.
   */
  it('dice che con lo slug lo stile del brand si applica, e senza no', () => {
    expect(text).toMatch(/this brand.s own look is applied by default/);
    expect(text).toMatch(/Without a slug there is no brand and none of that reaches the model/);
    expect(text).toMatch(/brand_style: ignore leaves them out/);
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
