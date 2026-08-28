import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, c, info, ok, warn } from '../lib/display.ts';

export async function cmdStudio(slug: string, opts: {
  action?: string;
  // Brand kit
  about?: string;
  category?: string;
  audience?: string;
  style?: string;
  language?: string;
  // Colors
  colors?: string;
  // People
  name?: string;
  role?: string;
  description?: string;
  kind?: string;
  gender?: string;
  ageRange?: string;
  vibe?: string;
  // Documents
  title?: string;
  text?: string;
  // Competitors
  website?: string;
  compKind?: string;
  rationale?: string;
  // Delete
  id?: string;
}) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const action = opts.action ?? 'show';

  switch (action) {
    case 'show':
      return showStudio(session.access_token, slug);
    case 'kit-update':
      return updateKit(session.access_token, slug, opts);
    case 'colors':
      return setColors(session.access_token, slug, opts.colors);
    case 'people-add':
      return addPerson(session.access_token, slug, opts);
    case 'people-generate':
      return generatePerson(session.access_token, slug, opts);
    case 'people-delete':
      return deletePerson(session.access_token, slug, opts.id);
    case 'add-note':
      return addNote(session.access_token, slug, opts);
    case 'delete-doc':
      return deleteDocument(session.access_token, slug, opts.id);
    case 'add-competitor':
      return addCompetitor(session.access_token, slug, opts);
    case 'delete-competitor':
      return deleteCompetitor(session.access_token, slug, opts.id);
    case 'research':
      return researchCompetitors(session.access_token, slug);
    case 'sync-history':
      return syncHistory(session.access_token, slug);
    default:
      console.error(`Azione sconosciuta: ${action}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
${c.bold('Azioni Studio:')}

  ${c.green('show')}                    Mostra lo studio completo (default)

  ${c.green('kit-update')}              Aggiorna dati brand kit
    --about "..."               Descrizione brand
    --category "..."            Categoria
    --audience "..."            Target audience
    --style "..."               Stile visivo
    --language "it"             Lingua post

  ${c.green('colors')}                 Imposta colori brand
    --colors "#ff0000,#00ff00"  Lista hex separata da virgola

  ${c.green('people-add')}             Aggiungi persona reale
    --name "Nome"               Nome (obbligatorio)
    --role "Ruolo"              Ruolo
    --description "..."         Descrizione

  ${c.green('people-generate')}        Genera persona AI
    --name "Nome"               Nome (obbligatorio)
    --role "Ruolo"              Ruolo
    --gender female|male        Genere
    --ageRange 26-35            Fascia età
    --vibe professional|casual  Stile

  ${c.green('people-delete')}          Elimina persona
    --id <uuid>                 ID persona

  ${c.green('add-note')}               Aggiungi nota/conoscenza
    --title "Titolo"            Titolo (default: "Note")
    --text "Contenuto..."       Testo (obbligatorio)

  ${c.green('delete-doc')}             Elimina documento
    --id <uuid>                 ID documento

  ${c.green('add-competitor')}         Aggiungi competitor
    --name "Nome"               Nome (obbligatorio)
    --website "example.com"     Sito web
    --compKind direct|indirect  Tipo
    --rationale "..."           Motivo

  ${c.green('delete-competitor')}      Elimina competitor
    --id <uuid>                 ID competitor

  ${c.green('research')}               Ricerca competitor con AI

  ${c.green('sync-history')}           Sincronizza storico post dai social
`);
}

async function showStudio(token: string, slug: string) {
  const data = await api.getStudio(token, slug);

  section('Studio');

  // Completeness
  const barLen = 25;
  const filled = Math.round((data.studioPct / 100) * barLen);
  const scoreColor = data.studioPct >= 80 ? c.green : data.studioPct >= 50 ? c.yellow : c.red;
  const bar = scoreColor('█'.repeat(filled)) + c.dim('░'.repeat(barLen - filled));
  console.log(`  Completeness: [${bar}] ${c.bold(`${data.studioPct}%`)}`);
  console.log();

  // Brand kit
  section('Brand Kit');
  const kit = data.kit as Record<string, unknown> | null;
  if (kit) {
    if (kit.category) console.log(`  Categoria:     ${kit.category}`);
    if (kit.about) console.log(`  About:         ${c.dim(String(kit.about).slice(0, 100))}${String(kit.about).length > 100 ? '…' : ''}`);
    if (kit.target_audience) console.log(`  Audience:      ${c.dim(String(kit.target_audience).slice(0, 100))}`);
    if (kit.brand_style) console.log(`  Stile:         ${kit.brand_style}`);
    if (kit.visual_style) console.log(`  Stile visivo:  ${kit.visual_style}`);
  }
  if (data.language) console.log(`  Lingua:        ${data.language}`);

  // Colors
  const colors = (kit?.brand_colors as string[]) ?? [];
  if (colors.length) {
    console.log(`  Colori:        ${colors.map(col => c.hex(col)(col)).join(' ')}`);
  }

  console.log();

  // Products
  section(`Prodotti (${data.products.length})`);
  for (const p of data.products) {
    console.log(`  ${c.bold(p.title)}${p.pricing ? ` · ${p.pricing}` : ''}`);
  }
  console.log();

  // People
  section(`Persone (${data.people.length})`);
  for (const p of data.people) {
    const badge = p.kind === 'ai' ? c.cyan('🤖') : '👤';
    console.log(`  ${badge} ${c.bold(p.name)} — ${p.role ?? '—'}  ${c.dim(p.id.slice(0, 8))}`);
  }
  console.log();

  // Competitors
  section(`Competitors (${data.competitors.length})`);
  for (const comp of data.competitors) {
    const src = comp.source === 'ai' ? c.cyan('🤖') : '👤';
    console.log(`  ${src} ${c.bold(comp.name)} — ${comp.website ?? '—'} (${comp.kind})  ${c.dim(comp.id.slice(0, 8))}`);
  }
  console.log();

  // Knowledge
  section(`Knowledge (${data.documents.length})`);
  for (const doc of data.documents) {
    const icon = doc.kind === 'image' ? '🖼' : doc.kind === 'document' ? '📄' : '📝';
    console.log(`  ${icon} ${doc.title}  ${c.dim(doc.id.slice(0, 8))}`);
  }
  console.log();

  // Platform instructions
  const instrEntries = Object.entries(data.platformInstructions).filter(([, v]) => v);
  if (instrEntries.length) {
    section('Istruzioni per platform');
    for (const [plat, instr] of instrEntries) {
      console.log(`  ${c.bold(plat)}: ${c.dim(instr.slice(0, 80))}${instr.length > 80 ? '…' : ''}`);
    }
    console.log();
  }
}

