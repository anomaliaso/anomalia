#!/usr/bin/env node

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

const run = promisify(execFile)

const DEFAULT_OUT = "../anomalia"
const EXTRA_RULES_FILE = "oss-exclusions.txt"
const OUT_PKG_NAME = "anomalia"

export const EXCLUSION_RULES = [
  "session-*",
  "AGENT-CHAT-*",
  "2026-*",
  "eval-results/",
  "experiments/",
  "docs/archive/",
  "scripts/eval/",
  "scripts/chat-live/",
  "src/lib/server/billing/anomalia-provider.ts",
  "src/lib/server/billing/anomalia-provider.test.ts",
  "src/lib/server/billing/index.test.ts",
  "basename:stripe*",
  "src/routes/api/v1/webhooks/stripe*",
  "src/routes/api/v1/billing/",
  "basename:billing-reconcile*",
  "src/routes/app/[brand]/upgrade/",
  "src/routes/app/[brand]/activate/",
  "docs/plans/",
  // La documentazione interna NON esce: piani di prodotto, review di sicurezza, analisi con dati
  // di produzione, playbook commerciali. Resta solo ciò che serve a chi installa e a chi chiama
  // l'API — che è anche l'unico pezzo che nessuno deve andare a ripulire prima di spedirlo.
  "docs/",
  "!docs/SELF_HOSTING.md",
  "!docs/api/",
  "basename:DRAFT-*.sql.disabled",
  "gen-hero.mjs",
  "bun.lock",
  "scripts/disconnect-unpaid-zernio.ts",
  "src/lib/server/vercel-domains.ts",
  "CLAUDE.md",
  "mcp.json",
  "mimocode.jsonc",
  "opencode.json",
  "render.yaml",
  ".vercel/",
  "build-worker/",
  ".claude/",
  ".cursor/",
  ".opencode/",
  "AGENT.md",
]

const GUARD_HARD_PATTERNS = [
  { id: "private-key-block", re: /BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/ },
  { id: "secret-key-literal", re: /sk-[A-Za-z0-9]{20,}/ },
  // La forma basta a far rifiutare il push da GitHub, anche su un valore inventato: il guard deve
  // essere severo almeno quanto la scansione che ci aspetta dall'altra parte.
  { id: "live-billing-key", re: /\b[sr]k_live_[A-Za-z0-9]{20,}/ },
  { id: "service-role-key-literal", re: /supabase_service_role_key\s*=\s*['"]?[A-Za-z0-9]/i },
  { id: "internal-domain", re: /teta\.so/ },
]

const GUARD_POLICY_PATTERNS = [
  { id: "product-domain", re: /anomalia\.so/ },
  { id: "hosted-api-endpoint", re: /zernio\.com\/api/ },
]

const GUARD_PATTERNS = [...GUARD_HARD_PATTERNS, ...GUARD_POLICY_PATTERNS]

const PATTERN_TIER = new Map([
  ...GUARD_HARD_PATTERNS.map((p) => [p.id, "hard"]),
  ...GUARD_POLICY_PATTERNS.map((p) => [p.id, "policy"]),
])

const PRODUCT_DOMAIN_COPY_PATHS = [
  "src/routes/",
  "src/lib/components/",
  "src/lib/i18n/",
  "src/remotion/",
  "src/lib/motion-video/",
  "static/",
]

const PRODUCT_DOMAIN_DOCS_PATHS = ["docs/", "CHANGELOG.md", ".agents/", ".env.example"]

const PRODUCT_DOMAIN_TOOLS_PATHS = ["scripts/", ".github/"]

const PRODUCT_DOMAIN_TEST_FILES_RULE = "re:\\.test\\.tsx?$"

const PRODUCT_DOMAIN_SERVER_PATHS = [
  "src/hooks.server.ts",
  "src/lib/ads-fee.ts",
  "src/lib/legal.ts",
  "src/lib/links.ts",
  "src/lib/seo.ts",
  "src/lib/server/ads-actions.ts",
  "src/lib/server/ads-generate.ts",
  "src/lib/server/app-url.ts",
  "src/lib/server/chat/notify-tools.ts",
  "src/lib/server/demo-account.ts",
  "src/lib/server/indexing.ts",
  "src/lib/server/internal-users.ts",
  "src/lib/server/oauth.ts",
  "src/lib/server/posts-design.ts",
  "src/lib/server/referrals.ts",
  "src/lib/server/support-config.ts",
  "src/lib/server/tool-guard.ts",
]

const PRODUCT_DOMAIN_SEED_PATHS = ["supabase/migrations/"]

const POLICY_PRODUCT_LINKS_IN_COPY = [
  ...PRODUCT_DOMAIN_COPY_PATHS,
  ...PRODUCT_DOMAIN_DOCS_PATHS,
  ...PRODUCT_DOMAIN_TOOLS_PATHS,
  PRODUCT_DOMAIN_TEST_FILES_RULE,
  ...PRODUCT_DOMAIN_SERVER_PATHS,
  ...PRODUCT_DOMAIN_SEED_PATHS,
]

const POLICY_ZERNIO_DEFAULT_PATHS = [
  "src/lib/server/publishing/zernio.ts",
  "src/lib/server/publishing/index.test.ts",
  "src/routes/api/status/+server.ts",
  "src/lib/server/zernio-ads.ts",
]

const POLICY_ALLOWLIST = [
  { pattern: "product-domain", paths: POLICY_PRODUCT_LINKS_IN_COPY },
  { pattern: "hosted-api-endpoint", paths: POLICY_ZERNIO_DEFAULT_PATHS },
]

const REDACT_KEY_FIXTURE_ALLOWLIST = [
  { pattern: "private-key-block", paths: ["src/lib/server/redact.test.ts"] },
]

// I moduli esclusi che qualcuno importa comunque: Rollup risolve staticamente anche un import
// dinamico con path letterale, quindi un buco non è una degradazione a runtime, è un build che
// non parte. Lo stub esplode all'import — che è esattamente ciò che i seam pigri già
// intercettano per tornare alla via aperta (billing/index.ts → openBillingProvider,
// blog-settings.ts → null).
const STUB_MODULES = [
  "src/lib/server/billing/anomalia-provider.ts",
  "src/lib/server/stripe.ts",
  "src/lib/server/vercel-domains.ts",
]

const STUB_TEXT = `throw new Error('not available in the open build')\n\nexport {}\n`

// Sorgente dentro una stringa normale: un parser lo distinguerebbe da un import, un'espressione
// regolare no. Sono due, si nominano qui e si vedono insieme.
const DANGLING_ALLOWLIST = [
  { file: "scripts/bake-motion-library.ts", specifier: "./V${i}" },
  { file: "src/lib/server/chat/loop-guard.test.ts", specifier: "./motion-trailer-1x1" },
]

const MODULE_SUFFIXES = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".svelte", ".json",
  "/index.ts", "/index.tsx", "/index.js",
]

// `$lib/utils.js` è `src/lib/utils.ts` sul disco: TypeScript vuole l'estensione di ciò che verrà
// emesso, non di ciò che si legge. Senza questa equivalenza il guard griderebbe su mezza UI.
const EMITTED_EXTENSION = /\.(js|jsx|mjs|cjs)$/

const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "cjs", "mjs", "svelte"])

