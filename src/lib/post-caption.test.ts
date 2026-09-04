import { describe, expect, it } from 'vitest';
import { captionPatch, CAPTION_MAX } from './post-caption';

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe('la copia che il pannello salva', () => {
  it('salva la copia comune quando non ci sono riscritture', () => {
    expect(captionPatch(form({ caption: 'Ciao' }))).toEqual({ caption: 'Ciao' });
  });

  it('rifiuta una copia vuota invece di svuotare il post', () => {
    expect(captionPatch(form({ caption: '   ' }))).toBe('The copy cannot be empty.');
  });

  it('rifiuta una copia più lunga di quanto la colonna regga', () => {
    expect(captionPatch(form({ caption: 'a'.repeat(CAPTION_MAX + 1) }))).toBe(
      'The copy is too long to save.'
    );
  });

  it('raccoglie le riscritture per piattaforma dai campi caption_<platform>', () => {
    expect(
      captionPatch(form({ caption: 'Base', caption_instagram: 'IG', caption_x: 'X' }))
    ).toEqual({ caption: 'Base', platform_captions: { instagram: 'IG', x: 'X' } });
  });

  /**
   * Una riscrittura svuotata NON è una riscrittura vuota: è la richiesta di tornare alla copia
   * comune. Se finisse nel patch come stringa vuota, quella piattaforma pubblicherebbe niente.
   */
  it('toglie la riscrittura svuotata invece di salvarla vuota', () => {
    expect(captionPatch(form({ caption: 'Base', caption_instagram: '  ' }))).toEqual({
      caption: 'Base',
      platform_captions: null
    });
  });

  it('non tocca le riscritture se il form non ne manda nessuna', () => {
    const patch = captionPatch(form({ caption: 'Base', id: 'post-1' }));
    expect(patch).not.toHaveProperty('platform_captions');
  });

  it('dice quale piattaforma è troppo lunga, non solo che qualcosa lo è', () => {
    expect(
      captionPatch(form({ caption: 'Base', caption_tiktok: 'a'.repeat(CAPTION_MAX + 1) }))
    ).toBe('The copy for tiktok is too long to save.');
  });
});
