// What a public website can tell us about the work a business repeats every week — the eyes of
// the free agent-team tool at /tools/agent-team.
//
// The tool is a CONVERSATION (see agent-team-chat.ts): a stranger pastes a URL and an agent maps
// their processes, asks what the site cannot say, and proposes the team one card at a time. This
// module is the half of that which never guesses.
//
// WHY THE PROCESSES ARE CODE AND THE TEAM IS A MODEL. Same split as `agent-team.ts`, for the same
// reason. "Does this site take bookings / sell online / run a careers page / answer support in a
// widget" is a verifiable fact sitting in the HTML — a model asked to guess it will happily give a
// dentist a returns-handling agent and a t-shirt shop a no-show-reminder agent, and the visitor
// correctly concludes the whole thing was made up. So the processes are DETECTED here, in
// `detectSignals`, each carrying the evidence it fired on, and the agent only does what it is
// actually good at: reading what the business sells, asking what is missing, naming the roles in
// the site's own language and wiring the handoffs.
//
// The same rule closes the loop on the way out: `normalizeProposedAgent` drops a proposal that
// stands on a process we never saw. A made-up teammate costs more trust than a smaller team.
import { safeFetchUrl } from './tool-guard';

/** Hard ceiling on the team. More than this and nobody reads past the fold. */
export const MAX_AGENTS = 7;
/** Extra pages fetched beyond the homepage. Each one is a second of latency and a slice of prompt. */
export const MAX_EXTRA_PAGES = 3;

export type AgentDepartment =
  | 'marketing'
  | 'content'
  | 'sales'
  | 'support'
  | 'ops'
  | 'data'
  | 'product'
  | 'people';

const DEPARTMENTS: AgentDepartment[] = [
  'marketing',
  'content',
  'sales',
  'support',
  'ops',
  'data',
  'product',
  'people'
];

export type Level = 'high' | 'medium' | 'low';

export type DetectedSignal = {
  /** Stable id — the UI labels it from i18n, so the label is never model prose. */
  id: string;
  /** What we actually saw (a path, a script host, a word in the page). Shown as-is. */
  evidence: string;
};

export type TeamAgent = {
  id: string;
  name: string;
  role: string;
  department: AgentDepartment;
  mission: string;
  /** Why THIS business needs it, in the site's language. */
  because: string;
  /** Detected signal ids this agent stands on. Validated: unknown ids are dropped. */
  signals: string[];
  cadence: string;
  inputs: string[];
  outputs: string[];
  integrations: string[];
  /** Ids of teammates this one hands work to. Dangling ids are dropped. */
  handoffTo: string[];
  impact: Level;
  effort: Level;
  hoursSavedPerWeek: number;
  firstTask: string;
  /** A published Agent Library template that already does this, when one matches. */
  library: { slug: string; name: string; tagline: string } | null;
};

// ---------------------------------------------------------------------------------------------
// The detectable processes
// ---------------------------------------------------------------------------------------------

// A process signal is something a website cannot fake by accident: a cart, a booking widget, a
// careers page, a support bubble. Each one implies work somebody is doing by hand every week —
// which is exactly what an agent can take over. `match` sees the lowercased HTML of every page we
// read plus the same-host link paths, and returns the evidence string it found (or null).
type SignalSpec = {
  id: string;
  match: (ctx: MatchContext) => string | null;
  /** One line for the model: what this signal means in terms of recurring work. */
  implies: string;
};

type MatchContext = {
  html: string;
  text: string;
  /** Same-host paths seen in links, lowercased, with their anchor text. */
  links: Array<{ path: string; label: string }>;
};

function hasScript(html: string, ...hosts: string[]): string | null {
  for (const h of hosts) if (html.includes(h)) return h;
  return null;
}

function hasPath(links: MatchContext['links'], ...needles: string[]): string | null {
  for (const n of needles) {
    const hit = links.find((l) => l.path.includes(n));
    if (hit) return hit.path;
  }
  return null;
}

function hasWord(text: string, ...words: string[]): string | null {
  for (const w of words) if (text.includes(w)) return w;
  return null;
}

