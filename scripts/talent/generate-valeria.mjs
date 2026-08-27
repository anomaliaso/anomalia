#!/usr/bin/env node
/**
 * Talent library prototype — Valeria multi-view pack via Nano Banana Pro.
 *
 * Consistency strategy:
 *  1. Face-front = identity + hair canon
 *  2. Body-front = wardrobe canon (right after face)
 *  3. Every later shot gets BOTH refs + locked wardrobe + locked hairstyle briefs
 */
import { GoogleGenAI } from '@google/genai';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.TALENT_OUT || join(__dirname, '../../artifacts/talent/valeria');
const ARTIFACTS_DIR = '/opt/cursor/artifacts/talent/valeria';
const MODEL = 'gemini-3-pro-image-preview'; // Nano Banana Pro

const IDENTITY = `Valeria, a 24-year-old Latin American woman.
Tall and lean / slim body, subtle bone structure, little body fat.
Brown mahogany skin with warm undertone.
Deep brown iris with visible white sclera and distinct pupil.
Lean face, subtle bone structure, moderate cheek definition.
Soft knowing smile that feels effortless rather than posed.
Two to three very small faint dark spots (1–2mm) on the left cheek and one near the right cheek — barely noticeable.
Warm, radiant girl-next-door presence. Photorealistic real human, not CGI, not illustration.`;

/**
 * Hard-locked hairstyle — same cut + styling in EVERY shot.
 * Anti-patterns block the “hair pulled back / different part” drift from earlier runs.
 */
const HAIR = `HAIR LOCK — identical cut AND styling in EVERY photo:
• Color: deep jet black with natural dark sheen.
• Texture: tight, well-defined spiral curls (not loose waves, not afro puff, not straightened).
• Length: long, past the shoulders, ending around mid-back.
• Part: slight off-center part (just left of center) — same part in every shot.
• Styling: ALWAYS worn fully DOWN and OPEN. Voluminous curls frame BOTH sides of the face
  symmetrically and fall over the fronts of both shoulders.
• FORBIDDEN: hair pulled back, ponytail, bun, updo, half-up, slicked back, tucked behind both ears,
  different part, shorter cut, wet look, braids, clips, headbands, or any restyle between shots.`;

const HAIR_MATCH = `HAIR MATCH (critical): the attached face-reference photo defines the EXACT haircut and styling.
Keep the same deep-black spiral curls, same mid-back length, same slight off-center part, same
volume framing both sides of the face, hair fully down over both shoulders.
Do NOT restyle, pull back, shorten, or change the part.`;

/**
 * Extremely specific wardrobe lock — copy/paste identical in every clothed shot.
 */
const WARDROBE = `WARDROBE LOCK — identical garment in EVERY photo (same set, same color, same cut):
• Top: soft heather medium-gray athletic sports bra, scoop neckline, thin parallel spaghetti straps
  (~6–8mm). From the BACK the straps stay SEPARATE parallel lines over each shoulder blade and meet
  a simple straight horizontal underband — classic two-strap bra back.
  FORBIDDEN: racerback, Y-back, crossed straps, wide straps, halter, lace, logos, underwire cups.
• Bottom: matching heather medium-gray athletic boy-short briefs, mid-rise, same fabric as the bra,
  clean sporty cut (NOT thong, NOT bikini string, NOT lace lingerie).
• Barefoot. No jewelry, shoes, socks, outerwear, or second layer.
• Calm everyday athletic underwear look — never sexy fashion lingerie.`;

const WARDROBE_MATCH = `CLOTHING MATCH (critical): the attached body-reference photo defines the EXACT outfit.
Reproduce that same heather-gray sports bra + boy-shorts — same shade of gray, same fabric texture,
same scoop neck, same thin parallel spaghetti straps, same straight horizontal back band (NOT racerback),
same boy-short cut and rise. Do not invent a different bra style.`;

const HOUSE = `Neutral seamless studio backdrop (soft light gray #E8E8E8). Soft diffused studio lighting, natural skin texture with pores, no beauty-filter plastic skin. Shot on a high-end DSLR, sharp focus, 8k. No text, no watermark, no logo.`;

const LOCK = `SAME PERSON as the attached reference photo(s) — identical face, age, skin tone, freckle spots, body type, AND identical haircut/hairstyle, identity locked.`;

