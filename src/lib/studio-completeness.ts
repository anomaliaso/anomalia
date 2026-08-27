// Studio completeness — one shared score for "how much does Anomalia know about this brand".
// The Studio page renders it as the nudge banner; strategy surfaces (GTM, plans) show it as
// "more data = sharper plan" context next to anything generated from the Studio. Pure and
// universal (client + server) so both sides compute the exact same number.

export type StudioTab = 'brand' | 'knowledge' | 'products';

export type StudioSnapshot = {
  products: number; // product count (3+ = full credit, partial below)
  history: number; // synced past posts
  documents: number; // notes/documents/images added as knowledge
  voice: boolean; // tone/speaking style/brand style defined
  about: boolean;
  audience: boolean;
  logo: boolean;
  colors: boolean;
};

export type StudioItem = { key: string; tab: StudioTab; credit: number };

export type StudioCompleteness = {
  pct: number; // 0-100, rounded to the nearest 5
  missing: StudioItem[]; // incomplete items, ordered by impact on plan quality
  tier: 'start' | 'good' | 'almost';
};

// Items are ordered by how much each one improves the plans; products earn partial credit
// (1/3 each up to 3). i18n labels live under app.studio.completeness.items/hints.<key>.
export function studioCompleteness(s: StudioSnapshot): StudioCompleteness {
  const items: StudioItem[] = [
    { key: 'products', tab: 'products', credit: Math.min(s.products, 3) / 3 },
    { key: 'history', tab: 'knowledge', credit: s.history ? 1 : 0 },
    { key: 'voice', tab: 'brand', credit: s.voice ? 1 : 0 },
    { key: 'about', tab: 'brand', credit: s.about ? 1 : 0 },
    { key: 'audience', tab: 'brand', credit: s.audience ? 1 : 0 },
    { key: 'logo', tab: 'brand', credit: s.logo ? 1 : 0 },
    { key: 'colors', tab: 'brand', credit: s.colors ? 1 : 0 },
    { key: 'knowledge', tab: 'knowledge', credit: s.documents ? 1 : 0 }
  ];
  const score = items.reduce((a, i) => a + i.credit, 0) / items.length;
  // Round to the nearest 5 for a friendlier number ("60%", not "62.5%").
  const pct = Math.round((score * 100) / 5) * 5;
  return {
    pct,
    missing: items.filter((i) => i.credit < 1),
    tier: pct < 40 ? 'start' : pct < 80 ? 'good' : 'almost'
  };
}
