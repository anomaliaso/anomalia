/**
 * LE REGOLE DI MESTIERE DELLE GRAFICHE, NEL PROMPT CHE LE COMPONE DAVVERO.
 *
 * Il buco che questo file chiude: le uniche regole grafiche MISURATE del prodotto vivevano in due
 * skill (`graphic-feed-legibility`, `graphic-palette-discipline`) che arrivano all'agente di chat
 * via `brand-memory`, mentre `design_graphic` fa una SECONDA chiamata separata al modello che
 * scrive l'HTML — e quella non ne sapeva niente. Delle 29 righe del suo prompt, 20 erano il
 * contratto tecnico di satori e 6 erano consigli senza un numero dentro.
 *
 * Due regole vere erano finite anche nel ramo morto: il compositore legacy a blocchi conteneva
 * l'unica regola tipografica del repo (dove spezzare una headline, con esempio) e l'unico numero
 * di contrasto su foto (il velo 0.4–0.55). Sono recuperate qui.
 *
 * SEMPRE IN FRAZIONI DI TELA, MAI IN PIXEL: è la disciplina che il gate (`graphic-check.ts`) e i
 * preset (`presets/shared.ts`) hanno già, ed è l'unico modo perché la stessa regola valga su
 * 1080×1350 e su 1080×1920.
 *
 * Client-safe di proposito (`$lib/design/`, non `$lib/server/`), come `MOTION_CRAFT_SPECS`: la UI
 * deve poter mostrare le stesse regole che il modello riceve, senza tirarsi dietro il server.
 *
 * OGNI REGOLA CON UN NUMERO DICHIARA SE È CONTROLLATA. Una regola nel prompt che nessuno verifica
 * è una regola che il modello ignora — è già successo col ricettario delle transizioni del motion.
 */
import {
	MAX_LINE_CHARS,
	MIN_HIERARCHY_STEP,
	MIN_SAFE_PADDING_RATIO,
	MIN_TEXT_RATIO
} from './graphic-check';

/** La tela di riferimento su cui sono calcolati i px d'esempio qui sotto. */
const W = 1080;
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
const px = (r: number) => Math.round(W * r);

export const GRAPHIC_CRAFT_SPECS = `CRAFT — the rules with numbers (always on, do not wait to be asked):

SIZES ARE FRACTIONS OF CANVAS WIDTH, NEVER PIXELS YOU LIKED
- You compose at ${W}px and the feed shows about 390px. Every size is a fraction of the canvas width: multiply and round. The proportions of the starter canvas this product ships: page padding 7% (${px(0.07)}px), kicker/label 2.5% (${px(0.025)}px), body 3% (${px(0.03)}px), headline 8.4% (${px(0.084)}px). Start from those and move deliberately.
- NOTHING below ${pct(MIN_TEXT_RATIO)} of canvas width (${px(MIN_TEXT_RATIO)}px on ${W}). A ${Math.round(px(MIN_TEXT_RATIO) * 0.75)}px caption is about 6 points on a phone: present in the source, invisible in the product. ENFORCED — the write is REFUSED.
- The headline is at least ${MIN_HIERARCHY_STEP}× the next size on the canvas. Three sizes within a few px of each other is not a composition, it is a paragraph in three colours. CHECKED — comes back as a warning.
- Canvas padding at least ${pct(MIN_SAFE_PADDING_RATIO)} of width (${px(MIN_SAFE_PADDING_RATIO)}px on ${W}); the starter canvas uses 7%. CHECKED — warning.
- Nothing sits outside the canvas box. Absolutely-positioned type placed past the edge is clipped away and simply never appears. ENFORCED — the write is REFUSED.

WORDS
- Fewer words than feel natural. This is read mid-scroll, not studied. A headline is one thought, ideally under ten words.
- One idea per graphic. If the brief carries two, pick the sharper one.
- A body line past ${MAX_LINE_CHARS} characters wraps into a paragraph, and nobody reads a paragraph in a feed. Fewer words at a bigger size beats more words at a smaller one. CHECKED — warning.
- Break a headline with a newline only where the break carries meaning ("Nove posti.\\nTu ne presidi uno."), never to even out line lengths.
- Open with a kicker only when it frames something the headline can then land on. Otherwise skip it.
- Write in the brand's language.

COLOUR
- The colours are the brand kit's, not your taste. At most THREE non-neutral colours on a canvas; everything else is the neutral ramp (background, ink, hairline). A fourth colour is never a decision, it is an accumulation. CHECKED — warning.
- ONE accent, used ONCE, on the one thing the eye must find: the number, the badge, the rule under the headline. Two accents at equal weight cancel each other out.
- No tint you invented. satori has no colour-mix: a lighter brand colour is the same hex at a lower opacity, or a neutral. A hex that is "nearly" the brand colour reads as a rendering bug. CHECKED — warning (off_palette).
- Contrast: 4.5:1 for anything under 5% of width, 3:1 above it. Grey-on-grey (#86868b on #f9f9f9 is 3.4:1) only survives on a LABEL, never on body copy. CHECKED — warning.

TYPE OVER A PHOTO
- A full-bleed photo behind type ALWAYS carries a veil: a dimming layer at 0.4–0.55 over the image, or the photo darkened to ≤ 0.35 over a solid ground. Prefer a dark canvas under it.
- A plate under a line is a solid band at ≥ 0.65 alpha. A 0.2 wash is decoration, not a scrim. If you cannot say which pixels sit behind a line, that line has no scrim.
- Contrast is NOT statically checked over a photo — no static check sees pixels. That makes the veil your responsibility, not the gate's.

THE BRAND MARK
- When AVAILABLE IMAGES lists a "brand logo", place THAT FILE as an <img> (size sm/md, fit contain). It is the official mark from the brand kit. Never fake it with a Lucide/Simple Icons icon, a coloured shape, or the brand name typed as a kicker. CHECKED — warning when the logo is offered and unused.
- Always carry the brand name somewhere on the canvas.`;
