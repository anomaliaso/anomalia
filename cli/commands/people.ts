import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, c, table, info, ok } from '../lib/display.ts';

export async function cmdPeople(slug: string, opts: {
  action?: string;
  name?: string;
  role?: string;
  description?: string;
  gender?: string;
  ageRange?: string;
  kind?: string;
  consent?: boolean;
  id?: string;
}) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const action = opts.action ?? 'list';
  switch (action) {
    case 'list':
      return listPeople(session.access_token, slug);
    case 'add':
      return addPerson(session.access_token, slug, opts);
    case 'remove':
      return removePerson(session.access_token, slug, opts.id);
    default:
      console.error(`Azione sconosciuta: ${action}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
${c.bold('Azioni Persone:')}

  ${c.green('list')}                    Elenca le persone del brand (default)

  ${c.green('add')}                     Aggiunge una persona
    --name "Andrea"               Nome (obbligatorio)
    --gender female               Genere (female/male) — IMPORTANTE per le immagini
    --ageRange "26-35"            Fascia d'età
    --role "Founder"              Ruolo
    --description "..."           Descrizione
    --kind ai|real                ai = genera foto AI; real = persona reale (default real)
    --consent                     Attesti di avere il consenso della persona reale (obbligatorio)

  ${c.green('remove')}                  Rimuove una persona
    --id <personId>               ID persona (da \`people list\`)
`);
}

async function listPeople(token: string, slug: string) {
  const studio = await api.getStudio(token, slug);
  const people = studio.people ?? [];
  section(`Persone (${people.length})`);
  if (!people.length) {
    info('Nessuna persona. Aggiungine una con `anomalia people ' + slug + ' add --name "..." --gender female`.');
    return;
  }
  table(
    ['ID', 'Nome', 'Tipo', 'Ruolo', 'Foto'],
    people.map(p => [
      p.id.slice(0, 8),
      p.name,
      p.kind,
      p.role ?? '—',
      p.imageCount > 0 ? String(p.imageCount) : c.red('0'),
    ])
  );
  console.log();
}

async function addPerson(token: string, slug: string, opts: { name?: string; role?: string; description?: string; gender?: string; ageRange?: string; kind?: string; consent?: boolean }) {
  if (!opts.name) { console.error('--name è obbligatorio'); process.exit(1); }
  const kind = opts.kind === 'ai' ? 'ai' : 'real';
  if (kind === 'ai') console.log(c.yellow('Generazione persona AI con foto in corso…'));
  const result = await api.addPerson(token, slug, {
    name: opts.name,
    role: opts.role,
    description: opts.description,
    gender: opts.gender,
    ageRange: opts.ageRange,
    kind,
    consent: opts.consent === true,
  });
  ok(`Persona "${result.person.name}" aggiunta (${result.person.kind}).`);
  if (kind === 'real') info('Persona reale senza foto: carica le foto dalla web app perché appaia nelle immagini generate.');
}

async function removePerson(token: string, slug: string, id?: string) {
  if (!id) { console.error('--id è obbligatorio (vedi `people list`)'); process.exit(1); }
  await api.deletePerson(token, slug, id);
  ok('Persona rimossa.');
}
