import { swallow } from '$lib/server/swallow';
import { graphicSize, parseGraphic, resolveImageRefs, type Graphic } from '$lib/design/blocks';
import { graphicTree, type El } from '$lib/design/graphic-tree';
import { inspectGraphicTree, type GraphicIssue } from '$lib/design/graphic-check';
import { compileGraphicTsx } from '$lib/design/compile-graphic-tsx';
import { graphicToHtml } from '$lib/design/html-from-blocks';
import { htmlToSatori } from '$lib/design/html-to-satori';
import {
  detectGraphicSourceKind,
  graphicHtmlMeta,
  parseGraphicCanvasSize,
  unwrapGraphicSource,
  type GraphicHtmlMeta,
  type GraphicSourceKind
} from '$lib/design/graphic-source';
import { isUrlSafe, svgToPng } from '$lib/server/brand-analysis';
import { DIGITAL_SOURCE_TYPE, markImage } from '$lib/server/content-credentials';

/**
 * Render a Graphic spec to PNG bytes, server-side, with no browser.
 *
 * The design lab renders stills through Remotion in the USER's browser, which is right for an
 * interactive editor and unusable here: the chat tool, the weekly producer and the autopilot cron
 * all run with no DOM. satori does the flexbox layout and emits SVG, @resvg/resvg-js (already a
 * dependency — see brand-analysis.ts) rasterises it. Both are plain node, so this path works from a
 * scheduled job at 3am exactly as it does from a chat message.
 *
 * Deterministic by construction: the letters are drawn from font outlines, so a graphic never comes
 * back with a misspelled wordmark the way an image model's does — which is the whole reason a
 * typographic post should not be going through an image model at all.
 *
 * Embedded photos (`image` blocks) are fetched here and inlined as data URIs before satori runs —
 * remote URLs at render time would be an SSRF footgun and a flaky dependency on the CDN.
 */

// satori needs real font binaries (ttf/otf/woff — NOT woff2, so the app's own static/fonts copies
// are no use). Google's CSS endpoint hands out ttf when asked with a UA that predates woff2; this is
// the same trick @vercel/og uses. Fetched once per instance and kept in module scope.
const LEGACY_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.30 (KHTML, like Gecko)';
const FALLBACK_FAMILY = 'Inter';

type LoadedFont = { name: string; data: ArrayBuffer; weight: number };

export type FontRoles = { display: string; body: string };

const fontCache = new Map<string, Promise<LoadedFont[] | null>>();

