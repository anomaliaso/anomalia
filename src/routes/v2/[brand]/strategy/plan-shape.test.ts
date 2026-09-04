import { describe, it, expect } from 'vitest';
import { listOf, mixOf, pairsOf, platformsOf, stateOf, textOf, weeksOf } from './plan-shape';

describe('le settimane arrivano da un jsonb che nessuno controlla', () => {
  it('un piano senza settimane non diventa una lista rotta', () => {
    expect(weeksOf(null, null)).toEqual([]);
    expect(weeksOf({ weeks: null }, null)).toEqual([]);
    expect(weeksOf({ weeks: 'four' }, null)).toEqual([]);
  });

  it('il tema manca e ci si accontenta del titolo', () => {
    const [week] = weeksOf({ weeks: [{ title: 'Lancio' }] }, null);

    expect(week.theme).toBe('Lancio');
  });

  it('senza tema e senza titolo la settimana si nomina da sola', () => {
    const [week] = weeksOf({ weeks: [{}] }, null);

    expect(week.theme).toBe('Week 1');
  });

  it("l'indice mostrato parte da uno, non da zero", () => {
    const weeks = weeksOf({ weeks: [{}, {}] }, null);

    expect(weeks.map((w) => w.label)).toEqual(['Week 1', 'Week 2']);
  });

  it('la settimana corrente e una sola', () => {
    const weeks = weeksOf({ weeks: [{}, {}, {}, {}] }, 2);

    expect(weeks.filter((w) => w.current).map((w) => w.index)).toEqual([2]);
  });

  it('senza settimana corrente non se ne accende nessuna', () => {
    expect(weeksOf({ weeks: [{}, {}] }, null).some((w) => w.current)).toBe(false);
  });
});

describe('lo stato di una settimana decide come si legge', () => {
  it('done e chiuso', () => {
    expect(stateOf('done')).toMatchObject({ label: 'Done', tone: 'secondary' });
  });

  it('uno stato inventato dal modello non rompe il badge', () => {
    expect(stateOf('vibes')).toEqual({ label: 'vibes', tone: 'outline' });
  });

  it('senza stato resta upcoming', () => {
    expect(stateOf(undefined).label).toBe('Upcoming');
  });
});

describe('il mix di contenuti si legge in una riga', () => {
  it('tipo e quantita in ordine di arrivo', () => {
    expect(mixOf({ content_mix: [{ type: 'reel', count: 3 }, { type: 'carousel', count: 2 }] })).toBe(
      '3 reel · 2 carousel'
    );
  });

  it('un mix assente non stampa un separatore solitario', () => {
    expect(mixOf({})).toBe('');
    expect(mixOf({ content_mix: [] })).toBe('');
    expect(mixOf({ content_mix: 'three reels' })).toBe('');
  });

  it('una voce senza tipo viene saltata invece di stampare undefined', () => {
    expect(mixOf({ content_mix: [{ count: 3 }, { type: 'reel', count: 1 }] })).toBe('1 reel');
  });
});

describe('la voce del brand si mostra solo dove esiste', () => {
  it('le quattro voci in ordine fisso', () => {
    const pairs = pairsOf({ voice: { mood: 'warm', tone: 'direct', goal: 'trust', personality: 'host' } });

    expect(pairs.map((p) => p.label)).toEqual(['Mood', 'Tone', 'Goal', 'Personality']);
  });

  it('una voce vuota non diventa una riga vuota', () => {
    expect(pairsOf({ voice: { mood: 'warm', tone: '  ', goal: null } })).toEqual([
      { label: 'Mood', value: 'warm' }
    ]);
  });

  it('senza voce non si mostra la sezione', () => {
    expect(pairsOf({})).toEqual([]);
    expect(pairsOf({ voice: 'friendly' })).toEqual([]);
  });
});

describe('il mix di piattaforme e testo del modello, non un numero', () => {
  it('piattaforma, quota e ruolo passano cosi come sono', () => {
    expect(
      platformsOf({ platform_mix: [{ platform: 'instagram', share: '2/week', role: 'discovery' }] })
    ).toEqual([{ platform: 'instagram', share: '2/week', role: 'discovery' }]);
  });

  it('una riga senza piattaforma viene saltata', () => {
    expect(platformsOf({ platform_mix: [{ share: '40%' }] })).toEqual([]);
  });

  it('un mix assente resta una lista vuota', () => {
    expect(platformsOf({ platform_mix: null })).toEqual([]);
  });
});

describe('i pilastri arrivano dallo studio, e non sempre arrivano', () => {
  it('una lista di stringhe passa', () => {
    expect(listOf({ content_pillars: ['dietro le quinte', 'ricette'] }, 'content_pillars')).toEqual([
      'dietro le quinte',
      'ricette'
    ]);
  });

  it('un brand mai analizzato non ha pilastri', () => {
    expect(listOf(null, 'content_pillars')).toEqual([]);
    expect(listOf({}, 'content_pillars')).toEqual([]);
  });

  it('un pilastro vuoto non diventa un badge vuoto', () => {
    expect(listOf({ content_pillars: ['ricette', '   ', ''] }, 'content_pillars')).toEqual([
      'ricette'
    ]);
  });

  it('un jsonb che non e una lista non viene iterato', () => {
    expect(listOf({ content_pillars: 'ricette, dietro le quinte' }, 'content_pillars')).toEqual([]);
  });
});

describe('un campo di testo del piano non e garantito che sia testo', () => {
  it('la strategia scritta si legge', () => {
    expect(textOf({ strategy: 'Portare il locale online' }, 'strategy')).toBe(
      'Portare il locale online'
    );
  });

  it('un piano assente non stampa undefined', () => {
    expect(textOf(null, 'strategy')).toBe('');
  });

  it('un numero al posto di una frase non finisce in pagina', () => {
    expect(textOf({ cadence: 3 }, 'cadence')).toBe('');
  });
});
