import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

/** Worktree `node_modules` is often a symlink into another checkout; Vite resolves it and
 *  rejects the real path unless it is on the allow list. */
const nodeModulesReal = (() => {
  try {
    return realpathSync('node_modules');
  } catch {
    return null;
  }
})();

/**
 * RICARICHE AUTOMATICHE, SPENTE SU RICHIESTA — `NO_HMR=1 npm run dev` (o `npm run dev:stable`).
 *
 * Perché esiste: su questo repo lavorano più sessioni insieme, e ogni file salvato da chiunque fa
 * ricaricare la pagina di chiunque altro. In mezzo a una conversazione con un agente — che è
 * esattamente dove si prova il prodotto — una ricarica azzera lo stato: la chat si rimonta, una
 * modale si chiude, una prova a metà va persa. Non è un fastidio estetico: è la ragione per cui
 * più verifiche nel browser sono fallite oggi, e per cui il proprietario non riusciva a tenere
 * aperta una chat abbastanza a lungo da giudicarla.
 *
 * Con la variabile impostata, Vite non apre il canale HMR: il codice sul server si aggiorna
 * comunque alla richiesta successiva, quindi basta ricaricare A MANO per vedere le modifiche —
 * che è precisamente il controllo che serve. Senza la variabile non cambia niente per nessuno.
 */
const hmr = process.env.NO_HMR === '1' || process.env.NO_HMR === 'true' ? false : undefined;

export default defineConfig({
  server: { hmr, fs: { allow: ['..', ...(nodeModulesReal ? [nodeModulesReal] : [])] } },
  plugins: [sentrySvelteKit({
    org: "021-6z",
    project: "021-1m"
  }), sveltekit(), tailwindcss()],
  // Modern baselines: skip legacy transforms (e.g. Array.from) that PSI flags as unused
  // on current Chrome/Safari/Firefox. Aligns with "Baseline widely available" guidance.
  build: {
    target: ['es2022', 'chrome111', 'firefox115', 'safari16.4', 'edge111'],
    // Left undefined, `sentrySvelteKit()` flips this to 'hidden' so it can upload the maps and
    // then delete them. Neither half happens here: there is no SENTRY_AUTH_TOKEN in any Vercel
    // environment (production, preview and development all checked), so nothing is ever
    // uploaded, and the plugin's deletion step never fires either. The maps just shipped —
    // 72 MB of `.map` files served from the CDN that nothing on earth reads, since `hidden`
    // also means no `sourceMappingURL` comment points at them.
    // Sentry respects an explicit `false` (it only warns), and it costs nothing real: stack
    // traces there were already minified. Want symbolication back? Set SENTRY_AUTH_TOKEN
    // first, then flip this to 'hidden'.
    sourcemap: false,
    rollupOptions: {
      // c2pa-node signs Content Credentials and is DELIBERATELY NOT INSTALLED: its 38 MB native
      // binary took the Vercel function past the 250 MB uncompressed limit, to carry a feature
      // that is off by default. content-credentials.ts imports it dynamically and no-ops when it
      // is missing, but Rollup still resolves the specifier at build time and fails the build.
      // Marking it external hands the resolution to Node at runtime, which is where the decision
      // belongs: installed → signing available, absent → XMP marking only.
      external: ['c2pa-node']
    }
  },
  ssr: {
    // simple-icons ships twin 5 MB entries (index.js + index.mjs) and Vercel's nft tracer copies
    // BOTH into every serverless function when the package is left external (10 MB × 5 functions).
    // Bundling it into the server chunks keeps one copy per function instead. Tree-shaking cannot
    // slim it further — graphic-icons.ts resolves arbitrary model-emitted slugs via a namespace
    // scan, and that full-catalogue lookup is the contract (unknown slug → null, any brand works).
    noExternal: ['simple-icons']
  },
  test: {
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'packages/*/src/**/*.{test,spec}.{js,ts}',
      'packages/*.{test,spec}.{js,ts}',
      'scripts/**/*.{test,spec}.{js,ts}'
    ],
    // Il grafo di import dei moduli server pesa diversi secondi da freddo (strategy-agent,
    // queue, ugc): sotto carico il default di 5s molla a metà setup e un file passa e fallisce
    // a seconda della parallelismo. 30s valutano la LOGICA, non la macchina.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