async function updateKit(token: string, slug: string, opts: { about?: string; category?: string; audience?: string; style?: string; language?: string }) {
  await api.updateBrandKit(token, slug, {
    about: opts.about,
    category: opts.category,
    target_audience: opts.audience,
    brand_style: opts.style,
    language: opts.language,
  });
  ok('Brand kit aggiornato.');
}

async function setColors(token: string, slug: string, colorsStr?: string) {
  if (!colorsStr) {
    console.error('Specifica i colori con --colors "#hex1,#hex2,..."');
    process.exit(1);
  }
  const colors = colorsStr.split(',').map(s => s.trim()).filter(Boolean);
  const result = await api.updateColors(token, slug, colors);
  ok(`Colori aggiornati: ${result.colors.join(', ')}`);
}

async function addPerson(token: string, slug: string, opts: { name?: string; role?: string; description?: string }) {
  if (!opts.name) { console.error('--name è obbligatorio'); process.exit(1); }
  const result = await api.addPerson(token, slug, {
    name: opts.name,
    role: opts.role,
    description: opts.description,
    kind: 'real',
  });
  ok(`Persona aggiunta: ${result.person.name} (${result.person.id})`);
}

async function generatePerson(token: string, slug: string, opts: { name?: string; role?: string; gender?: string; ageRange?: string; vibe?: string; description?: string }) {
  if (!opts.name) { console.error('--name è obbligatorio'); process.exit(1); }
  console.log(c.yellow('Generazione persona AI in corso (può richiedere qualche secondo)…'));
  const result = await api.addPerson(token, slug, {
    name: opts.name,
    role: opts.role,
    kind: 'ai',
    gender: opts.gender,
    ageRange: opts.ageRange,
    vibe: opts.vibe,
    description: opts.description,
  });
  ok(`Persona AI generata: ${result.person.name} (${result.person.id})`);
}

async function deletePerson(token: string, slug: string, id?: string) {
  if (!id) { console.error('--id è obbligatorio'); process.exit(1); }
  await api.deletePerson(token, slug, id);
  ok('Persona eliminata.');
}

async function addNote(token: string, slug: string, opts: { title?: string; text?: string }) {
  if (!opts.text) { console.error('--text è obbligatorio'); process.exit(1); }
  const result = await api.addDocument(token, slug, {
    title: opts.title ?? 'Note',
    content_text: opts.text,
    kind: 'note',
  });
  ok(`Nota aggiunta: ${result.document.title} (${result.document.id})`);
}

async function deleteDocument(token: string, slug: string, id?: string) {
  if (!id) { console.error('--id è obbligatorio'); process.exit(1); }
  await api.deleteDocument(token, slug, id);
  ok('Documento eliminato.');
}

async function addCompetitor(token: string, slug: string, opts: { name?: string; website?: string; compKind?: string; rationale?: string }) {
  if (!opts.name) { console.error('--name è obbligatorio'); process.exit(1); }
  const result = await api.addCompetitor(token, slug, {
    name: opts.name,
    website: opts.website,
    kind: opts.compKind ?? 'direct',
    rationale: opts.rationale,
  });
  ok(`Competitor aggiunto: ${result.competitor.name} (${result.competitor.id})`);
}

async function deleteCompetitor(token: string, slug: string, id?: string) {
  if (!id) { console.error('--id è obbligatorio'); process.exit(1); }
  await api.deleteCompetitor(token, slug, id);
  ok('Competitor eliminato.');
}

async function researchCompetitors(token: string, slug: string) {
  console.log(c.yellow('Ricerca competitor con AI in corso…'));
  const result = await api.researchCompetitors(token, slug);
  ok(`Trovati ${result.found} competitor, ${result.added} nuovi aggiunti.`);
}

async function syncHistory(token: string, slug: string) {
  console.log(c.yellow('Sincronizzazione storico post…'));
  const result = await api.syncHistory(token, slug);
  if (result.noAccounts) {
    warn('Nessun account social collegato.');
  } else {
    ok(`${result.synced} post sincronizzati.`);
    if (result.errors?.length) {
      warn(`${result.errors.length} errori: ${result.errors.slice(0, 3).join(', ')}`);
    }
  }
}
