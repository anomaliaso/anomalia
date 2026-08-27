import { describe, expect, it } from 'vitest';
import {
  renderDesignDoc,
  normalizeColors,
  normalizeFonts,
  normalizeLogos,
  normalizeImageUrls,
  normalizeStoragePaths,
  formatPricing,
  embedBrief,
  renderProductsSection,
  renderCompetitorsSection,
  loadDesignDoc,
  type DesignDocInput
} from './brand-design-doc';

const full = (): DesignDocInput => ({
  brandName: 'Caffè Milano',
  kit: {
    category: 'Caffè specialty',
    site_type: 'ecommerce',
    about: 'Torrefazione artigianale a Milano',
    target_audience: 'Giovani professionisti urbani',
    brand_style: 'Minimal, caldo, autentico',
    brand_colors: ['#7c5cff', { hex: '#ffffff' }],
    theme_color: '#7c5cff',
    fonts: [{ name: 'Inter', source: 'google' }, 'Georgia'],
    logos: [
      { url: 'https://caffemilano.it/logo.png', type: 'html-img-src' },
      { url: 'https://caffemilano.it/og.png', type: 'og-image' }
    ],
    favicon_url: 'https://caffemilano.it/favicon.ico',
    images: ['https://caffemilano.it/hero.jpg'],
    content_pillars: ['Dietro le quinte', 'Educazione al caffè'],
    visual_style: '## VISUAL STYLE\n\n### PALETTE\n- #7c5cff — primario',
    ai_context: 'VOCE: diretta.\n\n### GUARDRAIL\n- COSA NON FA: non spedisce fuori dall UE.',
    graphic_style: { display_font: 'Playfair Display', body_font: 'Inter', instructions: 'Poco testo, molto respiro.', why: 'Serif caldo su sans neutro.' },
    ai_character: { name: 'Giulia', role: 'barista', personality: 'ironica', empty: '' }
  },
  voice: { mood: 'caldo', tone: 'diretto', goal: '', register: 'informale' },
  language: 'it',
  targetPlatforms: ['instagram', 'tiktok'],
  products: [
    {
      id: 'p1',
      title: 'Blend Milano',
      description: 'Blend  arabica\n100%',
      kind: 'product',
      pricing: { amount: 18.5, currency: 'EUR' },
      featured: true,
      url: 'https://caffemilano.it/blend',
      images: ['https://caffemilano.it/blend.jpg', { src: 'https://caffemilano.it/blend-2.jpg' }]
    }
  ],
  people: [
    { id: 'pe1', name: 'Giulia', role: 'fondatrice', kind: 'real', description: 'Founder', images: [{ path: 'brand-knowledge/people/giulia.jpg' }] }
  ],
  documents: [
    { id: 'd1', collection: 'brand', title: 'Tone of voice', summary: 'Come parliamo', chunk_count: 12, status: 'ready' }
  ],
  competitors: [{ name: 'Caffè Rivale', website: 'https://cafferivale.it', kind: 'direct', rationale: 'Stessa fascia' }]
});

