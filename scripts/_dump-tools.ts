import { writeFileSync } from 'node:fs';
import { createChatTools } from '../src/lib/server/chat/tools';
import { pickTools, AGENTS } from '../src/lib/server/chat/agents';
const stub: any = new Proxy({}, { get: () => () => stub });
const all = createChatTools(stub, '00000000-0000-0000-0000-000000000000');
const motion: any = pickTools(all as any, 'motion');
const own = new Set(AGENTS.motion.toolKeys);
const rows = Object.entries(motion).map(([name, t]: any) => {
  const desc = String(t?.description ?? '');
  let params: string[] = [];
  try { params = Object.keys(t?.inputSchema?.shape ?? t?.parameters?.shape ?? {}); } catch {}
  return { name, desc, params, origine: own.has(name) ? 'motion' : 'condiviso' };
});
rows.sort((a, b) => a.origine.localeCompare(b.origine) || a.name.localeCompare(b.name));
const tot = rows.reduce((s, r) => s + r.desc.length, 0);
writeFileSync(process.argv[2], JSON.stringify({
  conteggio: rows.length,
  propri: rows.filter(r => r.origine === 'motion').length,
  condivisi: rows.filter(r => r.origine === 'condiviso').length,
  caratteri_descrizioni: tot, token_stimati: Math.round(tot / 4), strumenti: rows
}, null, 2), 'utf8');
console.log(`${rows.length} strumenti — ${tot} caratteri ≈ ${Math.round(tot/4)} token`);
console.log(`propri: ${rows.filter(r=>r.origine==='motion').length} · condivisi: ${rows.filter(r=>r.origine==='condiviso').length}`);
