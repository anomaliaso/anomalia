/**
 * Brand Analysis — la LETTURA di un sito.
 *
 * La raccolta (fetch, guardia SSRF, browser reale, pagine interne, Shopify/Woo, parsing di
 * metadati, loghi, colori, font, social) è uscita in `@anomalia/site-analysis/crawl`: è la stessa
 * per chiunque legga un sito. Qui resta ciò che è nostro — quali domande porre al materiale, con
 * quale schema, e come comporne un `BrandProfile`.
 *
 * I simboli della raccolta sono ri-esportati da qui perché quattordici moduli li importano da
 * questo indirizzo. È un ponte, non una casa: chi tocca uno di quei moduli lo faccia puntare al
 * package.
 */
import { swallow } from '$lib/server/swallow';
import { SITE_TYPES, clampSiteType, sanitizeThemeColor } from '$lib/brand-fields';
import { browserlessContent, isBrowserlessConfigured } from './browserless';
import { structured } from '$lib/server/research';
import { llmStructured } from '$lib/server/llm';
import {
  FETCH_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_TEXT_LENGTH,
  MIN_VISIBLE_TEXT_LENGTH,
  blockPageReason,
  classifyArchetype,
  discoverAnnouncementPages,
  discoverInternalPages,
  extractCSSCustomProperties,
  extractColorsFromImage,
  extractFonts,
  extractLogos,
  extractSocialHandles,
  extractThemeColor,
  extractVisibleText,
  fetchInternalPages,
  fetchManifestIcons,
  fetchPage,
  fetchShopifyProducts,
  fetchWooCommerceProducts,
  harvestPageImages,
  isShopifySite,
  isUrlSafe,
  isWooCommerceSite,
  loadPageHtml,
  matchTeamPhotos,
  parseHTMLMetadata,
  resolveEntryUrl,
  svgToPng,
  type BrowserRenderer,
  type EntryProbe,
  type HTMLMetadata,
  type ProgressCallback,
  type SiteType
} from '@anomalia/site-analysis/crawl';

export {
  blockPageReason,
  classifyArchetype,
  discoverAnnouncementPages,
  discoverInternalPages,
  extractCSSCustomProperties,
  extractColorsFromImage,
  extractFonts,
  extractLogos,
  extractSocialHandles,
  extractThemeColor,
  extractVisibleText,
  fetchInternalPages,
  fetchManifestIcons,
  fetchPage,
  fetchShopifyProducts,
  fetchWooCommerceProducts,
  harvestPageImages,
  isShopifySite,
  isUrlSafe,
  isWooCommerceSite,
  loadPageHtml,
  matchTeamPhotos,
  parseHTMLMetadata,
  resolveEntryUrl,
  svgToPng,
  type BrowserRenderer,
  type EntryProbe,
  type HTMLMetadata,
  type ProgressCallback,
  type SiteType
};

/**
 * Il browser vero, che il package non conosce: lui espone solo "dammi l'HTML di questo URL".
 * Passandolo a `loadPageHtml` si riottiene il comportamento di prima.
 */
const browserRenderer: BrowserRenderer = {
  isConfigured: isBrowserlessConfigured,
  content: browserlessContent
};

const MAX_ANALYSIS_IMAGES = 3; // Immagini passate al LLM multimodale per leggere palette/stile reali
const BRAND_ANALYSIS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory cache for brand analysis results
const brandAnalysisCache = new Map<string, { profile: BrandProfile; timestamp: number }>();

