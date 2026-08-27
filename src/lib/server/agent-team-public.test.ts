import { describe, it, expect } from 'vitest';
import {
  detectSignals,
  extractLinks,
  pickInternalPages,
  normalizeProposedAgent,
  clampHours,
  PROCESS_SIGNALS,
  MAX_EXTRA_PAGES
} from './agent-team-public';

const page = (html: string, base = 'https://shop.example.com/') => ({
  html,
  links: extractLinks(html, base)
});

describe('extractLinks', () => {
  it('keeps same-host links with their anchor text and drops the rest', () => {
    const links = extractLinks(
      `<a href="/shop">Shop</a><a href="https://shop.example.com/faq">Help</a>
       <a href="https://facebook.com/x">Facebook</a><a href="mailto:a@b.c">Mail</a>`,
      'https://shop.example.com/'
    );
    expect(links.map((l) => l.path)).toEqual(['/shop', '/faq']);
    expect(links[0].label).toBe('Shop');
  });

  it('treats www and apex as the same host, and de-duplicates paths', () => {
    const links = extractLinks(
      `<a href="https://www.example.com/pricing">A</a><a href="/pricing">B</a>`,
      'https://example.com/'
    );
    expect(links).toHaveLength(1);
  });
});

describe('detectSignals', () => {
  it('finds the processes a site visibly runs, with the evidence it found them by', () => {
    const signals = detectSignals([
      page(`<html><head><script src="https://cdn.shopify.com/s/x.js"></script></head>
        <body><a href="/cart">Cart</a><a href="/faq">FAQ</a><a href="/blog">Blog</a></body></html>`)
    ]);
    const ids = signals.map((s) => s.id);
    expect(ids).toContain('ecommerce');
    expect(ids).toContain('support');
    expect(ids).toContain('blog');
    expect(signals.find((s) => s.id === 'ecommerce')?.evidence).toBe('cdn.shopify.com');
  });

  it('says nothing about processes it cannot see', () => {
    const ids = detectSignals([page('<html><body><h1>Studio</h1></body></html>')]).map((s) => s.id);
    expect(ids).not.toContain('ecommerce');
    expect(ids).not.toContain('booking');
    expect(ids).not.toContain('careers');
  });

  it('does not read /products/<feature> as a storefront', () => {
    // Live regression: this one path alone gave a SaaS homepage an "order desk" agent.
    const ids = detectSignals([
      page('<html><body><a href="/products/observability">Observability</a><a href="/pricing">Pricing</a></body></html>')
    ]).map((s) => s.id);
    expect(ids).not.toContain('ecommerce');
    expect(ids).toContain('pricing');
  });

  it('summarises a long hreflang list instead of pasting it', () => {
    const html = ['it', 'en', 'fr', 'es', 'de']
      .map((l) => `<link rel="alternate" hreflang="${l}" href="/${l}" />`)
      .join('');
    const hit = detectSignals([page(html)]).find((s) => s.id === 'multilingual');
    expect(hit?.evidence).toBe('it, en, fr +2');
  });

  it('reads every page it was given, not just the homepage', () => {
    const ids = detectSignals([
      page('<html><body><h1>Home</h1></body></html>'),
      page('<html><body><a href="/careers">Join us</a></body></html>')
    ]).map((s) => s.id);
    expect(ids).toContain('careers');
  });

  it('only reports more-than-one-language when hreflang actually lists two', () => {
    const one = detectSignals([page('<link rel="alternate" hreflang="it" href="/it" />')]);
    const two = detectSignals([
      page('<link rel="alternate" hreflang="it" href="/it" /><link rel="alternate" hreflang="en" href="/en" />')
    ]);
    expect(one.map((s) => s.id)).not.toContain('multilingual');
    expect(two.map((s) => s.id)).toContain('multilingual');
  });

  it('has no duplicate signal ids in the catalogue', () => {
    const ids = PROCESS_SIGNALS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pickInternalPages', () => {
  it('prefers the pages that describe how a business runs, and stops at the cap', () => {
    const links = [
      { path: '/blog/post-1', label: 'Post' },
      { path: '/pricing', label: 'Pricing' },
      { path: '/about', label: 'About' },
      { path: '/contact', label: 'Contact' },
      { path: '/services', label: 'Services' }
    ];
    const picked = pickInternalPages(links);
    expect(picked).toHaveLength(MAX_EXTRA_PAGES);
    expect(picked[0]).toBe('/pricing');
    expect(picked).toContain('/services');
  });

  it('never picks the homepage or an asset', () => {
    const picked = pickInternalPages([
      { path: '/', label: 'Home' },
      { path: '/about/team.pdf', label: 'Team PDF' }
    ]);
    expect(picked).toEqual([]);
  });
});

describe('clampHours', () => {
  it('keeps estimates inside what a reader would believe', () => {
    expect(clampHours(400)).toBe(20);
    expect(clampHours(0)).toBe(1);
    expect(clampHours(-3)).toBe(1);
    expect(clampHours('nope')).toBe(1);
    expect(clampHours(3.3)).toBe(3.5);
  });
});

describe('normalizeProposedAgent', () => {
  const detected = [
    { id: 'ecommerce', evidence: '/cart' },
    { id: 'support', evidence: 'intercom' }
  ];

  const card = (over: Record<string, unknown> = {}) => ({
    name: 'Order desk',
    role: 'Handles orders',
    department: 'ops',
    mission: 'Reads new orders every morning and flags the ones that need a human.',
    because: 'The site checks out on Shopify and someone reads every order by hand today.',
    signals: ['ecommerce'],
    cadence: 'daily 09:00',
    inputs: ['orders'],
    outputs: ['flagged list'],
    integrations: ['Shopify'],
    handoffTo: [],
    impact: 'high',
    effort: 'low',
    hoursSavedPerWeek: 4,
    firstTask: 'Read yesterday’s orders.',
    ...over
  });

  it('drops signals we never detected on this site', () => {
    const a = normalizeProposedAgent(card({ signals: ['ecommerce', 'careers'] }), detected);
    expect(a?.signals).toEqual(['ecommerce']);
  });

  it('refuses an agent standing on nothing at all', () => {
    // No detected signal AND nothing said about why: a teammate invented out of thin air.
    expect(normalizeProposedAgent(card({ signals: ['careers'], because: 'perché sì' }), detected)).toBeNull();
    expect(normalizeProposedAgent(card({ name: '' }), detected)).toBeNull();
    expect(normalizeProposedAgent(card({ mission: '' }), detected)).toBeNull();
    expect(normalizeProposedAgent(null, detected)).toBeNull();
  });

  it('keeps an agent with no matched signal when it argues its own case', () => {
    const a = normalizeProposedAgent(
      card({ signals: [], because: 'The pricing page lists three tiers and nobody follows up on the quotes.' }),
      detected
    );
    expect(a?.name).toBe('Order desk');
    expect(a?.signals).toEqual([]);
  });

  it('gives the card a stable id from its name', () => {
    expect(normalizeProposedAgent(card({ name: 'Sveglia approvazioni' }), detected)?.id).toBe('sveglia-approvazioni');
  });

  it('clamps the numbers and the vocabulary instead of refusing the card', () => {
    const a = normalizeProposedAgent(
      card({ hoursSavedPerWeek: 300, impact: 'enormous', effort: '', department: 'legal' }),
      detected
    );
    expect(a?.hoursSavedPerWeek).toBe(20);
    expect(a?.impact).toBe('medium');
    expect(a?.effort).toBe('medium');
    expect(a?.department).toBe('ops');
  });

  it('caps the lists so one card cannot become a page', () => {
    const a = normalizeProposedAgent(
      card({ inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], handoffTo: ['x', 'y', 'z', 'w'] }),
      detected
    );
    expect(a?.inputs).toHaveLength(5);
    expect(a?.handoffTo).toHaveLength(3);
  });
});
