// Brand "people": real creators/founders (uploaded photos) or AI-generated avatars (built from a
// few attributes). One person = one `public.people` row + 1..N reference images in the private
// `brand-knowledge` bucket. Two jobs live here:
//   1. Create the images — AI generation (a canonical base portrait, then a couple of poses kept
//      consistent via reference-image conditioning) and the upload that backs both paths.
//   2. Feed people into the planner/generator — sign the private image paths and attach them to a
//      brand profile as `profile.people`, which content-preview turns into image references so the
//      person's face stays consistent across generated posts.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchImagePart } from './brand-context';
import { structured } from './research';
import { jpegIfHeic } from './raster-image';

const BUCKET = 'brand-knowledge';
const SIGN_TTL_SECONDS = 60 * 60 * 2; // 2h — long enough for a generation run

// Nessun id modello scritto qui: le facce escono dallo SLOT IMMAGINI come ogni altro render del
// prodotto, quindi il modello lo sceglie il registro e cambia con lui. Prima c'era
// `gemini-3.1-flash-lite-image` — l'id GOOGLE dello stesso Nano Banana 2 Lite che lo slot serve —
// e con lui l'unico client Google costruito fuori dal registro: gli avatar erano l'unica immagine
// del prodotto che non passava di lì, e nessuno l'aveva deciso.

export type PersonImage = { path: string; label?: string };

export type PersonAttributes = {
  gender?: string;
  ageRange?: string;
  ethnicity?: string;
  vibe?: string;
};

// What the planner/generator sees for one person: name/role/description + fetchable image URLs.
// `attributes` (gender/ageRange) feed the caption+image prompts so the model never guesses the
// person's gender from their name (ambiguous names like "Andrea" got misgendered without them).
export type ProfilePerson = { name: string; role?: string; description?: string; images: string[]; attributes?: PersonAttributes };

// ----------------------------------------------------------------------------------------------
// Signed URLs
// ----------------------------------------------------------------------------------------------

// Batch-sign storage paths in the private bucket. Returns a path→signedUrl map; failed paths are
// simply absent. Order is not guaranteed, so callers map by path.
export async function signPaths(
  supabase: SupabaseClient,
  paths: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const clean = paths.filter(Boolean);
  if (!clean.length) return out;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(clean, SIGN_TTL_SECONDS);
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}

// Sign a person's images (in stored order), dropping any that fail to sign.
export async function signPersonImages(
  supabase: SupabaseClient,
  images: PersonImage[]
): Promise<string[]> {
  const map = await signPaths(supabase, images.map((i) => i.path));
  return images.map((i) => map.get(i.path)).filter((u): u is string => !!u);
}

// ----------------------------------------------------------------------------------------------
// AI generation
// ----------------------------------------------------------------------------------------------

// Compose a portrait prompt from the lightweight attribute picker + free-text description.
function buildPersonPrompt(attributes: PersonAttributes | null | undefined, description: string): string {
  const a = attributes ?? {};
  const traits = [a.gender, a.ageRange, a.ethnicity].filter(Boolean).join(', ');
  const vibe = a.vibe ? `, ${a.vibe} style` : '';
  const who = traits ? `a ${traits} person${vibe}` : `a person${vibe}`;
  const desc = description?.trim() ? ` ${description.trim()}.` : '';
  return (
    `Photorealistic portrait photograph of ${who}.${desc} ` +
    `Looking at camera, natural skin texture, soft flattering studio lighting, neutral background, ` +
    `shot on a DSLR, 8k, sharp focus. A real, believable human. No text, no watermark.`
  );
}

type ImagePart = { inlineData: { mimeType: string; data: string } };

// Un render dallo slot immagini → un data URL base64 (o undefined). `refs` sono le foto che
// bloccano la stessa faccia da una posa all'altra: `personImages` è lo slot giusto, perché è quello
// che dice al modello che le foto SONO l'identità e non un suggerimento di stile.
//
// L'import è dinamico per non chiudere il ciclo: `content-preview/images.ts` importa `signPaths` da
// qui.
async function genImage(text: string, refs: ImagePart[] = []): Promise<string | undefined> {
  const { renderPostImage } = await import('./content-preview/images');
  return await renderPostImage(null as never, text, { personImages: refs, aspectRatio: '1:1' });
}

function dataUrlToImagePart(dataUrl: string): ImagePart | null {
  const [head, data] = dataUrl.split(',');
  if (!data) return null;
  const mimeType = head.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  return { inlineData: { mimeType, data } };
}

// The poses generated after the base, each kept identical to the base face via reference conditioning.
const POSES = [
  'a natural three-quarter angle headshot, friendly expression',
  'a relaxed half-body shot, casual confident pose'
];

// Generate an AI person: one canonical base portrait, then POSES.length consistent variations. Returns
// base64 data URLs (base first). Variations reuse the base as a reference so the identity stays fixed.
export async function generateAiPersonImages(
  opts: { attributes?: PersonAttributes; description?: string }
): Promise<string[]> {
  const basePrompt = buildPersonPrompt(opts.attributes, opts.description ?? '');
  const base = await genImage(basePrompt);
  if (!base) return [];

  const baseRef = dataUrlToImagePart(base);
  const out = [base];
  if (!baseRef) return out;

  const variants = await Promise.all(
    POSES.map((pose) =>
      genImage(
        `Same person, same face, same identity as the attached reference image — keep visual ` +
          `consistency. ${pose}. Photorealistic, natural lighting, neutral background, 8k. No text.`,
        [baseRef]
      ).catch((error) => { swallow('generate persona image variant', error); return undefined; })
    )
  );
  for (const v of variants) if (v) out.push(v);
  return out;
}