describe('renderDesignDoc', () => {
  it('renders the whole Studio as one stable document', () => {
    expect(renderDesignDoc(full())).toMatchInlineSnapshot(`
      "# DESIGN.md — Caffè Milano
      Every line below is a field of this brand's Studio, rendered as-is: nothing here was invented at
      request time. When something is wrong, the fix is the Studio field, not a correction in chat.

      ## IDENTITY
      - **Category**: Caffè specialty
      - **Business type**: ecommerce
      - **About**: Torrefazione artigianale a Milano
      - **Audience**: Giovani professionisti urbani
      - **Content language**: it
      - **Target platforms**: instagram, tiktok

      ## VOICE
      - **Style**: Minimal, caldo, autentico
      - **Locked voice**: mood=caldo, tone=diretto, register=informale

      ## COLOURS, TYPE & MARKS
      - **Palette**: #7c5cff · #ffffff
      - **Theme colour**: #7c5cff
      - **Fonts**: Inter · google · Georgia
      - **Logo**: https://caffemilano.it/logo.png
      - **Favicon**: https://caffemilano.it/favicon.ico
      - **Brand imagery**: https://caffemilano.it/hero.jpg
      - These are public URLs: link them, or pass one as a visual reference. Match the palette exactly — never approximate a brand colour.

      ## GRAPHIC DIRECTION
      - **Display font**: Playfair Display
      - **Body font**: Inter
      - **Art direction**: Poco testo, molto respiro.
      - **Why this pairing**: Serif caldo su sans neutro.

      ## CONTENT PILLARS
      - Dietro le quinte
      - Educazione al caffè

      ## PRODUCTS & SERVICES (1)
      - **Blend Milano** ★ (product, 18.5 EUR)
        - page: https://caffemilano.it/blend
        - images: https://caffemilano.it/blend.jpg · https://caffemilano.it/blend-2.jpg
        - Blend arabica 100%
        - id: p1
      - Link products with the exact URL above, never a guessed one. The image URLs are usable as-is as visual references. read_products for full detail; sync_products when an ecommerce brand is missing URLs.

      ## TEAM & PEOPLE (1)
      - **Giulia** (real, fondatrice): Founder
        - photos (private storage paths, not fetchable URLs): brand-knowledge/people/giulia.jpg
        - id: pe1
      - Pass people ids into create_post / generate_image so the same face stays consistent across posts. The photo paths are private: a tool signs them, you cannot fetch them.

      ## COMPETITORS (1)
      - **Caffè Rivale** (direct): Stessa fascia — https://cafferivale.it

      ## BRAND DOCUMENTS (1)
      - [brand] Tone of voice {d1} — Come parliamo (12 chunks)
      - Titles only. Use search_knowledge / read_document for content; {id} goes in document_ids.

      ## VISUAL STYLE

      ### PALETTE
      - #7c5cff — primario

      ## BRAND CONTEXT & HISTORY
      VOCE: diretta.

      ### GUARDRAIL
      - COSA NON FA: non spedisce fuori dall UE.

      ## AI CHARACTER
      - **name**: Giulia
      - **role**: barista
      - **personality**: ironica"
    `);
  });

  it('is pure — same input, byte-identical output (safe in the prompt-cache prefix)', () => {
    expect(renderDesignDoc(full())).toBe(renderDesignDoc(full()));
  });

  it('renders nothing for an empty Studio — a bare title reads as "already described"', () => {
    expect(renderDesignDoc({ brandName: 'Nuovo', kit: null })).toBe('');
    expect(renderDesignDoc({ brandName: 'Nuovo', kit: {}, products: [], people: [] })).toBe('');
  });

  it('never prints undefined or null for a half-filled Studio', () => {
    const doc = renderDesignDoc({ brandName: 'Nuovo', kit: { about: 'Solo questo' } });
    expect(doc).toContain('## IDENTITY');
    expect(doc).not.toContain('undefined');
    expect(doc).not.toContain('null');
  });

  it('never leaks a signed URL for private assets — people photos stay storage paths', () => {
    const doc = renderDesignDoc(full());
    expect(doc).toContain('brand-knowledge/people/giulia.jpg');
    expect(doc).not.toContain('token=');
    expect(doc).not.toContain('/storage/v1/object/sign');
  });

  it('drops tool hints when the reader has no tools', () => {
    const doc = renderDesignDoc(full(), { toolHints: false });
    expect(doc).toContain('## PRODUCTS & SERVICES (1)');
    expect(doc).not.toContain('read_products');
    expect(doc).not.toContain('search_knowledge');
  });

  it('switches sections off one by one, and leaves the rest on', () => {
    const doc = renderDesignDoc(full(), { include: { products: false, documents: false } });
    expect(doc).not.toContain('PRODUCTS & SERVICES');
    expect(doc).not.toContain('BRAND DOCUMENTS');
    expect(doc).toContain('TEAM & PEOPLE');
    expect(doc).toContain('## IDENTITY');
  });

  it('drops the whole brand look together, for a surface whose user turned brand style off', () => {
    const doc = renderDesignDoc(full(), { include: { look: false, visualStyle: false, graphic: false } });
    expect(doc).not.toContain('COLOURS, TYPE & MARKS');
    expect(doc).not.toContain('## VISUAL STYLE');
    expect(doc).not.toContain('GRAPHIC DIRECTION');
    // Identity and catalogue survive: a script still has to be about this brand.
    expect(doc).toContain('## IDENTITY');
    expect(doc).toContain('Blend Milano');
  });

  it('defaults every section ON — the document is the brand, a surface opts out', () => {
    const doc = renderDesignDoc(full(), {});
    for (const h of ['IDENTITY', 'VOICE', 'COLOURS, TYPE & MARKS', 'GRAPHIC DIRECTION', 'CONTENT PILLARS',
      'PRODUCTS & SERVICES', 'TEAM & PEOPLE', 'COMPETITORS', 'BRAND DOCUMENTS', 'VISUAL STYLE',
      'BRAND CONTEXT & HISTORY', 'AI CHARACTER']) {
      expect(doc, h).toContain(h);
    }
  });

  it('caps lists and says what it hid, so "not listed" never reads as "does not exist"', () => {
    const many = { ...full(), products: Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, title: `P${i}` })) };
    const doc = renderDesignDoc(many);
    expect(doc).toContain('## PRODUCTS & SERVICES (45)');
    expect(doc).toContain('…and 5 more products not listed');
  });

  it('breaks the hidden document tail down by collection', () => {
    const documents = Array.from({ length: 30 }, (_, i) => ({
      id: `d${i}`,
      title: `Doc ${i}`,
      collection: i % 2 ? 'brand' : 'legal',
      chunk_count: 30 - i
    }));
    const doc = renderDesignDoc({ ...full(), documents });
    expect(doc).toContain('…and 5 more documents not listed');
    expect(doc).toMatch(/legal: 15|brand: 15/);
  });

  it('keeps the guardrails block extractable after rendering', () => {
    expect(renderDesignDoc(full())).toContain('### GUARDRAIL');
  });
});