/**
 * Order: face-front (hair canon) → body-front (wardrobe canon) → rest with both refs.
 * @typedef {{ id: string, label: string, aspectRatio: string, isBase?: boolean, isWardrobeCanon?: boolean, needsCanonRefs?: boolean, prompt: string }} Shot
 * @type {Shot[]}
 */
const SHOTS = [
  {
    id: '01-face-front',
    label: 'Viso · Frontale (dettaglio)',
    aspectRatio: '3:4',
    isBase: true,
    prompt: `${IDENTITY}

${HAIR}

${WARDROBE}

Shot: tight head-and-shoulders portrait, camera squarely front-facing.
This is the CANONICAL hair reference for the whole pack — hair fully down, slight off-center part,
spiral curls framing both sides of the face and falling over both shoulders.
Focus on facial detail: eyes, skin texture, freckle-like spots, hair curl definition.
Visible clothing: thin heather-gray sports-bra spaghetti straps and scoop neckline at shoulders/collarbone.
Expression: soft knowing smile, relaxed, looking at camera.
${HOUSE}`
  },
  {
    id: '02-body-front',
    label: 'Corpo · Quasi intera frontale',
    aspectRatio: '3:4',
    isWardrobeCanon: true,
    prompt: `${LOCK}

${HAIR}
${HAIR_MATCH}

${WARDROBE}

Shot: nearly full-body standing portrait, front-facing — head to mid-calf / almost full figure (not cropped at waist).
This is the CANONICAL wardrobe reference — sports bra + boy-shorts exactly as specified.
Hair must match the face-reference exactly (same down style, same part, same length/volume).
Slim lean frame clearly visible. Relaxed confident stance, arms natural at sides, soft knowing smile, looking at camera.
${HOUSE}`
  },
  {
    id: '03-face-three-quarter',
    label: 'Viso · ¾ (dettaglio)',
    aspectRatio: '3:4',
    needsCanonRefs: true,
    prompt: `${LOCK}

${HAIR}
${HAIR_MATCH}

${WARDROBE_MATCH}

Shot: tight head-and-shoulders, three-quarter angle (camera ~35° off-axis).
Focus on facial detail and cheekbone contour. Soft natural expression, looking toward camera.
Hair stays fully down with the same slight off-center part and curls framing both sides — do NOT pull hair back.
Visible straps/neckline must match the body-reference sports bra exactly.
${HOUSE}`
  },
  {
    id: '04-face-profile',
    label: 'Viso · Profilo (lato)',
    aspectRatio: '3:4',
    needsCanonRefs: true,
    prompt: `${LOCK}

${HAIR}
${HAIR_MATCH}

${WARDROBE_MATCH}

Shot: true side-profile headshot — camera 90° to the face, head-and-shoulders.
Sharp focus on nose bridge, lips, jawline, ear, and spiral-curl hair silhouette.
Hair fully down in the same mid-back spiral-curl style — volume visible behind the head and over the near shoulder; same part as the face reference. Do NOT pin hair up or tuck it all behind the ear.
Neutral calm expression, eyes looking forward (not at camera).
If strap is visible on the shoulder, it must be the same thin heather-gray spaghetti strap from the body reference.
${HOUSE}`
  },
  {
    id: '05-hands-detail',
    label: 'Mani (dettaglio)',
    aspectRatio: '1:1',
    needsCanonRefs: true,
    prompt: `${LOCK} Hands belong to this exact woman.

${HAIR_MATCH}
${WARDROBE_MATCH}

Shot: close-up of both hands resting naturally, palms slightly turned, fingers relaxed.
Show realistic skin texture, knuckles, short natural nails, no rings.
Face/hair may be softly out of frame or only partially visible — if hair is visible, same deep-black spiral curls down.
Any visible clothing scrap must match the body-reference gray sports set.
${HOUSE}`
  },
  {
    id: '06-body-three-quarter',
    label: 'Corpo · Quasi intera ¾',
    aspectRatio: '3:4',
    needsCanonRefs: true,
    prompt: `${LOCK}

${HAIR}
${HAIR_MATCH}

${WARDROBE}
${WARDROBE_MATCH}

Shot: nearly full-body standing portrait at three-quarter angle — head to mid-calf.
Relaxed pose, weight on one leg, soft knowing smile looking toward camera.
Hair identical to face reference (down, same part, same length). Outfit identical to body-front reference.
${HOUSE}`
  },
  {
    id: '07-body-back',
    label: 'Corpo · Schiena (da dietro)',
    aspectRatio: '3:4',
    needsCanonRefs: true,
    prompt: `${LOCK}

${HAIR}
${HAIR_MATCH}

${WARDROBE}
${WARDROBE_MATCH}

CRITICAL BACK DESIGN: from behind, the bra has TWO SEPARATE thin parallel spaghetti straps
(one over each shoulder) and a straight horizontal underband — NOT a racerback, NOT a Y-back,
NOT crossed straps. Same heather-gray fabric and matching boy-shorts as the front reference.

HAIR FROM BEHIND: same long deep-black spiral curls cascading down the back to mid-back —
same length and volume as the face reference, never shorter, never in a ponytail.

Shot: nearly full-body standing portrait from BEHIND — back view, head to mid-calf.
Camera squarely behind the subject. Show back, shoulders, spine line, hair from rear.
Arms relaxed at sides. Head facing away (mostly rear). Do NOT show the face front-on.
${HOUSE}`
  }
];

