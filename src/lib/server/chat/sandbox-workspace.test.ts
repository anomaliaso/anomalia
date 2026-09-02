import { describe, expect, it } from 'vitest';
import { buildBrandWorkspace, describeColumns, toCsv, toJson, workspaceReadme } from './sandbox-workspace';
import { rejectPath, rejectReadPath } from '$lib/agent/tools/sandbox-tools';

/**
 * Un finto PostgREST: risolve `{data, error}` come supabase-js — che NON lancia mai — e registra
 * la stringa di `select()`. È tutto ciò che serve per inchiodare i due modi in cui questo file
 * perdeva un file intero senza dirlo.
 */
type FakeRes = { data: unknown; error: { code: string } | null };
function fakeSupabase(byTable: Record<string, FakeRes>) {
  const seen: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (table: string): any => {
    const res = byTable[table] ?? { data: null, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      select: (cols: string) => {
        seen[table] = cols;
        return self;
      },
      eq: () => self,
      order: () => self,
      limit: () => self,
      maybeSingle: () => Promise.resolve(res),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (ok: any, ko: any) => Promise.resolve(res).then(ok, ko)
    };
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from: (t: string) => chain(t) } as any, seen };
}

const IG = (id: string) => `https://www.instagram.com/p/${id}/`;

describe('toCsv', () => {
  it('quota virgole, virgolette e a-capo — o pandas legge le colonne sbagliate', () => {
    const csv = toCsv([{ a: 'x,y', b: 'he said "hi"', c: 'riga1\nriga2' }], ['a', 'b', 'c']);
    const [header, row] = csv.trim().split('\n', 1).concat(csv.trim().slice(csv.indexOf('\n') + 1));
    expect(header).toBe('a,b,c');
    expect(row).toContain('"x,y"');
    expect(row).toContain('"he said ""hi"""');
  });

  it('null e undefined sono celle vuote, non la stringa "null"', () => {
    const csv = toCsv([{ a: null, b: undefined, c: 0 }], ['a', 'b', 'c']);
    expect(csv.trim().split('\n')[1]).toBe(',,0');
  });

  it('una colonna che manca nella riga non sfasa le altre', () => {
    const csv = toCsv([{ a: 1 }, { a: 2, b: 3 }], ['a', 'b']);
    const rows = csv.trim().split('\n');
    expect(rows[1]).toBe('1,');
    expect(rows[2]).toBe('2,3');
  });

  it('gli oggetti finiscono serializzati, non "[object Object]"', () => {
    const csv = toCsv([{ m: { likes: 3 } }], ['m']);
    expect(csv).toContain('likes');
    expect(csv).not.toContain('[object Object]');
  });
});

describe('toJson', () => {
  it('dichiara il troncamento invece di consegnare JSON rotto', () => {
    const big = { blob: 'x'.repeat(5000) };
    const out = JSON.parse(toJson(big, 1000));
    expect(out.truncated).toBe(true);
    expect(out.reason).toContain('read_');
  });

  it('sotto il tetto resta JSON vero', () => {
    expect(JSON.parse(toJson({ a: 1 }))).toEqual({ a: 1 });
  });
});

describe('describeColumns — una colonna vuota non è una colonna a zero', () => {
  // Le righe vere: `scrapecreators` non porta engagement_rate né saves, `reach` non lo porta
  // nessuna delle due fonti. Misurato: 0/3.131, 0/3.131, 0/3.507.
  const scrape = { platform: 'instagram', source: 'scrapecreators', likes: 10, saves: '', reach: '', engagement_rate: '' };
  const zernio = { platform: 'instagram', source: 'zernio', likes: 20, saves: 3, reach: '', engagement_rate: 4.1 };
  const OPTIONAL = ['likes', 'saves', 'reach', 'engagement_rate'];

  it('una colonna che nessuna riga valorizza NON viene scritta — leggerla deve rompere, non dare 0', () => {
    const { columns } = describeColumns([scrape, scrape], ['platform', 'source', ...OPTIONAL], OPTIONAL);
    // È il bug: per i 22 brand su 29 senza righe zernio, `float(r['engagement_rate'] or 0)`
    // restituiva mediana 0,0 su ogni piattaforma e la riportava come misura.
    expect(columns).not.toContain('engagement_rate');
    expect(columns).not.toContain('saves');
    expect(columns).not.toContain('reach');
    expect(columns).toEqual(['platform', 'source', 'likes']);
  });

  it('e il CSV che ne esce non ha nemmeno l’intestazione: la chiave manca, non vale zero', () => {
    const { columns } = describeColumns([scrape], ['platform', 'source', ...OPTIONAL], OPTIONAL);
    const csv = toCsv([scrape], columns);
    expect(csv.split('\n')[0]).toBe('platform,source,likes');
    expect(csv).not.toContain('engagement_rate');
  });

  it('una colonna valorizzata a metà resta, ma dichiara quante righe la portano', () => {
    const { columns, note } = describeColumns([scrape, zernio], ['platform', 'source', ...OPTIONAL], OPTIONAL);
    expect(columns).toContain('engagement_rate');
    expect(note).toContain('engagement_rate 1/2');
    expect(note).toContain('source');
    // `reach` è vuota su ENTRAMBE: sparisce anche qui.
    expect(columns).not.toContain('reach');
    expect(note).toContain('reach');
  });

  it('le colonne non-metriche restano sempre, anche vuote: sono l’identità della riga', () => {
    const { columns } = describeColumns([{ platform: '', source: '', likes: 1 }], ['platform', 'source', 'likes'], OPTIONAL);
    expect(columns).toContain('platform');
    expect(columns).toContain('source');
  });

  it('zero righe: nessuna colonna metrica sopravvive, e nessuna promessa', () => {
    const { columns } = describeColumns([], ['platform', ...OPTIONAL], OPTIONAL);
    expect(columns).toEqual(['platform']);
  });
});