const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  "md", "txt", "json", "jsonc", "yaml", "yml", "html", "htm", "css", "scss",
  "sql", "sh", "py", "toml", "xml", "svg", "example", "conf", "gitignore",
])

const README_TEXT = `# Anomalia

Social media autopilot: editorial planning, AI content generation, scheduling,
and multi-brand workspaces. This repository is the open-source, self-hostable
distribution of the app.

## Prerequisites

- Node.js 22+
- Docker with Compose
- A Supabase database: either the bundled stack (\`infra/compose\`) or any hosted project

## Quickstart

\`\`\`sh
cp .env.example .env
npm install

cd infra/compose
cp .env.example .env
docker compose up -d --wait
cd ../..

npm run db:migrate
npm run db:seed
\`\`\`

Point \`PUBLIC_SUPABASE_URL\` and \`PUBLIC_SUPABASE_ANON_KEY\` in \`.env\` at your
Supabase instance (skip the compose step if you use a hosted one). \`db:seed\`
prints the \`TENANT_BRAND_ID\` line to paste into \`.env\`.

Run it:

\`\`\`sh
npm run dev                 # development, http://localhost:5173
npm run build:node && npm start   # production build, port 3000
\`\`\`

or, from \`infra/compose/\`, bring up the prebuilt app service next to the stack:
\`docker compose up -d --build app\`.

## Environment notes

- \`BILLING_PROVIDER=open\` removes all credit and quota gating (self-hosted default).
- Social publishing runs through the publisher seam: \`SOCIAL_PUBLISHER\`,
  \`ZERNIO_BASE_URL\` and \`ZERNIO_API_KEY\`. Without a publisher key, approved
  posts stay approved and are not sent anywhere.
- Every AI provider reads its key from env and degrades loudly to "off" when
  the key is missing. See \`.env.example\` for the full list.

Read [\`docs/SELF_HOSTING.md\`](docs/SELF_HOSTING.md) for the complete guide:
what degrades on purpose, cron setup, production-build caveats, and security
notes before exposing the app publicly.
`

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, dryRun: false, force: false }

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      args.out = argv[++i] ?? fail("export: --out requires a directory")
    } else if (argv[i] === "--dry-run") {
      args.dryRun = true
    } else if (argv[i] === "--force") {
      args.force = true
    } else {
      fail(`export: unknown argument ${argv[i]}`)
    }
  }

  return args
}

