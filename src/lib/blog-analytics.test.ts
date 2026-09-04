import { describe, expect, it } from 'vitest';
import {
  BLOG_ANALYTICS_ID_PATTERNS as CONTRACT_PATTERNS,
  BLOG_ANALYTICS_PROVIDERS as CONTRACT_PROVIDERS
} from '@anomalia/api-contracts';
import {
  BLOG_ANALYTICS_ID_PATTERNS,
  BLOG_ANALYTICS_PROVIDERS,
  renderableBlogAnalytics
} from './blog-analytics';

/**
 * Le regex sono ricopiate dal contratto per non trascinare zod nel bundle del blog pubblico. La
 * copia va bene solo finche' qualcosa fallisce quando diverge: se il contratto accettasse una forma
 * che il renderer non riconosce, un id salvato non caricherebbe niente e nessuno lo saprebbe; se il
 * renderer ne accettasse una che il contratto non convalida, la chiusura dell'elenco non varrebbe
 * piu' niente.
 */
describe('la tabella dei fornitori non puo’ divergere dal contratto', () => {
  it('conosce esattamente gli stessi fornitori', () => {
    expect([...BLOG_ANALYTICS_PROVIDERS].sort()).toEqual([...CONTRACT_PROVIDERS].sort());
  });

  it('con esattamente le stesse forme di id', () => {
    for (const provider of CONTRACT_PROVIDERS) {
      expect(BLOG_ANALYTICS_ID_PATTERNS[provider]?.source, provider).toBe(CONTRACT_PATTERNS[provider].source);
    }
  });
});

describe('cosa arriva davvero a diventare uno script', () => {
  it('scarta un fornitore che non conosciamo', () => {
    expect(renderableBlogAnalytics([{ provider: 'custom', id: 'x' }])).toEqual([]);
  });

  it('scarta un id che non ha la forma del suo fornitore', () => {
    expect(renderableBlogAnalytics([{ provider: 'ga4', id: 'G-A"></script><script>alert(1)' }])).toEqual([]);
    expect(renderableBlogAnalytics([{ provider: 'hotjar', id: "1;alert(1);//" }])).toEqual([]);
    expect(renderableBlogAnalytics([{ provider: 'plausible', id: 'x.test"/><img onerror=1>' }])).toEqual([]);
  });

  /**
   * Un id valido non deve poter contenere niente che chiuda la stringa o il tag in cui finisce:
   * e' l'unica ragione per cui interpolarlo dentro lo snippet e' sicuro.
   */
  it('nessun id accettabile contiene un carattere che esce dal contesto', () => {
    const dangerous = ['<', '>', '"', "'", '`', '\\', ' ', '\n', ';', '/'];
    for (const provider of BLOG_ANALYTICS_PROVIDERS) {
      const pattern = BLOG_ANALYTICS_ID_PATTERNS[provider];
      for (const ch of dangerous) {
        const probe = `${'a'.repeat(8)}${ch}${'1'.repeat(8)}`;
        expect(pattern.test(probe), `${provider} accetta "${ch}"`).toBe(false);
      }
    }
  });

  it('tiene un fornitore solo per tipo', () => {
    const kept = renderableBlogAnalytics([
      { provider: 'ga4', id: 'G-AAAAAAA' },
      { provider: 'ga4', id: 'G-BBBBBBB' }
    ]);
    expect(kept).toEqual([{ provider: 'ga4', id: 'G-AAAAAAA' }]);
  });

  it('lascia passare le quattro forme vere', () => {
    const all = [
      { provider: 'ga4', id: 'G-ABC1234567' },
      { provider: 'meta_pixel', id: '1234567890123' },
      { provider: 'plausible', id: 'example.com' },
      { provider: 'hotjar', id: '3512345' }
    ];
    expect(renderableBlogAnalytics(all)).toEqual(all);
  });
});