export const PROCESS_SIGNALS: SignalSpec[] = [
  {
    id: 'ecommerce',
    implies: 'sells online: orders, stock, product copy, returns and post-purchase messages recur every week',
    match: ({ html, links, text }) =>
      hasScript(html, 'cdn.shopify.com', 'woocommerce', 'shopifycloud', 'snipcart', 'bigcommerce', 'prestashop') ??
      // '/products' is deliberately NOT here: every SaaS on earth has /products/<feature>, and
      // that one path was enough to hand Vercel an order-desk agent in testing.
      hasPath(links, '/cart', '/checkout', '/collections', '/shop', '/store', '/negozio', '/carrello', '/tienda', '/boutique') ??
      hasWord(text, 'add to cart', 'aggiungi al carrello', 'añadir al carrito', 'ajouter au panier')
  },
  {
    id: 'booking',
    implies: 'takes appointments: scheduling, confirmations, reminders and no-show follow-ups recur',
    match: ({ html, links, text }) =>
      hasScript(html, 'calendly.com', 'cal.com', 'acuityscheduling', 'simplybook', 'setmore', 'treatwell', 'thefork', 'opentable') ??
      hasPath(links, '/book', '/booking', '/prenota', '/appointment', '/reserve', '/reservas', '/rendez-vous', '/prenotazioni') ??
      hasWord(text, 'book a call', 'prenota una', 'reserva una', 'réserver une', 'book now', 'prenota ora')
  },
  {
    id: 'lead_form',
    implies: 'collects enquiries: every submission needs qualifying, answering and chasing',
    match: ({ html, links, text }) =>
      hasScript(html, 'hsforms.net', 'typeform.com', 'tally.so', 'jotform', 'formspree', 'js.hs-scripts.com') ??
      hasPath(links, '/contact', '/contatti', '/contacto', '/preventivo', '/quote', '/get-started', '/demo', '/devis') ??
      hasWord(text, 'request a quote', 'richiedi un preventivo', 'get a demo', 'richiedi una demo', 'solicita presupuesto')
  },
  {
    id: 'support',
    implies: 'answers the same questions repeatedly: a large share of inbound support is deflectable',
    match: ({ html, links }) =>
      hasScript(html, 'intercom', 'crisp.chat', 'zendesk', 'tawk.to', 'freshchat', 'helpscout', 'front.com') ??
      hasPath(links, '/support', '/help', '/assistenza', '/faq', '/ayuda', '/aide', '/documentation', '/docs')
  },
  {
    id: 'blog',
    implies: 'already publishes: an editorial pipeline exists and is usually the first thing to go stale',
    match: ({ links }) => hasPath(links, '/blog', '/news', '/articoli', '/magazine', '/journal', '/insights', '/noticias', '/actualites')
  },
  {
    id: 'newsletter',
    implies: 'owns a list: lifecycle emails, segmentation and re-activation are recurring work',
    match: ({ html, text }) =>
      hasScript(html, 'klaviyo', 'mailchimp', 'list-manage.com', 'sendinblue', 'brevo', 'convertkit', 'beehiiv', 'substack') ??
      hasWord(text, 'newsletter', 'iscriviti alla', 'subscribe to our', 'suscríbete', 'inscrivez-vous')
  },
  {
    id: 'pricing',
    implies: 'sells a defined offer: proposals, objections and competitor pricing move constantly',
    match: ({ links }) => hasPath(links, '/pricing', '/prezzi', '/precios', '/tarifs', '/plans', '/piani', '/abbonamenti')
  },
  {
    id: 'careers',
    implies: 'is hiring: screening, scheduling and candidate replies are pure recurring admin',
    match: ({ links }) => hasPath(links, '/careers', '/jobs', '/lavora-con-noi', '/empleo', '/carriere', '/recrutement', '/hiring')
  },
  {
    id: 'saas',
    implies: 'runs a product with accounts: onboarding, activation and churn signals are measurable weekly',
    match: ({ links, text }) =>
      hasPath(links, '/login', '/signup', '/sign-up', '/app', '/dashboard', '/accedi', '/registrati') ??
      hasWord(text, 'free trial', 'prova gratuita', 'start for free', 'inizia gratis')
  },
  {
    id: 'social',
    implies: 'has social accounts to feed: publishing, replies and community work never stop',
    match: ({ html }) =>
      hasScript(html, 'instagram.com/', 'tiktok.com/@', 'linkedin.com/company', 'facebook.com/', 'youtube.com/@', 'x.com/')
  },
  {
    id: 'local',
    implies: 'serves a place: reviews, local listings and opening-hours questions are the recurring load',
    match: ({ html, text }) =>
      hasScript(html, 'maps.google', 'google.com/maps', 'schema.org/LocalBusiness') ??
      hasWord(text, 'opening hours', 'orari di apertura', 'horario de apertura', "horaires d'ouverture", 'come raggiungerci')
  },
  {
    id: 'analytics',
    implies: 'already measures: numbers exist that nobody reads on a schedule',
    match: ({ html }) =>
      hasScript(html, 'googletagmanager.com', 'google-analytics.com', 'plausible.io', 'posthog', 'matomo', 'hotjar', 'clarity.ms')
  },
  {
    id: 'multilingual',
    implies: 'speaks more than one language: every asset has to exist twice, and usually does not',
    match: ({ html }) => {
      const m = html.match(/hreflang=["']([a-z]{2})(-[a-z]{2})?["']/gi);
      if (!m) return null;
      const langs = new Set(m.map((s) => s.toLowerCase().replace(/.*hreflang=["']/, '').slice(0, 2)));
      langs.delete('x-');
      if (langs.size <= 1) return null;
      // A site with 30 hreflangs would fill the whole chip with a comma list; the count is the
      // fact that matters and the first three are the proof.
      const list = [...langs];
      return list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', ');
    }
  }
];

const SIGNAL_IDS = new Set(PROCESS_SIGNALS.map((s) => s.id));

/** Every process this site visibly runs. Deterministic: same HTML in, same signals out. */
export function detectSignals(pages: Array<{ html: string; links: Array<{ path: string; label: string }> }>): DetectedSignal[] {
  const html = pages.map((p) => p.html).join('\n').toLowerCase();
  const text = stripTags(html);
  const links = pages.flatMap((p) => p.links);
  const out: DetectedSignal[] = [];
  for (const spec of PROCESS_SIGNALS) {
    const evidence = spec.match({ html, text, links });
    if (evidence) out.push({ id: spec.id, evidence: evidence.slice(0, 120) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Page reading
// ---------------------------------------------------------------------------------------------

function normalizeUrl(input: string): string {
  const t = input.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function hostLabel(input: string): string {
  try {
    return new URL(normalizeUrl(input)).hostname.replace(/^www\./, '');
  } catch {
    return input;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    'i'
  );
  const m = html.match(re);
  return (m?.[1] || m?.[2] || '').trim();
}

function extractHeadings(html: string, limit = 24): string[] {
  const out: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const t = stripTags(m[1]).slice(0, 140);
    if (t.length > 2) out.push(t);
  }
  return out;
}

/** Same-host links with their anchor text. Off-site links are dropped; they are not this site's processes. */
export function extractLinks(html: string, base: string): Array<{ path: string; label: string }> {
  const out: Array<{ path: string; label: string }> = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    return out;
  }
  while ((m = re.exec(html)) && out.length < 300) {
    let u: URL;
    try {
      u = new URL(m[1], baseUrl);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, '') !== baseUrl.hostname.replace(/^www\./, '')) continue;
    const path = (u.pathname + u.search).toLowerCase();
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, label: stripTags(m[2]).slice(0, 60) });
  }
  return out;
}

// Which extra pages are worth a round-trip, most informative first. A pricing page says more about
// how a business runs than ten more paragraphs of homepage copy.
const PAGE_PRIORITY: string[] = [
  '/pricing', '/prezzi', '/precios', '/tarifs', '/plans', '/piani',
  '/services', '/servizi', '/servicios', '/what-we-do', '/soluzioni', '/solutions',
  '/about', '/chi-siamo', '/nosotros', '/a-propos',
  '/contact', '/contatti', '/contacto',
  '/shop', '/products', '/collections', '/negozio',
  '/faq', '/support', '/help', '/assistenza',
  '/careers', '/jobs', '/lavora-con-noi'
];

/** Up to MAX_EXTRA_PAGES internal pages, deduplicated, homepage excluded. */
export function pickInternalPages(
  links: Array<{ path: string; label: string }>,
  limit = MAX_EXTRA_PAGES
): string[] {
  const out: string[] = [];
  for (const needle of PAGE_PRIORITY) {
    if (out.length >= limit) break;
    const hit = links.find(
      (l) => l.path.includes(needle) && !out.includes(l.path) && l.path !== '/' && !/\.(pdf|jpg|png|zip|svg|webp)$/i.test(l.path)
    );
    if (hit) out.push(hit.path);
  }
  return out;
}

type PageRead = { url: string; html: string; links: Array<{ path: string; label: string }> };

async function readSite(rawUrl: string): Promise<PageRead[]> {
  const home = await safeFetchUrl(rawUrl, { maxBytes: 1_200_000, timeoutMs: 15_000 });
  if (!home.body || home.body.length < 300) throw new Error('Could not load enough content from that page');
  const homeLinks = extractLinks(home.body, home.url);
  const pages: PageRead[] = [{ url: home.url, html: home.body, links: homeLinks }];

  const extras = pickInternalPages(homeLinks);
  const fetched = await Promise.allSettled(
    extras.map(async (path) => {
      const target = new URL(path, home.url).toString();
      const res = await safeFetchUrl(target, { maxBytes: 500_000, timeoutMs: 8_000, maxRedirects: 2 });
      return { url: res.url, html: res.body, links: extractLinks(res.body, res.url) };
    })
  );
  for (const r of fetched) {
    // An extra page is a bonus. One 404 or one slow sub-page never costs the whole scan.
    if (r.status === 'fulfilled' && r.value.html.length > 200) pages.push(r.value);
  }
  return pages;
}

// ---------------------------------------------------------------------------------------------
// What the agent gets handed
// ---------------------------------------------------------------------------------------------

export type SiteRead = {
  url: string;
  host: string;
  title: string;
  description: string;
  headings: string[];
  navLabels: string[];
  /** Same-host paths worth a second look, already ranked. */
  otherPages: string[];
  text: string;
  pagesRead: string[];
  signals: DetectedSignal[];
};

function toSiteRead(pages: PageRead[]): SiteRead {
  const home = pages[0];
  return {
    url: home.url,
    host: hostLabel(home.url),
    title: (home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim().slice(0, 200),
    description: metaContent(home.html, 'description').slice(0, 300),
    headings: pages.flatMap((p) => extractHeadings(p.html, 12)),
    navLabels: home.links.map((l) => l.label).filter(Boolean).slice(0, 40),
    otherPages: home.links
      .map((l) => l.path)
      .filter((p) => p !== '/' && !/\.(pdf|jpg|jpeg|png|zip|svg|webp|xml|ico)$/i.test(p))
      .slice(0, 60),
    text: pages.map((p) => stripTags(p.html)).join('\n\n'),
    pagesRead: pages.map((p) => new URL(p.url).pathname || '/'),
    signals: detectSignals(pages)
  };
}

// One conversation asks about the same site several times: the first turn reads it, and every
// later turn would otherwise pay the same four fetches to learn nothing new. Serverless instances
// are short-lived, so this is a saving and never a source of truth — a miss just reads again.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; read: SiteRead }>();

/** Read a site the deterministic way: homepage + the pages that say how the business runs. */
export async function readSiteForAgent(rawUrl: string, opts?: { fresh?: boolean }): Promise<SiteRead> {
  const input = rawUrl.trim().slice(0, 300);
  if (!input) throw new Error('A website URL is required');
  const key = normalizeUrl(input).toLowerCase();

  const hit = cache.get(key);
  if (!opts?.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.read;

  const read = toSiteRead(await readSite(normalizeUrl(input)));
  cache.set(key, { at: Date.now(), read });
  // The map is per-instance and tiny; this only stops a long-lived instance from growing forever.
  if (cache.size > 50) for (const k of [...cache.keys()].slice(0, 20)) cache.delete(k);
  return read;
}

/** One extra page of a site already read. Same-host only — the path comes from a model. */
export async function readPageForAgent(
  siteUrl: string,
  path: string
): Promise<{ path: string; title: string; text: string; signals: DetectedSignal[] }> {
  const base = new URL(normalizeUrl(siteUrl));
  const target = new URL(String(path || '/').trim(), base);
  if (target.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) {
    throw new Error('That page is not on this site');
  }
  const res = await safeFetchUrl(target.toString(), { maxBytes: 600_000, timeoutMs: 10_000, maxRedirects: 2 });
  const links = extractLinks(res.body, res.url);
  return {
    path: new URL(res.url).pathname || '/',
    title: (res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim().slice(0, 200),
    text: stripTags(res.body).slice(0, 6000),
    signals: detectSignals([{ html: res.body, links }])
  };
}

/** The site, in the shape a system prompt can carry. */
export function siteBriefForPrompt(read: SiteRead): string {
  const detected = read.signals.length
    ? read.signals
        .map((s) => {
          const spec = PROCESS_SIGNALS.find((p) => p.id === s.id);
          return `- ${s.id} (seen: ${s.evidence}) → ${spec?.implies ?? ''}`;
        })
        .join('\n')
    : '(none detected — the site is thin, so ASK before assuming any process exists)';

  return `SITE
URL: ${read.url}
Host: ${read.host}
Title: ${read.title}
Meta: ${read.description}
Pages read: ${read.pagesRead.join(', ')}
Other pages you can open with read_page: ${read.otherPages.join(', ').slice(0, 900)}
Headings: ${read.headings.join(' | ').slice(0, 1200)}
Navigation: ${read.navLabels.join(' · ').slice(0, 600)}
Text (truncated): ${read.text.slice(0, 7000)}

DETECTED PROCESSES — facts read out of the HTML, not guesses. Build on them:
${detected}`;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

function str(v: unknown, max = 400): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function strList(v: unknown, max = 6, len = 120): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, len)).filter(Boolean).slice(0, max);
}

function level(v: unknown, fallback: Level = 'medium'): Level {
  const s = String(v ?? '').toLowerCase();
  return s === 'high' || s === 'medium' || s === 'low' ? s : fallback;
}

function department(v: unknown): AgentDepartment {
  const s = String(v ?? '').toLowerCase() as AgentDepartment;
  return DEPARTMENTS.includes(s) ? s : 'ops';
}

export function slugify(v: unknown, fallback: string): string {
  const s = String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || fallback;
}

/** 0.5–20 h/week. Anything outside that is a number nobody believes, whichever direction it went. */
export function clampHours(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(Math.min(20, Math.max(0.5, n)) * 2) / 2;
}

/**
 * Turn one proposed agent into one we are willing to put on screen.
 *
 * The two refusals that matter, both about standing on nothing:
 *   1. a signal we never detected is dropped — the card would otherwise cite evidence that does
 *      not exist on this site;
 *   2. an agent left with no signal AND nothing said about why is refused outright. A teammate
 *      invented out of thin air costs more trust than a smaller team.
 * Everything else is clamped rather than refused: a card missing its cadence is still a card.
 */
export function normalizeProposedAgent(raw: unknown, detected: DetectedSignal[]): TeamAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const detectedIds = new Set(detected.map((s) => s.id));

  const name = str(a.name, 60);
  const mission = str(a.mission, 600);
  if (!name || !mission) return null;

  const signals = strList(a.signals, 4, 40)
    .map((s) => s.toLowerCase().trim())
    .filter((s) => detectedIds.has(s) && SIGNAL_IDS.has(s));
  const because = str(a.because, 400);
  if (!signals.length && because.length < 20) return null;

  return {
    id: slugify(a.id ?? name, 'agent'),
    name,
    role: str(a.role, 160),
    department: department(a.department),
    mission,
    because,
    signals,
    cadence: str(a.cadence, 80),
    inputs: strList(a.inputs, 5),
    outputs: strList(a.outputs, 5),
    integrations: strList(a.integrations, 6, 40),
    handoffTo: strList(a.handoffTo, 3, 60),
    impact: level(a.impact),
    effort: level(a.effort),
    hoursSavedPerWeek: clampHours(a.hoursSavedPerWeek),
    firstTask: str(a.firstTask, 400),
    library: null
  };
}