async function loadRules(repoRoot) {
  const extraPath = path.join(repoRoot, EXTRA_RULES_FILE)

  if (!existsSync(extraPath)) {
    return [...EXCLUSION_RULES]
  }

  const raw = await readFile(extraPath, "utf8")

  const extra = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

  return [...EXCLUSION_RULES, ...extra]
}

function globToRegex(glob) {
  let source = ""

  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]

    if (char === "*") {
      source += glob[i + 1] === "*" ? (i++, ".*") : "[^/]*"
    } else if (char === "?") {
      source += "[^/]"
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }

  return new RegExp(`^${source}$`)
}

function matchRule(filePath, rule) {
  if (rule.startsWith("re:")) {
    return new RegExp(rule.slice(3)).test(filePath)
  }

  if (rule.startsWith("basename:")) {
    const base = filePath.split("/").pop()

    return matchBase(base, rule.slice(9))
  }

  if (rule.endsWith("/")) {
    return filePath.startsWith(rule)
  }

  if (rule.includes("*") || rule.includes("?")) {
    if (!rule.includes("/")) {
      return !filePath.includes("/") && globToRegex(rule).test(filePath)
    }

    return globToRegex(rule).test(filePath)
  }

  return filePath === rule || filePath.startsWith(`${rule}/`)
}

function matchBase(base, pattern) {
  if (pattern.includes("*") || pattern.includes("?")) {
    return globToRegex(pattern).test(base)
  }

  return base === pattern
}

// Una regola `!x` RIPESCA ciò che una regola larga ha preso: `docs/` esclude tutto, `!docs/api/`
// riporta dentro l'API. Il ripescaggio vince sempre, così le eccezioni si leggono accanto alla
// regola che le genera invece di diventare venti esclusioni puntuali che nessuno rilegge.
export const isExcluded = (filePath, rules) => {
  const kept = rules.some((rule) => rule.startsWith("!") && matchRule(filePath, rule.slice(1)))

  if (kept) {
    return false
  }

  return rules.some((rule) => !rule.startsWith("!") && matchRule(filePath, rule))
}

async function trackedFiles(repoRoot) {
  const { stdout } = await run("git", ["ls-files", "-z"], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 })

  return stdout.split("\0").filter(Boolean)
}

async function prepareOutDir(outDir, force) {
  if (existsSync(outDir)) {
    const entries = await readdir(outDir)

    if (entries.length > 0 && !force) {
      fail(`export: ${outDir} is not empty (use --force to wipe it first)`)
    }

    if (entries.length > 0) {
      await rm(outDir, { recursive: true })
    }
  }

  await mkdir(outDir, { recursive: true })
}

async function copyFiles(repoRoot, outDir, files) {
  for (const file of files) {
    const dest = path.join(outDir, file)

    await mkdir(path.dirname(dest), { recursive: true })
    await cp(path.join(repoRoot, file), dest)
  }
}

