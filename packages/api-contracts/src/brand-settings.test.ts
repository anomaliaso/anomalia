import { describe, expect, it } from 'vitest';
import { GET_BRAND_SETTINGS, SET_BRAND_SETTINGS, TARGET_PLATFORMS } from './brand-settings';
import { BRAND_ENDPOINTS, statusForFailure } from './index';

describe('le impostazioni di brand come contratto', () => {
  it('stanno nel registry, o nessun agente le vede', () => {
    for (const endpoint of [GET_BRAND_SETTINGS, SET_BRAND_SETTINGS]) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('cambia solo i campi che nomini: sono tutti facoltativi', () => {
    expect(SET_BRAND_SETTINGS.input.safeParse({ timezone: 'Europe/Rome' }).success).toBe(true);
    expect(SET_BRAND_SETTINGS.input.safeParse({ voice_examples: [] }).success).toBe(true);
  });

  it('una richiesta vuota non è una scrittura: 400 dichiarato, non un 200 che non fa niente', () => {
    // Lo schema resta un ZodObject puro — la registrazione MCP ci aggiunge `slug` con `.extend`,
    // e un `.refine` lo trasformerebbe in qualcosa che `.extend` non ha. Quindi il conteggio dei
    // campi lo fa la rotta, e il fallimento è dichiarato qui.
    expect(statusForFailure(SET_BRAND_SETTINGS, 'no_fields')).toBe(400);
    expect(typeof SET_BRAND_SETTINGS.input.extend).toBe('function');
  });

  it('accetta solo le piattaforme su cui il prodotto lavora', () => {
    expect(SET_BRAND_SETTINGS.input.safeParse({ platforms: ['instagram', 'linkedin'] }).success).toBe(true);
    expect(SET_BRAND_SETTINGS.input.safeParse({ platforms: ['myspace'] }).success).toBe(false);
    expect(TARGET_PLATFORMS).toContain('instagram');
  });

  it('togliere ogni piattaforma è una scelta, non un errore di battitura', () => {
    expect(SET_BRAND_SETTINGS.input.safeParse({ platforms: [] }).success).toBe(true);
  });

  it('un fuso che non esiste è colpa di chi chiama, e ha un errore suo', () => {
    expect(statusForFailure(SET_BRAND_SETTINGS, 'unknown_timezone')).toBe(400);
  });

  it('gli hashtag sono per piattaforma, non una lista sola', () => {
    const ok = SET_BRAND_SETTINGS.input.safeParse({ hashtags: { instagram: ['#caffe'] } });
    expect(ok.success).toBe(true);
    expect(SET_BRAND_SETTINGS.input.safeParse({ hashtags: { myspace: ['#x'] } }).success).toBe(false);
  });

  it('la lettura porta le scelte ammesse e quelle che non hanno dove pubblicare', () => {
    const parsed = GET_BRAND_SETTINGS.output.safeParse({
      brand: 'demo',
      timezone: 'Europe/Rome',
      platforms: ['instagram', 'reddit'],
      platform_choices: [...TARGET_PLATFORMS],
      connected_platforms: ['instagram'],
      hashtags: { instagram: ['#caffe'] },
      voice_examples: ['Un post vero del brand.']
    });
    expect(parsed.success).toBe(true);
  });

  it('dice cosa succede a un fuso cambiato e a una piattaforma tolta, o l agente non lo sa', () => {
    // Un post gia' programmato non si sposta e non si annulla: sono le due conseguenze che
    // rendono questi due campi diversi da una preferenza qualunque, e vivono nella descrizione
    // perche' e' l'unica cosa che l'agente legge prima di chiamare.
    expect(SET_BRAND_SETTINGS.description).toMatch(/does NOT move posts/);
    expect(SET_BRAND_SETTINGS.description).toMatch(/does NOT cancel posts/);
  });

  it('twitter non e un nome che il prodotto insegna: si chiama x', () => {
    expect(TARGET_PLATFORMS).not.toContain('twitter');
    expect(SET_BRAND_SETTINGS.input.safeParse({ platforms: ['twitter'] }).success).toBe(false);
  });
});
