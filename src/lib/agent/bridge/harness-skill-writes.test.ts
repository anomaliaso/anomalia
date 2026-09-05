import { describe, expect, it } from 'vitest';
import { writeSkills } from '@ai-sdk/harness/utils';

/**
 * IL COSTO PAGATO, 2026-09-03. Il primo token di una chat kit arrivava dopo ~10 secondi, e 6.9 di
 * quelli erano `writeSkills`: 14 file scritti nella sandbox UNO ALLA VOLTA, ~450ms l'uno, perche'
 * ogni `writeTextFile` e` un round-trip — due, in realta`: `mkdir -p` del padre, poi il file.
 *
 * Adesso partono insieme, e se ci sono gia` non partono affatto. La correzione vive in
 * `patches/@ai-sdk+harness+1.0.87.patch`, quindi questi test guidano la `writeSkills` INSTALLATA:
 * un bump di versione che si porta via la patch cade qui, invece di tornare in silenzio a sette
 * secondi di attesa. (LESSONS: patch-package e i deploy.)
 */
const SKILLS = [
  { name: 'humanizer', description: 'd', content: 'contenuto uno' },
  {
    name: 'social',
    description: 'd',
    content: 'contenuto due',
    files: [
      { path: 'references/platforms.md', content: "con 'apici' e \"virgolette\"" },
      { path: 'references/post-templates.md', content: 'terzo' }
    ]
  }
];

const ROOT = '/home/agent/.agents/skills';

/** Una sandbox finta che ricorda i comandi e finge un filesystem per il marcatore. */
function fakeSandbox(opts: { marker?: string; failBatch?: boolean; failPerFile?: boolean } = {}) {
  const commands: string[] = [];
  const perFile: string[] = [];
  let marker = opts.marker ?? '';
  return {
    commands,
    perFile,
    marker: () => marker,
    sandbox: {
      run: async ({ command }: { command: string }) => {
        commands.push(command);
        if (command.startsWith('cat ')) return { exitCode: 0, stdout: marker };
        if (command.includes('.harness-skills-id') && command.startsWith('printf')) {
          marker = command.split("'")[1];
          return { exitCode: 0, stdout: '' };
        }
        if (opts.failBatch && command.includes('base64 -d')) throw new Error('base64: not found');
        return { exitCode: 0, stdout: '' };
      },
      writeTextFile: async ({ path }: { path: string }) => {
        if (opts.failPerFile) throw new Error('sandbox morta');
        perFile.push(path);
      }
    } as never
  };
}

const batchCommands = (commands: string[]) => commands.filter((c) => c.includes('base64 -d'));

describe('le skill vanno nella sandbox in un colpo solo', () => {
  it('un comando solo per tutti i file, non un round-trip per file', async () => {
    const s = fakeSandbox();
    await writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: SKILLS as never });

    expect(batchCommands(s.commands)).toHaveLength(1);
    expect(s.perFile).toEqual([]);
    for (const p of ['humanizer/SKILL.md', 'social/SKILL.md', 'social/references/platforms.md']) {
      expect(batchCommands(s.commands)[0]).toContain(`${ROOT}/${p}`);
    }
  });

  /** Un batch che scrive i byte sbagliati e` peggio di uno lento: il contenuto va verificato. */
  it('i contenuti arrivano intatti, apici e virgolette compresi', async () => {
    const s = fakeSandbox();
    await writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: SKILLS as never });

    const decoded = [...batchCommands(s.commands)[0].matchAll(/printf %s '([A-Za-z0-9+/=]+)'/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8')
    );
    expect(decoded.some((c) => c.includes('contenuto uno'))).toBe(true);
    expect(decoded).toContain("con 'apici' e \"virgolette\"");
    expect(decoded).toContain('terzo');
  });

  /**
   * La sandbox del brand vive fra i turni e le skill non cambiano: riscriverle ogni volta e`
   * lavoro gia` fatto, ~1 secondo prima che la chat possa rispondere.
   */
  it('la seconda volta non scrive niente', async () => {
    const s = fakeSandbox();
    await writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: SKILLS as never });
    const dopoLaPrima = s.commands.length;

    await writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: SKILLS as never });

    // Nessuna scrittura nuova: solo il `mkdir -p` della radice e la lettura del marcatore.
    expect(batchCommands(s.commands)).toHaveLength(1);
    expect(s.commands.slice(dopoLaPrima).every((c) => c.startsWith('mkdir') || c.startsWith('cat'))).toBe(true);
    expect(s.perFile).toEqual([]);
  });

  it('ma se il contenuto cambia le riscrive', async () => {
    const s = fakeSandbox();
    await writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: SKILLS as never });

    const cambiate = [{ ...SKILLS[0], content: 'contenuto DIVERSO' }, SKILLS[1]];
    await writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: cambiate as never });

    expect(batchCommands(s.commands)).toHaveLength(2);
  });

  /**
   * Il marcatore mentirebbe se restasse scritto senza i file: il turno dopo salterebbe la
   * scrittura e l'agente si troverebbe una cartella vuota. Va scritto per ULTIMO, e mai se
   * nemmeno il fallback ce l'ha fatta.
   */
  it('non lascia il marcatore quando i file non sono arrivati', async () => {
    const s = fakeSandbox({ failBatch: true, failPerFile: true });

    await expect(
      writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: SKILLS as never })
    ).rejects.toThrow();

    expect(s.marker()).toBe('');
  });

  /**
   * IL SECONDO COSTO PAGATO. Un comando solo per tutti i file sembrava la mossa giusta, e in
   * laboratorio lo era. In pratica bash rifiutava l'argomento oltre MAX_ARG_STRLEN (128KB):
   * «argument list too long», si cadeva nel fallback, e il batch non girava MAI. Sembrava che
   * l'ottimizzazione non pagasse; non era mai partita.
   */
  it('spezza il comando invece di sforare il limite di bash', async () => {
    const s = fakeSandbox();
    const grosso = 'x'.repeat(70 * 1024);
    await writeSkills({
      sandbox: s.sandbox,
      rootDir: ROOT,
      skills: [
        { name: 'a', description: 'd', content: grosso },
        { name: 'b', description: 'd', content: grosso },
        { name: 'c', description: 'd', content: grosso }
      ] as never
    });

    expect(batchCommands(s.commands).length).toBeGreaterThan(1);
    for (const c of s.commands) {
      expect(c.length).toBeLessThan(128 * 1024);
    }
    expect(s.perFile).toEqual([]);
    const scritti = s.commands.join('\n');
    for (const n of ['a', 'b', 'c']) {
      expect(scritti).toContain(`${ROOT}/${n}/SKILL.md`);
    }
  });

  /**
   * `writeSkills` e` codice generico: una sandbox senza `base64` deve continuare a funzionare,
   * piu` lenta ma giusta. Senza questo ramo un'immagine diversa perderebbe le skill in silenzio.
   */
  it('se il comando fallisce, i file vanno scritti lo stesso uno per uno', async () => {
    const s = fakeSandbox({ failBatch: true });
    await writeSkills({ sandbox: s.sandbox, rootDir: ROOT, skills: SKILLS as never });

    expect(s.perFile).toHaveLength(4);
    expect(s.perFile).toContain(`${ROOT}/social/references/platforms.md`);
  });
});
