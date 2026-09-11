import { describe, expect, it } from 'vitest';
import { pathFor } from './index';
import { EDIT_POST, MAKE_VIDEO, REGENERATE_POST_MEDIA, REGENERATE_SLIDE, REORDER_SLIDES, RESCHEDULE_POST } from './posts';

const MEDIA = [REGENERATE_POST_MEDIA, REGENERATE_SLIDE, REORDER_SLIDES, MAKE_VIDEO];

describe('le quattro azioni sui media di un post', () => {
  it('hanno una rotta propria: nessuna dice cosa fare dentro il corpo', () => {
    for (const endpoint of MEDIA) {
      expect(Object.keys(endpoint.input.shape), endpoint.tool).not.toContain('action');
    }

    expect(pathFor(REGENERATE_POST_MEDIA, 'demo', 'p1')).toBe(
      '/api/v1/brands/demo/posts/p1/media/regenerate'
    );
    expect(pathFor(REGENERATE_SLIDE, 'demo', 'p1')).toBe('/api/v1/brands/demo/posts/p1/media/slide');
    expect(pathFor(REORDER_SLIDES, 'demo', 'p1')).toBe('/api/v1/brands/demo/posts/p1/media/order');
    expect(pathFor(MAKE_VIDEO, 'demo', 'p1')).toBe('/api/v1/brands/demo/posts/p1/media/video');
  });

  it('chiedono quello che serve a ciascuna, e nient’altro', () => {
    expect(REGENERATE_POST_MEDIA.input.safeParse({ instruction: 'più luce' }).success).toBe(true);
    expect(REGENERATE_POST_MEDIA.input.safeParse({}).success).toBe(false);

    expect(REGENERATE_SLIDE.input.safeParse({ index: 0, instruction: 'x' }).success).toBe(true);
    expect(REGENERATE_SLIDE.input.safeParse({ instruction: 'x' }).success).toBe(false);

    expect(REORDER_SLIDES.input.safeParse({ order: [0, 2, 1] }).success).toBe(true);
    expect(REORDER_SLIDES.input.safeParse({ order: [] }).success).toBe(false);

    expect(MAKE_VIDEO.input.safeParse({}).success).toBe(true);
    expect(MAKE_VIDEO.input.safeParse({ duration: 6, script: 'ciao' }).success).toBe(true);
  });

  it('riordinare non rende niente, le altre tre sì: solo loro sono aperte sul mondo', () => {
    expect(REORDER_SLIDES.openWorld).toBeUndefined();
    for (const endpoint of [REGENERATE_POST_MEDIA, REGENERATE_SLIDE, MAKE_VIDEO]) {
      expect(endpoint.failures.some((f) => f.status === 402), endpoint.tool).toBe(true);
    }
  });
});

/**
 * Due parole per «quando», divise fra due tool: `edit_post` prende `slot` (il giorno di calendario)
 * e NON `scheduled_for` (l'istante in cui il post esce), che si cambia solo con `reschedule_post`.
 * Senza il rimando un agente sposta il giorno credendo di aver spostato l'ora.
 */
describe('le due parole per «quando» si rimandano a vicenda', () => {
  it('edit_post dice che l’ora di pubblicazione è di reschedule_post', () => {
    expect(Object.keys(EDIT_POST.input.shape)).toContain('slot');
    expect(Object.keys(EDIT_POST.input.shape)).not.toContain('scheduled_for');
    expect(EDIT_POST.description).toContain('reschedule_post');
    expect(EDIT_POST.description).toContain('scheduled_for');
  });

  it('reschedule_post prende l’istante, e solo quello', () => {
    expect(Object.keys(RESCHEDULE_POST.input.shape)).toContain('scheduled_for');
  });
});
