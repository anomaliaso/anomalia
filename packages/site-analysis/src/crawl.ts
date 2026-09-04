/**
 * Leggere un sito, non interpretarlo.
 *
 * Qui c'è tutta la macchina di raccolta — risoluzione dell'indirizzo vero, guardia SSRF, fallback
 * su browser reale, riconoscimento delle pagine che una CDN mette al posto del sito, scoperta
 * delle pagine interne, cataloghi Shopify e WooCommerce, e l'estrazione di metadati, loghi,
 * colori, font, social e testo visibile.
 *
 * Quello che NON c'è è la lettura: nessuna chiamata a un modello, nessuno schema di profilo.
 * È deliberato. La raccolta è la stessa per chiunque; le domande da fare al materiale raccolto
 * cambiano da prodotto a prodotto — un autopilota social vuole colori e font, un prodotto di lead
 * vuole sapere cosa NON fai e con che parole ne parlano i tuoi clienti. Due lettori, un raccoglitore.
 */
import { lookup } from 'node:dns/promises';

/** Il nome ridotto a token confrontabili: serve solo ad abbinare le foto del team ai nomi. */
function slugify(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const MAX_INTERNAL_PAGES = 6;
export const MAX_TEXT_LENGTH = 50_000;
export const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB — limite per evitare OOM su siti enormi
export const MIN_VISIBLE_TEXT_LENGTH = 100; // Sotto questa soglia, probabile SPA client-rendered

// Pagine interne rilevanti per brand analysis — ordinate per priorità.
// Coprono ecommerce + archetipi non-ecommerce (portfolio, SaaS, local service).
const RELEVANT_PATH_PATTERNS = [
    /^\/(about|chi-siamo|a-propos)/i,
    /^\/(pricing|prezzi|plans?)/i,
    /^\/(products?|services?|servizi|prodotti)/i,
    /^\/(team|company|azienda)/i,
    /^\/(features?|funzionalita)/i,
    // Portfolio / freelancer
    /^\/(work|portfolio|projects?|progetti|lavori)/i,
    /^\/(case-stud(y|ies)|case-histor(y|ies)|casi[-_]?studio)/i,
    // SaaS / tech
    /^\/(use[-_]?cases?|solutions?|soluzioni)/i,
    /^\/(customers?|clients?|clienti)/i,
    // Local service
    /^\/(menu|booking|prenota|reservations?|prenotazioni)/i,
];

// Pagine da escludere — blog, docs, legal, ecc.
const EXCLUDED_PATH_PATTERNS = [
    /^\/(blog|news|articles?)/i,
    /^\/(docs?|documentation|api)/i,
    /^\/(legal|privacy|terms|cookie)/i,
    /^\/(login|signup|register|auth)/i,
    /^\/(support|help|faq|contact)/i,
];

// --- Types ---

export interface HTMLMetadata {
    title: string;
    description: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    faviconUrl?: string;
    cssColors: string[];
    // Nuovi campi per detection arricchita
    themeColor?: string;
    cssCustomProperties: Record<string, string>;
    logos: Array<{ url: string; type: string }>;
    fonts: Array<{ name: string; source: string }>;
    manifestUrl?: string;
}

// The site's business archetype — drives how offerings, spokesperson and content pillars are
// interpreted. 'ecommerce' is detected from platform/cart signals; the rest from content.
export type SiteType = 'ecommerce' | 'saas' | 'portfolio' | 'local_service' | 'creator' | 'generic';


export type ProgressCallback = (step: string, message: string) => void;

// --- HTML Parsing ---

/**
 * Estrae metadata strutturati dall'HTML: title, meta tags, OG tags, favicon, colori CSS.
 * Colori estratti SOLO da <style> blocks e attributi style="" — non da altri attributi HTML.
 */
export function parseHTMLMetadata(html: string, baseUrl: string): HTMLMetadata {
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';

    // [^>]*? permette attributi intermedi (es. data-rh="true") tra name e content
    const descMatch = html.match(/<meta\s+[^>]*?name=["']description["'][^>]*?content=["']([^"']*)["']/i)
        || html.match(/<meta\s+[^>]*?content=["']([^"']*)["'][^>]*?name=["']description["']/i);
    const description = descMatch?.[1]?.trim() || '';

    const ogTitle = extractMetaProperty(html, 'og:title');
    const ogDescription = extractMetaProperty(html, 'og:description');
    const ogImage = extractMetaProperty(html, 'og:image');
    const faviconUrl = extractFavicon(html, baseUrl);
    const cssColors = extractCSSColors(html);

    // Nuove estrazioni per detection arricchita
    const themeColor = extractThemeColor(html);
    const cssCustomProperties = extractCSSCustomProperties(html);
    const logos = extractLogos(html, baseUrl);
    const fonts = extractFonts(html);
    const manifestUrl = extractManifestUrl(html, baseUrl);

    return { title, description, ogTitle, ogDescription, ogImage, faviconUrl, cssColors, themeColor, cssCustomProperties, logos, fonts, manifestUrl };
}

function extractMetaProperty(html: string, property: string): string | undefined {
    // [^>]*? permette attributi intermedi (es. data-react-helmet="true") tra property e content
    const re = new RegExp(`<meta\\s+[^>]*?property=["']${property}["'][^>]*?content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta\\s+[^>]*?content=["']([^"']*)["'][^>]*?property=["']${property}["']`, 'i');
    return (html.match(re)?.[1] || html.match(re2)?.[1])?.trim();
}

/** Estrae il favicon URL. Priorità: typed icon > generic icon > apple-touch-icon */
function extractFavicon(html: string, baseUrl: string): string | undefined {
    // 1. Link con type esplicito (PNG, SVG)
    const typedMatch = html.match(/<link[^>]+rel=["']icon["'][^>]+type=["']image\/(png|svg)[^"']*["'][^>]+href=["']([^"']*)["']/i)
        || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']icon["'][^>]+type=["']image\/(png|svg)/i)
        || html.match(/<link[^>]+type=["']image\/(png|svg)[^"']*["'][^>]+rel=["']icon["'][^>]+href=["']([^"']*)["']/i);

    let href = typedMatch?.[2] || typedMatch?.[1];

    // 2. Qualsiasi rel="icon" o rel="shortcut icon"
    if (!href) {
        const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']*)["']/i)
            || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["'](?:shortcut )?icon["']/i);
        href = iconMatch?.[1];
    }

    // 3. Fallback: apple-touch-icon
    if (!href) {
        const appleMatch = html.match(/<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']*)["']/i)
            || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']apple-touch-icon/i);
        href = appleMatch?.[1];
    }

    if (!href) return undefined;

    try {
        return new URL(href, baseUrl).href;
    } catch {
        return undefined;
    }
}

/**
 * Raccoglie tutto il CSS dai <style> blocks dell'HTML.
 * Usata da extractCSSColors, extractCSSCustomProperties, e extractFonts
 * per evitare di parsare il DOM tre volte.
 */
function collectStyleCSS(html: string): string {
    let css = '';
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += m[1] + ' ';
    return css;
}

/**
 * Estrae colori SOLO da <style> blocks e attributi style="".
 * Scoped per evitare false positive da ID, anchor, e altri attributi HTML.
 */
function extractCSSColors(html: string): string[] {
    const colors = new Set<string>();

    // CSS dai <style> blocks + attributi style="" inline
    let cssText = collectStyleCSS(html);
    const inlineStyles = html.matchAll(/style=["']([^"']*)["']/gi);
    for (const m of inlineStyles) cssText += m[1] + ' ';

    // Hex colors (#RGB, #RRGGBB) — solo dal CSS raccolto
    const hexMatches = cssText.matchAll(/#([0-9A-Fa-f]{3,8})\b/g);
    for (const m of hexMatches) {
        const hex = m[1];
        if (hex.length === 3 || hex.length === 6) {
            const full = hex.length === 3
                ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
                : hex;
            colors.add(`#${full.toUpperCase()}`);
        }
    }

    // rgb(R, G, B) e rgba(R, G, B, A) — converti in hex
    const rgbMatches = cssText.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
    for (const m of rgbMatches) {
        const r = parseInt(m[1]);
        const g = parseInt(m[2]);
        const b = parseInt(m[3]);
        if (r <= 255 && g <= 255 && b <= 255) {
            colors.add(
                `#${r.toString(16).padStart(2, '0').toUpperCase()}` +
                `${g.toString(16).padStart(2, '0').toUpperCase()}` +
                `${b.toString(16).padStart(2, '0').toUpperCase()}`
            );
        }
    }

    return Array.from(colors);
}

// --- Font generici da escludere (non sono brand fonts) ---
const GENERIC_FONT_FAMILIES = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
    'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
    'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset',
    'arial', 'helvetica', 'times new roman', 'times', 'courier new', 'courier',
    'georgia', 'verdana', 'tahoma', 'trebuchet ms', 'impact',
]);

/**
 * Estrae il meta tag theme-color — segnale forte del colore brand primario.
 * Prende il primo match (light mode ha la precedenza se ci sono varianti).
 */
export function extractThemeColor(html: string): string | undefined {
    const re = /<meta\s+[^>]*?name=["']theme-color["'][^>]*?content=["']([^"']*)["']/i;
    const re2 = /<meta\s+[^>]*?content=["']([^"']*)["'][^>]*?name=["']theme-color["']/i;
    return (html.match(re)?.[1] || html.match(re2)?.[1])?.trim() || undefined;
}

/**
 * Estrae CSS custom properties color-like da tutti i <style> blocks.
 * Solo valori che sembrano colori (hex, rgb, rgba, hsl, hsla).
 * Include vars da :root, body, e selettori tema — tutti segnali utili per i brand colors.
 */
export function extractCSSCustomProperties(html: string): Record<string, string> {
    const result: Record<string, string> = {};
    const cssText = collectStyleCSS(html);

    // Trova variabili CSS con valori color-like
    const varPattern = /(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))\s*[;}/]/g;
    for (const m of cssText.matchAll(varPattern)) {
        const name = m[1];
        let value = m[2].trim();

        // Normalizza rgb/rgba a hex per consistenza
        const rgbMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch) {
            const r = parseInt(rgbMatch[1]);
            const g = parseInt(rgbMatch[2]);
            const b = parseInt(rgbMatch[3]);
            if (r <= 255 && g <= 255 && b <= 255) {
                value = `#${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${b.toString(16).padStart(2, '0').toUpperCase()}`;
            }
        }

        result[name] = value;
    }

    return result;
}

/**
 * Rileva loghi da multiple fonti HTML — Schema.org JSON-LD, img con class "logo", og:image.
 * Priorità: JSON-LD > img.logo > og:image (come fallback).
 * Dedup per URL per evitare duplicati quando lo stesso logo appare in più posti.
 */
export function extractLogos(html: string, baseUrl: string): Array<{ url: string; type: string }> {
    const logos: Array<{ url: string; type: string }> = [];
    const seenUrls = new Set<string>();

    const addLogo = (url: string, type: string) => {
        try {
            const resolved = new URL(url, baseUrl).href;
            if (!seenUrls.has(resolved)) {
                seenUrls.add(resolved);
                logos.push({ url: resolved, type });
            }
        } catch { /* URL invalido — skip */ }
    };

    // 1. Schema.org JSON-LD — la source più strutturata e affidabile
    const jsonLdBlocks = html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const block of jsonLdBlocks) {
        try {
            const data = JSON.parse(block[1]);
            // Logo può essere stringa, oggetto con url, o array di entrambi
            const parseLogo = (logo: unknown) => {
                if (typeof logo === 'string') addLogo(logo, 'schema-org');
                else if (logo && typeof logo === 'object' && 'url' in logo) addLogo((logo as { url: string }).url, 'schema-org');
            };
            const logoField = data?.logo;
            if (Array.isArray(logoField)) {
                for (const item of logoField) parseLogo(item);
            } else {
                parseLogo(logoField);
            }
            // Supporto @graph per siti con multiple entità
            if (Array.isArray(data?.['@graph'])) {
                for (const item of data['@graph']) {
                    if (typeof item?.logo === 'string') addLogo(item.logo, 'schema-org');
                    else if (item?.logo?.url) addLogo(item.logo.url, 'schema-org');
                }
            }
        } catch { /* JSON malformato — skip senza crash */ }
    }

    // 2. Immagini con class/id contenente "logo" o "brand"
    // Supporta sia src che data-src (lazy-loaded images — pattern comune su siti moderni)
    const imgLogoPattern = /<img[^>]+(?:class|id)=["'][^"']*\b(?:logo|brand)\b[^"']*["'][^>]*(?:data-)?src=["']([^"']*)["']/gi;
    const imgLogoPattern2 = /<img[^>]+(?:data-)?src=["']([^"']*)["'][^>]*(?:class|id)=["'][^"']*\b(?:logo|brand)\b[^"']*["']/gi;
    for (const m of html.matchAll(imgLogoPattern)) addLogo(m[1], 'html-img');
    for (const m of html.matchAll(imgLogoPattern2)) addLogo(m[1], 'html-img');

    // 2b. Immagini il cui FILENAME contiene logo/brand/wordmark (es. /assets/logo-mellon.png) —
    // molti loghi non hanno class/id ma sono nominati così. Esclude favicon/sprite/icone.
    const imgSrcLogoPattern = /<img[^>]+(?:data-)?src=["']([^"']*\b(?:logo|brand|wordmark)\b[^"']*)["']/gi;
    for (const m of html.matchAll(imgSrcLogoPattern)) {
        if (!/(favicon|sprite|icon)/i.test(m[1])) addLogo(m[1], 'html-img-src');
    }

    // 3. og:image come fallback — è uno screenshot/banner, NON un logo: lo teniamo per ultimo e i
    // consumer che vogliono il vero logo (es. la generazione) devono scartare type 'og-image'.
    const ogImage = extractMetaProperty(html, 'og:image');
    if (ogImage) addLogo(ogImage, 'og-image');

    return logos;
}

/**
 * Rileva font dal sito — Google Fonts link e CSS font-family declarations.
 * Google Fonts ha priorità come source perché è una identificazione certa.
 * Esclude font generici (serif, sans-serif, etc.) e font di sistema.
 */
export function extractFonts(html: string): Array<{ name: string; source: string }> {
    const fontMap = new Map<string, string>(); // name → source (Google Fonts vince su CSS)

    // Helper per parsare parametri family= da un URL Google Fonts
    const parseGoogleFontsUrl = (params: string) => {
        for (const fm of params.matchAll(/family=([^&:]+)/g)) {
            const name = decodeURIComponent(fm[1]).replace(/\+/g, ' ').trim();
            if (name && !GENERIC_FONT_FAMILIES.has(name.toLowerCase())) {
                fontMap.set(name, 'google-fonts');
            }
        }
    };

    // 1a. Google Fonts da <link> tags
    for (const m of html.matchAll(/<link[^>]+href=["']https?:\/\/fonts\.googleapis\.com\/css2?\?([^"']*)["']/gi)) {
        parseGoogleFontsUrl(m[1]);
    }

    // 1b. Google Fonts da @import nei <style> blocks (pattern alternativo usato da molti siti)
    const cssText = collectStyleCSS(html);
    for (const m of cssText.matchAll(/@import\s+url\(\s*['"]?https?:\/\/fonts\.googleapis\.com\/css2?\?([^'")]+)['"]?\s*\)/gi)) {
        parseGoogleFontsUrl(m[1]);
    }

    const fontFamilyPattern = /font-family\s*:\s*([^;}{]+)/gi;
    for (const m of cssText.matchAll(fontFamilyPattern)) {
        const families = m[1].split(',').map(f => f.trim().replace(/^["']|["']$/g, ''));
        for (const family of families) {
            if (family && !GENERIC_FONT_FAMILIES.has(family.toLowerCase()) && !fontMap.has(family)) {
                fontMap.set(family, 'css');
                break; // Solo il primo font non-generico per dichiarazione
            }
        }
    }

    return Array.from(fontMap.entries()).map(([name, source]) => ({ name, source }));
}

/**
 * Estrae l'URL del manifest.json dalla pagina — usato per fetch async delle icone.
 */
function extractManifestUrl(html: string, baseUrl: string): string | undefined {
    const match = html.match(/<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']*)["']/i)
        || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']manifest["']/i);
    if (!match?.[1]) return undefined;
    try {
        return new URL(match[1], baseUrl).href;
    } catch {
        return undefined;
    }
}

// --- Async enrichment ---

/**
 * Fetch manifest.json e estrae le icone — spesso la source con le icone più grandi (512x512).
 * SSRF-safe tramite fetchPage. Preferisce l'icona con risoluzione maggiore.
 */
export async function fetchManifestIcons(manifestUrl: string): Promise<Array<{ url: string; type: string }>> {
    try {
        const text = await fetchPage(manifestUrl);
        if (!text) return [];

        const manifest = JSON.parse(text);
        if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) return [];

        // Ordina per dimensione decrescente — l'icona più grande è il miglior candidato
        // "any" è un valore valido per sizes (SVG) — trattato come dimensione infinita
        const sorted = [...manifest.icons].sort((a: { sizes?: string }, b: { sizes?: string }) => {
            const parseSize = (s?: string) => s === 'any' ? Infinity : (parseInt(s?.split('x')[0] || '0') || 0);
            return parseSize(b.sizes) - parseSize(a.sizes);
        });

        return sorted
            .filter((icon: { src?: string }) => icon.src)
            .map((icon: { src: string }) => {
                try {
                    // Risolvi src relativo al manifest URL (non alla pagina)
                    return { url: new URL(icon.src, manifestUrl).href, type: 'manifest' as const };
                } catch { return null; }
            })
            .filter(Boolean) as Array<{ url: string; type: string }>;
    } catch {
        return [];
    }
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — limite per immagini logo (generose per SVG/PNG hi-res)

/**
 * Estrae colori dominanti da un'immagine usando node-vibrant.
 * SSRF-safe: valida l'URL, rifiuta redirect (potrebbero puntare a IP privati).
 * Size-limited: rifiuta immagini > 5MB per prevenire OOM.
 * Graceful degradation: se vibrant non è disponibile o fallisce, restituisce [].
 */
export async function extractColorsFromImage(imageUrl: string): Promise<string[]> {
    if (!(await isUrlSafeToFetch(imageUrl))) return [];

    try {
        const response = await fetch(imageUrl, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DalNullaBot/1.0)' },
            // Rifiuta redirect per prevenire SSRF via redirect a IP privati
            redirect: 'error',
        });
        if (!response.ok) return [];

        // Protezione OOM: rifiuta immagini troppo grandi
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > MAX_IMAGE_BYTES) return [];

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_IMAGE_BYTES) return [];

        // Import dinamico per graceful degradation se node-vibrant non è installato.
        // Specifier via variabile (string) così TS non lo risolve a build-time: è opzionale.
        const mod = 'node-vibrant';
        const { Vibrant } = await import(/* @vite-ignore */ mod);
        const palette = await Vibrant.from(buffer).getPalette();

        const colors: string[] = [];
        // Ordine di rilevanza per brand identity: Vibrant > DarkVibrant > Muted > LightVibrant > DarkMuted > LightMuted
        for (const swatch of [palette.Vibrant, palette.DarkVibrant, palette.Muted, palette.LightVibrant, palette.DarkMuted, palette.LightMuted]) {
            if (swatch) colors.push(swatch.hex.toUpperCase());
        }
        return colors;
    } catch {
        // node-vibrant non installato, fetch fallito, o immagine non valida
        return [];
    }
}

/**
 * Estrae il testo visibile dall'HTML, rimuovendo script, style e tag.
 */
export function extractVisibleText(html: string, maxLength: number = MAX_TEXT_LENGTH): string {
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text.slice(0, maxLength);
}

/**
 * Scopre pagine interne rilevanti (about, pricing, products) dall'HTML.
 */
export function discoverInternalPages(html: string, baseUrl: string): string[] {
    const seen = new Set<string>();
    const results: string[] = [];
    const hrefMatches = html.matchAll(/<a[^>]+href=["']([^"'#]*)["']/gi);
    const baseOrigin = new URL(baseUrl).origin;

    for (const m of hrefMatches) {
        let href = m[1].trim();
        if (!href || href === '/') continue;

        let fullUrl: URL;
        try { fullUrl = new URL(href, baseUrl); } catch { continue; }

        // Escludi link esterni
        if (fullUrl.origin !== baseOrigin) continue;

        const pathname = fullUrl.pathname;
        // Strip a leading locale segment (/en, /it, /zh, /en-us, …) before matching, so i18n sites
        // like /en/about or /it/use-cases are still recognised. The ORIGINAL url is what we fetch.
        const matchPath = pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, '') || pathname;

        // Escludi pagine non rilevanti (blog, docs, legal, ecc.)
        if (EXCLUDED_PATH_PATTERNS.some(p => p.test(matchPath))) continue;

        // Includi solo pagine rilevanti per brand analysis
        if (!RELEVANT_PATH_PATTERNS.some(p => p.test(matchPath))) continue;

        const normalized = `${fullUrl.origin}${pathname}`;
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        results.push(normalized);
        if (results.length >= MAX_INTERNAL_PAGES) break;
    }

    return results;
}

// Announcement/news sections — where releases & "what's new" live. These are DELIBERATELY excluded
// from brand-page discovery above; this is a SEPARATE, additive discovery that feeds only
// profile.announcements, never the brand analysis text/images/team.
const ANNOUNCEMENT_PATH_PATTERNS = [
    /^\/(blog|news|press|updates?|changelog|change-log|releases?|release-notes?|whats?-?new|roadmap|announcements?|novita|aggiornamenti)/i,
];

/**
 * Discover the site's announcement/news/changelog section pages (locale-aware), preferring index
 * pages (fewest path segments) over individual articles. Returns up to 3 URLs. Independent of
 * discoverInternalPages — adding these never changes brand-page or team discovery.
 */
export function discoverAnnouncementPages(html: string, baseUrl: string): string[] {
    let baseOrigin: string;
    try { baseOrigin = new URL(baseUrl).origin; } catch { return []; }
    // Group by SECTION (the first path segment, e.g. "blog", "changelog") and keep the shortest URL
    // per section — the index page, not an individual article — so we cover diverse sections.
    const sections = new Map<string, { url: string; segs: number }>();

    for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]*)["']/gi)) {
        const href = m[1].trim();
        if (!href || href === '/') continue;
        let u: URL;
        try { u = new URL(href, baseUrl); } catch { continue; }
        if (u.origin !== baseOrigin) continue;
        const matchPath = u.pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, '') || u.pathname;
        if (!ANNOUNCEMENT_PATH_PATTERNS.some((p) => p.test(matchPath))) continue;
        const section = matchPath.split('/').filter(Boolean)[0]?.toLowerCase();
        if (!section) continue;
        const segs = u.pathname.split('/').filter(Boolean).length;
        const cur = sections.get(section);
        if (!cur || segs < cur.segs) sections.set(section, { url: `${u.origin}${u.pathname}`, segs });
    }

    return [...sections.values()].slice(0, 3).map((s) => s.url);
}

// Filenames/paths that are almost never content imagery — icons, logos, sprites, tracking
// pixels, spinners. Excluded from harvested content images (logos are captured separately).
const NON_CONTENT_IMAGE_RE = /(sprite|icon|favicon|logo|pixel|tracking|spinner|loader|placeholder|\.svg(\?|$))/i;

/**
 * Harvest content images from a page's HTML: <img src|data-src>, the first srcset candidate,
 * and CSS background-image url()s. Resolves relative URLs against baseUrl, dedups in source
 * order (which surfaces hero/feature imagery first on most pages), and drops obvious
 * non-content assets (icons, logos, sprites, tracking pixels, SVGs, data: URIs).
 * On a JS-rendered page (via loadPageHtml) this is what finally surfaces the real imagery —
 * static HTML of an SPA carries none.
 */
export function harvestPageImages(html: string, baseUrl: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    const add = (raw?: string) => {
        let url = raw?.trim();
        if (!url || url.startsWith('data:')) return;
        // Decode the HTML entity that breaks CDN image URLs: `?w=1&amp;h=2` must become `&`,
        // else the server sees a bogus `amp;` param and returns an error instead of the image.
        url = url.replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&#x0*26;/gi, '&');
        let resolved: string;
        try { resolved = new URL(url, baseUrl).href; } catch { return; }
        if (seen.has(resolved) || NON_CONTENT_IMAGE_RE.test(resolved)) return;
        seen.add(resolved);
        out.push(resolved);
    };

    // <img src> + lazy-loaded data-src / data-*-src variants
    for (const m of html.matchAll(/<img[^>]+(?:[\w-]*-)?src=["']([^"']+)["']/gi)) add(m[1]);
    // srcset / data-srcset: take the first candidate URL of each
    for (const m of html.matchAll(/<(?:img|source)[^>]+(?:data-)?srcset=["']([^"']+)["']/gi)) {
        add(m[1].split(',')[0]?.trim().split(/\s+/)[0]);
    }
    // CSS background-image: url(...)
    for (const m of html.matchAll(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(m[1]);

    return out;
}

// host → platform key (matching the onboarding PLATFORMS keys). Includes the canonical SHORT/alias
// domains where the path is still the handle (instagr.am, fb.com). Redirect shorteners whose path
// is a code, not a username (vm.tiktok.com, youtu.be, fb.me), are deliberately excluded so we never
// extract a bogus handle. Twitter and X are the same platform → both map to 'x'.
const SOCIAL_HOSTS: Record<string, RegExp> = {
    instagram: /(^|\.)(instagram\.com|instagr\.am)$/i,
    tiktok: /(^|\.)tiktok\.com$/i,
    x: /(^|\.)(x\.com|twitter\.com)$/i,
    facebook: /(^|\.)(facebook\.com|fb\.com)$/i,
    youtube: /(^|\.)youtube\.com$/i,
    linkedin: /(^|\.)linkedin\.com$/i,
    threads: /(^|\.)threads\.net$/i,
};
// First-path segments that are never a profile handle (share/intent/utility/post permalinks).
const SOCIAL_RESERVED = new Set([
    'share', 'sharer', 'sharer.php', 'intent', 'home', 'login', 'signup', 'explore', 'hashtag',
    'search', 'p', 'reel', 'reels', 'tv', 'stories', 'story', 'watch', 'embed', 'results', 'feed',
    'about', 'privacy', 'tos', 'policies', 'help', 'dialog', 'i', 'profile.php', 'pages', 'groups',
]);

/**
 * Extract the brand's own social profiles linked from the page (footer/header). Maps known social
 * hosts to a platform key + handle, skipping share/intent/permalink links and the platform's own
 * utility paths. Dedupes by platform+handle. Best-effort: a site that links no socials yields [].
 */
export function extractSocialHandles(html: string): Array<{ platform: string; handle: string; url: string }> {
    const out: Array<{ platform: string; handle: string; url: string }> = [];
    const seen = new Set<string>();

    for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
        let u: URL;
        // Base lets protocol-relative (//instagram.com/x) resolve; relative paths resolve to a
        // dummy host and are filtered out by the host match below.
        try { u = new URL(m[1].trim(), 'https://_local_'); } catch { continue; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;

        const host = u.hostname.toLowerCase();
        const platform = Object.keys(SOCIAL_HOSTS).find((p) => SOCIAL_HOSTS[p].test(host));
        if (!platform) continue;

        const segs = u.pathname.split('/').filter(Boolean);
        let handle: string | null = null;
        if (platform === 'youtube') {
            if (segs[0]?.startsWith('@')) handle = segs[0];
            else if (['channel', 'c', 'user'].includes(segs[0]?.toLowerCase()) && segs[1]) handle = segs[1];
        } else if (platform === 'linkedin') {
            if (['company', 'in', 'school'].includes(segs[0]?.toLowerCase()) && segs[1]) handle = segs[1];
        } else if (segs[0] && !SOCIAL_RESERVED.has(segs[0].toLowerCase())) {
            handle = segs[0];
        }
        if (!handle) continue;

        handle = handle.replace(/^@/, '').trim();
        if (!handle || handle.length > 40 || /[^a-z0-9._-]/i.test(handle)) continue;

        const key = `${platform}:${handle.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ platform, handle, url: u.protocol === 'http:' || u.protocol === 'https:' ? `https://${host}${u.pathname}` : u.href });
    }
    return out;
}

// Filename tokens that mark an image as a person/team photo — used to safely accept a single-name
// match (e.g. "team-alessandro.webp" → "Alessandro") without mis-matching common words.
const TEAM_PHOTO_HINTS = ['team', 'staff', 'people', 'founder', 'founders', 'member', 'members', 'crew', 'author', 'about', 'persona', 'chi-siamo'];

// A person model reproduces a face far better from several shots than from one, so a person keeps
// EVERY photo whose filename matches them, capped to match the onboarding per-person upload cap.
const MAX_TEAM_PHOTOS = 6;

/**
 * Attach the photo URLs of each detected team person by matching their name against the harvested
 * image URLs. Filenames are usually the person's slug (e.g. /team/marco-di-franco.jpg) or just a
 * first name (e.g. /team-alessandro.webp). Matching uses EXACT filename tokens (split on
 * non-alphanumerics) to stay precise:
 *   1. all significant name tokens present  → match (e.g. marco+franco);
 *   2. plus any single name token present, but ONLY on an image whose filename also carries a
 *      team/staff/founder hint — so "Alessandro" matches "team-alessandro" yet "Nordic Person"
 *      never matches "nordic-health-hero".
 * ALL matches are returned in `images` (full-name matches first); `image` mirrors the first one for
 * the single-photo call sites. People without a match are kept (name+role still useful), imageless.
 */
export function matchTeamPhotos(
    people: Array<{ name: string; role?: string }>,
    images: string[]
): Array<{ name: string; role?: string; image?: string; images?: string[] }> {
    const indexed = images.map((u) => {
        let path = u.toLowerCase();
        try { path = new URL(u).pathname.toLowerCase(); } catch { /* keep full url */ }
        return { url: u, tokens: new Set(path.split(/[^a-z0-9]+/).filter(Boolean)) };
    });
    return people.map((p) => {
        const nameTokens = slugify(p.name || '').split('-').filter((t) => t.length >= 3);
        let matched: string[] = [];
        if (nameTokens.length) {
            const full = indexed.filter((i) => nameTokens.every((t) => i.tokens.has(t))).map((i) => i.url);
            // Filenames often use just one part of the name (first OR last). Accept ANY name token
            // (>=4 chars), but ONLY on an image whose filename carries a team/staff hint, so common
            // words can't mis-match.
            const cand = nameTokens.filter((t) => t.length >= 4);
            const partial = cand.length
                ? indexed
                    .filter((i) => TEAM_PHOTO_HINTS.some((h) => i.tokens.has(h)) && cand.some((t) => i.tokens.has(t)))
                    .map((i) => i.url)
                : [];
            matched = [...new Set([...full, ...partial])].slice(0, MAX_TEAM_PHOTOS);
        }
        return {
            name: p.name,
            role: p.role || undefined,
            image: matched[0],
            images: matched.length ? matched : undefined
        };
    });
}

// --- SSRF Protection ---

/** Lista di hostname bloccati per prevenire SSRF */
const SSRF_BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', '[::1]'];

/**
 * Gli indirizzi che non escono su internet. Una tabella sola, applicata sia al nome (quando è già
 * un indirizzo scritto per esteso) sia a ciò che il resolver risponde: la riga nuova vale per
 * entrambi i casi il giorno che si aggiunge, e nessuno dei due può restare indietro.
 */
const SSRF_PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT (100.64/10)
    /^(22[4-9]|2[3-5]\d)\./,                     // multicast e riservati (224.0.0.0+)
];

/** Pattern IPv6 privati — copre mapped IPv4 (::ffff:), unique local (fc/fd), link-local (fe80) */
const SSRF_PRIVATE_IPV6_PATTERNS = [
    /^::ffff:/i,      // IPv6-mapped IPv4 (es. ::ffff:127.0.0.1)
    /^::\d/,          // IPv4-compatible (es. ::127.0.0.1)
    /^::$/,           // Unspecified address
    /^::1$/,          // Loopback senza brackets
    /^f[cd]/i,        // Unique local addresses (fc00::/7)
    /^fe[89ab]/i,     // Link-local addresses (fe80::/10)
    /^2002:/i,        // 6to4 — porta un IPv4 dentro, e il relay è tecnologia morta
    /^64:ff9b:/i,     // NAT64 — idem
];

/**
 * Dice se un indirizzo — non un nome — è fuori dalla rete pubblica.
 *
 * Le parentesi quadre e la zone id (`fe80::1%eth0`) si tolgono prima: nessuna delle due fa parte
 * dell'indirizzo, ed entrambe basterebbero a far mancare ogni pattern.
 */
function isPrivateAddress(address: string): boolean {
    const bare = address.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
    return (
        SSRF_PRIVATE_IP_PATTERNS.some(p => p.test(bare)) ||
        SSRF_PRIVATE_IPV6_PATTERNS.some(p => p.test(bare))
    );
}

/**
 * Il PRE-FILTRO: dice se un URL è scritto in modo accettabile e non nomina apertamente un
 * indirizzo interno. Non risolve niente, quindi NON basta da solo prima di aprire un socket —
 * un nome pubblico il cui record DNS risponde `127.0.0.1` lo supera senza storie, perché la
 * stringa è innocua: è la risposta del resolver a non esserlo.
 *
 * Chi sta per scaricare qualcosa usa `isUrlSafeToFetch`. Questa resta per chi filtra un elenco
 * di URL senza dialogarli (le immagini di riferimento proposte a un modello, per esempio).
 */
export function isUrlSafe(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        const hostname = parsed.hostname.toLowerCase();
        if (SSRF_BLOCKED_HOSTNAMES.includes(hostname)) return false;

        return !isPrivateAddress(hostname);
    } catch {
        return false;
    }
}

/**
 * La guardia da usare PRIMA DI APRIRE UN SOCKET: il pre-filtro, e poi l'indirizzo vero.
 *
 * `lookup(host, { all: true })` chiede al resolver ogni indirizzo dietro quel nome, e basta che
 * uno solo sia interno perché l'URL sia rifiutato — un nome con due record, uno pubblico e uno
 * privato, sceglierebbe altrimenti quale dei due usare al momento della connessione. Un nome che
 * non risolve non si dialoga: se il resolver non sa dov'è, non lo sappiamo nemmeno noi.
 */
export async function isUrlSafeToFetch(url: string): Promise<boolean> {
    if (!isUrlSafe(url)) return false;

    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const addresses = await lookup(host, { all: true }).catch(() => []);
    if (!addresses.length) return false;

    return !addresses.some(a => isPrivateAddress(a.address));
}

// --- Fetch ---

/**
 * Fetch una singola pagina con timeout e size limit.
 * Ritorna stringa vuota su errore. User-agent neutro per evitare bot-detection.
 * Gestione redirect manuale per validare SSRF su ogni hop.
 */
export async function fetchPage(url: string): Promise<string> {
    // Validazione SSRF sull'URL iniziale: l'indirizzo, non il nome
    if (!(await isUrlSafeToFetch(url))) return '';

    let currentUrl = url;
    let redirectCount = 0;
    const MAX_REDIRECTS = 5;

    try {
        while (redirectCount <= MAX_REDIRECTS) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

            const response = await fetch(currentUrl, {
                signal: controller.signal,
                redirect: 'manual', // Gestione manuale per validare SSRF sui redirect
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; DalNullaBot/1.0)',
                    'Accept': 'text/html,application/xhtml+xml',
                },
            });

            clearTimeout(timeout);

            // Gestisci redirect manualmente con validazione SSRF
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                if (!location) return '';

                // Risolvi URL relativo in assoluto
                const resolvedUrl = new URL(location, currentUrl).href;

                // Validazione SSRF sul target del redirect
                if (!(await isUrlSafeToFetch(resolvedUrl))) return '';

                currentUrl = resolvedUrl;
                redirectCount++;
                continue;
            }

            if (!response.ok) return '';

            // Protezione OOM: rifiuta risposte > 2MB
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) return '';

            const text = await response.text();
            if (text.length > MAX_RESPONSE_BYTES) return text.slice(0, MAX_RESPONSE_BYTES);

            return text;
        }

        // Troppi redirect
        return '';
    } catch {
        return '';
    }
}

