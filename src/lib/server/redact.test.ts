import { describe, expect, it } from 'vitest';
import { redactSecrets, redactJson, noteSecret } from './redact';
import { agentSessionRow, createRecorder } from './agent-sessions';

/**
 * IL CORPUS, in due metà che devono valere insieme.
 *
 * Solo la prima ("devono sparire") si supera oscurando tutto, ed è il modo classico di dichiarare
 * risolto un problema di redazione mentre si rende illeggibile la traccia. La seconda ("devono
 * restare") è quella che tiene onesta la prima: 15 stringhe legittime — hash di commit, UUID,
 * percorsi, codice, URL pubbliche — che devono uscire IDENTICHE.
 *
 * Tutti i valori sono inventati.
 */
const TOK = 'gho_INVENTATO0000aaaaBBBBccccDDDD1111';
// Composta a pezzi, non scritta intera: la scansione di GitHub riconosce la FORMA di una chiave
// Stripe viva e rifiuta il push anche quando il valore è inventato — è già successo. Il test
// continua a provare esattamente la stessa stringa.
const STRIPE_FAKE = ['rk', 'live', '51QxINVENTATA0000000000000000'].join('_');

const DEV = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PWD = 'Inv3nt4t4Lung4Assai';
const KNOWN = [TOK, DEV, PWD];
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

