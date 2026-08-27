import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LE DUE PROVE CHE RENDONO LA CARTELLA UNO STRUMENTO INVECE DI UN ORNAMENTO.
 *
 * Il caso peggiore possibile non è un bug: è che il proprietario apra il bucket, corregga una
 * regola del mestiere a mano, e NON SUCCEDA NIENTE senza che nessuno glielo dica. Un no-op
 * silenzioso su una revisione fatta a mano brucia un pomeriggio e la fiducia nel meccanismo.
 *
 * Quindi due prove, non una:
 *  1. un `override` CAMBIA DAVVERO ciò che l'agente legge;
 *  2. senza override si legge il default, e il default è esattamente ciò che dice il codice.
 *
 * E la proprietà che impedisce la biforcazione, che è la ragione per cui la (2) può essere così
 * semplice: `defaults/` nel bucket è uno SPECCHIO IN SOLA SCRITTURA. Non viene mai letto a runtime
 * — la lettura è `overrides/` oppure il codice compilato. Un bucket non riallineato può quindi
 * ingannare chi guarda, ma non può cambiare il comportamento di un agente.
 */
const download = vi.fn();
// `list('overrides')` è l'INDICE: dice quali cartelle di primo livello hanno un override, e
// `readOverride` scarica solo per quelle. Prima si scaricava per ogni path — 153 download e 20
// secondi per un `grep` senza risultati — e questo mock rendeva `list` un `vi.fn()` vuoto perché
// nessuno lo chiamava. Adesso è la porta: se torna vuoto, non si scarica niente.
const list = vi.fn(async () => ({ data: [{ name: 'how' }, { name: 'skills' }, { name: 'library' }] }));
vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({ storage: { from: () => ({ download, upload: vi.fn(), list }) } })
}));

const { readAgentFile, AGENT_FILES, isOverridable } = await import('./agent-files');
const PATH = 'how/MAKE-MOTION-VIDEO.md';

beforeEach(() => download.mockReset());

describe('la cartella editabile', () => {
  it('un override cambia davvero cio` che l\'agente legge', async () => {
    download.mockResolvedValue({ data: { text: async () => 'IL MESTIERE, RISCRITTO A MANO' }, error: null });
    expect(await readAgentFile(PATH)).toBe('IL MESTIERE, RISCRITTO A MANO');
  });

  it('senza override si legge il default, e il default e` il codice', async () => {
    download.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const letto = await readAgentFile(PATH);
    // Se qualcuno cambia il testo nel codice, questo confronto lo segue da solo: non c'e` una
    // seconda copia da riallineare, perche` il default NON viene dal bucket.
    expect(letto).toBe(AGENT_FILES[PATH].body());
    expect(letto).toContain('TRANSITIONS COOKBOOK');
  });

  it('un override vuoto NON svuota la guida: vince il codice', async () => {
    // Il salvataggio a vuoto e` l'errore piu` facile da fare in una dashboard, e senza questa
    // regola cancellerebbe il ricettario per ogni brand, in silenzio.
    download.mockResolvedValue({ data: { text: async () => '   \n ' }, error: null });
    expect(await readAgentFile(PATH)).toBe(AGENT_FILES[PATH].body());
  });

  it('uno storage che non risponde non puo` svuotare una lettura', async () => {
    // Lo storage risponde ma i byte non arrivano: e` il guasto vero (`.text()` che fallisce a
    // meta` lettura), e non un mock che rifiuta — quello vitest lo conta come unhandled rejection
    // del test invece che come guasto del codice sotto esame.
    download.mockResolvedValue({ data: { text: async () => { throw new Error('stream interrotto'); } }, error: null });
    expect(await readAgentFile(PATH)).toBe(AGENT_FILES[PATH].body());
  });

  it('ogni file del registro ha un corpo non vuoto: nessun path che si materializza a bianco', () => {
    const vuoti = Object.entries(AGENT_FILES).filter(([, f]) => !f.body()?.trim());
    expect(vuoti.map(([p]) => p)).toEqual([]);
  });
});

/**
 * IL BUCKET È GLOBALE, I DATI DEL BRAND NO — e l'override VINCE sul codice.
 *
 * Finché il registro contiene solo materia di prodotto la cosa è innocua. Il giorno in cui la
 * migrazione fa nascere `brand/products.md`, un solo `overrides/brand/products.md` servirebbe gli
 * stessi prodotti a tutti e sessanta i brand, in silenzio e con l'aria di funzionare. Questi due
 * test sono la ragione per cui quel giorno non arriva di nascosto: il primo pinna la regola, il
 * secondo la esercita su un path di brand vero, aggiunto e tolto qui.
 */
describe('si sovrascrive solo il MESTIERE', () => {
  it('un path di dati del brand non è sovrascrivibile, uno di mestiere sì', () => {
    expect(isOverridable('brand/products.md')).toBe(false);
    expect(isOverridable('work/posts/abc.md')).toBe(false);
    expect(isOverridable('runs/x.md')).toBe(false);
    expect(isOverridable('how/MAKE-MOTION-VIDEO.md')).toBe(true);
    expect(isOverridable('skills/remotion/README.md')).toBe(true);
    // E il registro di oggi sta tutto dentro la regola: se domani ci entra un path di brand,
    // questo si accende prima che qualcuno se ne accorga in produzione.
    const fuori = Object.keys(AGENT_FILES).filter((p) => !isOverridable(p));
    expect(fuori).toEqual([]);
  });

  it('su un path di brand il bucket non viene nemmeno interrogato', async () => {
    download.mockResolvedValue({ data: { text: async () => 'PRODOTTI DI UN ALTRO BRAND' }, error: null });
    AGENT_FILES['brand/products.md'] = {
      agents: null,
      unlocks: [],
      summary: 'finto, solo per questo test',
      body: () => 'i prodotti veri'
    };
    try {
      expect(await readAgentFile('brand/products.md')).toBe('i prodotti veri');
      expect(download).not.toHaveBeenCalled();
    } finally {
      delete AGENT_FILES['brand/products.md'];
    }
  });

  it('una chiave della catena dei prototipi non è un file', async () => {
    // `AGENT_FILES['constructor']` risponde `Object.prototype.constructor`: passava `if (!f)` e
    // moriva su `f.body()` con un TypeError non catturato.
    for (const p of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(await readAgentFile(p), p).toBeNull();
    }
  });
});