/**
 * Browser-render dependency, injected for testability (mirrors how analyzeBrand/runBrandAnalysis
 * inject the GenAI client). Defaults to the real Browserless client.
 */
export interface BrowserRenderer {
    isConfigured: () => boolean;
    content: (url: string, opts?: { waitForTimeout?: number }) => Promise<string>;
}

/**
 * Senza un renderer iniettato si resta al fetch semplice: il package non sa che esista un
 * browser headless, e chi lo usa decide se e come procurarne uno.
 */
const noRenderer: BrowserRenderer = {
    isConfigured: () => false,
    content: async () => ''
};

/**
 * Le firme delle pagine che una CDN restituisce AL POSTO del sito. Stanno in una tabella sola:
 * la prossima CDN si aggiunge con una riga, e tutte restano visibili insieme.
 */
const BLOCK_PAGE_SIGNATURES: ReadonlyArray<{ cdn: string; re: RegExp }> = [
    { cdn: 'cloudfront', re: /generated by cloudfront|the request could not be satisfied/i },
    { cdn: 'cloudflare', re: /attention required!\s*\|\s*cloudflare|sorry, you have been blocked|<title>\s*just a moment\W*<\/title>/i },
    { cdn: 'akamai', re: /access denied[\s\S]{0,400}reference #\d|you don't have permission to access[\s\S]{0,200}on this server/i },
    { cdn: 'imperva', re: /incapsula incident id|powered by incapsula/i },
    { cdn: 'http-error', re: /<title>\s*(4\d\d|5\d\d)[^<]*<\/title>/i },
];

/**
 * Sopra questa quantità di testo visibile una pagina non è più un blocco: è un sito. È il
 * discriminante che tiene bassi i falsi positivi — una pagina di blocco è corta per definizione
 * (quella di CloudFront su illy.com: 553 caratteri), una homepage vera che nomina "access denied"
 * nel proprio testo non lo è.
 */
const BLOCK_PAGE_MAX_TEXT = 2000;

/**
 * Dice se l'HTML che abbiamo in mano è la pagina di blocco di una CDN invece del sito, e quale.
 *
 * Serve perché il renderer esce da IP di datacenter che molte CDN rifiutano: la risposta è HTML
 * valido, con un titolo e qualche centinaio di caratteri di testo, quindi supera ogni soglia
 * pensata per riconoscere una pagina MAGRA. Non era magra, era sbagliata — e il profilo di marca
 * veniva costruito sopra un errore 403 (illy.com, 31 agosto 2026).
 */
export function blockPageReason(html: string): string | null {
    if (!html) return null;
    if (extractVisibleText(html).length > BLOCK_PAGE_MAX_TEXT) return null;
    return BLOCK_PAGE_SIGNATURES.find(({ re }) => re.test(html))?.cdn ?? null;
}

/** Esito di una richiesta di sondaggio sull'indirizzo d'ingresso. */
export type EntryProbe = (url: string) => Promise<{ tlsError: boolean; finalUrl: string | null }>;

/**
 * Errori TLS che dicono «il certificato non copre questo indirizzo», non «il sito non c'è».
 * Un dominio di reindirizzamento comprato a difesa del marchio li produce quasi sempre.
 */
const TLS_ERROR_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_SSL_WRONG_VERSION_NUMBER',
]);

