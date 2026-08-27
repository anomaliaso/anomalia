/**
 * Misura il system prompt VERO, per mestiere. Costruisce `buildSystemPrompt` con un client
 * Supabase finto che risponde `{data:null}` a qualunque catena: quello che resta e` lo SCHELETRO
 * — i blocchi costanti, cioe` esattamente cio` che i cinque tagli spostano. Le sezioni che
 * dipendono dai dati del brand restano vuote e vanno misurate su un prompt reale (raw.txt).
 *
 * Uso: npx vite-node --config scripts/_vn.config.ts scripts/_prompt-size.ts [outdir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSystemPrompt } from '../src/lib/server/chat/system-prompt';
import { AGENT_IDS } from '../src/lib/server/chat/agents';

const mk = (): any =>
  new Proxy(function () {} as any, {
    get(_t, p) {
      if (p === 'then') return (res: (v: unknown) => void) => res({ data: null, error: null });
      return () => mk();
    },
    apply() {
      return mk();
    }
  });

const supabase: any = mk();
const brand = {
  id: '00000000-0000-0000-0000-000000000000',
  org_id: null,
  slug: 'demo',
  name: 'Demo',
  website: 'https://demo.test',
  plan: 'starter',
  status: 'active',
  timezone: 'Europe/Rome',
  content_prefs: null,
  onboarding_state: null,
  setup_completed_at: '2026-01-01T00:00:00Z'
};

const outdir = process.argv[2] ?? null;
if (outdir) mkdirSync(outdir, { recursive: true });

const rows: Array<{ agente: string; char: number; tok: number }> = [];
for (const id of [...AGENT_IDS, null]) {
  const s = await buildSystemPrompt(supabase, brand, 'it', id as any, { threadId: undefined });
  rows.push({ agente: id ?? '(nullo)', char: s.length, tok: Math.round(s.length / 4) });
  if (outdir) writeFileSync(`${outdir}/${id ?? 'nullo'}.txt`, s, 'utf8');
}
for (const r of rows) console.log(`${r.agente.padEnd(10)} ${String(r.char).padStart(8)} char  ${String(r.tok).padStart(6)} tok`);