export interface BrandProfile {
    name: string;
    url: string;
    // Business archetype (see SiteType). Steers offerings/spokesperson/pillars downstream.
    site_type?: SiteType;
    // Editorial pillars appropriate to the archetype (e.g. SaaS: feature launch, tip, customer story).
    content_pillars?: string[];
    favicon_url?: string;
    category: string;
    // Detected primary language (English name, e.g. "Italian"); steers caption language.
    language?: string;
    about: string;
    brand_style: string;
    target_audience: string;
    brand_colors: string[];
    // Immagini rappresentative del brand (OG image, hero images, ecc.)
    images?: string[];
    // Optional: a human spokesperson/avatar. Omitted for archetypes where it doesn't fit (e.g.
    // most SaaS/B2B), which lean on visual_style + real screenshots/product photos instead.
    ai_character?: {
        description: string;
        gender: string;
        age_range: string;
        accent: string;
        pitch: string;
        tone: string;
        speaking_style: string;
    };
    products: Array<{
        name: string;
        description: string;
        // What the offering is: product | service | project | feature. Absent ⇒ product.
        kind?: string;
        pricing?: string;
        images?: string[];
    }>;
    // Team members detected from the site (team/about/contact). `images` holds EVERY external photo
    // URL matched from the harvested images (`image` mirrors the first); pre-populates the People step.
    people?: Array<{ name: string; role?: string; image?: string; images?: string[] }>;
    // Social profiles linked from the site (footer/header). Pre-fills the onboarding socials step
    // so the brand's post history can be scraped without the user typing handles by hand.
    social_handles?: Array<{ platform: string; handle: string; url: string }>;
    // Recent announcements mined from the site's changelog/blog/releases (ADDITIVE — separate from
    // brand-page analysis). Feeds timely "feature launch / what's new" posts to the planner.
    announcements?: Array<{ title: string; date?: string; summary?: string; url?: string }>;
    // Nuovi campi per detection arricchita
    logos?: Array<{ url: string; type: string }>;
    fonts?: Array<{ name: string; source: string }>;
    theme_color?: string;
}

// --- LLM Analysis ---

const brandProfileSchema = {
    type: 'object' as const,
    properties: {
        name: { type: 'string' as const, description: 'Brand/company name' },
        category: { type: 'string' as const, description: 'Business category (e.g. "AI Application Development")' },
        site_type: {
            type: 'string' as const,
            enum: [...SITE_TYPES],
            description:
                'The business archetype of this site. ecommerce = sells physical/digital products with a cart; saas = software/tech product with pricing/signup/docs; portfolio = freelancer/creative/agency showcasing work & case-studies; local_service = a physical local business (restaurant, gym, salon, clinic, hotel); creator = personal brand monetising an audience; media = publisher/newsroom whose product is the content itself; mobile_app = a phone app as the product; service = a service business that is not tied to one place; generic = none of these clearly. Use the DETECTED ARCHETYPE hint as a strong prior but decide from the actual content.',
        },
        content_pillars: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description:
                '3-5 short content pillars appropriate to this brand\'s archetype — the recurring themes its social posts should rotate through (e.g. SaaS: "feature launch", "tip/how-to", "customer story", "comparison"; portfolio: "case study", "behind-the-scenes", "process"; local_service: "offer", "behind-the-scenes", "testimonial").',
        },
        language: { type: 'string' as const, description: 'The brand\'s PRIMARY communication language, as an English language name (e.g. "Italian", "English", "Spanish") — the language the website and marketing copy are actually written in.' },
        about: { type: 'string' as const, description: '2-3 sentence description of what the company does' },
        brand_style: { type: 'string' as const, description: 'Visual and design style description' },
        target_audience: { type: 'string' as const, description: 'Who the product/service is for' },
        brand_colors: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Brand colors as hex codes',
        },
        ai_character: {
            type: 'object' as const,
            properties: {
                description: { type: 'string' as const, description: 'Detailed visual description of a brand spokesperson/avatar' },
                gender: { type: 'string' as const },
                age_range: { type: 'string' as const },
                accent: { type: 'string' as const },
                pitch: { type: 'string' as const },
                tone: { type: 'string' as const },
                speaking_style: { type: 'string' as const },
            },
            required: ['description', 'gender', 'age_range', 'accent', 'pitch', 'tone', 'speaking_style'],
        },
        products: {
            type: 'array' as const,
            description:
                'The REAL things this brand offers, exactly as they appear on the site — products, services, projects/case-studies, or features. ONLY include offerings actually present in the content. If the site has no concrete catalog (e.g. a portfolio, agency or service business that lists no discrete items), return an EMPTY array. NEVER invent, assume, or pad this list with plausible-sounding items.',
            items: {
                type: 'object' as const,
                properties: {
                    name: { type: 'string' as const },
                    description: { type: 'string' as const },
                    kind: {
                        type: 'string' as const,
                        description: 'What this offering is: one of "product", "service", "project", "feature". Defaults to "product".',
                    },
                    pricing: { type: 'string' as const },
                },
                required: ['name', 'description'],
            },
        },
        people: {
            type: 'array' as const,
            description:
                "Real team members / founders / creators explicitly shown on the site (e.g. a team, about or contact page) — their full NAME and their ROLE. ONLY include people actually named on the site. Return an EMPTY array if the site names no people. Do NOT invent names.",
            items: {
                type: 'object' as const,
                properties: {
                    name: { type: 'string' as const, description: 'Full name exactly as shown on the site.' },
                    role: { type: 'string' as const, description: 'Their role/title (e.g. "Founder", "Art Director"). Empty if not stated.' },
                },
                required: ['name'],
            },
        },
    },
    // products + ai_character are intentionally NOT required:
    //  - products: forcing it makes the model invent a catalog for non-ecommerce sites.
    //  - ai_character: a human spokesperson doesn't fit every archetype (e.g. most SaaS/B2B), so
    //    the model omits it there and downstream leans on visual_style + real imagery instead.
    required: ['name', 'category', 'site_type', 'language', 'about', 'brand_style', 'target_audience', 'brand_colors', 'content_pillars'],
};

