// Il guard dell'export girava verde su una copia che non compilava: `import('./billing')` non
// veniva letto come import, e il modulo escluso restava un buco che solo `vite build` scopriva.
import { describe, expect, it } from 'vitest';
import {
  EXCLUSION_RULES,
  danglingImports,
  delinkMissing,
  isExcluded,
  resolveSpecifier,
  specifiersIn,
  staticImportsOfStubs
} from './export-oss.mjs';

describe('specifiersIn', () => {
  it('legge un import dinamico senza spazio dopo la parola', () => {
    const found = specifiersIn(`const { billingProvider } = await import('./billing');`);
    expect(found).toEqual([{ specifier: './billing', kind: 'dynamic' }]);
  });

  it('distingue statico da dinamico', () => {
    const found = specifiersIn(
      `import { a } from '$lib/server/plans';\nconst s = () => import('$lib/server/stripe');`
    );
    expect(found).toEqual([
      { specifier: '$lib/server/plans', kind: 'static' },
      { specifier: '$lib/server/stripe', kind: 'dynamic' }
    ]);
  });

  it('non legge un import citato in un commento', () => {
    expect(specifiersIn(`// vedi await import('./billing')`)).toEqual([]);
    expect(specifiersIn(`/** @typedef {import('./types.js').T} T */`)).toEqual([]);
  });

  it('non legge il sorgente che un generatore scrive dentro un template literal', () => {
    expect(specifiersIn('const src = `import { Video } from "./Video"`;')).toEqual([]);
  });

  it('legge anche import di solo effetto e require', () => {
    const found = specifiersIn(`import './side-effect';\nrequire('./legacy');`);
    expect(found.map((f) => f.specifier)).toEqual(['./side-effect', './legacy']);
  });
});

describe('resolveSpecifier', () => {
  it('mappa $lib su src/lib', () => {
    expect(resolveSpecifier('src/routes/x/+server.ts', '$lib/server/stripe')).toBe(
      'src/lib/server/stripe'
    );
  });

  it('risolve i relativi rispetto al file che importa', () => {
    expect(resolveSpecifier('src/lib/server/usage.ts', './billing')).toBe('src/lib/server/billing');
  });

  it('ignora i moduli del framework e i pacchetti', () => {
    expect(resolveSpecifier('src/lib/a.ts', '$env/dynamic/private')).toBeNull();
    expect(resolveSpecifier('src/lib/a.ts', '@sveltejs/kit')).toBeNull();
  });

  it("ignora ./$types: lo genera svelte-kit sync, non sta nel repo", () => {
    expect(resolveSpecifier('src/routes/x/+server.ts', './$types')).toBeNull();
  });

  it('lascia cadere la query di Vite', () => {
    expect(resolveSpecifier('src/lib/a.ts', './doc.md?raw')).toBe('src/lib/doc.md');
  });
});

describe('danglingImports', () => {
  it('segnala un import che nella copia esportata non risolve più', () => {
    const present = new Set(['src/lib/server/usage.ts']);
    const hits = danglingImports([{ file: 'src/lib/server/usage.ts', text: `await import('./billing')` }], present);
    expect(hits).toEqual([{ file: 'src/lib/server/usage.ts', specifier: './billing' }]);
  });

  it("un .js importato è un .ts sul disco, non un buco", () => {
    const present = new Set(['src/lib/a.svelte', 'src/lib/utils.ts']);
    const hits = danglingImports(
      [{ file: 'src/lib/a.svelte', text: `import { cn } from '$lib/utils.js';` }],
      present
    );
    expect(hits).toEqual([]);
  });

  it('tace quando il modulo c\'è, anche come index di cartella', () => {
    const present = new Set(['src/lib/server/usage.ts', 'src/lib/server/billing/index.ts']);
    const hits = danglingImports([{ file: 'src/lib/server/usage.ts', text: `await import('./billing')` }], present);
    expect(hits).toEqual([]);
  });
});

describe('staticImportsOfStubs', () => {
  it('un modulo sostituito da uno stub si può raggiungere solo da un seam pigro', () => {
    const stubs = ['src/lib/server/stripe.ts'];
    const files = [
      { file: 'src/lib/server/settings-actions.ts', text: `const s = () => import('$lib/server/stripe')` },
      { file: 'src/routes/x/+server.ts', text: `import { pay } from '$lib/server/stripe';` }
    ];
    expect(staticImportsOfStubs(files, stubs)).toEqual([
      { file: 'src/routes/x/+server.ts', specifier: '$lib/server/stripe' }
    ]);
  });
});

describe('regole di esclusione', () => {
  it('toglie il provider a pagamento ma tiene il selettore, che è progettato per la sua assenza', () => {
    expect(isExcluded('src/lib/server/billing/anomalia-provider.ts', EXCLUSION_RULES)).toBe(true);
    expect(isExcluded('src/lib/server/billing/index.ts', EXCLUSION_RULES)).toBe(false);
  });

  it('tiene vercel.json: SELF_HOSTING lo cita e i test delle cadenze lo leggono', () => {
    expect(isExcluded('vercel.json', EXCLUSION_RULES)).toBe(false);
  });

  it('della documentazione esce solo ciò che serve a installare e a chiamare l\'API', () => {
    expect(isExcluded('docs/SELF_HOSTING.md', EXCLUSION_RULES)).toBe(false);
    expect(isExcluded('docs/api/03-posts.md', EXCLUSION_RULES)).toBe(false);
    expect(isExcluded('docs/readme-hero.png', EXCLUSION_RULES)).toBe(false);
    expect(isExcluded('docs/36-leads-gen-playbook.md', EXCLUSION_RULES)).toBe(true);
    expect(isExcluded('docs/29-structural-reviews.md', EXCLUSION_RULES)).toBe(true);
    expect(isExcluded('docs/README.md', EXCLUSION_RULES)).toBe(true);
  });

  it('non spedisce i piani interni sul database né i lockfile di un secondo gestore', () => {
    expect(isExcluded('supabase/migrations/DRAFT-drop-dead-tables-2026-09-XX.sql.disabled', EXCLUSION_RULES)).toBe(true);
    expect(isExcluded('gen-hero.mjs', EXCLUSION_RULES)).toBe(true);
    expect(isExcluded('bun.lock', EXCLUSION_RULES)).toBe(true);
    expect(isExcluded('package-lock.json', EXCLUSION_RULES)).toBe(false);
    expect(isExcluded('supabase/migrations/0050_ai_calls.sql', EXCLUSION_RULES)).toBe(false);
  });
});

describe('guard dei segreti', () => {
  it('riconosce la forma di una chiave viva di fatturazione, come fa GitHub', () => {
    const live = /\b[sr]k_live_[A-Za-z0-9]{20,}/;
    expect(live.test(['rk', 'live', '51QxINVENTATA0000000000000000'].join('_'))).toBe(true);
    expect(live.test('rk_live_corta')).toBe(false);
  });
});

describe('delinkMissing', () => {
  const exists = (link: string) => link === 'docs/SELF_HOSTING.md';

  it('toglie il link a un documento che non viene spedito, non la frase', () => {
    expect(delinkMissing('vedi [il playbook](docs/36-leads.md) qui', exists)).toBe('vedi il playbook qui');
  });

  it('lascia stare i link che risolvono e quelli esterni', () => {
    expect(delinkMissing('[guida](docs/SELF_HOSTING.md)', exists)).toBe('[guida](docs/SELF_HOSTING.md)');
    expect(delinkMissing('[x](https://example.com/a.md)', exists)).toBe('[x](https://example.com/a.md)');
  });
});