async function transformPackageJson(outDir, rules) {
  const pkgPath = path.join(outDir, "package.json")
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"))

  pkg.name = OUT_PKG_NAME
  const hadStripeDep = Boolean(pkg.dependencies?.stripe ?? pkg.devDependencies?.stripe)
  delete pkg.dependencies?.stripe
  delete pkg.devDependencies?.stripe

  const droppedScripts = []

  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    const tokens = command.split(/\s+/).map((token) => token.replace(/^["']|["']$/g, ""))

    const referencesExcluded = tokens.some(
      (token) => token.includes("/") && isExcluded(token.replace(/^[A-Z_a-z][A-Za-z0-9_]*=/, ""), rules),
    )

    if (referencesExcluded) {
      delete pkg.scripts[name]
      droppedScripts.push(name)
    }
  }

  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return { droppedScripts, hadStripeDep }
}

// Un link a un documento che l'export non spedisce diventa testo semplice: la riga resta leggibile
// e nessuno clicca su un 404. Serve perché la selezione dei documenti cambia — ogni volta che si
// stringe, i rimandi da CHANGELOG e dall'indice dell'API restano indietro.
export function delinkMissing(markdown, exists) {
  return markdown.replace(/\[([^\]]+)\]\(([^)#\s]+\.md)\)/g, (whole, text, link) =>
    link.startsWith("http") || exists(link) ? whole : text,
  )
}

async function delinkExported(outDir, files) {
  const present = new Set(files)
  let touched = 0

  for (const file of files) {
    if (!file.endsWith(".md")) {
      continue
    }

    const text = await readFile(path.join(outDir, file), "utf8")
    const dir = path.posix.dirname(file)
    const next = delinkMissing(text, (link) => present.has(path.posix.normalize(path.posix.join(dir, link))))

    if (next !== text) {
      await writeFile(path.join(outDir, file), next)
      touched += 1
    }
  }

  return touched
}

async function writeStubs(outDir) {
  for (const stub of STUB_MODULES) {
    const dest = path.join(outDir, stub)

    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, STUB_TEXT)
  }
}

async function writeReadme(outDir) {
  await writeFile(path.join(outDir, "README.md"), README_TEXT)
}

async function walkTree(root) {
  const files = []
  const stack = [""]

  while (stack.length > 0) {
    const rel = stack.pop()
    const abs = rel ? path.join(root, rel) : root
    const entries = await readdir(abs, { withFileTypes: true })

    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        stack.push(child)
      } else {
        files.push(child)
      }
    }
  }

  return files.sort()
}

const extension = (filePath) => {
  const base = filePath.split("/").pop()
  const dot = base.lastIndexOf(".")

  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase()
}

function allowedByList(filePath, patternId, list) {
  return list.some(
    (entry) => entry.pattern === patternId && entry.paths.some((rule) => matchRule(filePath, rule)),
  )
}

function allowed(filePath, patternId) {
  return (
    allowedByList(filePath, patternId, POLICY_ALLOWLIST) ||
    allowedByList(filePath, patternId, REDACT_KEY_FIXTURE_ALLOWLIST)
  )
}

async function scanContent(files, outDir) {
  const byKey = new Map()

  for (const file of files) {
    if (file === "LICENSE" || !TEXT_EXTENSIONS.has(extension(file))) {
      continue
    }

    const text = await readFile(path.join(outDir, file), "utf8")

    for (const pattern of GUARD_PATTERNS) {
      if (allowed(file, pattern.id)) {
        continue
      }

      const lines = text.split("\n").filter((line) => pattern.re.test(line)).length

      if (lines > 0) {
        byKey.set(`${file}[${pattern.id}]`, { file, pattern: pattern.id, lines })
      }
    }
  }

  return [...byKey.values()]
}

// Commenti e template literal contengono specificatori che non sono import: un @typedef JSDoc,
// il sorgente che un generatore scrive dentro una sandbox. Leggerli come import fa gridare il
// guard su moduli che nessuno importa davvero.
const stripNonCode = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/^[ \t]*\/\/.*$/gm, "")