const defaultEntryProbe: EntryProbe = async (url) => {
    if (!(await isUrlSafeToFetch(url))) return { tlsError: false, finalUrl: null };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DalNullaBot/1.0)' },
        });
        return { tlsError: false, finalUrl: res.url || url };
    } catch (e) {
        const code = String((e as { cause?: { code?: unknown } })?.cause?.code ?? '');
        return { tlsError: TLS_ERROR_CODES.has(code), finalUrl: null };
    } finally {
        clearTimeout(timeout);
    }
};

/**
 * Risolve l'indirizzo da cui leggere davvero il sito.
 *
 * Il wizard antepone `https://` a quello che l'utente scrive. Un dominio che rimanda altrove ma
 * non ha il certificato per sé stesso (ginshop.it → ilgin.it) muore lì, e l'utente si sente dire
 * che il suo sito non esiste mentre esiste. Quando — e solo quando — https fallisce PER IL
 * CERTIFICATO, si chiede a http dove rimanda.
 *
 * La destinazione si accetta solo se risale a https. Se resta in chiaro non si prosegue di
 * nascosto: l'indirizzo torna quello di partenza e l'analisi fallisce onestamente, perché
 * analizzare in chiaro un sito che l'utente crede protetto è una decisione sua, non nostra.
 */
