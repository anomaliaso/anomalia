import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { fetchSocialProfile } from '$lib/server/scrapecreators';
import { logOnboardingError } from '$lib/server/onboarding-errors';

// People detection from the brand's OWN socials. A personal handle (e.g. a founder's Instagram) is
// full of the person's photos, so we propose it as a brand "person": display name + a face photo
// (profile picture, with recent post thumbnails as extra reference images). The wizard merges these
// into the detected-people list (pre-selected, toggleable) and imports their photos through the same
// SSRF-safe /people/import path as website-detected team members.
//
// Only PERSONAL surfaces are probed (instagram, tiktok, threads, x). Brand-only surfaces (a Facebook
// page, a LinkedIn company, a YouTube channel) don't represent a single face and are skipped.
//
// Keep this well under typical edge/proxy idle limits (~30s): a hung ScrapeCreators call used to
// outlive the browser fetch and surface as client "Failed to fetch" with no JSON body.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

const PERSONAL_PLATFORMS = new Set(['instagram', 'tiktok', 'threads', 'x']);
/** Per-handle budget so one slow platform can't kill the whole people step. */
const PROFILE_TIMEOUT_MS = 15_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHandles(raw: any): { platform: string; username: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((h: any) => ({
      platform: String(h?.platform ?? '').toLowerCase(),
      username: String(h?.username ?? '').trim().replace(/^@/, '')
    }))
    .filter((h) => PERSONAL_PLATFORMS.has(h.platform) && h.username);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({}));
  const handles = parseHandles(body?.handles);
  if (!handles.length) {
    return new Response(JSON.stringify({ people: [] }), { headers: { 'content-type': 'application/json' } });
  }

  try {
    const profiles = await Promise.all(
      handles.map((h) => withTimeout(fetchSocialProfile(h.platform, h.username), PROFILE_TIMEOUT_MS))
    );
    // Keep only profiles we found a usable face photo for — a candidate with no image can't seed a
    // person model. Dedupe by lowercased name so the same person on IG + Threads appears once, but
    // KEEP the second surface's shots: more angles of the same face make a better reference set.
    const at = new Map<string, number>();
    const people: { name: string; role: string; image: string; thumbs: string[]; source: string }[] = [];
    for (const p of profiles) {
      if (!p || !p.photoUrl) continue;
      const key = (p.name || p.username).toLowerCase();
      const idx = at.get(key);
      const shots = [...new Set([p.photoUrl, ...(p.thumbs ?? [])].filter(Boolean))] as string[];
      if (idx !== undefined) {
        const cur = people[idx];
        const merged = [...new Set([cur.image, ...cur.thumbs, ...shots])];
        cur.image = merged[0];
        cur.thumbs = merged.slice(1);
        // Prefer a real display name over a bare handle when a later surface has it.
        if (p.name && p.name.length > cur.name.length) cur.name = p.name;
        continue;
      }
      at.set(key, people.length);
      people.push({
        name: p.name || p.username,
        role: '',
        image: shots[0],
        thumbs: shots.slice(1),
        source: `${p.platform}:@${p.username}`
      });
    }
    return new Response(JSON.stringify({ people }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    await logOnboardingError(supabase, user.id, 'people_from_socials', e, { handles: handles.length });
    // Non-fatal: the people step still works with website-detected members + manual upload.
    return new Response(JSON.stringify({ people: [] }), { headers: { 'content-type': 'application/json' } });
  }
};