function ensureDirs(...dirs) {
  for (const d of dirs) mkdirSync(d, { recursive: true });
}

/**
 * @param {import('@google/genai').GoogleGenAI} ai
 * @param {string} text
 * @param {string} aspectRatio
 * @param {{ inlineData: { mimeType: string, data: string } }[]} refs
 */
async function genImage(ai, text, aspectRatio, refs = []) {
  const parts = [{ text }, ...refs];
  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio }
    }
  });
  const ms = Date.now() - t0;
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return {
        mimeType: part.inlineData.mimeType ?? 'image/png',
        data: part.inlineData.data,
        ms
      };
    }
  }
  const textOut = (res.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text)
    .filter(Boolean)
    .join(' ');
  throw new Error(`No image in response (${ms}ms). Model said: ${textOut.slice(0, 200) || '(empty)'}`);
}

function saveImage(dir, id, mimeType, base64) {
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  const path = join(dir, `${id}.${ext}`);
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  ensureDirs(OUT_DIR, ARTIFACTS_DIR);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const manifest = {
    model: 'Valeria',
    generator: MODEL,
    hair: 'deep-black mid-back spiral curls, slight off-center part, always fully down framing both sides',
    wardrobe: 'heather-gray scoop sports bra (parallel thin straps, straight back band) + matching boy-shorts',
    createdAt: new Date().toISOString(),
    identity: IDENTITY,
    shots: []
  };

  /** @type {{ inlineData: { mimeType: string, data: string } } | null} */
  let baseRef = null;
  /** @type {{ inlineData: { mimeType: string, data: string } } | null} */
  let wardrobeRef = null;

  for (const shot of SHOTS) {
    console.log(`\n→ Generating ${shot.id} (${shot.label})…`);
    /** @type {{ inlineData: { mimeType: string, data: string } }[]} */
    const refs = [];
    if (!shot.isBase && baseRef) refs.push(baseRef);
    if ((shot.needsCanonRefs || shot.isWardrobeCanon) && wardrobeRef) refs.push(wardrobeRef);
    // body-front only has face ref at generation time; wardrobeRef is set after it completes

    try {
      const img = await genImage(ai, shot.prompt, shot.aspectRatio, refs);
      const path = saveImage(OUT_DIR, shot.id, img.mimeType, img.data);
      const artPath = saveImage(ARTIFACTS_DIR, shot.id, img.mimeType, img.data);
      console.log(`  ✓ ${path} (${img.ms}ms)`);
      console.log(`  ✓ artifact: ${artPath}`);

      const part = { inlineData: { mimeType: img.mimeType, data: img.data } };
      if (shot.isBase) baseRef = part;
      if (shot.isWardrobeCanon) wardrobeRef = part;

      manifest.shots.push({
        id: shot.id,
        label: shot.label,
        aspectRatio: shot.aspectRatio,
        path,
        artifactPath: artPath,
        ms: img.ms,
        ok: true
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ ${shot.id}: ${msg}`);
      manifest.shots.push({ id: shot.id, label: shot.label, ok: false, error: msg });
      if (shot.isBase || shot.isWardrobeCanon) {
        writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
        process.exit(1);
      }
    }
  }

  const manPath = join(OUT_DIR, 'manifest.json');
  writeFileSync(manPath, JSON.stringify(manifest, null, 2));
  writeFileSync(join(ARTIFACTS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone. Manifest: ${manPath}`);
  console.log(`OK: ${manifest.shots.filter((s) => s.ok).length}/${SHOTS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
