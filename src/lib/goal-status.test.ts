import { describe, expect, it } from 'vitest';
import { splitGoalStatus } from './goal-status';

// I casi veri degli screenshot del 2026-08-21, più i quattro template di goalTurnNotice (en/it).
describe('splitGoalStatus', () => {
  it('parses the resuming notice (the screenshot case)', () => {
    const { text, status } = splitGoalStatus(
      'Done for now.\n\n_Goal not reached yet — 4/6 done, still open: MP4 2K renderizzato e in gallery; Ultimo render revisionato con verdict ship. I am picking it back up in the background._'
    );
    expect(text).toBe('Done for now.');
    expect(status).toEqual({
      state: 'resuming',
      done: 4,
      total: 6,
      detail: null,
      open: [
        'MP4 2K renderizzato e in gallery',
        'Ultimo render revisionato con verdict ship'
      ],
      // Formato vecchio: la frazione e basta. Nessun nome, e nessuna riga rotta.
      closed: []
    });
  });

  /**
   * LA REGRESSIONE DA TEMERE, ed è invisibile finché qualcuno non riapre una conversazione di
   * ieri: i thread esistenti hanno avvisi nel formato precedente, e devono continuare a leggersi
   * uguali. Il gruppo «appena chiusi» è opzionale proprio per questo.
   */
  it.each([
    '_Goal not reached yet — 4/6 done, still open: uno; due. I am picking it back up in the background._',
    '_Obiettivo non ancora raggiunto — 4/6 fatti, restano: uno; due. Riprendo in background._',
    '_Obiettivo non ancora raggiunto — 4/6 fatti, restano: uno; due. Resta aperto e riprendo al tuo prossimo messaggio._',
    '_Goal stopped at 0/5 — a whole pass closed nothing. Still open: uno; due. Tell me how you want to go on._',
    '_Obiettivo fermo a 0/5 — un giro intero non ha chiuso niente. Restano: uno; due. Dimmi come vuoi procedere._',
    '_Goal reached — 6/6: tutti i post di settembre approvati._'
  ])('legge ancora gli avvisi scritti prima del formato nuovo: %s', (line) => {
    const { status } = splitGoalStatus(line);
    expect(status).not.toBeNull();
    expect(status?.closed).toEqual([]);
    expect(status?.total).toBeGreaterThan(0);
  });

  it('nomina i criteri chiusi in QUEL turno, en e it', () => {
    const en = splitGoalStatus(
      '_Goal not reached yet — 2/5 done (just closed: referenza studiata; UI catturata), still open: uno; due. I am picking it back up in the background._'
    ).status;
    expect(en?.closed).toEqual(['referenza studiata', 'UI catturata']);
    expect(en?.open).toEqual(['uno', 'due']);
    expect(en?.state).toBe('resuming');

    const it1 = splitGoalStatus(
      '_Obiettivo non ancora raggiunto — 2/5 fatti (appena chiusi: referenza studiata; UI catturata), restano: uno; due. Riprendo in background._'
    ).status;
    expect(it1?.closed).toEqual(['referenza studiata', 'UI catturata']);
    expect(it1?.done).toBe(2);

    // Uno solo: «appena chiuso», singolare.
    const it2 = splitGoalStatus(
      '_Obiettivo non ancora raggiunto — 1/5 fatti (appena chiuso: referenza studiata), restano: uno. Resta aperto e riprendo al tuo prossimo messaggio._'
    ).status;
    expect(it2?.closed).toEqual(['referenza studiata']);
    expect(it2?.state).toBe('waiting');
  });

  it('anche sulla riga di resa, dove la motivazione resta un campo a parte', () => {
    const { status } = splitGoalStatus(
      '_Goal stopped at 3/5 (just closed: terzo criterio) — I used every automatic pass. Still open: uno; due. Tell me how you want to go on._'
    );
    expect(status?.closed).toEqual(['terzo criterio']);
    expect(status?.detail).toBe('I used every automatic pass');
    expect(status?.open).toEqual(['uno', 'due']);
  });

  it('parses the stopped notice (the screenshot case)', () => {
    const { status } = splitGoalStatus(
      '_Goal stopped at 0/5 — a whole pass closed nothing. Still open: uno; due. Tell me how you want to go on._'
    );
    expect(status?.state).toBe('stopped');
    expect(status?.done).toBe(0);
    expect(status?.total).toBe(5);
    expect(status?.detail).toBe('a whole pass closed nothing');
    expect(status?.open).toEqual(['uno', 'due']);
  });

  // Il caso della segnalazione: 0/5 con una motivazione. La riga in chat li mostrava tutti e sei
  // — motivazione compresa — come voci identiche di uno stesso elenco, e "0/5" sopra cinque righe
  // sembrava arbitrario. La motivazione deve restare un campo a parte, e i criteri devono
  // tornare tutti, in ordine, con le loro parole.
  it('keeps the stop reason out of the criteria (0/5, the reported case)', () => {
    const { status } = splitGoalStatus(
      '_Goal stopped at 0/5 — a whole pass closed nothing. Still open: Referenza studiata e beat raggiungibili scelti; UI reale del prodotto catturata o in libreria; Composizione TSX con 5 beat, transizioni wow, mockup UI; Voice-over e music bed nel source; MP4 renderizzato in galleria e revisionato. Tell me how you want to go on._'
    );
    expect(status?.detail).toBe('a whole pass closed nothing');
    expect(status?.open).toEqual([
      'Referenza studiata e beat raggiungibili scelti',
      'UI reale del prodotto catturata o in libreria',
      'Composizione TSX con 5 beat, transizioni wow, mockup UI',
      'Voice-over e music bed nel source',
      'MP4 renderizzato in galleria e revisionato'
    ]);
    expect(status!.open).not.toContain(status!.detail);
    // Niente criterio chiuso, quindi l'elenco copre tutto il totale: qui la riga può dire la
    // verità intera. Con `done > 0` i nomi dei chiusi non ci sono — è il buco lato server.
    expect(status!.done + status!.open.length).toBe(status!.total);
  });

  // Con dei criteri già chiusi, l'avviso porta solo i nomi degli APERTI: la differenza fra
  // `total` e `open.length` è tutto quello che si sa dei fatti. Se un giorno il notice li
  // nominerà, è questo test a doversi aggiornare per primo.
  it('carries only the open criteria by name — the closed ones are just a count', () => {
    const { status } = splitGoalStatus(
      '_Goal stopped at 2/5 — I used every automatic pass. Still open: a; b; c. Tell me how you want to go on._'
    );
    expect(status?.open).toEqual(['a', 'b', 'c']);
    expect(status!.total - status!.open.length).toBe(status!.done);
  });

  it('parses waiting, met, and the Italian variants', () => {
    expect(
      splitGoalStatus(
        '_Goal not reached yet — 1/2 done, still open: x. It stays open and I carry on with your next message._'
      ).status?.state
    ).toBe('waiting');
    expect(
      splitGoalStatus('_Obiettivo non ancora raggiunto — 2/3 fatti, restano: a; b. Riprendo in background._')
        .status
    ).toMatchObject({ state: 'resuming', done: 2, total: 3, open: ['a', 'b'] });
    expect(
      splitGoalStatus('_Obiettivo raggiunto — 3/3: tutti i post approvati_').status
    ).toMatchObject({ state: 'met', done: 3, total: 3, detail: 'tutti i post approvati' });
    expect(
      splitGoalStatus(
        '_Obiettivo fermo a 1/4 — un giro intero non ha chiuso niente. Restano: a. Dimmi come vuoi procedere._'
      ).status?.state
    ).toBe('stopped');
  });

  it('never leaves raw underscores: unparseable goal paragraphs become *italic*', () => {
    const { text, status } = splitGoalStatus('ok\n\n_Goal something the parser has never seen_');
    expect(status).toBeNull();
    expect(text).toBe('ok\n\n*Goal something the parser has never seen*');
  });

  it('leaves ordinary text alone', () => {
    const input = 'plain reply, nothing _special about goals here';
    expect(splitGoalStatus(input)).toEqual({ text: input, status: null });
  });
});
