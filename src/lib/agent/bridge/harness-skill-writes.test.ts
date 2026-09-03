import { describe, expect, it } from 'vitest';
import { writeSkills } from '@ai-sdk/harness/utils';

/**
 * IL COSTO PAGATO, 2026-09-03. Il primo token di una chat kit arrivava dopo ~10 secondi, e 6.9 di
 * quelli erano `writeSkills`: 14 file scritti nella sandbox UNO ALLA VOLTA, ~450ms l'uno, perche'
 * ogni `writeTextFile` e` un round-trip — due, in realta`: `mkdir -p` del padre, poi il file.
 *
 * Adesso partono tutti in un comando solo. La correzione vive in
 * `patches/@ai-sdk+harness+1.0.87.patch`, quindi questo test guida la `writeSkills` INSTALLATA: se
 * un bump di versione si porta via la patch, cade qui invece di tornare in silenzio a dieci
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

describe('le skill vanno nella sandbox in un colpo solo', () => {
  it('un comando solo, non un round-trip per file', async () => {
    const commands: string[] = [];
    const perFile: string[] = [];

    await writeSkills({
      sandbox: {
        run: async ({ command }: { command: string }) => {
          commands.push(command);
          return { exitCode: 0 };
        },
        writeTextFile: async ({ path }: { path: string }) => {
          perFile.push(path);
        }
      } as never,
      rootDir: ROOT,
      skills: SKILLS as never
    });

    // Uno per la radice (lo faceva gia`) e uno per tutto il resto.
    expect(commands).toHaveLength(2);
    expect(perFile).toEqual([]);
    for (const p of ['humanizer/SKILL.md', 'social/SKILL.md', 'social/references/platforms.md']) {
      expect(commands[1]).toContain(`${ROOT}/${p}`);
    }
  });

  /** Un batch che scrive i byte sbagliati e` peggio di uno lento: il contenuto va verificato. */
  it('i contenuti arrivano intatti, apici e virgolette compresi', async () => {
    const commands: string[] = [];
    await writeSkills({
      sandbox: {
        run: async ({ command }: { command: string }) => {
          commands.push(command);
          return { exitCode: 0 };
        },
        writeTextFile: async () => {}
      } as never,
      rootDir: ROOT,
      skills: SKILLS as never
    });

    const decoded = [...commands[1].matchAll(/printf %s '([A-Za-z0-9+/=]+)'/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8')
    );
    expect(decoded.some((c) => c.includes('contenuto uno'))).toBe(true);
    expect(decoded).toContain("con 'apici' e \"virgolette\"");
    expect(decoded).toContain('terzo');
  });

  /**
   * IL SECONDO COSTO PAGATO, mezz'ora dopo il primo. Un comando solo per tutti i file sembrava la
   * mossa giusta e in laboratorio lo era — 388ms invece di 6900. In pratica bash rifiutava
   * l'argomento oltre MAX_ARG_STRLEN (128KB): «argument list too long», si cadeva nel fallback, e
   * il batch non girava MAI. Sembrava che l'ottimizzazione non pagasse; non era mai partita.
   */
  it('spezza il comando invece di sforare il limite di bash', async () => {
    const commands: string[] = [];
    const perFile: string[] = [];
    const grosso = 'x'.repeat(70 * 1024);

    await writeSkills({
      sandbox: {
        run: async ({ command }: { command: string }) => {
          commands.push(command);
          return { exitCode: 0 };
        },
        writeTextFile: async ({ path }: { path: string }) => {
          perFile.push(path);
        }
      } as never,
      rootDir: ROOT,
      skills: [
        { name: 'a', description: 'd', content: grosso },
        { name: 'b', description: 'd', content: grosso },
        { name: 'c', description: 'd', content: grosso }
      ] as never
    });

    // Nessun comando oltre la soglia, e nessun file perso per strada.
    expect(commands.length).toBeGreaterThan(2);
    for (const c of commands) {
      expect(c.length).toBeLessThan(128 * 1024);
    }
    expect(perFile).toEqual([]);
    const scritti = commands.join('\n');
    for (const n of ['a', 'b', 'c']) {
      expect(scritti).toContain(`${ROOT}/${n}/SKILL.md`);
    }
  });

  /**
   * `writeSkills` e` codice generico: una sandbox senza `base64` deve continuare a funzionare,
   * piu` lenta ma giusta. Senza questo ramo un'immagine diversa perderebbe le skill in silenzio.
   */
  it('se il comando fallisce, i file vanno scritti lo stesso uno per uno', async () => {
    const perFile: string[] = [];
    await writeSkills({
      sandbox: {
        run: async ({ command }: { command: string }) => {
          if (command.includes('base64')) throw new Error('base64: not found');
          return { exitCode: 0 };
        },
        writeTextFile: async ({ path }: { path: string }) => {
          perFile.push(path);
        }
      } as never,
      rootDir: ROOT,
      skills: SKILLS as never
    });

    expect(perFile).toHaveLength(4);
    expect(perFile).toContain(`${ROOT}/social/references/platforms.md`);
  });
});
