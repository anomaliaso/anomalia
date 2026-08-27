import { describe, it, expect } from 'vitest';
import { normalizeAgentProposal, describeSchedule } from './chat-agent-proposal';

const valid = {
  name: 'Lettura performance',
  prompt: 'Leggi la performance degli ultimi 7 giorni e di cosa cambiare la settimana prossima.',
  agent: 'grow',
  days: [1],
  times: ['09:00'],
  because: 'Ci sono dati di performance da leggere ogni lunedì.',
  outputs: ['recap settimanale']
};

describe('normalizeAgentProposal', () => {
  it('reads the payload both bare and wrapped in a tool output', () => {
    expect(normalizeAgentProposal(valid)?.name).toBe('Lettura performance');
    expect(normalizeAgentProposal({ success: true, proposal: valid })?.name).toBe('Lettura performance');
  });

  it('refuses anything that is not a complete, showable card', () => {
    // A card missing the schedule would ask for a yes to something undefined.
    expect(normalizeAgentProposal({ ...valid, days: [] })).toBeNull();
    expect(normalizeAgentProposal({ ...valid, times: [] })).toBeNull();
    expect(normalizeAgentProposal({ ...valid, name: '' })).toBeNull();
    expect(normalizeAgentProposal({ ...valid, prompt: 'too short' })).toBeNull();
    expect(normalizeAgentProposal(null)).toBeNull();
    expect(normalizeAgentProposal('nope')).toBeNull();
  });

  it('drops days and times that are not days and times', () => {
    const p = normalizeAgentProposal({ ...valid, days: [1, 9, -2, 1, 3], times: ['09:00', '25:00', 'nine', '18:30'] });
    expect(p?.days).toEqual([1, 3]);
    expect(p?.times).toEqual(['09:00', '18:30']);
  });

  it('falls back to auto for a specialist that does not exist', () => {
    expect(normalizeAgentProposal({ ...valid, agent: 'ceo' })?.agent).toBe('auto');
    expect(normalizeAgentProposal({ ...valid, agent: 'web' })?.agent).toBe('web');
  });

  it('keeps the brief intact — it is what gets created', () => {
    const long = 'x'.repeat(9000);
    expect(normalizeAgentProposal({ ...valid, prompt: long })?.prompt).toHaveLength(8000);
    expect(normalizeAgentProposal(valid)?.prompt).toBe(valid.prompt);
  });

  it('caps the trimmings', () => {
    const p = normalizeAgentProposal({ ...valid, outputs: ['a', 'b', 'c', 'd', 'e'], because: 'y'.repeat(400) });
    expect(p?.outputs).toHaveLength(4);
    expect(p?.because).toHaveLength(300);
  });
});

describe('describeSchedule', () => {
  it('reads like a person would say it', () => {
    expect(describeSchedule([1, 4], ['09:00'], 'it')).toBe('lun, gio · 09:00');
    expect(describeSchedule([1], ['09:00', '18:00'], 'en')).toBe('Mon · 09:00, 18:00');
  });

  it('drops the day list when it is every day', () => {
    expect(describeSchedule([0, 1, 2, 3, 4, 5, 6], ['07:00'], 'it')).toBe('07:00');
  });

  it('falls back to English day names for a locale it does not know', () => {
    expect(describeSchedule([2], ['08:00'], 'de')).toBe('Tue · 08:00');
  });
});
