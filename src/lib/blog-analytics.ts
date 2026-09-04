/**
 * I tracker che un brand puo' far girare sul PROPRIO blog.
 *
 * Tre cose, in ordine di importanza:
 *
 * 1. **L'elenco e' chiuso.** Non esiste un campo "script": un `<script>` libero su una pagina
 *    pubblica e' esecuzione di codice arbitraria sui visitatori del cliente, e su `/blog/<slug>` —
 *    che sta sulla nostra origine — anche sulla sessione di chi e' loggato in `/app`.
 * 2. **Girano solo sul dominio del brand.** Chi li monta e' `_site/+layout.server.ts`, l'albero
 *    servito quando l'host NON e' il nostro. `/blog/<slug>` non li passa: dimenticarsene significa
 *    non caricarli, mai il contrario.
 * 3. **Girano solo dopo il consenso**, come il pixel che il blog gia' aveva.
 *
 * Le forme degli id sono ricopiate dal contratto (`@anomalia/api-contracts`) invece di essere
 * importate: importarle trascinerebbe zod nel bundle del blog pubblico per quattro regex.
 * `blog-analytics.test.ts` fallisce se le due tabelle divergono.
 */

export const BLOG_ANALYTICS_ID_PATTERNS: Record<string, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,20}$/,
  meta_pixel: /^[0-9]{6,20}$/,
  plausible: /^[a-z0-9][a-z0-9.-]{1,78}[a-z0-9]$/,
  hotjar: /^[0-9]{5,12}$/
};

export type BlogAnalyticsEntry = { provider: string; id: string };

function inline(code: string) {
  const s = document.createElement('script');
  s.textContent = code;
  document.head.appendChild(s);
}

function external(src: string, attrs: Record<string, string> = {}) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

/**
 * Uno snippet per fornitore. L'id ci entra gia' verificato contro il pattern qui sopra, che e'
 * l'unica ragione per cui interpolarlo e' sicuro: nessuno dei quattro alfabeti contiene una
 * virgoletta, un `<` o uno spazio.
 */
const LOADERS: Record<string, (id: string) => void> = {
  ga4: (id) => {
    external(`https://www.googletagmanager.com/gtag/js?id=${id}`);
    inline(
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id}');`
    );
  },
  meta_pixel: (id) =>
    inline(
      `!(function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)})(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`
    ),
  plausible: (id) => external('https://plausible.io/js/script.js', { 'data-domain': id, defer: '' }),
  hotjar: (id) =>
    inline(
      `(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${id},hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j;a.appendChild(r)})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`
    )
};

export const BLOG_ANALYTICS_PROVIDERS = Object.keys(LOADERS);

/** Quali voci sono davvero rendibili. Una riga che non lo e' non e' un errore: e' da ignorare. */
export function renderableBlogAnalytics(entries: readonly BlogAnalyticsEntry[]): BlogAnalyticsEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const pattern = BLOG_ANALYTICS_ID_PATTERNS[e.provider];
    if (!pattern || !LOADERS[e.provider] || !pattern.test(e.id) || seen.has(e.provider)) return false;
    seen.add(e.provider);
    return true;
  });
}

let loaded = false;

/** Idempotente: un secondo consenso nella stessa pagina non raddoppia i PageView. */
export function loadBlogAnalytics(entries: readonly BlogAnalyticsEntry[]) {
  if (loaded || typeof document === 'undefined') return;
  const renderable = renderableBlogAnalytics(entries);
  if (!renderable.length) return;
  loaded = true;
  for (const e of renderable) LOADERS[e.provider](e.id);
}
