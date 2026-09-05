// Il registro delle scorciatoie: UN modulo, non gestori sparsi nei componenti. Qui la DEFINIZIONE
// (quale tasto, quale etichetta) e il RICONOSCIMENTO (dato un evento, quale comando); l'esecuzione
// resta di chi ha il contesto. Così la scheda di aiuto è generata da questa lista e non può
// divergere da ciò che i tasti fanno davvero.
//
// Sequenze in stile Gmail/Linear (`g` poi una lettera) e non modificatori: ⌘L/⌘D/⌘T/⌘N/⌘W/⌘R sono
// del browser, ⌥+lettera scrive caratteri veri su macOS, Ctrl+lettera è il set Emacs nei campi di
// testo. Fuori da un campo di testo una lettera nuda non ha significato di sistema. Il prezzo è lo
// stato: c'è un `pending` da azzerare, e sta tutto qui dentro.
// Le uniche con modificatore sono le due che un utente si aspetta: ⌘K e ⌘,.

import { writable } from 'svelte/store';
import { NAV_OFF_SIDEBAR, NAV_TEAM_SPACES } from '$lib/workbench-paths';

/** Quanto resta armato il prefisso `g` prima di annullarsi da solo. */
export const SEQUENCE_TIMEOUT_MS = 1200;

/**
 * Le destinazioni di `g` + lettera. I `path` NON sono scritti a mano: vengono dalla nav
 * (NAV_TEAM_SPACES / NAV_OFF_SIDEBAR), da cui `goTargetLabelKey` prende anche l'etichetta — il test
 * fallisce se una sparisce dalla nav. La lettera è l'iniziale inglese, tranne dove collideva:
 * `d` per Leads (l è già Library).
 */
export const GO_TARGETS: readonly { key: string; path: string }[] = [
  { key: 'c', path: '/calendar' },
  { key: 'l', path: '/media' },
  { key: 's', path: '/site' },
  { key: 'a', path: '/analytics' },
  { key: 'r', path: '/radar' },
  { key: 'd', path: '/leads' },
  { key: 'k', path: '/knowledge' },
  { key: 't', path: '/agents' }
];

/** L'etichetta di una destinazione `g`, presa dalla nav vera. null = non è più nella nav. */
export function goTargetLabelKey(path: string): string | null {
  const hit = [...NAV_TEAM_SPACES, ...NAV_OFF_SIDEBAR].find((i) => i.path === path);
  return hit?.labelKey ?? null;
}

export type ShortcutDef = {
  id: string;
  /** I tasti come vanno mostrati, in ordine. 'mod' = ⌘ su mac, Ctrl altrove. */
  keys: string[];
  /** Chiave i18n dell'etichetta. Per le destinazioni `g` è quella della voce di nav. */
  labelKey: string;
};

/**
 * TUTTE le scorciatoie, nell'ordine in cui la scheda di aiuto le mostra. `close` è qui solo per
 * essere documentata: Esc lo gestisce ogni overlay per sé e non passa da `matchShortcut` — un
 * `preventDefault` centrale lo ruberebbe a menu, dropdown e campi.
 */
export const BASE_SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'palette', keys: ['mod', 'K'], labelKey: 'app.shell.scPalette' },
  { id: 'settings', keys: ['mod', ','], labelKey: 'app.nav.settings' },
  { id: 'help', keys: ['?'], labelKey: 'app.shell.scHelp' },
  { id: 'close', keys: ['Esc'], labelKey: 'app.shell.scClose' }
];

/**
 * L'elenco COMPLETO che la scheda `?` mostra: le fisse più le destinazioni `g` risolte. Funzione e
 * non costante perché metà dipende dalla nav viva, ed è la STESSA lista che alimenta i tasti.
 * `label` è già tradotta (viene dalla nav), `labelKey` resta per le fisse.
 */
