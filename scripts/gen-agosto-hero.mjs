/**
 * Generate summer beach hero images for /agosto via Gemini REST (Nano Banana Pro).
 * Avoids needing node_modules.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error('Missing GEMINI_API_KEY');
  process.exit(1);
}

const MODEL = 'gemini-3-pro-image-preview';
const OUT = join(root, 'static/agosto');
mkdirSync(OUT, { recursive: true });

const STYLE =
  'Photorealistic editorial lifestyle photography, Mediterranean August vacation mood, ' +
  'golden-hour warm natural light, turquoise sea, soft sand, premium calm aesthetic, ' +
  'shallow depth of field, no text, no logos, no watermarks, no UI overlays, no phone screens with readable text.';

const shots = [
  {
    f: 'hero-beach.png',
    ratio: '16:9',
    p:
      `${STYLE} Wide cinematic 16:9 hero photo: a young Italian woman in her late 20s lying relaxed on a sunbed ` +
      `at a chic beach club in August, eyes closed, slight smile, straw hat beside her, linen white dress, ` +
      `Aperol spritz on a small side table, closed laptop faintly visible under a towel. ` +
      `Background: blue-and-white striped umbrellas, calm sea horizon, soft bokeh. Feeling: freedom, vacation, autopilot.`
  },
  {
    f: 'couple-sea.png',
    ratio: '4:5',
    p:
      `${STYLE} Vertical 4:5 photo: a stylish couple (man and woman, early 30s) walking barefoot along the shoreline ` +
      `at sunset in Italy, holding hands, laughing, summer outfits (linen shirt, light dress). ` +
      `Warm amber light, gentle waves, carefree August holiday mood. They look like founders on vacation while work runs itself.`
  },
  {
    f: 'phone-tap.png',
    ratio: '4:5',
    p:
      `${STYLE} Vertical 4:5 close-up of a woman's hand holding a modern smartphone at the beach, ` +
      `thumb about to tap the screen. Soft sandy background, turquoise water bokeh, purple beach umbrella out of focus. ` +
      `The phone screen should be blank/off or softly glowing white — no readable UI. Mood: approve in one tap while on holiday.`
  },
  {
    f: 'founder-relax.png',
    ratio: '16:9',
    p:
      `${STYLE} Wide 16:9 photo: a confident male founder in his 30s reclining in a striped hammock on a sandy beach, ` +
      `eyes closed, hands behind head, patterned short-sleeve shirt, wooden side table with closed silver laptop and orange cocktail. ` +
      `Blue-white striped umbrellas, turquoise sea, golden hour. Pure summer autopilot calm.`
  }
];

async function gen(shot) {
  console.log(`Generating ${shot.f} (${shot.ratio})...`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: shot.p }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: shot.ratio }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('HTTP', res.status, errText.slice(0, 500));
    return false;
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const b64 = img?.inlineData?.data ?? img?.inline_data?.data;
  if (!b64) {
    const text = parts.filter((p) => p.text).map((p) => p.text).join(' ');
    console.error('NO IMAGE for', shot.f, text.slice(0, 300));
    console.error('finish:', data.candidates?.[0]?.finishReason, 'block:', data.promptFeedback?.blockReason);
    return false;
  }
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(join(OUT, shot.f), buf);
  console.log('saved', shot.f, Math.round(buf.length / 1024) + 'KB');
  return true;
}

for (const shot of shots) {
  try {
    await gen(shot);
  } catch (e) {
    console.error('Failed', shot.f, e?.message ?? e);
  }
}
console.log('Done.');
