import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/publish', () => ({ publishApprovedPost: vi.fn() }));
vi.mock('$lib/server/zernio', () => ({ requireZernioCancellation: vi.fn() }));

import { REORDER_SLIDES } from '@anomalia/api-contracts';
import { restructureCarouselSlides, type EditorTarget } from './post-editor-tools';

type Row = Record<string, unknown>;

/**
 * Il minimo che `restructureCarouselSlides` tocca: legge la riga, la aggiorna, e `reschedIfNeeded`
 * la rilegge per lo `status`. Nessun mock della funzione sotto esame — è quello il difetto dei
 * test di rotta accanto, che verificano l'inoltro degli argomenti e non cosa succede alla riga.
 */
function fakePosts(row: Row) {
  const written: Row[] = [];
  const query = (result: Row | null) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: result })
    };
    return chain;
  };

  const supabase = {
    from: () => ({
      select: () => query(row).select?.() ?? query(row),
      update: (patch: Row) => {
        written.push(patch);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      }
    })
  };

  return { supabase: supabase as unknown as EditorTarget['supabase'], written };
}

const target = (supabase: EditorTarget['supabase']): EditorTarget => ({
  supabase,
  brandId: 'b1',
  postId: 'p1',
  tz: 'Europe/Rome',
  userId: 'u1',
  ctx: {} as EditorTarget['ctx'],
  refUrls: []
});

const FIVE_SLIDES = {
  status: 'pending_user',
  media_urls: ['/a/0', '/a/1', '/a/2', '/a/3', '/a/4'],
  image_prompts: ['p0', 'p1', 'p2', 'p3', 'p4']
};

describe('reorder_slides', () => {
  /**
   * IL FATTO CHE DECIDE. `order` non riordina soltanto: è la lista di ciò che RESTA, e le slide
   * che non ci sono spariscono dalla riga senza che il chiamante le abbia mai nominate. Non
   * tornano indietro. Il registro (`REORDER_SLIDES.destructive`) dice `false`, e il tool viveva
   * accanto a tre che ridisegnano — cioè accanto a tre che non possono togliere niente.
   *
   * È il motivo per cui la famiglia «media del post» non si collassa: un tool solo davanti a
   * queste quattro rotte porterebbe UNA annotazione per un'operazione che distrugge e tre che no,
   * e `destructiveHint` tornerebbe a mentire come su `ads_action`.
   */
  it('cancella per omissione: le slide fuori da `order` non tornano', async () => {
    const { supabase, written } = fakePosts({ ...FIVE_SLIDES });

    const res = await restructureCarouselSlides(target(supabase), { order: [0, 2] });

    expect(res).toEqual({ success: true, slide_count: 2 });
    expect(written).toHaveLength(1);
    expect(written[0].media_urls).toEqual(['/a/0', '/a/2']);
    expect(written[0].image_prompts).toEqual(['p0', 'p2']);
    expect(written[0].media_url).toBe('/a/0');
  });

  it('rifiuta un post che non è un carosello — un vocabolario che i suoi fratelli non hanno', async () => {
    const { supabase, written } = fakePosts({ status: 'pending_user', media_urls: ['/a/0'], image_prompts: [] });

    expect(await restructureCarouselSlides(target(supabase), { order: [0] })).toEqual({
      error: 'This post is not a carousel.'
    });
    expect(written).toHaveLength(0);
  });
  /**
   * La contraddizione sta qui e non in un commento, così scade quando qualcuno la ripara: il test
   * sopra dimostra che il tool toglie, il registro dichiara che non toglie. Correggere il flag fa
   * fallire questa riga, e chi la cancella trova sopra il motivo per cui era stata scritta.
   * `changelog/2026-09-08-two-families-stay-separate.md` dice perché non è stato corretto qui.
   */
  it('e il registro dice ancora che non distrugge', () => {
    expect(REORDER_SLIDES.destructive).toBe(false);
  });
});