export function specifiersIn(rawText) {
  const text = stripNonCode(rawText)
  const found = []

  const re = /(?:\bfrom\s+|\bimport\s*(\()?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g

  for (const match of text.matchAll(re)) {
    found.push({ specifier: match[2], kind: match[1] ? "dynamic" : "static" })
  }

  return found
}

export function resolveSpecifier(fromFile, rawSpecifier) {
  const specifier = rawSpecifier.split("?")[0]

  if (specifier.endsWith("$types")) {
    return null
  }

  if (specifier.startsWith("$lib/")) {
    return `src/lib/${specifier.slice("$lib/".length)}`
  }

  if (!specifier.startsWith(".")) {
    return null
  }

  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
}

const resolvesTo = (target, present) => {
  const stem = target.replace(EMITTED_EXTENSION, "")

  return MODULE_SUFFIXES.some((suffix) => present.has(`${target}${suffix}`) || present.has(`${stem}${suffix}`))
}

export function danglingImports(sources, present) {
  const hits = []

  for (const { file, text } of sources) {
    for (const { specifier } of specifiersIn(text)) {
      const target = resolveSpecifier(file, specifier)

      if (target && !resolvesTo(target, present)) {
        hits.push({ file, specifier })
      }
    }
  }

  return hits
}

export function staticImportsOfStubs(sources, stubs) {
  const stubbed = new Set(stubs.map((stub) => stub.replace(/\.ts$/, "")))
  const hits = []

  for (const { file, text } of sources) {
    for (const { specifier, kind } of specifiersIn(text)) {
      const target = resolveSpecifier(file, specifier)

      if (kind === "static" && target && stubbed.has(target)) {
        hits.push({ file, specifier })
      }
    }
  }

  return hits
}

async function readSources(files, outDir) {
  const sources = []

  for (const file of files) {
    if (!CODE_EXTENSIONS.has(extension(file))) {
      continue
    }

    sources.push({ file, text: await readFile(path.join(outDir, file), "utf8") })
  }

  return sources
}

const renderHit = (hit) => `${hit.file} [${hit.pattern}] x${hit.lines}`

const renderImport = (hit) => `${hit.file} -> ${hit.specifier}`

const unique = (hits) => [...new Map(hits.map((hit) => [`${hit.file}->${hit.specifier}`, hit])).values()]

function printGuardHits(title, rows, render) {
  console.error(`\nguard failed: ${title} (${rows.length})`)

  for (const row of rows) {
    console.error(`  ${render(row)}`)
  }
}

function summarize(outDir, exported, guardsOk) {
  const topLevel = new Set(exported.map((file) => file.split("/")[0]))

  console.log(`\nexport ok: ${outDir}`)
  console.log(`files: ${exported.length}`)
  console.log(`top-level: ${[...topLevel].sort().join(", ")}`)

  for (const result of guardsOk) {
    console.log(result)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = process.cwd()
  const outDir = path.resolve(args.out)

  const rules = await loadRules(repoRoot)
  const all = await trackedFiles(repoRoot)
  const kept = all.filter((file) => !isExcluded(file, rules))
  const excludedCount = all.length - kept.length

  if (args.dryRun) {
    console.log(`tracked: ${all.length}`)
    console.log(`excluded: ${excludedCount}`)
    console.log(`would copy: ${kept.length}`)
    return
  }

  await prepareOutDir(outDir, args.force)
  await copyFiles(repoRoot, outDir, kept)

  const pkgReport = await transformPackageJson(outDir, rules)
  await writeReadme(outDir)
  await writeStubs(outDir)

  const exported = await walkTree(outDir)

  const structuralHits = exported.filter(
    (file) => isExcluded(file, rules) && !STUB_MODULES.includes(file),
  )

  const missing = ["LICENSE", "README.md", "docs/SELF_HOSTING.md"].filter(
    (required) => !exported.includes(required),
  )

  const delinked = await delinkExported(outDir, exported)

  const sources = await readSources(exported, outDir)
  const present = new Set(exported)

  const danglingHits = danglingImports(sources, present).filter(
    (hit) =>
      !DANGLING_ALLOWLIST.some(
        (allowed) => allowed.file === hit.file && allowed.specifier === hit.specifier,
      ),
  )
  const stubHits = staticImportsOfStubs(sources, STUB_MODULES)
  const contentHits = await scanContent(exported, outDir)

  const failed =
    structuralHits.length > 0 ||
    missing.length > 0 ||
    danglingHits.length > 0 ||
    stubHits.length > 0 ||
    contentHits.length > 0

  if (structuralHits.length > 0) {
    printGuardHits("excluded files present in output", structuralHits, (file) => file)
  }

  if (missing.length > 0) {
    printGuardHits("required files missing from output", missing, (file) => file)
  }

  if (danglingHits.length > 0) {
    printGuardHits("imports that no longer resolve", unique(danglingHits), renderImport)
  }

  if (stubHits.length > 0) {
    printGuardHits("stubbed modules reached by a static import", unique(stubHits), renderImport)
  }

  if (contentHits.length > 0) {
    const hard = contentHits.filter((hit) => PATTERN_TIER.get(hit.pattern) === "hard")
    const policy = contentHits.filter((hit) => PATTERN_TIER.get(hit.pattern) !== "hard")

    if (hard.length > 0) {
      printGuardHits("forbidden content (hard)", hard, renderHit)
    }

    if (policy.length > 0) {
      printGuardHits("content outside policy allowlist", policy, renderHit)
    }
  }

  if (failed) {
    console.error("\nexport aborted: fix the guards above (target left in place for inspection)")
    process.exit(1)
  }

  await run("git", ["init"], { cwd: outDir })
  await run("git", ["add", "-A"], { cwd: outDir })

  summarize(outDir, exported, [
    `stripe dep removed: ${pkgReport.hadStripeDep ? "yes" : "not present"}`,
    `npm scripts dropped: ${pkgReport.droppedScripts.join(", ") || "none"}`,
    `stubs written: ${STUB_MODULES.length}`,
    `markdown de-linked: ${delinked} file`,
    `guards: structural ok, imports ok, content ok`,
    `git: initialized, all files staged, nothing committed`,
  ])
}

if (process.argv[1]?.endsWith("export-oss.mjs")) {
  main().catch((error) => fail(`export: ${error.message}`))
}
