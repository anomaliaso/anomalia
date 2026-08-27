import { describe, it, expect } from 'vitest';
import { orderLeastRecentlyServed, queueForLoop, markServed } from './loop-fairness';

/**
 * IL TEST CHE MANCAVA. Non «il tick risponde 200», ma: con una flotta più grande della finestra di
 * un tick, dopo N giri OGNI brand è stato servito almeno una volta e NESSUNO due volte prima che
 * tutti ne abbiano avuta una. È la proprietà che in produzione era falsa da sei settimane senza che
 * un solo test fosse rosso.
 */

/** Il minimo di `loop_cursors` che serve: legge e scrive. Niente rete, niente Supabase. */
function fakeAdmin(store: Map<string, string>) {
  let reads = 0;
  let claims = 0;
  const api = {
    from(table: string) {
      if (table !== 'loop_cursors') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                in(_col: string, ids: string[]) {
                  reads++;
                  const data = ids.filter((id) => store.has(id)).map((id) => ({ brand_id: id, served_at: store.get(id) }));
                  return Promise.resolve({ data, error: null });
                }
              };
            }
          };
        },
        upsert(row: { brand_id: string; served_at: string }) {
          claims++;
          store.set(row.brand_id, row.served_at);
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  return { admin: api as never, reads: () => reads, claims: () => claims };
}

/** Un tick: prende la coda, e per ogni brand claima PRIMA di "lavorarlo". */
async function runTick(
  admin: never,
  store: Map<string, string>,
  candidates: { id: string }[],
  limit: number,
  work: (id: string) => void,
  /** Quanti brand entrano nella finestra prima che scada. */
  budgetFor = limit
): Promise<string[]> {
  const queue = await queueForLoop(admin, 'geo', candidates, limit);
  const done: string[] = [];
  for (const brand of queue) {
    if (done.length >= budgetFor) break; // finestra finita: si esce pulito, senza claimare
    await markServed(admin, 'geo', brand.id);
    // Il claim è già scritto: da qui in poi qualunque cosa succeda, il brand ha avuto il suo turno.
    work(brand.id);
    done.push(brand.id);
    // Ogni claim deve avere un istante strettamente successivo, o l'ordine fra due tick pareggia.
    const t = Date.parse(store.get(brand.id)!) + done.length;
    store.set(brand.id, new Date(t).toISOString());
  }
  return done;
}

describe('orderLeastRecentlyServed', () => {
  it('mette davanti chi non è mai stato servito, poi dal più vecchio', () => {
    const brands = [{ id: 'c' }, { id: 'a' }, { id: 'b' }, { id: 'd' }];
    const served = new Map([
      ['c', '2026-08-20T00:00:00Z'],
      ['a', '2026-08-10T00:00:00Z']
    ]);
    // b e d mai serviti (in ordine di id), poi a (più vecchio), poi c.
    expect(orderLeastRecentlyServed(brands, served).map((b) => b.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it("rompe il pareggio sull'id, non sull'ordine di arrivo", () => {
    // Due tick consecutivi ricevono la stessa flotta in ordini diversi dal pianificatore: la
    // priorità deve restare la stessa, o il secondo giro ripesca chi ha già avuto il suo turno.
    const empty = new Map<string, string>();
    const one = orderLeastRecentlyServed([{ id: 'x' }, { id: 'y' }, { id: 'z' }], empty);
    const two = orderLeastRecentlyServed([{ id: 'z' }, { id: 'x' }, { id: 'y' }], empty);
    expect(one.map((b) => b.id)).toEqual(two.map((b) => b.id));
  });

  it("non lascia l'ordine originale quando nessuno è mai stato servito", () => {
    // Il caso in cui un comparatore che sottrae -Infinity torna NaN e Array.sort non muove niente.
    expect(orderLeastRecentlyServed([{ id: 'z' }, { id: 'y' }, { id: 'x' }], new Map()).map((b) => b.id)).toEqual([
      'x',
      'y',
      'z'
    ]);
  });
});

describe('copertura: flotta più grande della finestra di un tick', () => {
  it('dopo N tick ogni brand è servito una volta, e nessuno due volte prima di tutti', async () => {
    const FLEET = 13; // la flotta vera al 2026-08-22
    const PER_TICK = 4; // quanti ne entrano in una finestra da 300s per un lavoro da ~60s
    const brands = Array.from({ length: FLEET }, (_, i) => ({ id: `brand-${String(i).padStart(2, '0')}` }));
    const store = new Map<string, string>();
    const { admin } = fakeAdmin(store);

    const servedCount = new Map(brands.map((b) => [b.id, 0]));
    const ticks = Math.ceil(FLEET / PER_TICK);

    for (let t = 0; t < ticks; t++) {
      // Il pianificatore restituisce le righe come gli pare: il tick non deve dipenderne.
      const shuffled = [...brands].reverse();
      await runTick(admin, store, shuffled, PER_TICK, (id) => servedCount.set(id, (servedCount.get(id) ?? 0) + 1));

      // Nessuno due volte prima che tutti ne abbiano avuta una: finché gli slot distribuiti non
      // superano la flotta, nessun conteggio può valere 2. È la proprietà che in produzione era
      // falsa — 3 brand serviti sei settimane di fila mentre 2 non lo erano mai stati.
      const slots = (t + 1) * PER_TICK;
      if (slots <= FLEET) {
        expect(Math.max(...servedCount.values()), `bis al tick ${t + 1} (${slots} slot su ${FLEET} brand)`).toBe(1);
      }
    }

    // Ogni brand servito almeno una volta entro il giro completo.
    for (const [id, n] of servedCount) expect(n, `${id} mai servito in ${ticks} tick`).toBeGreaterThanOrEqual(1);
  });

  it("un tick interrotto dalla scadenza riparte da dove era, non dall'inizio", async () => {
    const brands = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}` }));
    const store = new Map<string, string>();
    const { admin } = fakeAdmin(store);
    const noop = () => {};

    // La coda chiede 4 brand, ma la finestra ne regge 2: gli altri due NON vengono claimati.
    const first = await runTick(admin, store, brands, 4, noop, 2);
    const second = await runTick(admin, store, brands, 4, noop, 2);

    expect(first).toEqual(['b0', 'b1']);
    expect(second).toEqual(['b2', 'b3']); // non ['b0','b1'], e nemmeno ['b4','b5']
  });

  it('un brand che non produce niente avanza lo stesso: il claim precede il lavoro', async () => {
    const brands = [{ id: 'muto' }, { id: 'produttivo' }];
    const store = new Map<string, string>();
    const { admin } = fakeAdmin(store);
    // Il lavoro non scrive da nessuna parte per 'muto' — nessun output, nessuna riga di risultato.
    const work = () => {};

    expect(await runTick(admin, store, brands, 1, work)).toEqual(['muto']);
    // Il giro dopo NON deve ridarlo: lo slot non è suo per sempre.
    expect(await runTick(admin, store, brands, 1, work)).toEqual(['produttivo']);
  });

  it("non tocca il database quando non c'è niente da servire", async () => {
    const { admin, reads } = fakeAdmin(new Map());
    expect(await queueForLoop(admin, 'geo', [], 5)).toEqual([]);
    expect(await queueForLoop(admin, 'geo', [{ id: 'a' }], 0)).toEqual([]);
    expect(reads()).toBe(0);
  });
});