type InlineImagePart = { inlineData: { mimeType: string; data: string } };

// MIME types Gemini accepts as image input directly. SVG is NOT one (Gemini 400s on it) — we
// rasterise SVG to PNG instead (see svgToPng). GIF/BMP etc. are dropped.
const GEMINI_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);


/**
 * Fetch an image URL into a Gemini inlineData part. SSRF-safe, size-capped, best-effort
 * (null on any failure / unsupported type / oversized), so a bad image never breaks analysis.
 * SVGs are rasterised to PNG so the model can still read them; unsupported types are dropped.
 */
async function fetchImageInlinePart(url: string): Promise<InlineImagePart | null> {
    if (!isUrlSafe(url)) return null;
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DalNullaBot/1.0)' },
            redirect: 'error',
        });
        if (!res.ok) return null;
        let mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || 'image/jpeg';
        if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
        const contentLength = res.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > MAX_IMAGE_BYTES) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_IMAGE_BYTES) return null;

        // SVG → rasterise to PNG (Gemini can't read SVG directly).
        if (mimeType === 'image/svg+xml' || (mimeType === 'image/jpeg' && /\.svg(\?|$)/i.test(url))) {
            const png = await svgToPng(buf);
            return png ? { inlineData: { mimeType: 'image/png', data: png.toString('base64') } } : null;
        }
        if (!GEMINI_IMAGE_MIME.has(mimeType)) return null;
        return { inlineData: { mimeType, data: buf.toString('base64') } };
    } catch {
        return null;
    }
}

/**
 * Chiama Gemini con JSON schema per estrarre un BrandProfile strutturato.
 * Il client è iniettato per rendere la funzione testabile.
 * `imageUrls`: immagini rappresentative del sito (og:image, hero) passate come parti inline così
 * il modello può leggere la palette reale dai pixel quando i colori CSS sono scarsi.
 */