describe('reusable sections', () => {
  const products = [
    { id: 'p1', title: 'CRM', kind: 'product', pricing: '49 €/mese', url: 'https://acme.it/crm', description: 'Pipeline', images: ['https://acme.it/crm.jpg'], featured: true }
  ];

  it('renders one product list that every surface shares', () => {
    expect(renderProductsSection(products)).toMatchInlineSnapshot(`
      "## PRODUCTS & SERVICES (1)
      - **CRM** ★ (product, 49 €/mese)
        - page: https://acme.it/crm
        - images: https://acme.it/crm.jpg
        - Pipeline
        - id: p1
      - Link products with the exact URL above, never a guessed one. The image URLs are usable as-is as visual references. read_products for full detail; sync_products when an ecommerce brand is missing URLs."
    `);
  });

  it('lets a surface pick a projection without writing a second rendering', () => {
    const featuring = renderProductsSection(products, {
      title: 'PRODUCTS & SERVICES (for featuring)',
      images: false,
      ids: false,
      hint: null
    });
    expect(featuring).toContain('## PRODUCTS & SERVICES (for featuring) (1)');
    expect(featuring).toContain('page: https://acme.it/crm');
    expect(featuring).not.toContain('images:');
    expect(featuring).not.toContain('id: p1');
    expect(featuring).not.toContain('read_products');
  });

  it('is empty for an empty catalogue, so the caller decides what to say instead', () => {
    expect(renderProductsSection([])).toBe('');
    expect(renderProductsSection(null)).toBe('');
    expect(renderCompetitorsSection([])).toBe('');
  });

  it('caps and reports the tail in the standalone sections too', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, title: `P${i}` }));
    expect(renderProductsSection(many, { max: 30 })).toContain('…and 10 more products not listed');
  });

  it('renders competitors the same way for the brand hub and the grow hub', () => {
    expect(renderCompetitorsSection([{ name: 'Rivale', kind: 'direct', website: 'https://r.it', rationale: 'Stessa fascia' }]))
      .toMatchInlineSnapshot(`
        "## COMPETITORS (1)
        - **Rivale** (direct): Stessa fascia — https://r.it"
      `);
  });
});

describe('embedBrief', () => {
  it('normalises a self-titled brief instead of doubling its heading', () => {
    expect(embedBrief('VISUAL STYLE', '## VISUAL STYLE\n\n### MOOD\ncaldo')).toBe('## VISUAL STYLE\n\n### MOOD\ncaldo');
    expect(embedBrief('VISUAL STYLE', '# Visual style\n### MOOD\ncaldo')).toBe('## VISUAL STYLE\n### MOOD\ncaldo');
  });

  it('wraps a legacy brief that predates the markdown format', () => {
    expect(embedBrief('VISUAL STYLE', 'COLOUR PALETTE:\n- #fff')).toBe('## VISUAL STYLE\nCOLOUR PALETTE:\n- #fff');
  });

  it('does not swallow a heading that belongs to the body', () => {
    expect(embedBrief('VISUAL STYLE', '### MOOD\ncaldo')).toBe('## VISUAL STYLE\n### MOOD\ncaldo');
  });

  it('is empty for an empty field, so the doc never grows a blank section', () => {
    expect(embedBrief('VISUAL STYLE', '   ')).toBe('');
    expect(embedBrief('VISUAL STYLE', null)).toBe('');
  });
});

