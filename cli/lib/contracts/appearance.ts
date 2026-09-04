import { z } from 'zod';
import type { BrandEndpoint } from './index';

/**
 * Il look del brand vive in `brand_kit`, e fino a qui nessun agente esterno poteva toccarlo: il
 * logo si caricava solo da un form, i font che le grafiche usano davvero (`graphic_style`) solo
 * dalla chat in-app. Un endpoint solo, una tabella sola.
 *
 * Il logo NON e' una stringa che salviamo: e' una URL che scarichiamo dietro la guardia SSRF e di
 * cui teniamo i byte nel nostro bucket. Salvare la stringa significherebbe mettere in ogni grafica
 * del brand un'immagine che qualcun altro puo' cambiare dopo, o togliere.
 */

const GraphicStyle = z.object({
  display_font: z.string().nullable(),
  body_font: z.string().nullable(),
  instructions: z.string().nullable()
});

const Appearance = z.object({
  logo_url: z.string().nullable(),
  favicon_url: z.string().nullable(),
  colors: z.array(z.string()),
  graphic_style: GraphicStyle.nullable(),
  visual_style: z.string().nullable(),
  visual_style_locked: z.boolean()
});

export const GET_APPEARANCE = {
  tool: 'get_appearance',
  title: 'How the brand looks',
  description:
    'The brand’s look as every render sees it: logo, favicon, colour palette, the two Google Fonts ' +
    'graphics are composed with, and the visual brief every image follows. Read it before ' +
    'set_appearance — a font this answer does not carry is a font Google Fonts will not serve, and ' +
    'the graphics would silently come out in Inter instead.',
  method: 'GET',
  pathUnderBrand: '/studio/appearance',
  input: z.object({}).strict(),
  output: z.object({ brand: z.string(), appearance: Appearance }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SET_APPEARANCE = {
  tool: 'set_appearance',
  title: 'Change how the brand looks',
  description:
    'Change the brand’s logo, favicon, graphic fonts or visual brief. Only the fields you send ' +
    'change. `logo_url` and `favicon_url` are DOWNLOADED and kept in our storage, not linked: the ' +
    'answer carries the address we stored, which is the one every graphic will use — a private, ' +
    'redirecting or oversized address is refused rather than half-saved. `remove_logo` clears it. ' +
    '`display_font` and `body_font` must be families Google Fonts actually serves and are checked ' +
    'before saving, because a name it will not serve renders as Inter with nothing said. Setting ' +
    '`visual_style` LOCKS it: the nightly rebuild stops rewriting the brand’s visual brief until ' +
    'someone regenerates it from the browser. Calls no model and spends no credits.',
  method: 'PUT',
  pathUnderBrand: '/studio/appearance',
  input: z
    .object({
      logo_url: z.string().url().optional().describe('Public http(s) image address; downloaded and re-hosted, max 4MB'),
      favicon_url: z.string().url().optional().describe('Same rules as logo_url'),
      remove_logo: z.boolean().optional().describe('Clear the logo. Cannot be combined with logo_url'),
      display_font: z.string().min(1).max(60).optional().describe('Google Fonts family for headings, e.g. "Playfair Display"'),
      body_font: z.string().min(1).max(60).optional().describe('Google Fonts family for body text'),
      graphic_instructions: z.string().max(1200).optional().describe('Art direction the composer follows'),
      visual_style: z
        .string()
        .min(20)
        .max(2000)
        .optional()
        .describe('The visual brief every image render follows. Setting it locks it against the nightly rebuild')
    })
    .strict(),
  output: z.object({ ok: z.literal(true), appearance: Appearance }),
  failures: [
    { error: 'no_fields', status: 400 },
    { error: 'logo_conflict', status: 400 },
    { error: 'font_not_available', status: 400 },
    { error: 'image_rejected', status: 400 },
    { error: 'font_pair_incomplete', status: 400 },
    { error: 'update_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;
