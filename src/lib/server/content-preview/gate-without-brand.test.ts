import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL TEST CHE GUARDA DUE BUCHI, E SOLO UNO SI VEDE DA QUI.
 *
 * `renderPostImage` è il chokepoint: le immagini sono ~66% della spesa AI, e la quota si applica
 * QUI perché un loop in un flusso qualunque si fermi invece di bruciare per giorni. Il gate però
 * passava da `getBrandContext()`, e senza brand context non c'era gate — quindi togliere lo slug
 * alla lettera avrebbe lasciato il punto più caro del prodotto senza controllo dei crediti.
 *
 * Il secondo buco è SQL e da qui non si vede: `sum_org_ai_cost_usd` faceva `join brands`, quindi
 * una riga con `brand_id` nullo valeva zero per ogni organizzazione — il cancello sarebbe passato
 * per sempre e quelle generazioni sarebbero state gratis in permanenza, con la suite verde perché
 * il database finto non somma niente. Lo chiude la migration `20260905100000_ai_calls_org_id`
 * (left join + coalesce), e va applicata PRIMA di questo codice: qui i deploy non eseguono le
 * migration.
 */

const gateCredits = vi.fn();
const gateOrgCredits = vi.fn();
const generateImageOnOpenrouter = vi.fn();

vi.mock('$lib/server/wall-digest', () => ({
  designWallDigestSection: () => Promise.resolve('')
}));

vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  gateOrgCredits: (...args: unknown[]) => gateOrgCredits(...args)
}));

vi.mock('$lib/server/openrouter-image', () => ({
  generateImageOnOpenrouter: (...args: unknown[]) => generateImageOnOpenrouter(...args)
}));

vi.mock('$lib/server/model-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/model-routing')>()),
  route: () => ({ endpoint: 'openrouter' })
}));

const { renderPostImage } = await import('./images');
const { withBrandContext, withOrgContext } = await import('$lib/server/ai-log');

const RENDERED = 'data:image/png;base64,AAAA';

class Exhausted extends Error {
  name = 'CreditsExhaustedError';
}

beforeEach(() => {
  vi.clearAllMocks();
  generateImageOnOpenrouter.mockResolvedValue(RENDERED);
});

describe('il cancello dei crediti senza un brand', () => {
  it('chiede all organizzazione, che è chi paga quando nessun brand paga', async () => {
    await withOrgContext('org-1', () => renderPostImage(null as never, 'un gatto', {}));

    expect(gateOrgCredits).toHaveBeenCalledWith('org-1');
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('senza crediti non disegna, e il render non parte nemmeno', async () => {
    gateOrgCredits.mockRejectedValue(new Exhausted('AI credits exhausted for this billing period'));

    await expect(
      withOrgContext('org-1', () => renderPostImage(null as never, 'un gatto', {}))
    ).rejects.toThrow(/exhausted/);

    expect(generateImageOnOpenrouter).not.toHaveBeenCalled();
  });

  it('con un brand resta il cancello di sempre, senza passare dall organizzazione', async () => {
    await withBrandContext('brand-1', () => renderPostImage(null as never, 'un banco in noce', {}));

    expect(gateCredits).toHaveBeenCalledWith('brand-1');
    expect(gateOrgCredits).not.toHaveBeenCalled();
  });

  it('un brand senza crediti continua a fermarsi prima del render', async () => {
    gateCredits.mockRejectedValue(new Exhausted('AI credits exhausted for this billing period'));

    await expect(
      withBrandContext('brand-1', () => renderPostImage(null as never, 'x', {}))
    ).rejects.toThrow(/exhausted/);

    expect(generateImageOnOpenrouter).not.toHaveBeenCalled();
  });
});
