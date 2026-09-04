import { describe, it, expect } from 'vitest';
import {
  captionFields,
  distributionNote,
  extrasOf,
  filterFor,
  platformsOf,
  previewOf,
  stateOf,
  summarise,
  viewFor,
  whenLabel,
  type PostDetail,
  type PostRow
} from './post-state';

const ROME = 'Europe/Rome';

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 'p1',
    platform: 'instagram',
    platforms: null,
    caption: null,
    media_url: null,
    slot: null,
    scheduled_for: null,
    status: 'pending_user',
    published_url: null,
    created_at: '2026-09-01T08:00:00Z',
    ...over
  };
}

describe('la tabella degli stati decide da sola cosa si puo fare', () => {
  it('un post in attesa si modifica e si approva', () => {
    expect(stateOf('pending_user')).toMatchObject({ canEdit: true, canApprove: true });
  });

  it('un post pubblicato non si tocca', () => {
    expect(stateOf('published')).toMatchObject({ canEdit: false, canApprove: false });
  });

  it('uno stato sconosciuto non concede niente', () => {
    expect(stateOf('quantum')).toEqual({
      label: 'quantum',
      tone: 'outline',
      canEdit: false,
      canApprove: false
    });
  });
});

describe('il filtro viene dalla URL e non si fida', () => {
  it('accetta uno stato conosciuto', () => {
    expect(filterFor('pending_user')).toBe('pending_user');
  });

  it('riporta ad all uno stato inventato', () => {
    expect(filterFor('drop table posts')).toBe('all');
  });

  it('riporta ad all quando manca', () => {
    expect(filterFor(null)).toBe('all');
  });
});

describe('la data mostrata e quella del brand, non quella del server', () => {
  it('le 23:30 UTC del 31 agosto sono il 1 settembre a Roma', () => {
    const label = whenLabel(post({ scheduled_for: '2026-08-31T23:30:00Z' }), ROME);

    expect(label).toContain('1 Sep');
    expect(label).not.toContain('31 Aug');
  });

  it('senza orario resta il giorno dello slot', () => {
    expect(whenLabel(post({ slot: '2026-09-10' }), ROME)).toContain('10 Sep');
  });

  it('senza data lo dice', () => {
    expect(whenLabel(post(), ROME)).toBe('No date');
  });
});

describe('le piattaforme di un post', () => {
  it('la lista vince sul singolo', () => {
    expect(platformsOf(post({ platform: 'instagram', platforms: ['linkedin', 'x'] }))).toEqual([
      'linkedin',
      'x'
    ]);
  });

  it('senza lista resta il singolo', () => {
    expect(platformsOf(post({ platform: 'instagram' }))).toEqual(['instagram']);
  });

  it('senza niente resta vuoto', () => {
    expect(platformsOf(post({ platform: null }))).toEqual([]);
  });
});

describe('cosa dice la riga quando la copy manca', () => {
  it('una copy vuota non diventa una riga vuota', () => {
    expect(summarise(post({ caption: '   ' }))).toBe('Untitled');
  });

  it('una copy lunga viene troncata', () => {
    expect(summarise(post({ caption: 'x'.repeat(200) })).length).toBeLessThan(200);
  });
});

describe('cosa succede davvero quando approvi', () => {
  const now = Date.parse('2026-09-04T10:00:00Z');

  it('una data futura viene nominata', () => {
    const note = distributionNote(post({ scheduled_for: '2026-09-05T09:00:00Z' }), ROME, now);

    expect(note).toContain('5 Sep');
    expect(note).toContain(ROME);
  });

  it('una data passata non viene spacciata per programmata', () => {
    const note = distributionNote(post({ scheduled_for: '2026-09-01T09:00:00Z' }), ROME, now);

    expect(note).not.toContain('1 Sep');
    expect(note).toContain('possibly right away');
  });

  it('senza data dice che esce al primo slot utile', () => {
    expect(distributionNote(post(), ROME, now)).toContain('possibly right away');
  });
});

describe('la vista sta nell URL, e il default è il calendario', () => {
  it('accetta solo le viste che esistono', () => {
    expect(viewFor('list')).toBe('list');
    expect(viewFor('calendar')).toBe('calendar');
  });

  it('ricade sul calendario quando il parametro manca o è inventato', () => {
    expect(viewFor(null)).toBe('calendar');
    expect(viewFor('gantt')).toBe('calendar');
  });
});

function detail(over: Partial<PostDetail> = {}): PostDetail {
  return {
    status: 'pending_user',
    platform: 'instagram',
    caption: null,
    scheduled_for: null,
    media_url: null,
    ...over
  };
}

describe('l anteprima mostra quello che c e, non quello che ci si aspetta', () => {
  it('senza media non mostra nulla', () => {
    expect(previewOf(detail())).toEqual({ kind: 'none', urls: [] });
  });

  it('una sola immagine', () => {
    expect(previewOf(detail({ media_url: 'https://cdn/a.png' }))).toEqual({
      kind: 'image',
      urls: ['https://cdn/a.png']
    });
  });

  it('un video si riconosce dal flag, non dall estensione', () => {
    expect(previewOf(detail({ media_url: 'https://cdn/clip.mp4', is_video: true }))).toEqual({
      kind: 'video',
      urls: ['https://cdn/clip.mp4']
    });
  });

  it('il carosello mostra le slide, non la copertina', () => {
    const preview = previewOf(
      detail({
        media_url: 'https://cdn/cover.png',
        is_carousel: true,
        slides: [
          { index: 0, url: 'https://cdn/1.png' },
          { index: 1, url: null },
          { index: 2, url: 'https://cdn/3.png' }
        ]
      })
    );

    expect(preview).toEqual({ kind: 'carousel', urls: ['https://cdn/1.png', 'https://cdn/3.png'] });
  });

  it('un carosello ancora senza slide renderizzate ricade sulla copertina', () => {
    expect(previewOf(detail({ media_url: 'https://cdn/cover.png', is_carousel: true }))).toEqual({
      kind: 'image',
      urls: ['https://cdn/cover.png']
    });
  });
});

describe('le caption modificabili sono quelle che il post ha davvero', () => {
  it('senza override c è solo la caption principale', () => {
    expect(captionFields(detail({ caption: 'ciao' }))).toEqual([
      { name: 'caption', label: 'Caption', value: 'ciao' }
    ]);
  });

  it('una casella per piattaforma, in ordine stabile', () => {
    const fields = captionFields(
      detail({ caption: 'lunga', platform_captions: { x: 'corta', threads: 'media' } })
    );

    expect(fields.map((f) => f.name)).toEqual(['caption', 'caption_threads', 'caption_x']);
    expect(fields[2].value).toBe('corta');
  });
});

describe('il resto del testo che esce si vede, ma non si modifica', () => {
  it('salta i campi vuoti e tiene l ordine della tabella', () => {
    expect(extrasOf(detail({ title: 'Titolo', subreddit: 'r/x', first_comment: '  ' }))).toEqual([
      { label: 'Title', value: 'Titolo' },
      { label: 'Subreddit', value: 'r/x' }
    ]);
  });
});
