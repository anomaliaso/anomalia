import { describe, it, expect } from 'vitest';
import { normalizeRoutineEvent } from './chat-routine-event';

/**
 * IL NORMALIZZATORE È IL CANCELLO della riga di sistema: quello che passa di qui finisce a
 * schermo. Le due cose che deve fare sono opposte fra loro, ed è il motivo per cui esiste:
 * accettare la stessa cosa nelle due forme in cui arriva (l'output vivo del tool e la part
 * arricchita al salvataggio), e rifiutare tutto ciò che non è una riga scrivibile — meglio niente
 * che `Nuova routine ""`.
 */

const full = {
  kind: 'created',
  id: 'r1',
  name: 'X tech news radar',
  agent: 'team:web',
  owner_name: 'Web Specialist',
  self: false,
  by: 'Anomalia',
  days: [1, 4],
  times: ['09:00'],
  prompt: 'Leggi le fonti del settore e porta i tre fatti che cambiano qualcosa.',
  next_run: '2026-08-24T07:00:00.000Z',
  changes: []
};

describe('normalizeRoutineEvent', () => {
  it('legge sia il payload nudo sia il risultato del tool che lo avvolge', () => {
    const bare = normalizeRoutineEvent(full);
    const wrapped = normalizeRoutineEvent({ success: true, id: 'r1', routine_event: full });
    expect(bare).toEqual(wrapped);
    expect(bare?.name).toBe('X tech news radar');
    expect(bare?.ownerName).toBe('Web Specialist');
    expect(bare?.self).toBe(false);
  });

  it('accetta i cinque verbi e nessun altro', () => {
    for (const kind of ['created', 'updated', 'paused', 'resumed', 'deleted']) {
      expect(normalizeRoutineEvent({ ...full, kind })?.kind, kind).toBe(kind);
    }
    expect(normalizeRoutineEvent({ ...full, kind: 'renamed' })).toBeNull();
  });

  it('senza verbo o senza nome non c’è riga', () => {
    expect(normalizeRoutineEvent({ ...full, name: '   ' })).toBeNull();
    expect(normalizeRoutineEvent({ ...full, kind: undefined })).toBeNull();
    expect(normalizeRoutineEvent(null)).toBeNull();
    expect(normalizeRoutineEvent({ success: false, error: 'missing' })).toBeNull();
  });

  it('tiene i cambiamenti veri e butta quelli che non cambiano niente', () => {
    const ev = normalizeRoutineEvent({
      ...full,
      kind: 'updated',
      changes: [
        { field: 'name', from: 'Ronda SEO', to: 'Ronda posizioni' },
        { field: 'schedule', from: 'lun · 09:00', to: 'lun · 09:00' },
        { field: 'colore', from: 'a', to: 'b' }
      ]
    });
    expect(ev?.changes).toEqual([{ field: 'name', from: 'Ronda SEO', to: 'Ronda posizioni' }]);
  });

  it('giorni e orari arrivano puliti, il prossimo giro può mancare', () => {
    const ev = normalizeRoutineEvent({ ...full, days: [4, 1, 1, 9, -1], next_run: null })!;
    expect(ev.days).toEqual([1, 4]);
    expect(ev.nextRun).toBeNull();
  });
});
