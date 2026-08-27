import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { logOnboardingError } from '$lib/server/onboarding-errors';

// Import a team member's photo from an EXTERNAL url (detected during brand analysis) into the
// private brand-knowledge bucket — the same place manual uploads land — so a detected person can
// be used as an image reference and persisted just like a manually-added one. SSRF-safe.
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' || h === '0.0.0.0' || h === '::1' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
  );
}

function assertPublicUrl(raw: string): URL {
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHost(parsed.hostname)) {
    throw new Error('Forbidden host');
  }
  return parsed;
}

// Social CDNs (IG/TikTok/X) almost always 302 — reject-all redirects dropped every thumb. Follow
// redirects manually and re-check each hop so we never land on a private IP.
async function fetchPublicImage(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(current);
    const res = await fetch(current, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DalNullaBot/1.0)',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Bad redirect');
      current = new URL(loc, current).href;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

function sniffImageExt(buf: Buffer, contentType: string): string | null {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct.startsWith('image/')) {
    const ext = (ct.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
    return ext === 'jpeg' ? 'jpg' : ext || 'jpg';
  }
  // CDNs often serve images as application/octet-stream — sniff magic bytes.
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6) === 'GIF87a') return 'gif';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({}));
  const raw = String(body?.url ?? '').trim();
  let start: URL;
  try {
    start = assertPublicUrl(raw);
  } catch {
    return new Response('Forbidden host', { status: 400 });
  }

  let res: Response;
  try {
    res = await fetchPublicImage(start.href);
  } catch (e) {
    await logOnboardingError(supabase, user.id, 'people_import', e, { host: start.hostname });
    return new Response('Fetch failed', { status: 400 });
  }
  if (!res.ok) {
    await logOnboardingError(supabase, user.id, 'people_import', `Fetch failed: HTTP ${res.status}`, { host: start.hostname });
    return new Response('Fetch failed', { status: 400 });
  }

  const contentType = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_BYTES) return new Response('Bad size', { status: 400 });
  const ext = sniffImageExt(buf, contentType);
  if (!ext) return new Response('Not an image', { status: 400 });

  const path = `${user.id}/onboarding/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage
    .from('brand-knowledge')
    .upload(path, buf, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false });
  if (up.error) {
    await logOnboardingError(supabase, user.id, 'people_import', up.error.message, { host: start.hostname, size: buf.length });
    return new Response(up.error.message, { status: 400 });
  }

  const { data } = await supabase.storage.from('brand-knowledge').createSignedUrl(path, 60 * 60 * 2);
  return new Response(JSON.stringify({ path, url: data?.signedUrl ?? null }), {
    headers: { 'content-type': 'application/json' }
  });
};
