import { describe, it, expect } from 'vitest';
import {
  BASE_SHORTCUTS,
  GO_TARGETS,
  SECTION_LETTERS,
  buildShortcuts,
  goTargetLabelKey,
  isTypingTarget,
  matchShortcut,
  resolveSequence,
  seqLetter,
  type SeqTarget
} from './shortcuts';
import { NAV_TEAM_SPACES, NAV_TEAM_TOOLS } from './workbench-paths';

/** Un evento tastiera finto: bastano i campi che il registro guarda. */
function ev(key: string, opts: Omit<Partial<KeyboardEvent>, 'target'> & { target?: unknown } = {}) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: 'DIV', isContentEditable: false },
    ...opts
  } as unknown as KeyboardEvent;
}
const TEXTAREA = { tagName: 'TEXTAREA', isContentEditable: false };
const TEXT_INPUT = { tagName: 'INPUT', type: 'text', isContentEditable: false };
const EDITABLE = { tagName: 'DIV', isContentEditable: true };

describe('isTypingTarget', () => {
  it('riconosce i campi in cui si scrive', () => {
    expect(isTypingTarget(TEXTAREA as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(TEXT_INPUT as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(EDITABLE as unknown as EventTarget)).toBe(true);
    expect(
      isTypingTarget({ tagName: 'INPUT', type: 'search' } as unknown as EventTarget)
    ).toBe(true);
  });

  it('non scambia per campo di testo ciò che non lo è', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('mentre si scrive, nessun tasto nudo è una scorciatoia', () => {
  // L'errore classico: `n` dentro una caption apre una chat nuova e il testo si perde.
  for (const target of [TEXTAREA, TEXT_INPUT, EDITABLE]) {
    for (const key of ['n', '/', '?', 'g', 'c', 'a', 'r']) {
      it(`${String(target.tagName)} + "${key}" non fa niente`, () => {
        expect(matchShortcut(ev(key, { target })).type).toBe('none');
      });
    }
  }

  it('nemmeno la SECONDA lettera di una sequenza già armata', () => {
    expect(matchShortcut(ev('c', { target: TEXTAREA }), true).type).toBe('none');
  });

  it('ma ⌘K e ⌘, restano vive: cercare mentre si scrive è il gesto da servire', () => {
    expect(matchShortcut(ev('k', { metaKey: true, target: TEXTAREA }))).toEqual({
      type: 'run',
      id: 'palette'
    });
    expect(matchShortcut(ev(',', { ctrlKey: true, target: TEXTAREA }))).toEqual({
      type: 'run',
      id: 'settings'
    });
  });
});

describe('matchShortcut', () => {
  it('⌘K / Ctrl+K aprono la palette', () => {
    expect(matchShortcut(ev('k', { metaKey: true }))).toEqual({ type: 'run', id: 'palette' });
    expect(matchShortcut(ev('K', { ctrlKey: true }))).toEqual({ type: 'run', id: 'palette' });
  });

  it('i tasti singoli fuori dai campi di testo', () => {
    expect(matchShortcut(ev('n'))).toEqual({ type: 'run', id: 'newChat' });
    expect(matchShortcut(ev('/'))).toEqual({ type: 'run', id: 'focusPrompt' });
    expect(matchShortcut(ev('?', { shiftKey: true }))).toEqual({ type: 'run', id: 'help' });
  });

  it('`g` arma la sequenza, la lettera dopo è la destinazione', () => {
    expect(matchShortcut(ev('g'))).toEqual({ type: 'pending' });
    expect(matchShortcut(ev('c'), true)).toEqual({ type: 'run', id: 'seq:c' });
    expect(seqLetter('seq:c')).toBe('c');
  });

  it('dopo `g` un tasto che non è una lettera non è una destinazione', () => {
    expect(matchShortcut(ev('Tab'), true).type).toBe('none');
  });

  it('una lettera senza destinazione non apre niente', () => {
    const targets: SeqTarget[] = [{ key: 'c', href: '/app/x/calendar', label: 'Calendar' }];
    expect(resolveSequence('c', targets)?.href).toBe('/app/x/calendar');
    expect(resolveSequence('q', targets)).toBe(null);
  });

  it('lascia al browser e al sistema tutto ciò che è loro', () => {
    // ⌘L (barra indirizzi), ⌥C (carattere vero su macOS), ⌘⌥K: mai nostri.
    expect(matchShortcut(ev('l', { metaKey: true })).type).toBe('none');
    expect(matchShortcut(ev('c', { altKey: true })).type).toBe('none');
    expect(matchShortcut(ev('k', { metaKey: true, altKey: true })).type).toBe('none');
  });
});

describe('le destinazioni vengono dalla nav vera, non da una lista a mano', () => {
  it('ogni `g <lettera>` punta a una voce che esiste nella nav', () => {
    const navPaths = new Set([...NAV_TEAM_SPACES, ...NAV_TEAM_TOOLS].map((i) => i.path));
    for (const t of GO_TARGETS) {
      expect(navPaths.has(t.path), `${t.key} → ${t.path} non è nella nav`).toBe(true);
      expect(goTargetLabelKey(t.path)).toBeTruthy();
    }
  });

  it('nessuna lettera doppia', () => {
    const keys = GO_TARGETS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('le lettere delle SEZIONI non collidono con quelle delle pagine-strumento', () => {
    const tools = new Set(GO_TARGETS.map((t) => t.key));
    for (const [section, key] of Object.entries(SECTION_LETTERS)) {
      expect(tools.has(key), `g ${key} è già di una pagina-strumento (${section})`).toBe(false);
    }
    const sectionKeys = Object.values(SECTION_LETTERS);
    expect(new Set(sectionKeys).size, 'due sezioni sulla stessa lettera').toBe(sectionKeys.length);
  });
});

describe('la scheda di aiuto è generata dal registro', () => {
  // Le sezioni che la nav espone davvero — qui simulate, nel prodotto arrivano dai gruppi vivi.
  const targets: SeqTarget[] = [
    { key: SECTION_LETTERS.home, href: '/app/x', label: 'Hire an agent' },
    { key: SECTION_LETTERS.web, href: '/app/x/web', label: 'Web' },
    ...GO_TARGETS.map((t) => ({ key: t.key, href: `/app/x${t.path}`, label: t.path }))
  ];

  it('nessuna combinazione di tasti duplicata', () => {
    const combos = buildShortcuts(targets).map((s) => s.keys.join('+'));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('ogni scorciatoia ha un id, dei tasti e un\'etichetta (chiave o già tradotta)', () => {
    for (const s of buildShortcuts(targets)) {
      expect(s.id).toBeTruthy();
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.label || s.labelKey).toBeTruthy();
    }
  });

  it('elenca le fisse e OGNI destinazione `g` che la nav espone', () => {
    const ids = buildShortcuts(targets).map((s) => s.id);
    expect(ids).toContain('palette');
    expect(ids).toContain('settings');
    for (const t of targets) expect(ids).toContain(`seq:${t.key}`);
  });

  it('una sezione che sparisce dalla nav si porta via la sua scorciatoia', () => {
    // È il caso Designer, in rimozione mentre si scrive: nessuno deve toccare il registro.
    const withoutWeb = targets.filter((t) => t.key !== SECTION_LETTERS.web);
    const ids = buildShortcuts(withoutWeb).map((s) => s.id);
    expect(ids).not.toContain(`seq:${SECTION_LETTERS.web}`);
    expect(BASE_SHORTCUTS.length).toBeGreaterThan(0);
  });
});

describe('con la palette aperta i tasti sono suoi', () => {
  // Regressione vera, vista nel browser: il fuoco non era ancora nel campo e la `n` di
  // "calendar" ha aperto una chat dietro l'overlay, navigando via dalla ricerca.
  // La guardia sta nel componente (`if (open && m.id !== 'palette') return`); qui si fissa il
  // contratto su cui poggia: fuori da un campo di testo quei tasti SONO comandi, quindi
  // qualcuno deve fermarli, e il solo `isTypingTarget` non può farlo.
  it('fuori da un campo di testo `n` è un comando — per questo serve la guardia', () => {
    expect(matchShortcut(ev('n'))).toEqual({ type: 'run', id: 'newChat' });
  });

  it('⌘K resta l’unico che la palette lascia passare (per chiudersi)', () => {
    expect(matchShortcut(ev('k', { metaKey: true })).type).toBe('run');
    expect(matchShortcut(ev('k', { metaKey: true })).type === 'run').toBe(true);
  });
});
