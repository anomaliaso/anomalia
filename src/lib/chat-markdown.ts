// Minimal, dependency-free markdown → HTML used by the chat surfaces (global chatbot and the
// per-post content editor). Handles inline emphasis/code/links/images, lists, headings, blockquotes,
// fenced code, tables and horizontal rules. Output is escaped before formatting, so it is safe
// to inject with {@html}. Shared so both chats render identically.

import { isShowableMediaUrl } from '$lib/chat-media';

/** Hex (#RGB…#RRGGBBAA), rgb/rgba, hsl/hsla — classic and space-separated CSS Color 4 forms. */
const COLOR_CODE_RE =
  /#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b|rgba?\(\s*(?:[\d.]+%?(?:\s*,\s*|\s+)){2}[\d.]+%?(?:\s*[/,]\s*[\d.]+%?)?\s*\)|hsla?\(\s*[\d.]+(?:deg|rad|turn|grad)?(?:\s*,\s*|\s+)[\d.]+%?(?:\s*,\s*|\s+)[\d.]+%?(?:\s*[/,]\s*[\d.]+%?)?\s*\)/gi;

function isPlausibleCssColor(value: string): boolean {
  const v = value.trim();
  if (/^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(v)) return true;
  if (/^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)) return true;
  return false;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function colorBadgeHtml(color: string): string {
  const safe = color.replace(/"/g, '').replace(/</g, '').replace(/>/g, '');
  const attr = escapeAttr(safe);
  const swatch =
    'display:block;width:0.85em;height:0.85em;border-radius:3px;flex-shrink:0;' +
    'border:1px solid color-mix(in srgb, currentColor 20%, transparent);' +
    `background-color:${safe}`;
  const badge =
    'display:inline-flex;align-items:center;gap:0.35em;margin:0 0.1em;padding:0.12em 0.45em 0.12em 0.3em;' +
    'border-radius:999px;border:1px solid color-mix(in srgb, currentColor 14%, transparent);' +
    'background:color-mix(in srgb, currentColor 6%, transparent);color:inherit;' +
    'font:inherit;font-size:0.92em;font-variant-numeric:tabular-nums;line-height:1.2;' +
    'cursor:pointer;vertical-align:middle;-webkit-tap-highlight-color:transparent';
  return (
    `<button type="button" class="chat-color-badge" style="${badge}" data-color="${attr}" title="Copy ${attr}" aria-label="Copy color ${attr}">` +
    `<span class="chat-color-swatch" style="${swatch}" aria-hidden="true"></span>` +
    `<span class="chat-color-label">${attr}</span>` +
    `</button>`
  );
}

/**
 * Wrap hex/rgb/hsl color codes in a clickable badge with a preview swatch
 * (skips tag attributes so href/src stay untouched).
 */
export function decorateColorCodes(html: string): string {
  return html.replace(/(^|>)([^<]*)/g, (_m, prefix: string, text: string) => {
    if (!text || !/[#rRhH]/.test(text)) return prefix + text;
    const decorated = text.replace(COLOR_CODE_RE, (raw) => {
      if (!isPlausibleCssColor(raw)) return raw;
      return colorBadgeHtml(raw);
    });
    return prefix + decorated;
  });
}

/**
 * If the click landed on a chat image meant for zoom (markdown or attachment thumb),
 * return its URL. Callers open ChatImageLightbox with the result.
 */
export function chatZoomableImageSrc(e: MouseEvent): string | null {
  const target = e.target;
  if (!(target instanceof Element)) return null;
  // Skip images inside navigational post preview cards.
  if (target.closest('a.post-preview-link')) return null;
  const img = target.closest('img.chat-zoomable, img.att-thumb');
  if (!(img instanceof HTMLImageElement)) return null;
  const src = img.currentSrc || img.getAttribute('src');
  if (!src) return null;
  e.preventDefault();
  e.stopPropagation();
  return src;
}

/** Click handler for color badges injected by decorateColorCodes. Returns true if handled. */
export function handleChatColorBadgeClick(e: MouseEvent): boolean {
  const target = e.target;
  if (!(target instanceof Element)) return false;
  const badge = target.closest('.chat-color-badge');
  if (!(badge instanceof HTMLElement)) return false;
  const color = badge.getAttribute('data-color');
  if (!color) return false;
  e.preventDefault();
  e.stopPropagation();
  void navigator.clipboard.writeText(color).then(() => {
    const prev = badge.getAttribute('title');
    badge.setAttribute('title', 'Copied');
    badge.dataset.copied = '1';    window.setTimeout(() => {
      if (prev) badge.setAttribute('title', prev);
      delete badge.dataset.copied;
    }, 1200);
  }).catch(() => {});
  return true;
}

/** Escape user text for {@html} — no markdown. Newlines become <br>. */
export function escapeChatText(text: string): string {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '<br>');
  return decorateColorCodes(html);
}

// Un'immagine markdown incorpora una risorsa nel browser di chi legge, e l'URL lo ha scritto un
// modello che può averlo copiato dalla pagina appena letta: incorporarlo significa consegnare a
// un terzo l'IP e il referrer di chi guarda. Quindi si incorpora solo ciò che è NOSTRO (stessa
// regola di `show_media`), e tutto il resto resta un link — visibile, cliccabile, non caricato.
export function renderMd(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/~~(.*?)~~/g, '<del>$1</del>')
      // Images before links — same []() shape, leading !
      .replace(
        /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (_m, alt: string, src: string, title?: string) =>
          isShowableMediaUrl(src)
            ? `<img class="chat-zoomable" src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy" decoding="async" style="max-width:min(220px,100%);max-height:min(180px,32dvh);width:auto;height:auto;object-fit:contain" />`
            : `<a href="${src}" target="_blank" rel="noopener noreferrer">${alt || src}</a>`
      )
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
        const internal = href.startsWith('/app/') || href.startsWith('/');
        const blank = internal ? '' : ' target="_blank" rel="noopener noreferrer"';
        return `<a href="${href}"${blank}>${label}</a>`;
      });
  const parseRow = (line: string) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const out: string[] = [];
  let inList = false;
  let inOList = false;
  let inCode = false;
  let codeBuf: string[] = [];
  let inTable = false;
  let tableBuf: string[] = [];
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const closeOList = () => {
    if (inOList) {
      out.push('</ol>');
      inOList = false;
    }
  };
  const flushTable = () => {
    if (!inTable || tableBuf.length < 2) {
      inTable = false;
      tableBuf = [];
      return;
    }
    const rows = tableBuf.map(parseRow);
    const header = rows[0];
    const body = rows[2] ? rows.slice(2) : [];
    let t = '<div class="md-table-wrap"><table><thead><tr>';
    for (const h of header) t += '<th>' + inline(h) + '</th>';
    t += '</tr></thead><tbody>';
    for (const r of body) {
      t += '<tr>';
      for (let i = 0; i < header.length; i++) t += '<td>' + inline(r[i] ?? '') + '</td>';
      t += '</tr>';
    }
    t += '</tbody></table></div>';
    out.push(t);
    inTable = false;
    tableBuf = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      if (inCode) {
        out.push(esc(codeBuf.join('\n')) + '</code></pre>');
        inCode = false;
        codeBuf = [];
      } else {
        closeList();
        closeOList();
        flushTable();
        out.push('<pre><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    if (line.startsWith('|')) {
      if (!inTable) {
        closeList();
        closeOList();
        inTable = true;
        tableBuf = [];
      }
      tableBuf.push(line);
      continue;
    }
    if (inTable) flushTable();
    // Standalone image on its own line → block figure
    const onlyImg = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (onlyImg) {
      closeList();
      closeOList();
      const [, alt, src, title] = onlyImg;
      out.push(
        isShowableMediaUrl(src)
          ? `<figure class="md-img"><img class="chat-zoomable" src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy" decoding="async" style="max-width:min(220px,100%);max-height:min(180px,32dvh);width:auto;height:auto;object-fit:contain" /></figure>`
          : `<p><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(alt || src)}</a></p>`
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      closeOList();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push('<li>' + inline(bullet[1]) + '</li>');
      continue;
    }
    const olist = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olist) {
      closeList();
      if (!inOList) {
        out.push('<ol>');
        inOList = true;
      }
      out.push('<li>' + inline(olist[1]) + '</li>');
      continue;
    }
    closeList();
    closeOList();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const lvl = heading[1].length;
      out.push('<h' + lvl + '>' + inline(heading[2]) + '</h' + lvl + '>');
      continue;
    }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      out.push('<blockquote>' + inline(bq[1]) + '</blockquote>');
      continue;
    }
    if (line.match(/^---+$/)) {
      out.push('<hr>');
      continue;
    }
    out.push(line === '' ? '<br>' : inline(line) + '<br>');
  }
  closeList();
  closeOList();
  flushTable();
  if (inCode) out.push(esc(codeBuf.join('\n')) + '</code></pre>');
  return decorateColorCodes(out.join(''));
}
