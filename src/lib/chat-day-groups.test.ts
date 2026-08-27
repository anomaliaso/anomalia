import { describe, expect, it } from 'vitest';
import { dayDividerLabel, dayDividers, firstUnreadIndex, type TranscriptMsg } from './chat-day-groups';

/** Cataloghi finti: le sole due chiavi che il modulo chiede. Il resto lo scrive Intl. */
const IT: Record<string, string> = { 'chat.groupToday': 'Oggi', 'chat.groupYesterday': 'Ieri' };
const EN: Record<string, string> = { 'chat.groupToday': 'Today', 'chat.groupYesterday': 'Yesterday' };
const t = (dict: Record<string, string>) => (k: string) => dict[k] ?? k;

/** Un istante costruito in ora LOCALE, così il test dice la stessa cosa in ogni fuso del runner. */
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

const NOW = new Date(2026, 7, 21, 15, 30); // 21 agosto 2026, ora locale

describe('dayDividerLabel', () => {
  it('oggi e ieri usano il catalogo, con l’ora accodata', () => {
    expect(dayDividerLabel(at(2026, 8, 21, 12, 56), { locale: 'it', now: NOW, t: t(IT) })).toBe(
      `Oggi ${new Date(2026, 7, 21, 12, 56).toLocaleTimeString('it', { hour: 'numeric', minute: '2-digit' })}`
    );
    expect(dayDividerLabel(at(2026, 8, 20, 9, 14), { locale: 'it', now: NOW, t: t(IT) })).toMatch(/^Ieri /);
  });

  it('entro la settimana è il nome del giorno, oltre è la data breve', () => {
    // 17 agosto 2026 è un lunedì: dentro i 6 giorni → nome del giorno.
    const weekday = dayDividerLabel(at(2026, 8, 17), { locale: 'en', now: NOW, t: t(EN) });
    expect(weekday).toMatch(/^Monday /);
    // 1 agosto: oltre la settimana → data breve, senza anno (stesso anno).
    const old = dayDividerLabel(at(2026, 8, 1), { locale: 'en', now: NOW, t: t(EN) });
    expect(old).toMatch(/Aug/);
    expect(old).not.toMatch(/2026/);
    // Anno diverso: l'anno compare, o due "1 ago" distanti dodici mesi sarebbero la stessa riga.
    expect(dayDividerLabel(at(2025, 8, 1), { locale: 'en', now: NOW, t: t(EN) })).toMatch(/2025/);
  });

  it('cambia lingua con il locale, senza chiavi in più nel catalogo', () => {
    expect(dayDividerLabel(at(2026, 8, 17), { locale: 'it', now: NOW, t: t(IT) })).toMatch(/^lunedì /);
    expect(dayDividerLabel(at(2026, 8, 17), { locale: 'fr', now: NOW, t: t(EN) })).toMatch(/^lundi /);
  });

  it('una data illeggibile non produce etichetta (e quindi nessun divisore)', () => {
    expect(dayDividerLabel(null, { now: NOW, t: t(EN) })).toBe('');
    expect(dayDividerLabel('non-una-data', { now: NOW, t: t(EN) })).toBe('');
  });
});

describe('dayDividers', () => {
  const opts = { locale: 'it', now: NOW, t: t(IT) };

  it('uno in cima e uno a ogni cambio di giorno, non fra messaggi dello stesso giorno', () => {
    const msgs: TranscriptMsg[] = [
      { role: 'user', content: 'a', created_at: at(2026, 8, 19, 10) },
      { role: 'assistant', content: 'b', created_at: at(2026, 8, 19, 10, 5) },
      { role: 'user', content: 'c', created_at: at(2026, 8, 20, 9) },
      { role: 'assistant', content: 'd', created_at: at(2026, 8, 21, 12, 56) }
    ];
    const out = dayDividers(msgs, opts);
    expect(Object.keys(out)).toEqual(['0', '2', '3']);
    expect(out[2]).toMatch(/^Ieri /);
    expect(out[3]).toMatch(/^Oggi /);
  });

  it('lo stesso istante scritto con offset diversi resta lo stesso giorno', () => {
    // Il bug di `isUnread`: postgrest scrive `+00:00`, toISOString scrive `Z`. Confrontati come
    // testo sono due cose diverse; qui devono dare un divisore solo.
    const z = at(2026, 8, 21, 12, 0);
    const msgs: TranscriptMsg[] = [
      { role: 'user', content: 'a', created_at: z },
      { role: 'assistant', content: 'b', created_at: z.replace('Z', '+00:00') }
    ];
    expect(Object.keys(dayDividers(msgs, opts))).toEqual(['0']);
  });

  it('la bolla ottimistica (senza created_at) non apre né chiude un giorno', () => {
    const msgs: TranscriptMsg[] = [
      { role: 'user', content: 'a', created_at: at(2026, 8, 21, 10) },
      { role: 'user', content: 'appena scritto' },
      { role: 'assistant', content: 'b', created_at: at(2026, 8, 21, 11) }
    ];
    expect(Object.keys(dayDividers(msgs, opts))).toEqual(['0']);
  });

  it('transcript vuoto: nessun divisore', () => {
    expect(dayDividers([], opts)).toEqual({});
  });
});

