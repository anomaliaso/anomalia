# Stop bundling simple-icons into the node SSR chunk

`npm run build:node` OOMs building the self-host Docker image. `vite.config.ts`
forced `ssr.noExternal: ['simple-icons']` unconditionally, to keep Vercel's nft
tracer from copying the package's twin 5 MB entries (index.js + index.mjs) into
every serverless function. That reasoning is Vercel-specific: it does not apply
to `DEPLOY_TARGET=node`, whose Dockerfile (`infra/app/Dockerfile`) runs
`npm ci --omit=dev` and ships the whole `node_modules` once, with no
per-function tracing at all.

Because `graphic-icons.ts` does `import * as SimpleIcons from 'simple-icons'`
and resolves slugs dynamically, forcing the bundle defeats tree-shaking
entirely: the full 5.2 MB module lands verbatim in
`.svelte-kit/output/server/chunks/index3.js`, ten times any other chunk.

`noExternal` is now decided by `scripts/ssr-no-external.ts`
(`ssrNoExternalForDeploy`), which only bundles `simple-icons` for the Vercel
build; the node build leaves it as a normal `require`, already satisfied by
`node_modules` at runtime. `index3.js` drops from 5,382.78 kB to 295.52 kB
(-94.5%) and the SSR build phase runs measurably faster.

The node target still bundles `@anomalia/*`: the Dockerfile's final stage
runs `npm ci --omit=dev` without `packages/`, so the workspaces are not on
disk at runtime and Rollup has to inline them, same as it always did before
this change — only `simple-icons` moved.

This does **not** by itself fix the OOM: bisecting `--max-old-space-size`
shows both the old and new build fail at 4096 MB and succeed at 4608/5120 MB —
unchanged. Instrumenting `adapter-node`'s own `adapt()` (temporary, not
committed) shows the Node heap is already ~3.4 GB used by the time its own
asset-copy/compress phase starts, before it does any bundling of its own — the
dominant cost is memory Vite/Rollup's SSR build never releases across the
~1,378 emitted server chunks, not one bloated import. That is a
Vite/Rollup/adapter-node build-time retention issue, not application code;
left for the next attempt, with `nodeAdapter({ precompress: false })`
identified and explicitly rejected as a lever — it would serve every static
asset uncompressed in production, a real user-facing regression traded for a
build-time convenience.