describe('normalisers', () => {
  it('reads colours as strings or objects', () => {
    expect(normalizeColors(['#fff', { hex: '#000' }, { color: '#123' }, null])).toEqual(['#fff', '#000', '#123']);
    expect(normalizeColors('nope')).toEqual([]);
  });

  it('reads fonts as a comma string or as detection objects', () => {
    expect(normalizeFonts('Inter, Georgia')).toEqual(['Inter', 'Georgia']);
    expect(normalizeFonts([{ name: 'Inter', source: 'google' }])).toEqual(['Inter · google']);
  });

  it('skips the og-image, which is a share card and not a logo', () => {
    expect(normalizeLogos([{ url: 'https://a/og.png', type: 'og-image' }, { url: 'https://a/logo.png', type: 'html-img-src' }])).toEqual([
      'https://a/logo.png'
    ]);
  });

  it('reads image urls from strings, {src} and {url}', () => {
    expect(normalizeImageUrls(['https://a.jpg', { src: 'https://b.jpg' }, { url: 'https://c.jpg' }])).toEqual([
      'https://a.jpg',
      'https://b.jpg',
      'https://c.jpg'
    ]);
  });

  it('reads storage paths from {path} entries', () => {
    expect(normalizeStoragePaths([{ path: 'a/b.jpg' }, 'c/d.jpg', {}])).toEqual(['a/b.jpg', 'c/d.jpg']);
  });

  it('formats pricing from both the scraped string and the Studio object', () => {
    expect(formatPricing('18,50 €')).toBe('18,50 €');
    expect(formatPricing({ amount: 18.5, currency: 'EUR' })).toBe('18.5 EUR');
    expect(formatPricing({ amount: 9 })).toBe('9 EUR');
    expect(formatPricing(null)).toBe('');
  });
});

describe('loadDesignDoc', () => {
  const rows: Record<string, unknown> = {
    brands: { name: 'Caffè Milano', content_prefs: { language: 'it' }, target_platforms: ['instagram'] },
    brand_kit: { about: 'Torrefazione', brand_colors: ['#7c5cff'] },
    products: [{ id: 'p1', title: 'Blend Milano' }],
    people: [{ id: 'pe1', name: 'Giulia' }],
    competitors: [{ name: 'Rivale' }],
    brand_documents: [{ id: 'd1', title: 'Tone of voice' }]
  };

  const fakeSupabase = (seen: string[]) => ({
    from(table: string) {
      seen.push(table);
      const single = table === 'brands' || table === 'brand_kit';
      const data = rows[table] ?? null;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.neq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => ({ data });
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: single ? data : data ?? [] }).then(res);
      return chain;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  it('reads the whole Studio in one call', async () => {
    const seen: string[] = [];
    const doc = await loadDesignDoc(fakeSupabase(seen), 'b1');
    expect(doc).toContain('# DESIGN.md — Caffè Milano');
    expect(doc).toContain('Blend Milano');
    expect(doc).toContain('Giulia');
    expect(doc).toContain('Rivale');
    expect(doc).toContain('Content language**: it');
    expect(seen).toEqual(expect.arrayContaining(['brands', 'brand_kit', 'products', 'people', 'competitors', 'brand_documents']));
  });

  it('does not query a table whose section is switched off', async () => {
    const seen: string[] = [];
    await loadDesignDoc(fakeSupabase(seen), 'b1', { include: { products: false, documents: false } });
    expect(seen).not.toContain('products');
    expect(seen).not.toContain('brand_documents');
    expect(seen).toContain('people');
  });

  it('skips the brands lookup when the caller already knows the name', async () => {
    const seen: string[] = [];
    const doc = await loadDesignDoc(fakeSupabase(seen), 'b1', { brandName: 'Caffè Milano' });
    expect(seen).not.toContain('brands');
    expect(doc).toContain('# DESIGN.md — Caffè Milano');
  });

  it('soft-fails: a broken read costs the document, never the caller', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const broken = { from: () => { throw new Error('down'); } } as any;
    await expect(loadDesignDoc(broken, 'b1')).resolves.toBe('');
  });
});