export async function resolveEntryUrl(url: string, probe: EntryProbe = defaultEntryProbe): Promise<string> {
    if (!/^https:\/\//i.test(url)) return url;

    const { tlsError } = await probe(url);
    if (!tlsError) return url;

    const { finalUrl } = await probe(url.replace(/^https:/i, 'http:'));
    if (!finalUrl) return url;

    try {
        if (new URL(finalUrl).protocol === 'https:' && (await isUrlSafeToFetch(finalUrl))) return finalUrl;
    } catch {
        return url;
    }
    return url;
}

/**
 * Load a page's HTML, preferring a REAL BROWSER RENDER whenever Browserless is configured — on
 * every site, not just SPAs. A render captures JS-injected nav links and lazy-loaded images (team
 * photos, galleries) that static HTML misses even on server-rendered sites, which is what lets us
 * reliably discover the other pages and the imagery. Falls back to static fetch when Browserless
 * isn't configured, the render fails, or the render comes back thinner than the static HTML.
 *
 * Cost note: this renders the homepage AND each internal page (bounded by MAX_INTERNAL_PAGES), so
 * an analysis makes up to ~1 + MAX_INTERNAL_PAGES Browserless calls. Intentional — finding the
 * real material is the priority. Disable by unsetting BROWSERLESS_API_KEY to revert to static.
 */
export async function loadPageHtml(
    url: string,
    onEscalate?: () => void,
    renderer: BrowserRenderer = noRenderer
): Promise<string> {
    if (!(await isUrlSafeToFetch(url))) return '';

    // Una pagina di blocco non è il sito: meglio niente, così chi chiama lo dice all'utente
    // invece di far analizzare un errore 403 come se fosse il suo brand.
    const siteOrNothing = async () => {
        const html = await fetchPage(url);
        return blockPageReason(html) ? '' : html;
    };

    // No browser available → static only.
    if (!renderer.isConfigured()) return await siteOrNothing();

    // Browser available → render. Browserless validates + fetches server-side.
    onEscalate?.();
    try {
        const rendered = await renderer.content(url, { waitForTimeout: 2500 });
        // Il render esce da IP di datacenter e la CDN può rifiutarlo. La sua pagina di errore ha
        // abbastanza testo da superare la soglia qui sotto, quindi va riconosciuta PRIMA: si
        // riprova in diretta, che spesso passa proprio dove il render viene bloccato.
        if (blockPageReason(rendered || '')) return await siteOrNothing();

        const renderedLen = extractVisibleText(rendered || '').length;
        if (renderedLen >= MIN_VISIBLE_TEXT_LENGTH) return rendered;
        // Render came back thin/empty — keep whichever of render/static has more visible text.
        const staticHtml = await siteOrNothing();
        return rendered && renderedLen >= extractVisibleText(staticHtml).length ? rendered : staticHtml;
    } catch {
        // render failed (timeout, rate limit, bad key) — fall back to static
        return await siteOrNothing();
    }
}

/**
 * Fetch multiple pagine in parallelo. Each page tiers through loadPageHtml, so internal pages
 * on a JS-rendered site are rendered too (not just the homepage). Returns BOTH the visible text
 * (for the LLM) AND the images harvested from each page — so e.g. team photos on /about or /team
 * are captured, not just homepage imagery.
 */
export async function fetchInternalPages(
    urls: string[],
    renderer: BrowserRenderer = noRenderer
): Promise<{ texts: Record<string, string>; images: string[] }> {
    const texts: Record<string, string> = {};
    const seen = new Set<string>();
    const images: string[] = [];
    const promises = urls.map(async (url) => {
        const html = await loadPageHtml(url, undefined, renderer);
        if (!html) return;
        texts[url] = extractVisibleText(html);
        for (const img of harvestPageImages(html, url)) {
            if (!seen.has(img)) {
                seen.add(img);
                images.push(img);
            }
        }
    });
    await Promise.allSettled(promises);
    return { texts, images };
}

// --- Shopify Detection & Products ---

/**
 * Rileva se un sito è Shopify cercando marker tipici nel HTML
 * (cdn.shopify.com, Shopify.theme, meta generator Shopify).
 */
export function isShopifySite(html: string): boolean {
    return /cdn\.shopify\.com/i.test(html)
        || /Shopify\.theme/i.test(html)
        || /<meta[^>]+name=["']generator["'][^>]+content=["']Shopify["']/i.test(html);
}

/**
 * Fetch prodotti direttamente dall'endpoint pubblico /products.json di Shopify.
 * Paginazione completa: Shopify restituisce max 250 prodotti per pagina.
 * Restituisce array vuoto se il sito non lo espone.
 */
export async function fetchShopifyProducts(baseUrl: string): Promise<Array<{ name: string; description: string; pricing?: string; images?: string[]; productType?: string; url?: string }>> {
    try {
        const origin = new URL(baseUrl).origin;

        // Validazione SSRF — l'origin deriva dall'URL utente che è già validato,
        // ma difesa in profondità per evitare bypass se chiamato da altri contesti
        if (!(await isUrlSafeToFetch(`${origin}/products.json`))) return [];

        const PER_PAGE = 250; // Max consentito da Shopify
        const MAX_PAGES = 10; // Limite sicurezza: max 2500 prodotti
        let allRawProducts: any[] = []; // SAFETY: Shopify product shape is untyped external data
        let page = 1;

        // Paginazione: continua finché ci sono prodotti o si raggiunge il limite
        while (page <= MAX_PAGES) {
            const response = await fetch(`${origin}/products.json?limit=${PER_PAGE}&page=${page}`, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'DalNulla/1.0' },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                redirect: 'error', // Rifiuta redirect per prevenire SSRF
            });

            if (!response.ok) {
                console.warn(`[BrandAnalysis] Shopify /products.json returned ${response.status} for ${origin}`);
                break;
            }

            const data = await response.json() as any; // SAFETY: external Shopify API response shape
            const pageProducts = data.products || [];
            if (pageProducts.length === 0) break;

            allRawProducts = allRawProducts.concat(pageProducts);
            // Se ha restituito meno di PER_PAGE, è l'ultima pagina
            if (pageProducts.length < PER_PAGE) break;
            page++;
        }

        console.log(`[BrandAnalysis] Fetched ${allRawProducts.length} Shopify products from ${origin}`);

        return allRawProducts.map((p: any) => { // SAFETY: Shopify product shape is untyped
            const firstVariant = p.variants?.[0];
            const price = firstVariant?.price ? `${firstVariant.price}` : undefined;
            const description = (p.body_html || '')
                .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const images = Array.isArray(p.images)
                ? p.images.map((img: any) => typeof img === 'string' ? img : img?.src).filter(Boolean) // SAFETY: image can be string or object
                : [];
            // Canonical PDP URL — handle is always present on /products.json; never invent paths.
            const handle = typeof p.handle === 'string' ? p.handle.trim() : '';
            const url =
              handle && !/[/?#\s]/.test(handle) ? `${origin}/products/${encodeURIComponent(handle)}` : undefined;

            return {
                name: p.title || '',
                description: description || undefined,
                pricing: price,
                images: images.length > 0 ? images.slice(0, 5) : undefined,
                // Shopify's product_type — the brand's own category label (e.g. "Keyboards",
                // "Monitor", "Switches"). Carried through so the planner can pick substantial
                // products and vary categories instead of treating everything as one bucket.
                productType: (p.product_type || '').trim() || undefined,
                url,
            };
        });
    } catch (err) {
        console.warn('[BrandAnalysis] Shopify products fetch failed:', err);
        return [];
    }
}

// --- WooCommerce Detection & Products ---

/**
 * Rileva se un sito è WooCommerce cercando marker tipici nel HTML:
 * plugin path, WC Store API link, body class, o wp-content con wc assets.
 */
export function isWooCommerceSite(html: string): boolean {
    return /\/plugins\/woocommerce\//i.test(html)
        || /wp-json\/wc\//i.test(html)
        || /class=["'][^"']*woocommerce/i.test(html)
        || /\/wp-content\/.*wc[-_]/i.test(html);
}

/**
 * Fetch prodotti dal WooCommerce Store API pubblico (non richiede auth).
 * Paginazione: 100 prodotti per pagina, max 10 pagine (1000 prodotti).
 * I prezzi sono in minor units — dividiamo per 10^currency_minor_unit.
 * I nomi possono contenere HTML entities — li decodifichiamo.
 */
export async function fetchWooCommerceProducts(baseUrl: string): Promise<Array<{ name: string; description: string; pricing?: string; images?: string[]; url?: string }>> {
    try {
        const origin = new URL(baseUrl).origin;

        // Validazione SSRF — difesa in profondità
        if (!(await isUrlSafeToFetch(`${origin}/wp-json/wc/store/v1/products`))) return [];

        const PER_PAGE = 100; // Max per WooCommerce Store API
        const MAX_PAGES = 10;
        let allRawProducts: any[] = []; // SAFETY: WooCommerce product shape is untyped external data
        let page = 1;

        // Prima richiesta per ottenere currency_minor_unit dalla risposta
        let currencyMinorUnit = 2; // Default: 2 decimali (centesimi)

        while (page <= MAX_PAGES) {
            const response = await fetch(`${origin}/wp-json/wc/store/v1/products?per_page=${PER_PAGE}&page=${page}`, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'DalNulla/1.0' },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                redirect: 'error', // Rifiuta redirect per prevenire SSRF
            });

            if (!response.ok) {
                console.warn(`[BrandAnalysis] WooCommerce Store API returned ${response.status} for ${origin}`);
                break;
            }

            const data = await response.json() as any; // SAFETY: external WooCommerce API response shape
            const pageProducts = Array.isArray(data) ? data : [];
            if (pageProducts.length === 0) break;

            // WooCommerce include currency_minor_unit nel primo prodotto con prices
            if (page === 1 && pageProducts[0]?.prices?.currency_minor_unit != null) {
                currencyMinorUnit = pageProducts[0].prices.currency_minor_unit;
            }

            allRawProducts = allRawProducts.concat(pageProducts);
            if (pageProducts.length < PER_PAGE) break;
            page++;
        }

        console.log(`[BrandAnalysis] Fetched ${allRawProducts.length} WooCommerce products from ${origin}`);

        // Divisore per convertire minor units in prezzo leggibile
        const divisor = Math.pow(10, currencyMinorUnit);

        return allRawProducts.map((p: any) => { // SAFETY: WooCommerce product shape is untyped
            // I prezzi sono in minor units (es. centesimi) — convertiamo
            const rawPrice = p.prices?.price;
            const price = rawPrice != null ? `${(Number(rawPrice) / divisor).toFixed(currencyMinorUnit)}` : undefined;

            // Nomi WooCommerce contengono HTML entities — decodifica generica con supporto numeric entities
            const name = (p.name || '')
                .replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code)))
                .replace(/&#x([0-9a-fA-F]+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 16)))
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&nbsp;/g, ' ');

            const description = (p.short_description || p.description || '')
                .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

            // Immagini in .images[].src
            const images = Array.isArray(p.images)
                ? p.images.map((img: any) => img?.src).filter(Boolean) // SAFETY: image shape is untyped
                : [];

            // Store API exposes the public PDP as `permalink` — use it as-is when it's http(s).
            const permalink = typeof p.permalink === 'string' ? p.permalink.trim() : '';
            const url = /^https?:\/\//i.test(permalink) ? permalink : undefined;

            return {
                name,
                description: description || undefined,
                pricing: price,
                images: images.length > 0 ? images.slice(0, 5) : undefined,
                url,
            };
        });
    } catch (err) {
        console.warn('[BrandAnalysis] WooCommerce products fetch failed:', err);
        return [];
    }
}