describe('workspaceReadme', () => {
  it('elenca i file che esistono davvero, non quelli che potrebbero esistere', () => {
    const md = workspaceReadme(['- `brand/history.csv` — 12 post']);
    expect(md).toContain('history.csv');
    expect(md).toContain('12 post');
  });

  it('un brand senza dati lo dice, invece di promettere file vuoti', () => {
    expect(workspaceReadme([])).toContain('nessun dato disponibile');
  });

  it('dice che i numeri vengono da un comando, non da un’occhiata', () => {
    expect(workspaceReadme([])).toContain('comando che hai eseguito');
  });

  it('stampa l’istante in cui è stato generato: «adesso» non è una data', () => {
    expect(workspaceReadme([], new Date('2026-08-23T14:02:00.000Z'))).toContain('2026-08-23T14:02:00.000Z');
  });

  it('avverte che una colonna assente non vale zero', () => {
    const md = workspaceReadme([]);
    expect(md).toContain('non vale zero');
    expect(md).toContain('source');
  });
});

describe('rejectPath', () => {
  it('accetta i path di lavoro', () => {
    expect(rejectPath('work/analysis.py')).toBeNull();
    expect(rejectPath('out.png')).toBeNull();
  });

  it('rifiuta assoluti e risalite', () => {
    expect(rejectPath('/etc/passwd')).toBeTruthy();
    expect(rejectPath('../../secrets')).toBeTruthy();
    expect(rejectPath('work/../../x')).toBeTruthy();
  });

  it('rifiuta la cassaforte della VM, in lettura come in scrittura', () => {
    // La falla: `.github.env` sta DENTRO la directory della run, quindi era un path lecito — e
    // dentro c'è il token GitHub che l'utente ha autorizzato.
    for (const p of ['.github.env', 'work/.github.env', '.anomalia', '.anomalia/github-device.json']) {
      expect(rejectPath(p)).toBeTruthy();
      expect(rejectReadPath(p)).toBeTruthy();
    }
  });

  it('la lettura, a differenza della scrittura, vede lo snapshot del brand', () => {
    expect(rejectReadPath('brand/history.csv')).toBeNull();
  });

  it('protegge lo snapshot dei dati del brand dalla scrittura', () => {
    // Se l'agente potesse riscrivere brand/history.csv, il turno dopo analizzerebbe i suoi stessi
    // scarabocchi credendoli dati del prodotto.
    expect(rejectPath('brand/history.csv')).toBeTruthy();
  });
});