/**
 * Il criterio della sidebar, ricopiato dal filtro di `loadUnreadCounts` (unread.ts): risposte
 * dell'agente con del testo, scritte dopo il segnalibro. Serve a verificare che il divisore e il
 * badge non possano contare cose diverse.
 */
const sidebarCount = (msgs: TranscriptMsg[], since: string) =>
  msgs.filter(
    (m) => m.role === 'assistant' && m.content !== '' && Date.parse(m.created_at ?? '') > Date.parse(since)
  ).length;

describe('firstUnreadIndex', () => {
  const since = at(2026, 8, 21, 10, 0);
  const msgs: TranscriptMsg[] = [
    { role: 'assistant', content: 'vecchia', created_at: at(2026, 8, 21, 9, 0) },
    { role: 'user', content: 'scritto dopo', created_at: at(2026, 8, 21, 10, 30) },
    { role: 'assistant', content: '', created_at: at(2026, 8, 21, 10, 40) },
    { role: 'assistant', content: 'nuova', created_at: at(2026, 8, 21, 11, 0) },
    { role: 'assistant', content: 'nuovissima', created_at: at(2026, 8, 21, 11, 5) }
  ];

  it('punta alla prima risposta dell’agente dopo il segnalibro', () => {
    // Non l'1 (è dell'utente: l'ha scritto lui) né il 2 (turno chiuso su un tool, niente da vedere).
    expect(firstUnreadIndex(msgs, since)).toBe(3);
  });

  it('stesso criterio del badge in sidebar: o entrambi vedono qualcosa, o nessuno dei due', () => {
    expect(sidebarCount(msgs, since)).toBe(2);
    expect(firstUnreadIndex(msgs, since)).toBeGreaterThanOrEqual(0);
    // Segnalibro dopo l'ultima risposta: la sidebar conta 0, e allora niente divisore.
    const dopo = at(2026, 8, 21, 12, 0);
    expect(sidebarCount(msgs, dopo)).toBe(0);
    expect(firstUnreadIndex(msgs, dopo)).toBe(-1);
    // Solo un messaggio dell'utente dopo il segnalibro: badge spento, divisore assente.
    const soloUtente = at(2026, 8, 21, 10, 20);
    expect(sidebarCount(msgs.slice(0, 2), soloUtente)).toBe(0);
    expect(firstUnreadIndex(msgs.slice(0, 2), soloUtente)).toBe(-1);
  });

  it('senza segnalibro (0207 non applicata) non c’è confine e non c’è divisore', () => {
    expect(firstUnreadIndex(msgs, null)).toBe(-1);
    expect(firstUnreadIndex(msgs, undefined)).toBe(-1);
    expect(firstUnreadIndex(msgs, 'non-una-data')).toBe(-1);
  });

  it('offset diversi non spostano il confine', () => {
    expect(firstUnreadIndex(msgs, since.replace('Z', '+00:00'))).toBe(3);
  });

  /**
   * Il divisore dice «questo te lo sei perso», non «questo è arrivato». Una risposta comparsa
   * mentre il thread era aperto davanti all'utente l'ha già vista; e chi ricarica la pagina un
   * minuto dopo non se l'è persa, sta solo tornando dove era. L'apertura congela il suo `now`,
   * quindi ciò che arriva DOPO non può mai diventare il confine, per quanto si resti sul thread.
   */
  describe('età minima: solo quello che è rimasto lì un po’', () => {
    const openedAt = Date.parse(at(2026, 8, 21, 11, 6));

    it('la risposta arrivata un minuto fa non porta il divisore', () => {
      const recente: TranscriptMsg[] = [
        { role: 'assistant', content: 'vecchia', created_at: at(2026, 8, 21, 9, 0) },
        { role: 'assistant', content: 'appena arrivata', created_at: at(2026, 8, 21, 11, 5) }
      ];
      expect(firstUnreadIndex(recente, since, openedAt)).toBe(-1);
    });

    it('quella arrivata mentre il thread era già aperto non lo porta mai', () => {
      const dopoLApertura: TranscriptMsg[] = [
        { role: 'assistant', content: 'scritta sotto i suoi occhi', created_at: at(2026, 8, 21, 11, 30) }
      ];
      expect(firstUnreadIndex(dopoLApertura, since, openedAt)).toBe(-1);
    });

    it('quella ferma lì da un pezzo sì', () => {
      const tardi = Date.parse(at(2026, 8, 21, 13, 0));
      expect(firstUnreadIndex(msgs, since, tardi)).toBe(3);
    });

    it('senza apertura non c’è confine: nessun divisore', () => {
      expect(firstUnreadIndex(msgs, since, 0)).toBe(-1);
    });
  });
});