export async function analyzeBrand(
    metadata: HTMLMetadata,
    pageTexts: Record<string, string>,
    client: { models: { generateContent: (params: any) => Promise<{ text?: string | null }> } },
    imageUrls: string[] = [],
    archetypeHint: SiteType = 'generic',
    // Language for the human-readable descriptive fields shown to the user (follows the
    // site locale, e.g. "Italian"). Defaults to English to preserve prior behaviour.
    outputLanguage = 'English',
): Promise<BrandProfile> {
    const pagesContext = Object.entries(pageTexts)
        .map(([url, text]) => `--- PAGE: ${url} ---\n${text}`)
        .join('\n\n');

    const colorsContext = metadata.cssColors?.length
        ? `\nCSS Colors found on the site: ${metadata.cssColors.join(', ')}`
        : '';

    // Segnali aggiuntivi per una brand analysis più precisa
    const themeColorContext = metadata.themeColor
        ? `\n- Theme Color: ${metadata.themeColor}`
        : '';

    const cssVarsContext = metadata.cssCustomProperties && Object.keys(metadata.cssCustomProperties).length > 0
        ? `\n- CSS Design Tokens: ${JSON.stringify(metadata.cssCustomProperties)}`
        : '';

    const fontsContext = metadata.fonts?.length
        ? `\n- Detected Fonts: ${metadata.fonts.map(f => `${f.name} (${f.source})`).join(', ')}`
        : '';

    // Fetch representative images so the model can read the brand's REAL palette from pixels —
    // essential on JS sites where colors live in external/utility CSS we can't see. Best-effort.
    const imageParts = (await Promise.all(imageUrls.slice(0, MAX_ANALYSIS_IMAGES).map(fetchImageInlinePart)))
        .filter((p): p is InlineImagePart => p !== null);
    const imageHint = imageParts.length
        ? `\n\n${imageParts.length} representative image(s) from the site are attached. READ the brand's actual colour palette from these pixels — sample the dominant and accent colours — and weigh them heavily for brand_colors, especially when few CSS colors are listed above. Use them to inform brand_style too.`
        : '';

    const prompt = `Analyze this website and extract a complete brand profile.

DETECTED ARCHETYPE (strong prior — confirm or correct it from the content): ${archetypeHint}

WEBSITE METADATA:
- Title: ${metadata.title || 'N/A'}
- Description: ${metadata.description || 'N/A'}
- OG Title: ${metadata.ogTitle || 'N/A'}
- OG Description: ${metadata.ogDescription || 'N/A'}${colorsContext}${themeColorContext}${cssVarsContext}${fontsContext}

WEBSITE CONTENT:
${pagesContext}

Extract ALL fields. Set site_type to the true archetype and content_pillars to themes that fit it.

For brand_colors, use the CSS colors, theme color, and CSS design tokens combined with your analysis — pick the 3-6 most representative brand colors as hex codes. Prioritize colors from CSS custom properties (design tokens) as they are the most intentional brand choices.${imageHint}

For products, list ONLY offerings that genuinely appear in the content — real products, services, projects/case-studies or features — and set each item's "kind" accordingly (product | service | project | feature). If the site has no discrete catalog (a portfolio, agency or service business), return an EMPTY products array. Do NOT invent or infer items that are not actually shown.

For people, list the real team members / founders / creators explicitly NAMED on the site (team, about or contact sections) with their role. Return an empty array if no people are named. Never invent names.

For ai_character: include a detailed, photorealistic human spokesperson ONLY when a human face authentically fits the brand (typical for portfolio, local_service, creator, many ecommerce brands). For software/SaaS/B2B/generic brands where a human spokesperson would feel inauthentic, OMIT ai_character entirely.

The website may be in any language — extract information regardless. Write the human-readable descriptive fields (category, about, brand_style, target_audience, content_pillars, and each product's description) in ${outputLanguage}. Do NOT translate the brand name or product names — keep them exactly as they appear on the site. Keep the "language" field as an English language name (e.g. "Italian"), and leave brand_colors, site_type and other enum/code fields unchanged.`;

    // analyzeBrand's `client` is deliberately mock-shaped for tests; structured() only ever
    // calls models.generateContent on it, so the narrow shape is safe to widen here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any = await structured(prompt, brandProfileSchema,
        `You are an expert brand analyst. Analyze websites and extract structured brand profiles. Be specific and detailed, but NEVER fabricate: only report what the site actually shows — an empty products list is correct for sites with no catalog, and ai_character should be omitted when a human spokesperson doesn't fit the brand. When you do include an AI character, describe a photorealistic person (appearance, clothing, setting, expression) that authentically represents the brand's values and audience.`,
        { label: 'brandProfile', images: imageParts });
    if (!parsed.name) throw new Error('LLM returned invalid brand profile');

    return parsed as BrandProfile;
}

// --- Announcements (additive) ---

const ANNOUNCEMENTS_SCHEMA = {
    type: 'object' as const,
    properties: {
        announcements: {
            type: 'array' as const,
            items: {
                type: 'object' as const,
                properties: {
                    title: { type: 'string' as const, description: 'Short title of the release/feature/news.' },
                    date: { type: 'string' as const, description: 'Date as shown on the page, or empty string if none.' },
                    summary: { type: 'string' as const, description: 'One-line summary of what changed/launched.' },
                },
                required: ['title'],
            },
        },
    },
    required: ['announcements'],
};

/**
 * Extract recent REAL announcements (releases, new features, news) from the brand's own
 * changelog/blog/release pages. Only what's actually in the text — empty array if none, never
 * invented. Separate from analyzeBrand so it can't dilute the brand profile.
 */