describe('buildBrandWorkspace — i file che non si scrivevano, e perché nessuno se ne accorgeva', () => {
  it('un errore del database diventa una riga ⚠ nel README, non silenzio', async () => {
    // È il caso reale: `posts.content` non esiste (la colonna è `caption`), PostgREST risponde
    // 42703, supabase-js risolve con `{data: null, error}` e `if (!data) return` ingoiava tutto.
    // Il README è onesto per costruzione — elenca solo ciò che è riuscito — quindi l'agente
    // leggeva «questo brand non ha post» davanti a un guasto.
    const { client } = fakeSupabase({ posts: { data: null, error: { code: '42703' } } });
    const files = await buildBrandWorkspace(client, 'b1');
    const readme = files.find((f) => f.path.endsWith('README.md'))!.content;
    expect(files.some((f) => f.path.endsWith('posts.csv'))).toBe(false);
    expect(readme).toContain('posts.csv');
    expect(readme).toContain('42703');
    expect(readme).toContain('GUASTO');
  });

  it('un brand senza post NON produce la stessa riga di un brand rotto', async () => {
    const { client } = fakeSupabase({ posts: { data: [], error: null } });
    const readme = (await buildBrandWorkspace(client, 'b1')).find((f) => f.path.endsWith('README.md'))!.content;
    expect(readme).not.toContain('GUASTO');
  });

  it('posts.csv chiede `caption` con un ALIAS: rinominare e basta lo riempirebbe di zeri', async () => {
    const { client, seen } = fakeSupabase({
      posts: { data: [{ id: 'p1', status: 'draft', platform: 'instagram', content: 'ciao mondo' }], error: null }
    });
    const files = await buildBrandWorkspace(client, 'b1');
    // `content:caption`, non `caption`: `p.content` è letto due volte più sotto (chars + caption).
    expect(seen.posts).toContain('content:caption');
    const csv = files.find((f) => f.path.endsWith('posts.csv'))!.content;
    expect(csv.trim().split('\n')[1]).toContain(',10,ciao mondo');
  });

  it('strategy.json non nomina più due colonne che non esistono', async () => {
    const { client, seen } = fakeSupabase({ brand_strategy: { data: { positioning: 'x' }, error: null } });
    await buildBrandWorkspace(client, 'b1');
    expect(seen.brand_strategy).not.toContain('gtm_plan');
    expect(seen.brand_strategy).not.toMatch(/\bstatus\b/);
    expect(seen.brand_strategy).toContain('positioning');
  });

  it('history.csv: `source` in colonna, duplicati fra le fonti tolti, colonne vuote non scritte', async () => {
    const { client, seen } = fakeSupabase({
      social_post_history: {
        data: [
          // Lo stesso post, due volte: una riga per fonte. Vince zernio (metriche più ricche).
          { source: 'scrapecreators', platform: 'instagram', platform_post_url: IG('ABC'), content: 'x', published_at: '2026-08-01T00:00:00Z', metrics: { likes: 10 } },
          { source: 'zernio', platform: 'instagram', platform_post_url: IG('ABC'), content: 'x', published_at: '2026-08-01T00:00:00Z', metrics: { likes: 12, saves: 3, engagementRate: 4.1 } },
          { source: 'scrapecreators', platform: 'instagram', platform_post_url: IG('XYZ'), content: 'y', published_at: '2026-07-01T00:00:00Z', metrics: { likes: 5 } }
        ],
        error: null
      }
    });
    const files = await buildBrandWorkspace(client, 'b1');
    expect(seen.social_post_history).toContain('source');
    const csv = files.find((f) => f.path.endsWith('history.csv'))!.content;
    const [header, ...rows] = csv.trim().split('\n');
    expect(header).toContain('source');
    // 3 righe in ingresso, 2 post logici: senza dedup un `count(*)` per piattaforma conta doppio.
    expect(rows).toHaveLength(2);
    expect(csv).toContain('zernio');
    // `reach` non esiste su nessuna fonte (0/3.507 misurate): non deve nemmeno avere un'intestazione.
    expect(header).not.toContain('reach');
    // `engagement_rate` esiste su una riga sola: resta, ma il README dice quante.
    expect(header).toContain('engagement_rate');
    const note = files.find((f) => f.path.endsWith('README.md'))!.content;
    expect(note).toContain('engagement_rate 1/2');
    expect(note).toContain('reach');
  });

  it('un brand con SOLO scrapecreators non riceve una colonna engagement_rate da leggere come 0', async () => {
    // 22 brand su 29 stanno esattamente qui (misurato). Prima: intestazione presente, celle vuote,
    // `float(r['engagement_rate'] or 0)` → mediana 0,0 su ogni piattaforma, riportata come misura.
    const { client } = fakeSupabase({
      social_post_history: {
        data: [
          { source: 'scrapecreators', platform: 'instagram', platform_post_url: IG('A'), content: 'a', published_at: '2026-08-01T00:00:00Z', metrics: { likes: 10 } },
          { source: 'scrapecreators', platform: 'tiktok', platform_post_url: IG('B'), content: 'b', published_at: '2026-08-02T00:00:00Z', metrics: { likes: 7 } }
        ],
        error: null
      }
    });
    const files = await buildBrandWorkspace(client, 'b1');
    const header = files.find((f) => f.path.endsWith('history.csv'))!.content.split('\n')[0];
    expect(header).not.toContain('engagement_rate');
    expect(header).not.toContain('saves');
    expect(header).toContain('likes');
    const readme = files.find((f) => f.path.endsWith('README.md'))!.content;
    expect(readme).toContain('engagement_rate');
    expect(readme).toContain('non sono zeri');
  });
});