// ----------------------------------------------------------------------------------------------
// Upload
// ----------------------------------------------------------------------------------------------

// Upload base64 data URLs to the private bucket under {userId}/{brandId}/people/. Returns the stored
// PersonImage refs (path + optional label), skipping any that fail.
export async function uploadPersonDataUrls(
  supabase: SupabaseClient,
  userId: string,
  brandId: string,
  dataUrls: string[],
  labelFor?: (index: number) => string | undefined
): Promise<PersonImage[]> {
  const refs: PersonImage[] = [];
  for (let i = 0; i < dataUrls.length; i++) {
    const base64 = dataUrls[i].split(',')[1];
    if (!base64) continue;
    const bytes = Buffer.from(base64, 'base64');
    const path = `${userId}/${brandId}/people/${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'image/png',
      upsert: false
    });
    if (!error) refs.push({ path, label: labelFor?.(i) });
  }
  return refs;
}

// Upload an already-buffered file (used by the real-photo upload form) to the private bucket.
export async function uploadPersonFile(
  supabase: SupabaseClient,
  userId: string,
  brandId: string,
  file: { buffer: ArrayBuffer; name: string; type: string },
  label?: string
): Promise<PersonImage | null> {
  const converted = await jpegIfHeic(Buffer.from(file.buffer), {
    mime: file.type,
    filename: file.name
  });
  if (!converted.ok) return null;
  const path = `${userId}/${brandId}/people/${crypto.randomUUID()}-${converted.filename}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, converted.bytes, {
    contentType: converted.mime,
    upsert: false
  });
  if (error) return null;
  return { path, label };
}

// ----------------------------------------------------------------------------------------------
// Feeding the planner/generator
// ----------------------------------------------------------------------------------------------

// Load a brand's people and attach them to the planner profile as `profile.people` (with signed,
// fetchable image URLs). No-op-safe: leaves profile.people untouched if it's already populated
// (onboarding passes people in directly, before any brand row exists).
export async function attachBrandPeople(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any,
  supabase: SupabaseClient,
  brandId: string
): Promise<void> {
  if (Array.isArray(profile?.people) && profile.people.length) return;
  const { data: rows } = await supabase
    .from('people')
    .select('name, role, description, images, attributes')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (!rows?.length) return;

  const people: ProfilePerson[] = [];
  for (const r of rows) {
    const images = await signPersonImages(supabase, (r.images ?? []) as PersonImage[]);
    if (images.length)
      people.push({
        name: r.name,
        role: r.role ?? undefined,
        description: r.description ?? undefined,
        images,
        attributes: (r.attributes as PersonAttributes | null) ?? undefined
      });
  }
  if (people.length) profile.people = people;
}

// ----------------------------------------------------------------------------------------------
// Attribute inference (backfill)
// ----------------------------------------------------------------------------------------------

const ATTR_SCHEMA = {
  type: 'object' as const,
  properties: {
    gender: {
      type: 'string' as const,
      enum: ['female', 'male', 'nonbinary'] as const,
      description: 'The perceived gender presentation of the person in the photo.'
    },
    ageRange: { type: 'string' as const, description: "Approximate age range, e.g. '25-34'." }
  },
  required: ['gender', 'ageRange']
};

// Backfill people.attributes (gender/ageRange) by LOOKING at each person's reference photo, for
// rows that miss them (onboarding-created people: website team, social profiles, manual uploads).
// Without these the content prompts carry no gender and the model infers it from the NAME — which
// misgenders ambiguous names. One flash vision call per person; best-effort, never throws.
export async function inferMissingPersonAttributes(
  supabase: SupabaseClient,
  brandId: string
): Promise<void> {
  const { data: rows } = await supabase
    .from('people')
    .select('id, images, attributes')
    .eq('brand_id', brandId);
  const todo = (rows ?? []).filter(
    (r) => !(r.attributes as PersonAttributes | null)?.gender && Array.isArray(r.images) && r.images.length
  );
  if (!todo.length) return;
  await Promise.all(
    todo.map(async (r) => {
      try {
        const [url] = await signPersonImages(supabase, (r.images as PersonImage[]).slice(0, 1));
        if (!url) return;
        const part = await fetchImagePart(url);
        if (!part) return;
        const parsed = await structured<{ gender?: string; ageRange?: string }>(
          null as never,
          'Look at the attached reference photo of a real person and report their perceived gender presentation and approximate age range. This is used only to describe them accurately and respectfully in generated content.',
          ATTR_SCHEMA,
          undefined,
          { label: 'personAttributes', images: [part] }
        );
        if (!parsed.gender) return;
        const attributes: PersonAttributes = {
          ...((r.attributes as PersonAttributes | null) ?? {}),
          gender: String(parsed.gender),
          ...(parsed.ageRange ? { ageRange: String(parsed.ageRange) } : {})
        };
        await supabase.from('people').update({ attributes }).eq('id', r.id);
      } catch (error) { swallow('infer person attributes', error); }
    })
  );
}