export async function extractAnnouncements(
    pageTexts: Record<string, string>,
    client: { models: { generateContent: (params: any) => Promise<{ text?: string | null }> } },
): Promise<Array<{ title: string; date?: string; summary?: string }>> {
    const ctx = Object.entries(pageTexts)
        .map(([u, t]) => `--- ${u} ---\n${t.slice(0, 8000)}`)
        .join('\n\n');
    if (!ctx.trim()) return [];

    const prompt = `Below are the brand's own announcement/blog/changelog pages. Extract the most RECENT real announcements — product releases, new features, or news — present in the text. For each: a short title, the date if shown (else ""), and a one-line summary. Most recent first, max 8. ONLY items actually in the text; if there are none, return an empty array. NEVER invent.\n\n${ctx}`;
    const systemInstruction = 'You extract only real announcements present in the provided text. Never fabricate.';

    try {
        void client;
        const parsed = await llmStructured<{ announcements?: Array<Record<string, unknown>> }>({
            prompt,
            schema: ANNOUNCEMENTS_SCHEMA,
            system: systemInstruction,
            label: 'announcements'
        });
        if (!Array.isArray(parsed.announcements)) return [];
        return parsed.announcements
            .slice(0, 8)
            .map((a: Record<string, unknown>) => ({
                title: String(a?.title ?? '').trim(),
                date: a?.date ? String(a.date).trim() : undefined,
                summary: a?.summary ? String(a.summary).trim() : undefined,
            }))
            .filter((a: { title: string }) => a.title);
    } catch {
        return [];
    }
}

// --- Orchestrator ---

/**
 * Orchestratore principale: fetch -> discover -> fetch pages -> LLM -> save.
 * Il client GenAI è iniettato per testabilità (default: crea nuova istanza).
 */
