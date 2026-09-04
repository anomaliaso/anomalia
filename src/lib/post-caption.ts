/** Quanto testo la copia di un post regge prima che salvarla sia un errore, non una svista. */
export const CAPTION_MAX = 20_000;

const PLATFORM_CAPTION = /^caption_(.+)$/;

/**
 * Dal form del pannello alla patch per `PUT /api/v1/brands/:slug/posts/:id`, oppure il messaggio
 * da mostrare a chi ha scritto.
 *
 * `platform_captions` compare SOLO se il form ha mandato almeno un campo `caption_<platform>`:
 * un form che non li manda (perché il post ha una copia sola) non deve cancellare riscritture
 * che qualcun altro ha salvato. E una riscrittura svuotata a mano non è una riscrittura vuota —
 * è la richiesta di tornare alla copia comune.
 */
export function captionPatch(form: FormData): Record<string, unknown> | string {
  const caption = String(form.get('caption') ?? '');
  if (!caption.trim()) {
    return 'The copy cannot be empty.';
  }
  if (caption.length > CAPTION_MAX) {
    return 'The copy is too long to save.';
  }

  const overrides: Record<string, string> = {};
  let sawOverride = false;

  for (const [key, value] of form.entries()) {
    const platform = PLATFORM_CAPTION.exec(key)?.[1];
    if (!platform || typeof value !== 'string') {
      continue;
    }
    if (value.length > CAPTION_MAX) {
      return `The copy for ${platform} is too long to save.`;
    }

    sawOverride = true;
    if (value.trim()) {
      overrides[platform] = value.trim();
    }
  }

  if (!sawOverride) {
    return { caption };
  }

  return { caption, platform_captions: Object.keys(overrides).length ? overrides : null };
}
