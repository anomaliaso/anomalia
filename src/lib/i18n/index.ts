import { register, init } from 'svelte-i18n';
import { DEFAULT_LOCALE } from './locale';

// Lazy loaders → each locale ships as its own chunk. Because dictionaries load
// asynchronously, the root +layout.ts must `await waitLocale()` before first render
// so SSR and hydration both see the resolved messages (no flicker, no mismatch).
// Docs + tools catalogs are separate and merged under `docs` / `tools` keys.
register('en', async () => {
  const [main, docs, tools] = await Promise.all([
    import('./locales/en.json'),
    import('./locales/docs/en.json'),
    import('./locales/tools/en.json')
  ]);
  return { ...main.default, docs: docs.default, tools: tools.default };
});
register('it', async () => {
  const [main, docs, tools] = await Promise.all([
    import('./locales/it.json'),
    import('./locales/docs/it.json'),
    import('./locales/tools/it.json')
  ]);
  return { ...main.default, docs: docs.default, tools: tools.default };
});
register('es', async () => {
  const [main, docs, tools] = await Promise.all([
    import('./locales/es.json'),
    import('./locales/docs/es.json'),
    import('./locales/tools/es.json')
  ]);
  return { ...main.default, docs: docs.default, tools: tools.default };
});
register('fr', async () => {
  const [main, docs, tools] = await Promise.all([
    import('./locales/fr.json'),
    import('./locales/docs/fr.json'),
    import('./locales/tools/fr.json')
  ]);
  return { ...main.default, docs: docs.default, tools: tools.default };
});

init({
  fallbackLocale: DEFAULT_LOCALE,
  initialLocale: DEFAULT_LOCALE
});