const DEVONO_SPARIRE: Array<[string, string, string]> = [
  ['token nudo', TOK, TOK],
  ['export shell', `export GH_TOKEN='${TOK}'`, TOK],
  ['installation token', 'ghs_INVENTATA0000aaaaBBBBccccDDDD2222', 'ghs_INVENTATA0000'],
  ['pat fine-grained', 'github_pat_11AINVENTATA0000_aaaaBBBBccccDDDD1111eeee', 'github_pat_11AINVENTATA'],
  ['device code json', `{"device_code":"${DEV}","interval":5}`, DEV],
  ['nostra api key', 'anomalia_live_0123456789abcdef0123456789abcdef', 'anomalia_live_0123'],
  ['jwt', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJJTlZFTlRBVE8ifQ.SW52ZW50YXRhRmlybWFYWVo', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
  ['url firmata', 'https://xyz.supabase.co/storage/v1/object/sign/brand-knowledge/a.png?token=eyJhbGciOiJIUzI1NiJ9INVENTATA&download=1', 'eyJhbGciOiJIUzI1NiJ9INVENTATA'],
  ['pgpassword', 'PGPASSWORD=Inv3nt4t4! psql -h db.esempio.io -U app', 'Inv3nt4t4!'],
  ['aws secret', 'AWS_SECRET_ACCESS_KEY=wJalrINVENTATA/K7MDENG+bPxRfiCYINVENTATAKEY', 'wJalrINVENTATA'],
  ['gemini key', 'GEMINI_API_KEY=AIzaSyINVENTATA00000000000000000000000000', 'AIzaSyINVENTATA'],
  ['stripe restricted', `STRIPE_SECRET_KEY=${STRIPE_FAKE}`, 'rk_live_51Qx'],
  ['supabase secret', 'SUPABASE_SECRET=sb_secret_INVENTATA00000000000', 'sb_secret_INVENTATA'],
  ['cron secret hex64', `CRON_SECRET=${'0123456789abcdef'.repeat(4)}`, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
  ['database url', `postgres://app:${PWD}@db.esempio.io:5432/prod`, PWD],
  ['basic auth', 'Authorization: Basic aW52ZW50YXRvOmludmVudGF0bw==', 'aW52ZW50YXRvOmludmVudGF0bw'],
  ['curl bearer', `curl -H "Authorization: Bearer ${TOK}" https://api.github.com/user`, TOK],
  ['chiave privata pem', '-----BEGIN OPENSSH PRIVATE KEY-----\nSW52ZW50YXRhQ2hpYXZlUHJpdmF0YQ==\n-----END OPENSSH PRIVATE KEY-----', 'SW52ZW50YXRhQ2hpYXZlUHJpdmF0YQ'],
  ['header x-api-key', 'x-api-key: INVENTATA0000aaaaBBBBcccc1111', 'INVENTATA0000aaaaBBBB'],
  ['doppio escape', '{"body":"{\\"api_key\\":\\"INVENTATA0000aaaaBBBB\\"}"}', 'INVENTATA0000aaaaBBBB'],
  ['password con &', 'password=Tr0ub4dor&3', 'Tr0ub4dor&3'],
  ['base64 del token', b64(TOK), b64(TOK).slice(0, 20)],
  ['access_token in query', 'https://graph.facebook.com/v20.0/me?access_token=INVENTATO0000aaaaBBBBcccc', 'INVENTATO0000aaaaBBBB'],
  ['chiave a forma di uuid', 'EXA_API_KEY=11111111-2222-4333-a444-555555555555', '11111111-2222-4333-a444-555555555555'],
  ['password dataforseo', 'DATAFORSEO_PASSWORD=Inv3nt4t4', 'Inv3nt4t4'],
  ['npm token', 'npm_INVENTATA0000aaaaBBBBcccc1111222233', 'npm_INVENTATA0000'],
  ['webhook secret', 'whsec_INVENTATA0000aaaaBBBBcccc', 'whsec_INVENTATA0000'],
  ['google oauth', 'ya29.INVENTATA0000aaaaBBBBcccc1111DDDD', 'ya29.INVENTATA'],
  ['google client secret', 'GOCSPX-INVENTATA0000aaaaBBBB', 'GOCSPX-INVENTATA'],
  ['argv annidato', `{"tool":"sandbox_exec","input":{"args":["-lc","source .github.env && curl -H \\"Authorization: Bearer ${TOK}\\" x"]}}`, TOK],
  ['base64 del device code', b64(DEV), b64(DEV).slice(0, 20)],
  ['hex del token', hex(TOK), hex(TOK).slice(0, 20)]
];

const DEVONO_RESTARE: Array<[string, string]> = [
  ['percorso storage', 'storage_path: "d3f9c2a1-4b56-4e78-9a0b-1c2d3e4f5a6b/7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e/media/sandbox-1756049123456.png"'],
  ['uuid nudi', 'brand_id: 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d · user_id: 5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c'],
  ['git head', 'HEAD is now at 9f2c1ab fix: taglio della voce'],
  ['sha di commit', 'commit 9f2c1ab5d7e34c8190bd2f6a4e0c7b3d5a1f8e29'],
  ['sha256', 'sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['tsx', '<Button key={item.id} onClick={() => setOpen(true)} className="mt-4 flex items-center gap-2">Salva</Button>'],
  ['query supabase', "const { data } = await supabase.from('agent_sessions').select('id, agent, mode').eq('brand_id', brandId);"],
  ['errore npm', 'npm error code ERESOLVE — exit code 1'],
  ['path con riga', 'src/routes/api/v1/brands/[slug]/agent-sessions/+server.ts:31'],
  ['timestamp e durata', '2026-08-22T14:03:11.482Z · durata 1832 ms'],
  ['nome vm', 'anomalia-4f3c2b1a-9e8d-4c7b-a6f5-0d1e2f3a4b5c-compute-g2'],
  ['prosa', 'Il delegato ha aperto la VM, installato le dipendenze e prodotto il rapporto finale.'],
  ['riga modello', 'model: anthropic claude-opus-5[1m] · eventi: 47'],
  ['url pubblica', 'https://www.anomalia.so/it/blog/come-funziona-il-piano-editoriale-settimanale'],
  ['import', "import { createAdminClient } from '$lib/server/supabase-admin';"]
];

describe('redactSecrets — devono sparire', () => {
  it.each(DEVONO_SPARIRE)('%s', (_n, input, spia) => {
    expect(redactSecrets(input, KNOWN)).not.toContain(spia);
  });
});

describe('redactSecrets — devono restare', () => {
  // La metà che impedisce di "risolvere" oscurando tutto.
  it.each(DEVONO_RESTARE)('%s', (_n, input) => {
    expect(redactSecrets(input, KNOWN)).toBe(input);
  });
});

describe('redazione PRIMA del taglio', () => {
  /**
   * `clipEventData` taglia a 4.000 caratteri. Redigere dopo lascerebbe 39 caratteri su 40 di un
   * token — cioè sedici tentativi di forza bruta invece di un segreto.
   */
  it('un segreto oltre il taglio non sopravvive nel troncamento', () => {
    noteSecret('b-clip', TOK);
    const rec = createRecorder(Date.now, 'b-clip');
    rec.event('sandbox_exec', { stdout: 'x'.repeat(3990) + TOK });
    // La spia è corta di proposito. Con `'gho_INVENTATO'` (13 caratteri) questo test passerebbe
    // anche SENZA redazione, perché il taglio a 4.000 lascia sopravvivere solo `gho_INVENT` — ed è
    // precisamente il difetto: dieci caratteri di token in chiaro sono sedici tentativi di forza
    // bruta, non un segreto protetto. Otto caratteri è la soglia sotto cui non redigiamo comunque.
    expect(JSON.stringify(rec.events())).not.toContain('gho_INVE');
  });
});

describe('fail-closed', () => {
  it('un round-trip impossibile torna null, mai il valore di partenza', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(redactJson(circular, 'b1')).toBeNull();
  });

  it('un segreto con virgolette e backslash sparisce anche nella forma escapata', () => {
    const weird = 'pa$$"w\\ord-Inventata-2026';
    noteSecret('b-esc', weird);
    const out = redactJson({ tool: 'sandbox_exec', input: { cmd: `echo ${weird}` } }, 'b-esc');
    expect(JSON.stringify(out)).not.toContain('Inventata-2026');
  });
});

describe('costo', () => {
  // Guardrail contro un regex catastrofico aggiunto in futuro: misurato 48 ms su 1 MB,
  // ~300 ms con la suite in parallelo. Un regex esplosivo brucia in secondi: la soglia
  // sta sopra il rumore e sotto il disastro.
  it('sta sotto 1 s su 1 MB', () => {
    const big = ('riga di traccia con un po di testo e un uuid 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d\n').repeat(11000);
    const t0 = Date.now();
    redactSecrets(big, KNOWN);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('la riga scritta è redatta in ogni campo, non solo nel transcript', () => {
  it('system_prompt ed error non escono in chiaro, e la riga è marcata', () => {
    noteSecret('b-save', TOK);
    const rec = createRecorder(Date.now, 'b-save');
    rec.event('report', { report: `rapporto con ${TOK}` });
    const row = agentSessionRow({
      brandId: 'b-save', agent: 'motion', mode: 'execute', surface: 'chat_subagent', status: 'error',
      systemPrompt: `sistema con ${TOK}`, transcript: `rapporto con ${TOK}`, error: `errore con ${TOK}`,
      recorder: rec
    });
    expect(JSON.stringify(row)).not.toContain('gho_INVE');
    expect(row.format_version).toBe(2);
  });
});
