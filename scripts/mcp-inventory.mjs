/**
 * Rigenera `docs/mcp-tools.md` dal server MCP vero.
 *
 *   node scripts/mcp-inventory.mjs            confronta e fallisce se il file e' vecchio
 *   node scripts/mcp-inventory.mjs --write    riscrive il file
 *
 * L'elenco si prende da `tools/list` attraverso il transport, mai leggendo i sorgenti: contare i
 * contratti a mano ha gia' dato tre numeri sbagliati, e un inventario che sbaglia il conteggio e'
 * peggio di nessun inventario.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const OUT = 'docs/mcp-tools.md';

function fetchTools() {
  const script = `
    import { handleMcpFetch } from './mcp/http-app.ts';
    const post = (b) => handleMcpFetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(b)
    }));
    await post({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inventory', version: '0' } } });
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    process.stdout.write(JSON.stringify((await res.json()).result));
  `;
  writeFileSync('cli/.inventory.tmp.ts', script);
  const run = spawnSync('bun', ['run', './.inventory.tmp.ts'], { cwd: 'cli', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  spawnSync('rm', ['-f', 'cli/.inventory.tmp.ts']);
  if (run.status !== 0) {
    throw new Error(`bun failed: ${run.stderr?.slice(0, 400)}`);
  }
  return JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
}

const KIND = (t) =>
  t.annotations?.readOnlyHint === true ? 'read'
  : t.annotations?.destructiveHint === true ? 'destroy'
  : 'write';

/** Il gruppo e' il soggetto su cui il tool lavora, dedotto dal nome: serve a leggere, non a decidere. */
const GROUPS = [
  ['Post', /post|slide|caption|carousel|schedule|render/],
  ['Piano editoriale e settimana', /plan|week|brief|seed/],
  ['Media', /media|image|video|graphic|motion/],
  ['Blog e articoli', /article|blog|web/],
  ['Studio: chi e cosa', /competitor|person|product|document|note|talent/],
  ['Brand: identita e impostazioni', /brand|voice|colors|appearance|bio|identity|setting/],
  ['Memoria e conoscenza', /memory|knowledge|skill/],
  ['SEO, GEO, ads', /seo|geo|ads|keyword|rank|gsc|backlink/],
  ['Radar e mercato', /radar|market|news|idea|field/],
  ['Accesso diretto al database', /^(query|insert_row|update_row)$/],
  ['Account, condivisione, fatturazione', /brand|share|checkout|billing|social|connect|automation|history/]
];
const groupOf = (name) => (GROUPS.find(([, re]) => re.test(name)) ?? ['Altro'])[0];

function params(schema) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const rows = Object.entries(props).map(([k, v]) => {
    const type = v.enum ? v.enum.map((e) => `\`${e}\``).join(' \\| ')
      : v.type === 'array' ? `${v.items?.type ?? 'any'}[]`
      : v.anyOf ? v.anyOf.map((a) => a.type).filter(Boolean).join(' \\| ') || 'any'
      : v.type ?? 'any';
    return `| \`${k}\`${required.has(k) ? '' : '?'} | ${type} | ${(v.description ?? '').replace(/\|/g, '\\|')} |`;
  });
  return rows.length ? ['| campo | tipo | |', '|---|---|---|', ...rows].join('\n') : '_nessun parametro._';
}

function render(result) {
  const tools = [...result.tools].sort((a, b) => a.name.localeCompare(b.name));
  const bytes = JSON.stringify(tools).length;
  const by = { read: [], write: [], destroy: [] };
  for (const t of tools) by[KIND(t)].push(t);

  const groups = new Map();
  for (const t of tools) {
    const g = groupOf(t.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }

  const out = [];
  out.push('# I tool MCP di Anomalia');
  out.push('');
  out.push('> Generato da `node scripts/mcp-inventory.mjs --write`, leggendo `tools/list` dal server vero.');
  out.push('> Non si modifica a mano: il prossimo che rigenera cancella le correzioni.');
  out.push('');
  out.push(`**${tools.length} tool** — ${by.read.length} in lettura, ${by.write.length} in scrittura, ${by.destroy.length} che distruggono.`);
  out.push(`Il payload di \`tools/list\` pesa **${bytes.toLocaleString('it-IT')} caratteri**, circa **${Math.round(bytes / 4).toLocaleString('it-IT')} token**, ed e' il costo che ogni sessione paga prima di dire una parola.`);
  out.push('');
  out.push('| gruppo | tool |');
  out.push('|---|---:|');
  for (const [g, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`| ${g} | ${list.length} |`);
  }
  out.push('');
  out.push('Legenda: **R** legge e non cambia niente · **W** scrive · **D** distrugge, e il client puo\' chiedere conferma.');
  out.push('');

  for (const [g, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`## ${g}`);
    out.push('');
    for (const t of list) {
      const k = KIND(t);
      const badge = k === 'read' ? 'R' : k === 'destroy' ? 'D' : 'W';
      out.push(`### \`${t.name}\` · ${badge}`);
      out.push('');
      if (t.title) out.push(`*${t.title}*`);
      out.push('');
      out.push(t.description ?? '_senza descrizione._');
      out.push('');
      out.push(params(t.inputSchema));
      out.push('');
    }
  }
  return out.join('\n') + '\n';
}

const result = fetchTools();
const text = render(result);
if (process.argv.includes('--write')) {
  writeFileSync(OUT, text);
  console.log(`${OUT} rigenerato — ${result.tools.length} tool`);
} else {
  const current = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return ''; } })();
  if (current !== text) {
    console.error(`${OUT} non e' aggiornato. Rigeneralo: node scripts/mcp-inventory.mjs --write`);
    process.exit(1);
  }
  console.log(`${OUT} aggiornato — ${result.tools.length} tool`);
}