// --- Archetype classification ---

/**
 * Deterministic, heuristic site-archetype classifier. Ecommerce wins on platform/cart signals;
 * the other archetypes are scored from URL paths + visible text and the highest (>= 2) wins,
 * else 'generic'. Used as a HINT for the LLM (which makes the final call from full content) and
 * as a fallback when the LLM returns something off-enum. Pure + testable.
 */
export function classifyArchetype(html: string, text: string): SiteType {
    const h = html.toLowerCase();
    const t = text.toLowerCase();
    const hay = `${h}\n${t}`;

    // Ecommerce — strongest signal: platform markers or a real cart/checkout flow.
    if (isShopifySite(html) || isWooCommerceSite(html)
        || /\/(cart|checkout)\b/.test(h) || /add[\s-]?to[\s-]?cart|aggiungi al carrello/.test(hay)) {
        return 'ecommerce';
    }

    const score = { saas: 0, portfolio: 0, local_service: 0, creator: 0 };

    // SaaS / tech
    if (/\/(pricing|prezzi)\b/.test(h)) score.saas += 2;
    if (/\bfree trial\b|\bstart free\b|\bget started\b|\bsign ?up\b|\bbook a demo\b|\bprova gratuita\b/.test(hay)) score.saas += 1;
    if (/https?:\/\/app\.|\/(login|sign-?in|dashboard)\b/.test(h)) score.saas += 1;
    if (/\/(docs|documentation|api)\b/.test(h)) score.saas += 1;
    if (/\b(integrations?|sdk|saas|platform|piattaforma|software)\b/.test(t)) score.saas += 1;

    // Portfolio / freelancer / creative agency
    if (/\/(work|portfolio|projects?|progetti|case-stud)/.test(h)) score.portfolio += 2;
    if (/\b(portfolio|case stud(y|ies)|selected works?|my work|i miei lavori)\b/.test(hay)) score.portfolio += 1;
    if (/\b(freelance|designer|photographer|fotografo|studio creativo|creative studio|agency|agenzia)\b/.test(t)) score.portfolio += 1;

    // Local service (restaurant, gym, salon, clinic, hotel…)
    if (/\/(menu|booking|reservations?|prenota|prenotazioni)\b/.test(h)) score.local_service += 2;
    if (/\b(opening hours|orari di apertura|book a table|prenota un tavolo|reservation|come raggiungerci|find us)\b/.test(hay)) score.local_service += 1;
    if (/maps\.google|google\.com\/maps|goo\.gl\/maps|tel:\+?\d/.test(h)) score.local_service += 1;
    if (/\b(restaurant|ristorante|trattoria|caff[eè]|gym|palestra|salon|barber|parrucchier|clinic|clinica|hotel|spa|dentist)\b/.test(t)) score.local_service += 1;

    // Creator / media / personal brand
    if (/\/(blog|newsletter|episodes?|podcast)\b/.test(h)) score.creator += 1;
    if (/\b(subscribe|newsletter|iscriviti|substack|patreon|my latest videos?)\b/.test(hay)) score.creator += 1;

    const [bestKey, bestScore] = (Object.entries(score) as [keyof typeof score, number][])
        .sort((a, b) => b[1] - a[1])[0];
    return bestScore >= 2 ? bestKey : 'generic';
}

