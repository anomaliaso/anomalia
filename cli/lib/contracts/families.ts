import { z } from 'zod';
import { SET_APPEARANCE } from './appearance';
import type { BrandEndpoint, ResourcelessEndpoint } from './index';
import { SET_COLORS, UPDATE_BRAND_KIT, UPDATE_VOICE } from './studio';

/**
 * Una famiglia e' un tool solo davanti a piu' rotte, e il campo che il chiamante manda dice quale.
 * NON e' un `*_action`: non c'e' nessun verbo dentro un parametro, quindi `destructiveHint` resta
 * capace di dire la verita' — una famiglia si forma solo fra scritture che non distruggono niente,
 * e il collasso muore appena una di loro toglie qualcosa.
 *
 * Le regole che una famiglia deve superare, tutte e tre, stanno in `docs/mcp-tools.md`: forme di
 * risposta compatibili, un nome di famiglia non piu' vago di quelli che sostituisce, e nessun
 * danno peggiore quando il modello sbaglia campo di quando sbagliava tool.
 */
export type BrandFamily = {
  readonly tool: string;
  readonly title: string;
  readonly description: string;
  /**
   * Solo scritture a livello di brand. Una rotta che nomina una riga vuole un id, e un id in una
   * famiglia sarebbe un secondo campo che sceglie: quale riga, oltre a quale rotta. Il tipo lo
   * vieta invece di lasciarlo scoprire a chi lo prova.
   */
  readonly members: readonly ResourcelessEndpoint[];
};

/**
 * Il look, i fatti e la voce del brand vivono in due righe sole — `brand_kit` e
 * `brands.content_prefs` — e quattro tool ci scrivevano da quattro porte. La divisione non era
 * neutra: chi cercava «cambia i colori del brand» apriva `set_appearance`, che di campi colore non
 * ne aveva nessuno, e la palette stava in `set_colors`. Qui unire non peggiora la trovabilita': la
 * ripara.
 *
 * `set_bio` non entra: scrive `social_accounts`, non il brand, e risponde 404 quando nessun account
 * e' collegato — un fallimento che nessun altro membro puo' avere.
 */
export const UPDATE_BRAND_IDENTITY = {
  tool: 'update_brand_identity',
  title: 'Change what the brand is, how it sounds and how it looks',
  description:
    'Change what this brand IS, how it SOUNDS and how it LOOKS: its facts and language, its voice, ' +
    'its colours, its logo, its fonts and its visual brief. One door for all of it — it replaces ' +
    '`update_brand_kit`, `update_voice`, `set_colors` and `set_appearance`, which are gone. Only ' +
    'the fields you send change, and at least one is required. `colors` REPLACES the whole ' +
    'palette, so send every colour you want to keep: three or six hex digits, up to 8. `logo_url` ' +
    'and `favicon_url` are DOWNLOADED and re-hosted, not linked, so a private, redirecting or ' +
    'oversized address is refused rather than half-saved, and the answer carries the address we ' +
    'stored; `remove_logo` clears it. `display_font` and `body_font` go together and must be ' +
    'families Google Fonts actually serves — a name it will not serve renders as Inter with ' +
    'nothing said, so they are checked before anything is written. Setting `visual_style` LOCKS ' +
    'it: the nightly rebuild stops rewriting the brand’s visual brief until someone regenerates ' +
    'it from the browser. Sending any voice field switches the brand OFF automatic voice: from ' +
    'then on nobody rewrites it for you. The past posts the writer imitates are `voice_examples` on ' +
    '`set_brand_settings`, not here. To read the look it has NOW: query({ table: "brand_kit" }). ' +
    'Calls no model and spends nothing.',
  members: [UPDATE_BRAND_KIT, UPDATE_VOICE, SET_COLORS, SET_APPEARANCE]
} satisfies BrandFamily;

export const BRAND_FAMILIES: readonly BrandFamily[] = [UPDATE_BRAND_IDENTITY];

const MEMBER_TOOLS = new Set(BRAND_FAMILIES.flatMap((f) => f.members.map((m) => m.tool)));

/** Un membro non si registra piu' da solo: il suo tool e' la famiglia. La rotta REST resta. */
export function inAFamily(endpoint: BrandEndpoint): boolean {
  return MEMBER_TOOLS.has(endpoint.tool);
}

export function familyFields(family: BrandFamily): z.ZodRawShape {
  return family.members.reduce<z.ZodRawShape>(
    (shape, member) => ({ ...shape, ...member.input.partial().shape }),
    {}
  );
}

export function familyInput(family: BrandFamily): z.ZodObject<z.ZodRawShape> {
  return z.strictObject(familyFields(family));
}

/**
 * Le rotte da chiamare, nell'ordine dichiarato: solo quelle di cui il chiamante ha nominato almeno
 * un campo. Chiamarle tutte manderebbe un corpo vuoto a chi risponde `no_fields`, e la meta' di
 * una scrittura riuscita e' peggio di un rifiuto.
 */
export function familyCalls(
  family: BrandFamily,
  input: Record<string, unknown>
): { endpoint: ResourcelessEndpoint; body: Record<string, unknown> }[] {
  return family.members
    .map((endpoint) => ({
      endpoint,
      body: Object.fromEntries(
        Object.keys(endpoint.input.shape)
          .filter((field) => input[field] !== undefined)
          .map((field) => [field, input[field]])
      )
    }))
    .filter(({ body }) => Object.keys(body).length > 0);
}