export async function runBrandAnalysis(
    url: string,
    onProgress: ProgressCallback,
    genaiClient?: { models: { generateContent: (params: any) => Promise<{ text?: string | null }> } },
    // Language for the user-facing brand fields (follows the site locale). Defaults to English.
    outputLanguage = 'English',
): Promise<BrandProfile> {
    // Check cache first
    const now = Date.now();
    const cached = brandAnalysisCache.get(url);
    if (cached && now - cached.timestamp < BRAND_ANALYSIS_CACHE_TTL) {
        onProgress('cached', `Loaded from cache…`);
        return cached.profile;
    }

    // 0. L'indirizzo scritto dall'utente può non essere quello da cui si legge il sito: un dominio
    // che rimanda altrove senza avere il certificato per sé stesso arriverebbe qui come
    // irraggiungibile. Da qui in poi si lavora sulla destinazione vera, che finisce anche nel
    // profilo — il brand non deve portarsi dietro un indirizzo che non risponde.
    url = await resolveEntryUrl(url);

    // 1. Fetch homepage. When Browserless is configured we render it in a real browser (every
    // site, not just SPAs) so JS nav links + lazy-loaded images are present in the HTML we parse.
    onProgress('fetching', `Fetching homepage: ${url}`);
    const homepageHtml = await loadPageHtml(
        url,
        () => onProgress('rendering', 'Opening your site in a real browser to read every page and image…'),
        browserRenderer
    );
    if (!homepageHtml) throw new Error(`Could not fetch URL: ${url}`);

    // 2. Parse metadata
    onProgress('parsing', 'Extracting metadata and links...');
    const metadata = parseHTMLMetadata(homepageHtml, url);
    const homepageText = extractVisibleText(homepageHtml);

    // Harvest real content images from the (rendered) homepage — hero/feature/case-study shots.
    // On an SPA this is empty until loadPageHtml has rendered the page; on a static site it works
    // directly. Feeds both the multimodal color read and profile.images.
    const harvestedImages = harvestPageImages(homepageHtml, url);
    const harvestedSeen = new Set(harvestedImages);

    // SPA fallback — when visible text is too short (client-rendered), build a synthetic
    // text block from metadata so the LLM still has something meaningful to analyze.
    // Most SPAs have rich meta tags (title, description, og:*) even without SSR.
    const isSPA = homepageText.length < MIN_VISIBLE_TEXT_LENGTH;
    let effectiveHomepageText = homepageText;

    if (isSPA) {
        onProgress('parsing', 'Site uses client-side rendering — analyzing from metadata...');
        const metaParts = [
            metadata.title && `Title: ${metadata.title}`,
            metadata.description && `Description: ${metadata.description}`,
            metadata.ogTitle && metadata.ogTitle !== metadata.title && `OG Title: ${metadata.ogTitle}`,
            metadata.ogDescription && metadata.ogDescription !== metadata.description && `OG Description: ${metadata.ogDescription}`,
            homepageText.length > 0 && `Visible text: ${homepageText}`,
        ].filter(Boolean).join('\n');

        if (!metaParts.trim()) {
            throw new Error(
                'Could not extract any content from this site. ' +
                'The page has no visible text and no metadata (title, description, og:tags).'
            );
        }
        effectiveHomepageText = metaParts;
    }

    // 3. Discover + fetch internal pages
    const internalUrls = isSPA ? [] : discoverInternalPages(homepageHtml, url);
    const pageTexts: Record<string, string> = { [url]: effectiveHomepageText };

    if (internalUrls.length > 0) {
        onProgress('fetching', `Found ${internalUrls.length} internal pages, fetching...`);
        const internal = await fetchInternalPages(internalUrls, browserRenderer);
        Object.assign(pageTexts, internal.texts);
        // Fold in images harvested from internal pages (e.g. team photos on /about or /team) so
        // they're available for profile.images and team-photo matching — not just homepage imagery.
        for (const img of internal.images) {
            if (!harvestedSeen.has(img)) {
                harvestedSeen.add(img);
                harvestedImages.push(img);
            }
        }
    }

    // 3b. E-commerce detection: Shopify o WooCommerce — fetch prodotti reali
    // Priorità: Shopify prima (più specifico), WooCommerce come fallback
    let ecommerceProducts: Array<{ name: string; description: string; pricing?: string; images?: string[]; url?: string; productType?: string }> = [];
    let ecommercePlatform: string | null = null;

    if (isShopifySite(homepageHtml)) {
        ecommercePlatform = 'Shopify';
        onProgress('fetching', 'Shopify store detected — fetching all products...');
        ecommerceProducts = await fetchShopifyProducts(url);
    } else if (isWooCommerceSite(homepageHtml)) {
        ecommercePlatform = 'WooCommerce';
        onProgress('fetching', 'WooCommerce store detected — fetching all products...');
        ecommerceProducts = await fetchWooCommerceProducts(url);
    }

    if (ecommerceProducts.length > 0) {
        onProgress('fetching', `Found ${ecommerceProducts.length} ${ecommercePlatform} products`);
    }

    // 3c. Enrichment async — manifest icons e colori dal logo
    if (metadata.manifestUrl) {
        onProgress('enriching', 'Fetching manifest icons...');
        const manifestLogos = await fetchManifestIcons(metadata.manifestUrl);
        metadata.logos.push(...manifestLogos);
    }

    // Estrai colori dominanti dal logo principale — segnale forte per brand colors
    if (metadata.logos.length > 0) {
        onProgress('enriching', 'Extracting colors from logo...');
        const logoColors = await extractColorsFromImage(metadata.logos[0].url);
        if (logoColors.length > 0) {
            // Prepend: colori dal logo hanno priorità su colori CSS generici
            metadata.cssColors = [...logoColors, ...metadata.cssColors];
        }
    }

    // Dedup colori prima di passarli al LLM
    metadata.cssColors = [...new Set(metadata.cssColors)];

    // 4. Tronca testo totale a MAX_TEXT_LENGTH — accumula in nuovo oggetto, no pagine extra
    const truncatedTexts: Record<string, string> = {};
    let totalLength = 0;
    for (const [pageUrl, text] of Object.entries(pageTexts)) {
        const remaining = MAX_TEXT_LENGTH - totalLength;
        if (remaining <= 0) break;
        truncatedTexts[pageUrl] = text.slice(0, remaining);
        totalLength += truncatedTexts[pageUrl].length;
    }

    // Se abbiamo prodotti e-commerce reali, aggiungili al contesto per il LLM
    if (ecommerceProducts.length > 0) {
        const productsSummary = ecommerceProducts.slice(0, 20).map(p =>
            `- ${p.name}${p.pricing ? ` ($${p.pricing})` : ''}${p.description ? `: ${p.description.slice(0, 100)}` : ''}`
        ).join('\n');
        truncatedTexts[`[${ecommercePlatform?.toUpperCase()} PRODUCTS]`] = `Real product catalog (${ecommerceProducts.length} products):\n${productsSummary}`;
    }

    // 5. LLM Analysis
    onProgress('analyzing', 'AI is analyzing brand identity...');
    const client = genaiClient || (null as never);

    // Representative images for the multimodal palette/style read: the OG preview first (often a
    // full-site screenshot — the best single palette signal), then the first harvested heroes.
    const analysisImages = [...(metadata.ogImage ? [metadata.ogImage] : []), ...harvestedImages]
        .filter((v, i, a) => a.indexOf(v) === i);

    // Archetype hint for the LLM: a real ecommerce catalog is authoritative; otherwise heuristics
    // on the (rendered) homepage. The LLM confirms/corrects it and returns the final site_type.
    const archetypeHint: SiteType = ecommerceProducts.length > 0
        ? 'ecommerce'
        : classifyArchetype(homepageHtml, homepageText);
    const profile = await analyzeBrand(metadata, truncatedTexts, client, analysisImages, archetypeHint, outputLanguage);

    // Dati dai metadata HTML (più affidabili dell'LLM)
    profile.url = url;
    // A real ecommerce catalog overrides any LLM guess; otherwise fall back to the heuristic if
    // the model returned nothing usable.
    profile.site_type = ecommerceProducts.length > 0
        ? 'ecommerce'
        : (clampSiteType(profile.site_type) ?? archetypeHint);
    if (metadata.faviconUrl) profile.favicon_url = metadata.faviconUrl;
    if (metadata.logos.length > 0) profile.logos = metadata.logos;
    if (metadata.fonts.length > 0) profile.fonts = metadata.fonts;
    if (metadata.themeColor) profile.theme_color = sanitizeThemeColor(metadata.themeColor) ?? undefined;

    // Immagini del sito: OG image + immagini reali raccolte dalla pagina + foto prodotti e-commerce
    const siteImages: string[] = [];
    if (metadata.ogImage) siteImages.push(metadata.ogImage);
    for (const img of harvestedImages) {
        if (siteImages.length >= 20) break;
        if (!siteImages.includes(img)) siteImages.push(img);
    }
    for (const p of ecommerceProducts) {
        if (p.images?.[0] && !siteImages.includes(p.images[0])) {
            siteImages.push(p.images[0]);
        }
        // Max 20 immagini generali per non sovraccaricare il profilo
        if (siteImages.length >= 20) break;
    }
    if (siteImages.length > 0) profile.images = siteImages;

    // Match detected team members to their harvested photo (by name slug) so the brand's People
    // can be pre-populated from the site (team/about pages).
    if (Array.isArray(profile.people) && profile.people.length) {
        profile.people = matchTeamPhotos(profile.people, harvestedImages);
    }

    // Social profiles linked from the site (footer/header) → pre-fill the onboarding socials step.
    const socialHandles = extractSocialHandles(homepageHtml);
    if (socialHandles.length) profile.social_handles = socialHandles;

    // Sovrascrivi prodotti con dati reali dall'e-commerce (più accurati dell'inferenza LLM)
    if (ecommerceProducts.length > 0) {
        profile.products = ecommerceProducts.map(p => ({
            name: p.name,
            description: p.description,
            kind: 'product',
            pricing: p.pricing,
            images: p.images,
            url: p.url,
            productType: p.productType,
        }));
    }

    // Announcements (ADDITIVE): a separate pass over the site's changelog/blog/release pages — which
    // are deliberately excluded from brand-page discovery — so we never touch the brand analysis,
    // images or team. Feeds only profile.announcements (timely posts for the planner). Best-effort.
    try {
        const annUrls = discoverAnnouncementPages(homepageHtml, url);
        if (annUrls.length) {
            onProgress('fetching', 'Checking for recent announcements…');
            const annTexts: Record<string, string> = {};
            for (const annUrl of annUrls.slice(0, 2)) {
                const html = await loadPageHtml(annUrl, undefined, browserRenderer);
                if (html) annTexts[annUrl] = extractVisibleText(html);
            }
            const announcements = await extractAnnouncements(annTexts, client);
            if (announcements.length) {
                profile.announcements = announcements.map((a) => ({ ...a, url: Object.keys(annTexts)[0] }));
            }
        }
    } catch (error) { swallow('extract announcements', error); }

    // No DB write here — the caller persists into brand_kit + products on brand creation.
    onProgress('done', 'Brand profile ready');

    // Save to cache
    brandAnalysisCache.set(url, { profile, timestamp: Date.now() });

    return profile;
}