/**
 * Rasterise an SVG buffer to a PNG buffer via @resvg/resvg-js. Dynamic import (specifier via a
 * variable so it isn't bundled) + best-effort: returns null if resvg is unavailable or rendering
 * fails, so an SVG never breaks analysis. Lets the model "see" SVG logos/illustrations.
 */
export async function svgToPng(svg: Buffer | string): Promise<Buffer | null> {
    try {
        const mod = '@resvg/resvg-js';
        const { Resvg } = await import(/* @vite-ignore */ mod);
        const out = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
        return Buffer.from(out);
    } catch {
        return null;
    }
}

// ── La raccolta come un giro solo ───────────────────────────────────────────────────────────────

export interface SiteCrawl {
    /** L'indirizzo da cui il sito si legge davvero, che può non essere quello scritto. */
    url: string;
    html: string;
    metadata: HTMLMetadata;
    /** Testo visibile della home. Vuoto o quasi su una SPA: guarda `clientRendered`. */
    text: string;
    /** Testo delle pagine interne, per indirizzo. */
    pages: Record<string, string>;
    images: string[];
    logos: Array<{ url: string; type: string }>;
    fonts: Array<{ name: string; source: string }>;
    cssColors: Record<string, string>;
    themeColor?: string;
    socialHandles: Array<{ platform: string; handle: string; url: string }>;
    products: Array<{ name: string; description: string; pricing?: string; images?: string[]; url?: string }>;
    /** Da dove vengono i prodotti: `none` significa che il catalogo non era leggibile. */
    productSource: 'shopify' | 'woocommerce' | 'none';
    archetype: SiteType;
    announcementPages: string[];
    /** Testo troppo corto per essere il contenuto vero: probabile rendering lato client. */
    clientRendered: boolean;
}

