/** Gmail payload → plain text. Prefers text/plain, falls back to stripped HTML. */

export function decodeBase64Url(data: string): string {
  const pad = data.replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(pad, 'base64');
  return buf.toString('utf8');
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: Array<{ name?: string; value?: string }>;
};

function walkParts(part: GmailPart | undefined, acc: { plain: string[]; html: string[] }): void {
  if (!part) return;
  const mime = (part.mimeType ?? '').toLowerCase();
  const data = part.body?.data;
  if (data) {
    const text = decodeBase64Url(data);
    if (mime === 'text/plain') acc.plain.push(text);
    else if (mime === 'text/html') acc.html.push(text);
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) walkParts(child, acc);
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function extractGmailText(payload: unknown): string {
  const part = payload && typeof payload === 'object' ? (payload as GmailPart) : undefined;
  const acc = { plain: [] as string[], html: [] as string[] };
  walkParts(part, acc);
  const plain = acc.plain.join('\n\n').trim();
  if (plain) return plain;
  const html = acc.html.join('\n\n').trim();
  return html ? stripHtml(html) : '';
}

export function gmailHeader(
  payload: unknown,
  name: string
): string | null {
  const part = payload && typeof payload === 'object' ? (payload as GmailPart) : undefined;
  const headers = part?.headers ?? [];
  const want = name.toLowerCase();
  for (const h of headers) {
    if (String(h.name ?? '').toLowerCase() === want) return String(h.value ?? '').trim() || null;
  }
  return null;
}

export function formatGmailMarkdown(opts: {
  subject: string;
  from: string;
  date: string;
  body: string;
}): string {
  const lines = [
    `# ${opts.subject || '(no subject)'}`,
    '',
    `- From: ${opts.from || 'unknown'}`,
    opts.date ? `- Date: ${opts.date}` : null,
    '',
    opts.body.trim()
  ].filter((l) => l !== null);
  return lines.join('\n').trim();
}

export const GMAIL_LIST_QUERY = 'in:inbox -category:promotions -category:social -category:forums newer_than:30d';

export function parseGmailProfile(data: unknown): string | null {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const email = String(o.emailAddress ?? '').trim();
  return email || null;
}

export function parseGmailMessageList(data: unknown): { ids: string[]; nextPageToken: string | null } {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(o.messages) ? o.messages : [];
  const ids: string[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const id = String((m as Record<string, unknown>).id ?? '').trim();
    if (id) ids.push(id);
  }
  return { ids, nextPageToken: o.nextPageToken ? String(o.nextPageToken) : null };
}
