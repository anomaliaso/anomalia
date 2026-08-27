/**
 * Shared multi-view talent pack generator (Nano Banana Pro).
 * Usage: node scripts/talent/generate.mjs <slug>
 */
import { GoogleGenAI } from '@google/genai';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL = 'gemini-3-pro-image-preview';
const HOUSE = `Neutral seamless studio backdrop (soft light gray #E8E8E8). Soft diffused studio lighting, natural skin texture with pores, no beauty-filter plastic skin. Shot on a high-end DSLR, sharp focus, 8k. No text, no watermark, no logo.`;
const LOCK = `SAME PERSON as the attached reference photo(s) — identical face, age, skin tone, distinguishing marks, body type, AND identical haircut/hairstyle, identity locked.`;

/**
 * @param {import('./characters/noah.mjs').default} c
 */
function buildShots(c) {
  return [
    {
      id: '01-face-front',
      label: 'Viso · Frontale (dettaglio)',
      aspectRatio: '3:4',
      isBase: true,
      prompt: `${c.identity}

${c.hair}

${c.wardrobe}

Shot: tight head-and-shoulders portrait, camera squarely front-facing.
This is the CANONICAL hair reference for the whole pack — same cut and styling as the hair lock.
Focus on facial detail: eyes, skin texture, distinguishing marks, hair.
Expression: soft natural smile, relaxed, looking at camera.
${HOUSE}`
    },
    {
      id: '02-body-front',
      label: 'Corpo · Quasi intera frontale',
      aspectRatio: '3:4',
      isWardrobeCanon: true,
      prompt: `${LOCK}

${c.hair}
${c.hairMatch}

${c.wardrobe}

Shot: nearly full-body standing portrait, front-facing — head to mid-calf / almost full figure (not cropped at waist).
This is the CANONICAL wardrobe reference — render the locked underwear clearly and exactly as specified.
Hair must match the face-reference exactly. Slim/athletic frame clearly visible.
Relaxed confident stance, arms natural at sides, soft natural smile, looking at camera.
${HOUSE}`
    },
    {
      id: '03-face-three-quarter',
      label: 'Viso · ¾ (dettaglio)',
      aspectRatio: '3:4',
      needsCanonRefs: true,
      prompt: `${LOCK}

${c.hair}
${c.hairMatch}

${c.wardrobeMatch}

Shot: tight head-and-shoulders, three-quarter angle (camera ~35° off-axis).
Focus on facial detail. Soft natural expression, looking toward camera.
Hair identical to face reference — do not restyle.
${HOUSE}`
    },
    {
      id: '04-face-profile',
      label: 'Viso · Profilo (lato)',
      aspectRatio: '3:4',
      needsCanonRefs: true,
      prompt: `${LOCK}

${c.hair}
${c.hairMatch}

${c.wardrobeMatch}

Shot: true side-profile headshot — camera 90° to the face, head-and-shoulders.
Sharp focus on nose bridge, lips, jawline, ear, and hair silhouette.
Same haircut as face reference. Neutral calm expression, eyes looking forward (not at camera).
${HOUSE}`
    },
    {
      id: '05-hands-detail',
      label: 'Mani (dettaglio)',
      aspectRatio: '1:1',
      needsCanonRefs: true,
      prompt: `${LOCK} Hands belong to this exact person.

${c.hairMatch}
${c.wardrobeMatch}

Shot: close-up of both hands resting naturally, palms slightly turned, fingers relaxed.
Show realistic skin texture, knuckles, short natural nails, no rings.
Face/hair may be softly out of frame — if visible, match references exactly.
${HOUSE}`
    },
    {
      id: '06-body-three-quarter',
      label: 'Corpo · Quasi intera ¾',
      aspectRatio: '3:4',
      needsCanonRefs: true,
      prompt: `${LOCK}

${c.hair}
${c.hairMatch}

${c.wardrobe}
${c.wardrobeMatch}

Shot: nearly full-body standing portrait at three-quarter angle — head to mid-calf.
Relaxed pose, weight on one leg, soft natural smile looking toward camera.
Hair and outfit identical to the canon references.
${HOUSE}`
    },
    {
      id: '07-body-back',
      label: 'Corpo · Schiena (da dietro)',
      aspectRatio: '3:4',
      needsCanonRefs: true,
      prompt: `${LOCK}

${c.hair}
${c.hairMatch}

${c.wardrobe}
${c.wardrobeMatch}

Shot: nearly full-body standing portrait from BEHIND — back view, head to mid-calf.
Camera squarely behind the subject. Show back, shoulders, spine line, hair from rear, and the back of the locked underwear.
Arms relaxed at sides. Head facing away (mostly rear). Do NOT show the face front-on.
Hair and outfit identical to the canon references.
${HOUSE}`
    }
  ];
}

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
  throw new Error(`No image in response (${ms}ms)`);
}

function saveImage(dir, id, mimeType, base64) {
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  const path = join(dir, `${id}.${ext}`);
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/talent/generate.mjs <slug>');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  const charPath = join(__dirname, 'characters', `${slug}.mjs`);
  const { default: character } = await import(pathToFileURL(charPath).href);
  const outDir = process.env.TALENT_OUT || join(__dirname, '../../artifacts/talent', slug);
  const artifactsDir = join('/opt/cursor/artifacts/talent', slug);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const shots = buildShots(character);
  const manifest = {
    model: character.name,
    slug: character.slug,
    generator: MODEL,
    createdAt: new Date().toISOString(),
    shots: []
  };

  let baseRef = null;
  let wardrobeRef = null;

  for (const shot of shots) {
    console.log(`\n→ Generating ${shot.id} (${shot.label})…`);
    const refs = [];
    if (!shot.isBase && baseRef) refs.push(baseRef);
    if ((shot.needsCanonRefs || shot.isWardrobeCanon) && wardrobeRef) refs.push(wardrobeRef);

    try {
      const img = await genImage(ai, shot.prompt, shot.aspectRatio, refs);
      const path = saveImage(outDir, shot.id, img.mimeType, img.data);
      const artPath = saveImage(artifactsDir, shot.id, img.mimeType, img.data);
      console.log(`  ✓ ${path} (${img.ms}ms)`);

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
        writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        process.exit(1);
      }
    }
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(artifactsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone. OK: ${manifest.shots.filter((s) => s.ok).length}/${shots.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