export interface CrawlOptions {
    renderer?: BrowserRenderer;
    onProgress?: ProgressCallback;
    maxInternalPages?: number;
}

/**
 * Legge un sito e restituisce quello che c'è, senza interpretarlo.
 *
 * Nessuna chiamata a un modello: il risultato è materiale grezzo ma pulito, e chi lo riceve
 * decide quali domande porgli. È il punto in cui due prodotti diversi possono condividere la
 * parte costosa — il giro di rete, le difese, il parsing — e divergere solo nella lettura.
 */
export async function crawlSite(input: string, opts: CrawlOptions = {}): Promise<SiteCrawl> {
    const renderer = opts.renderer ?? noRenderer;
    const say: ProgressCallback = opts.onProgress ?? (() => {});

    // L'indirizzo scritto può non essere quello da cui il sito risponde.
    const url = await resolveEntryUrl(input);

    say('fetching', `Leggo ${url}`);
    const html = await loadPageHtml(url, () => say('rendering', 'Apro il sito in un browser vero'), renderer);
    if (!html) throw new Error(`Non sono riuscito a leggere ${url}`);

    say('parsing', 'Estraggo metadati e collegamenti');
    const metadata = parseHTMLMetadata(html, url);
    const text = extractVisibleText(html);

    const internalUrls = discoverInternalPages(html, url).slice(0, opts.maxInternalPages ?? MAX_INTERNAL_PAGES);
    say('pages', `Seguo ${internalUrls.length} pagine interne`);
    const internal = await fetchInternalPages(internalUrls, renderer);

    // Il catalogo vero quando la piattaforma lo espone: dedurlo dal testo produce prodotti che
    // non esistono.
    let products: SiteCrawl['products'] = [];
    let productSource: SiteCrawl['productSource'] = 'none';
    if (isShopifySite(html)) {
        products = await fetchShopifyProducts(url).catch(() => []);
        if (products.length) productSource = 'shopify';
    } else if (isWooCommerceSite(html)) {
        products = await fetchWooCommerceProducts(url).catch(() => []);
        if (products.length) productSource = 'woocommerce';
    }

    const images = [...new Set([...harvestPageImages(html, url), ...internal.images])];

    return {
        url,
        html,
        metadata,
        text,
        pages: internal.texts,
        images,
        logos: extractLogos(html, url),
        fonts: extractFonts(html),
        cssColors: extractCSSCustomProperties(html),
        themeColor: extractThemeColor(html),
        socialHandles: extractSocialHandles(html),
        products,
        productSource,
        archetype: classifyArchetype(html, text),
        announcementPages: discoverAnnouncementPages(html, url),
        clientRendered: text.length < MIN_VISIBLE_TEXT_LENGTH
    };
}