export function buildShortcuts(
  targets: readonly SeqTarget[]
): readonly (ShortcutDef & { label?: string })[] {
  return [
    ...BASE_SHORTCUTS,
    ...targets.map((t) => ({ id: `seq:${t.key}`, keys: ['g', t.key], labelKey: '', label: t.label }))
  ];
}

/**
 * L'utente sta scrivendo? Allora nessun tasto nudo è una scorciatoia: `n` dentro una caption
 * aprirebbe una chat nuova e il testo si perde. Contenteditable inclusi (l'editor degli articoli);
 * i campi che non accettano testo (checkbox, bottoni-input) esclusi apposta.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  const tag = String(el.tagName).toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = String((el as HTMLInputElement).type ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
      type
    );
  }
  return el.isContentEditable === true;
}

/** Quello che l'evento significa: esegui un comando, arma il prefisso, o niente. */
export type ShortcutMatch =
  | { type: 'run'; id: string }
  | { type: 'pending' }
  | { type: 'none' };

const NONE: ShortcutMatch = { type: 'none' };

/**
 * Da un evento al comando. `pending` è true se il tasto precedente era `g` e non è scaduto: sta al
 * chiamante tenerlo, perché è l'unico stato di tutta la faccenda.
 * Le due con modificatore restano vive anche mentre si scrive; tutto il resto si spegne dentro un
 * campo di testo.
 */
export function matchShortcut(e: KeyboardEvent, pending = false): ShortcutMatch {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  if (mod && !e.altKey) {
    if (key.toLowerCase() === 'k') return { type: 'run', id: 'palette' };
    if (key === ',') return { type: 'run', id: 'settings' };
  }
  // Qualunque altra combinazione con modificatori appartiene al browser o al sistema.
  if (mod || e.altKey) return NONE;
  if (isTypingTarget(e.target)) return NONE;
  // `?` vuole Shift: si esclude Alt/Meta/Ctrl, non Shift.
  if (pending) {
    // Qualunque lettera: CHI sia quella destinazione lo sa solo chi ha la nav viva (le sezioni
    // cambiano col piano e con le feature accese). Qui si dice solo "è la seconda lettera di una
    // sequenza"; una lettera che non porta da nessuna parte non apre niente.
    return /^[a-z0-9]$/i.test(key) ? { type: 'run', id: `seq:${key.toLowerCase()}` } : NONE;
  }
  if (key.toLowerCase() === 'g') return { type: 'pending' };
  if (key === '?') return { type: 'run', id: 'help' };
  return NONE;
}

/** La lettera di una sequenza `g`, dal suo id. null se l'id non è una sequenza. */
export function seqLetter(id: string): string | null {
  return id.startsWith('seq:') ? id.slice(4) : null;
}

/**
 * LE SEZIONI DELLA SIDEBAR e la home. Qui c'è SOLO l'assegnazione delle lettere: una mappatura
 * tastiera→sezione la scrive una persona, non si deduce. Le DESTINAZIONI arrivano dai gruppi di nav
 * vivi, l'unico posto che sa quali sezioni esistono per questo brand — una sezione che sparisce
 * dalla nav si porta via la sua scorciatoia e la scheda `?` smette di elencarla.
 *
 * Le lettere non collidono con quelle delle pagine-strumento sopra (c'è il test):
 *   h home · b Brand · m social Media · w Web · p Paid (Ads) · z automations (l'icona è Zap)
 */
export const SECTION_LETTERS: Record<string, string> = {
  home: 'h',
  brand: 'b',
  publish: 'm',
  web: 'w',
  ads: 'p',
  automations: 'z'
};

/** Una destinazione di `g`, già risolta: lettera, dove va, come si chiama. */
export type SeqTarget = { key: string; href: string; label: string };

/** La destinazione di `g <lettera>`, o null. Prima vince chi è in lista: nessun doppione. */
export function resolveSequence(letter: string, targets: readonly SeqTarget[]): SeqTarget | null {
  return targets.find((t) => t.key === letter) ?? null;
}

/** La palette è aperta? Store e non prop: la leggono rami diversi dell'albero. */
export const paletteOpen = writable(false);
