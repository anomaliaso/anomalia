import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { safeFetchBytes, SafeFetchError, type SafeFetchReason, type SafeFetchBytesResult } from '$lib/server/tool-guard';

// Import a team member's photo from an EXTERNAL url (detected during brand analysis) into the
// private brand-knowledge bucket — the same place manual uploads land — so a detected person can
// be used as an image reference and persisted just like a manually-added one.
//
// The URL comes from outside, so the fetch goes through the shared guard: it RESOLVES the host
// instead of matching its name, re-checks every redirect hop (social CDNs almost always 302),
// and refuses a body past the ceiling while it streams rather than after buffering it.
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const IMPORT_USER_AGENT = 'Mozilla/5.0 (compatible; DalNullaBot/1.0)';

// What the browser is told, per refusal — one row per reason, so a new one cannot be answered
// with a message invented at the call site.
const REFUSAL_BY_REASON: Record<SafeFetchReason, string> = {
  not_public: 'Forbidden host',
  too_large: 'Bad size',
  fetch_failed: 'Fetch failed'
};

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
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
  const host = hostOf(raw);

  let fetched: SafeFetchBytesResult;
  try {
    fetched = await safeFetchBytes(raw, {
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      userAgent: IMPORT_USER_AGENT
    });
  } catch (e) {
    const reason: SafeFetchReason = e instanceof SafeFetchError ? e.reason : 'fetch_failed';
    if (reason !== 'not_public') {
      await logOnboardingError(supabase, user.id, 'people_import', e, { host });
    }
    return new Response(REFUSAL_BY_REASON[reason], { status: 400 });
  }

  if (!fetched.ok) {
    await logOnboardingError(supabase, user.id, 'people_import', `Fetch failed: HTTP ${fetched.status}`, { host });
    return new Response('Fetch failed', { status: 400 });
  }

  const buf = fetched.bytes;
  if (buf.length === 0) return new Response('Bad size', { status: 400 });
  const ext = sniffImageExt(buf, fetched.mime);
  if (!ext) return new Response('Not an image', { status: 400 });

  const path = `${user.id}/onboarding/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage
    .from('brand-knowledge')
    .upload(path, buf, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false });
  if (up.error) {
    await logOnboardingError(supabase, user.id, 'people_import', up.error.message, { host, size: buf.length });
    return new Response(up.error.message, { status: 400 });
  }

  const { data } = await supabase.storage.from('brand-knowledge').createSignedUrl(path, 60 * 60 * 2);
  return new Response(JSON.stringify({ path, url: data?.signedUrl ?? null }), {
    headers: { 'content-type': 'application/json' }
  });
};
