import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * UN'IMMAGINE = UN RENDER FATTURATO.
 *
 * Il controllo qualita' rendeva due candidati in parallelo e ne buttava uno — gia' pagato — e poi
 * ridisegnava a prezzo pieno fino a due volte un render RIUSCITO che il critico bocciava. Misurato:
 * ~4 render pagati per ogni immagine consegnata, 1.058 render per ~250 artefatti in 30 giorni,
 * $78,29. `IMAGE_CREDITS` ha sempre dichiarato UN render.
 *
 * Il test conta i RENDER, non le immagini restituite: contare le immagini e' esattamente la
 * confusione che ha prodotto il difetto — ne tornava sempre una, e intanto se ne pagavano quattro.
 *
 * Si conta sul percorso VERO. Prima questo file finreva `route` a `{ endpoint: 'google' }` e
 * contava le chiamate a `googleGenaiClient`: un endpoint che il registro non sa produrre, cioe' il
 * conteggio girava su un ramo che la produzione non poteva raggiungere. Passava, e non misurava
 * niente.
 */

vi.mock('$lib/server/wall-digest', () => ({
  designWallDigestSection: () => Promise.resolve('')
}));

const renderOnKie = vi.fn();

vi.mock('$lib/server/kie-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/kie-jobs')>()),
  generateImageOnKie: renderOnKie
}));

vi.mock('$lib/server/model-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/model-routing')>()),
  route: () => ({ family: 'nano-banana', endpoint: 'kie', provider: 'kie' })
}));

const images = await import('./images');

const RENDERED = { dataUrl: 'data:image/png;base64,AAAA' };

beforeEach(() => {
  renderOnKie.mockReset();
  renderOnKie.mockResolvedValue(RENDERED);
});

describe('un render per immagine', () => {
  it('paga UN render, non due candidati piu due ritentativi', async () => {
    const out = await images.renderBrandImage(null as never, 'un banco di lavoro in noce', {
      visualStyle: 'warm editorial'
    });

    expect(out).toBeTruthy();
    // Il numero che conta. Con il critico erano 2 in parallelo, e fino a 4 col ritentativo.
    expect(renderOnKie).toHaveBeenCalledTimes(1);
  });

  it('il critico non e piu raggiungibile da nessuna parte', () => {
    expect('renderWithQC' in images).toBe(false);
    expect('critiqueImage' in images).toBe(false);
    expect('MAX_QC_RETRIES' in images).toBe(false);
  });

  it('un render che torna vuoto ritenta ancora: quello e il ritentativo legittimo', async () => {
    // Nessuna parte immagine al primo giro: e' un fallimento vero del modello, non un verdetto di
    // qualita'. Qui ritentare e' giusto e non c'entra con la QC che si e' tolta.
    renderOnKie
      .mockResolvedValueOnce({ dataUrl: undefined })
      .mockResolvedValueOnce(RENDERED);

    const out = await images.renderBrandImage(null as never, 'x', {});

    expect(out).toBeTruthy();
    expect(renderOnKie).toHaveBeenCalledTimes(2);
  });
});