async function fetchFamily(family: string): Promise<LoadedFont[] | null> {
  const weights = [400, 500, 600, 700];
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights.join(';')}`;
  const css = await fetch(url, { headers: { 'user-agent': LEGACY_UA } });
  if (!css.ok) return null;
  const text = await css.text();

  // One @font-face per weight, in the order requested; take each block's ttf url.
  const urls = [...text.matchAll(/src:\s*url\((https:\/\/[^)]+\.ttf)\)/g)].map((m) => m[1]);
  if (urls.length === 0) return null;

  const files = await Promise.all(
    urls.slice(0, weights.length).map(async (u, i) => {
      const res = await fetch(u);
      if (!res.ok) return null;
      return { name: family, data: await res.arrayBuffer(), weight: weights[i] ?? 400 };
    })
  );
  const ok = files.filter((f): f is LoadedFont => !!f);
  return ok.length ? ok : null;
}

/**
 * Fonts for a family, falling back to Inter. A brand font that isn't on Google Fonts simply isn't
 * available to a server renderer — degrade to Inter rather than fail the post, and say which one
 * was used so the caller can tell the user.
 */
export async function loadGraphicFont(preferred?: string | null): Promise<{ fonts: LoadedFont[]; family: string }> {
  const wanted = preferred?.trim();
  for (const family of [wanted, FALLBACK_FAMILY].filter((f): f is string => !!f)) {
    if (!fontCache.has(family)) fontCache.set(family, fetchFamily(family).catch((error) => { swallow('load font family', error); return null; }));
    const fonts = await fontCache.get(family)!;
    if (fonts) return { fonts, family };
    fontCache.delete(family); // a transient network failure must not poison the cache forever
  }
  throw new Error('Could not load a font for the graphic renderer');
}

export type RenderedGraphic = {
  png: Buffer;
  /** Present when the caller asked for JPEG export. PNG is always produced (that's what we store). */
  jpeg?: Buffer;
  width: number;
  height: number;
  /** The display family actually drawn — differs from the brand's if it isn't on Google Fonts. */
  font: string;
  /** The body family actually drawn. */
  bodyFont: string;
  /**
   * Block spec when the graphic was composed as JSON; HTML meta `{ v:2, kind, aspect }` otherwise.
   * Store THIS plus `source` — a later edit has to start from what was rendered.
   */
  spec: Graphic | GraphicHtmlMeta;
  /** Editable HTML or React TSX — the real source of the image. Durable https srcs, not data URIs. */
  source: string;
  sourceKind: GraphicSourceKind;
  aspect: Graphic['aspect'];
  /**
   * Cosa non regge nel feed, letto sull'albero che è appena stato rasterizzato.
   *
   * Sta QUI e non nei chiamanti perché era il difetto: il gate esisteva ed era agganciato solo
   * alle due tool che patchano il sorgente, mentre le tre porte che compongono una grafica da
   * zero non lo chiamavano mai. Un innesto solo, nel punto in cui l'albero è già costruito, e
   * ogni chiamante — presente e futuro — decide da sé se rifiutare o solo avvisare.
   */
  issues: GraphicIssue[];
};

/** Fetch a remote/data image into a data URI satori can embed without further network I/O. */
async function toDataUri(src: string): Promise<string | null> {
  if (src.startsWith('data:image/svg')) {
    try {
      const b64 = src.replace(/^data:image\/svg\+xml;base64,/, '');
      const raw = src.includes(';base64,') ? Buffer.from(b64, 'base64') : Buffer.from(decodeURIComponent(src.split(',')[1] ?? ''), 'utf8');
      const png = await svgToPng(raw);
      return png ? `data:image/png;base64,${png.toString('base64')}` : null;
    } catch {
      return null;
    }
  }
  if (src.startsWith('data:image/')) return src;
  if (!/^https?:\/\//i.test(src) || !isUrlSafe(src)) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 8_000_000) return null;
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
    if (!mime.startsWith('image/')) return null;
    // Satori's <img> is unreliable with SVG — rasterise brand logos (often .svg) to PNG first.
    if (mime.includes('svg') || /\.svg(\?|#|$)/i.test(src)) {
      const png = await svgToPng(buf);
      return png ? `data:image/png;base64,${png.toString('base64')}` : null;
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Inline every `image` block src (and optional background) as a data URI; drop unloadable ones. */
async function inlineImageBlocks(graphic: Graphic): Promise<Graphic> {
  let background = graphic.background;
  if (background) {
    const data = await toDataUri(background.src);
    background = data ? { ...background, src: data } : undefined;
  }

  const blocks = await Promise.all(
    graphic.blocks.map(async (b) => {
      if (b.type !== 'image') return b;
      const data = await toDataUri(b.src);
      if (!data) return null;
      return { ...b, src: data };
    })
  );
  return {
    ...graphic,
    background,
    blocks: blocks.filter((b): b is NonNullable<typeof b> => !!b)
  };
}

export async function renderGraphic(
  input: Graphic | unknown,
  opts: {
    brandColors?: string[] | null;
    brandFont?: string | null;
    typography?: FontRoles;
    /** Catalog used to expand `ref:N` image srcs before fetch. */
    availableImages?: Array<{ url: string }> | null;
    format?: 'png' | 'jpeg';
    /** La sandbox è PER BRAND e il tempo macchina si addebita: senza questi, niente browser. */
    brandId?: string | null;
    userId?: string | null;
  } = {}
): Promise<RenderedGraphic> {
  if (typeof input === 'string' || isSourceBag(input)) {
    const source = typeof input === 'string' ? input : String((input as { source: unknown }).source);
    return renderGraphicSource(source, opts);
  }

  const durable = resolveImageRefs(parseGraphic(input), opts.availableImages);
  let graphic = await inlineImageBlocks(durable);
  if (!graphic.blocks.length) {
    throw new Error('Graphic has no renderable blocks after image resolution');
  }
  const { width, height } = graphicSize(graphic.aspect);

  const packed = await packFonts(opts);
  const [{ default: satori }, { Resvg }] = await Promise.all([
    import('satori'),
    import(/* @vite-ignore */ '@resvg/resvg-js')
  ]);

  const tree = graphicTree(graphic, {
    brandColors: opts.brandColors,
    fonts: { display: packed.family, body: packed.bodyFamily }
  });
  const svg = await satori(tree as never, {
    width,
    height,
    fonts: packed.satoriFonts
  });

  const png = Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
  const source = graphicToHtml(durable, {
    brandColors: opts.brandColors,
    fonts: { display: packed.family, body: packed.bodyFamily }
  });
  return {
    // Marked at the exit, on the bytes we hand out — see content-credentials.ts. The JPEG is
    // encoded from the UNMARKED png so the packet is written once, by us, not copied by sharp.
    png: await markImage(png, 'image/png', DIGITAL_SOURCE_TYPE.composite),
    jpeg:
      opts.format === 'jpeg'
        ? await markImage(await pngToJpeg(png), 'image/jpeg', DIGITAL_SOURCE_TYPE.composite)
        : undefined,
    width,
    height,
    font: packed.family,
    bodyFont: packed.bodyFamily,
    spec: durable,
    source,
    sourceKind: 'html',
    aspect: graphic.aspect,
    issues: inspect(tree as El, width, height, opts.brandColors)
  };
}

function isSourceBag(input: unknown): input is { source: string } {
  return !!input && typeof input === 'object' && typeof (input as { source?: unknown }).source === 'string';
}

async function packFonts(opts: {
  brandFont?: string | null;
  typography?: FontRoles;
}) {
  const wanted = opts.typography ?? { display: opts.brandFont ?? '', body: opts.brandFont ?? '' };
  const [displayLoad, bodyLoad] = await Promise.all([
    loadGraphicFont(wanted.display || null),
    wanted.body && wanted.body !== wanted.display
      ? loadGraphicFont(wanted.body)
      : Promise.resolve(null)
  ]);
  const family = displayLoad.family;
  const bodyFamily = bodyLoad?.family ?? family;
  const fonts = bodyLoad ? [...displayLoad.fonts, ...bodyLoad.fonts] : displayLoad.fonts;
  return {
    family,
    bodyFamily,
    satoriFonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight as never,
      style: 'normal' as const
    }))
  };
}

export async function pngToJpeg(png: Buffer, quality = 90): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/**
 * HTML o TSX → l'albero che satori riceve, con gli stili già risolti.
 *
 * Estratto da `renderGraphicSource` perché ha un secondo lettore: il gate delle grafiche
 * (`inspectGraphicTree`) deve guardare ESATTAMENTE l'albero che va in rasterizzazione. Un
 * controllo che si riparsasse il sorgente per conto suo boccerebbe pixel che non esistono.
 */
export async function sourceToSatoriTree(
  source: string,
  kind: GraphicSourceKind = detectGraphicSourceKind(source)
): Promise<{ tree: El; width: number; height: number }> {
  if (kind === 'tsx') {
    const compiled = compileGraphicTsx(source);
    const { renderToStaticMarkup } = await import('react-dom/server');
    const markup = renderToStaticMarkup(compiled.element);
    const wrapped =
      /data-graphic|class=["'][^"']*canvas/.test(markup)
        ? markup
        : `<div class="canvas" data-graphic data-width="${compiled.width}" data-height="${compiled.height}" style="width:${compiled.width}px;height:${compiled.height}px;display:flex;flex-direction:column">${markup}</div>`;
    return { tree: htmlToSatori(wrapped).tree, width: compiled.width, height: compiled.height };
  }
  const parsed = htmlToSatori(source);
  return { tree: parsed.tree, width: parsed.width, height: parsed.height };
}

/**
 * Rasterise HTML or React TSX source. Image URLs are inlined as data URIs (same SSRF gate as
 * block graphics). The returned `source` keeps durable https URLs.
 */
export async function renderGraphicSource(
  raw: string,
  opts: {
    brandColors?: string[] | null;
    brandFont?: string | null;
    typography?: FontRoles;
    availableImages?: Array<{ url: string }> | null;
    format?: 'png' | 'jpeg';
    /** La sandbox è PER BRAND e il tempo macchina si addebita: senza questi, niente browser. */
    brandId?: string | null;
    userId?: string | null;
  } = {}
): Promise<RenderedGraphic> {
  const durable = resolveSourceImageRefs(unwrapGraphicSource(raw), opts.availableImages);
  if (!durable.trim()) throw new Error('Empty graphic source');
  const kind = detectGraphicSourceKind(durable);
  const inlined = await inlineSourceImages(durable);

  const packed = await packFonts(opts);
  const [{ default: satori }, { Resvg }] = await Promise.all([
    import('satori'),
    import(/* @vite-ignore */ '@resvg/resvg-js')
  ]);

  const { tree, width, height } = await sourceToSatoriTree(inlined, kind);

  // Chromium PRIMA, quando l'operatore l'ha acceso: satori e' un sottoinsieme stretto di flexbox e
  // il compositore chiede al modello «full HTML with <style>», quindi `grid`, `clamp()` e
  // `text-wrap` — che un browser impagina — li' traboccano. Torna `undefined` se la via non c'e',
  // e si scende su satori: un renderer assente non deve diventare un post senza immagine.
  const { renderGraphicWithChromium } = await import('$lib/server/design-render-chromium');
  const viaChromium = await renderGraphicWithChromium(inlined, {
    width,
    height,
    brandId: opts.brandId,
    userId: opts.userId
  });

  // L'albero serve comunque: e' quello che il gate ispeziona. L'SVG no, quando Chromium ha reso.
  const svg = viaChromium
    ? ''
    : await satori(tree as never, { width, height, fonts: packed.satoriFonts });
  const png =
    viaChromium?.png ?? Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
  const canvas = parseGraphicCanvasSize(durable);
  const spec = graphicHtmlMeta(canvas.aspect, kind);

  return {
    // Marked at the exit, on the bytes we hand out — see content-credentials.ts. The JPEG is
    // encoded from the UNMARKED png so the packet is written once, by us, not copied by sharp.
    png: await markImage(png, 'image/png', DIGITAL_SOURCE_TYPE.composite),
    jpeg:
      opts.format === 'jpeg'
        ? await markImage(await pngToJpeg(png), 'image/jpeg', DIGITAL_SOURCE_TYPE.composite)
        : undefined,
    width,
    height,
    font: packed.family,
    bodyFont: packed.bodyFamily,
    spec,
    source: durable,
    sourceKind: kind,
    aspect: spec.aspect,
    issues: inspect(tree, width, height, opts.brandColors)
  };
}

/**
 * Il gate non deve MAI far fallire un render. Legge l'albero e riporta; se inciampa (un albero
 * inatteso, una forma che non conosce) tace, perché una grafica che esiste vale più di un giudizio
 * su una grafica che non esisterebbe.
 */
function inspect(tree: El, width: number, height: number, brandColors?: string[] | null): GraphicIssue[] {
  try {
    return inspectGraphicTree(tree, { width, height, brandColors });
  } catch (e) {
    console.warn('[design] graphic check skipped:', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Expand `ref:N` tokens against the catalog the composer saw. Leaves https/data URLs alone. */
export function resolveSourceImageRefs(
  source: string,
  available: Array<{ url: string }> | null | undefined
): string {
  if (!available?.length) return source;
  let out = source;
  for (let i = 0; i < available.length; i++) {
    const url = available[i]?.url;
    if (!url) continue;
    out = out.split(`ref:${i}`).join(url);
  }
  return out;
}

async function inlineSourceImages(source: string): Promise<string> {
  const found = [...source.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
  const unique = [...new Set(found)];
  let out = source;
  for (const url of unique) {
    if (!isUrlSafe(url)) continue;
    const data = await toDataUri(url);
    if (data) out = out.split(url).join(data);
  }
  return out;
}
