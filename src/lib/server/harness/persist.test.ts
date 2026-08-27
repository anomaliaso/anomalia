import { describe, expect, it } from 'vitest';
import { redactEvents } from './persist';

/**
 * La traccia che si svuotava da sola: 19 sessioni `chat` su 146 (produzione, 14 giorni al
 * 2026-08-23) avevano `event_count > 0` e `events: []`, perché il round-trip JSON della redazione
 * falliva sull'intero array e il `?? []` scriveva il vuoto senza dire niente.
 *
 * `BigInt` è il modo più corto di far fallire `JSON.stringify` davvero, cioè la stessa strada per
 * cui `redactJson` torna `null`. Quello che conta non è quale evento rompe: è che gli altri
 * sopravvivano e che il buco resti visibile.
 */
describe('redactEvents', () => {
  it('salva gli eventi buoni e lascia un segnaposto dove la serializzazione rompe', () => {
    const events = [
      { type: 'turn_start', at: '2026-08-23T00:00:00.000Z' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: 'tool_call', name: 'read_posts', input: { n: 1n } as any },
      { type: 'assistant_text', text: 'fatto' }
    ];
    const out = redactEvents(events, 'brand-1');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'turn_start' });
    expect(out[1]).toMatchObject({ type: 'redaction_failed', index: 1 });
    expect(out[2]).toMatchObject({ type: 'assistant_text', text: 'fatto' });
  });

  it('il percorso normale resta una serializzazione sola e non tocca niente', () => {
    const events = [{ type: 'assistant_text', text: 'ok' }];
    expect(redactEvents(events, 'brand-1')).toEqual(events);
  });
});
