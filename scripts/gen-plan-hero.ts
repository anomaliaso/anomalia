/**
 * Generate a space-themed hero image for the /plan page using Gemini (Nano Banana Pro).
 * Brand palette: purple #c485fe, pink #ff2d8f, blue #00B2FF, pixel-orange #FF5A00
 * Run: npx tsx scripts/gen-plan-hero.ts
 */

import { GoogleGenAI } from '@google/genai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- load env from .env manually ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Missing GEMINI_API_KEY in .env'); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: API_KEY });

const BRAND_COLORS = '#c485fe, #ECB2ED';

const prompt = `An open book or pages floating in space, with indexed cards, bookmarks, and connection lines linking them together like a library catalogue. Use ONLY the brand colors: ${BRAND_COLORS} (and their tints/shades). The scene shows the concept of a content library — pages being scanned, catalogued and organised. Abstract data streams, index tags, and gentle scan-line effects sweep across the floating pages. Small glowing nodes represent indexed content. No text. No UI. 16:9 landscape. Match the style of the attached reference image exactly.`;

const REF_PATH = '/Users/andreabuttarelli/Downloads/sqlite-cover.webp';
const OUT_NAME = 'library-hero';

async function main() {
  console.log('Generating image with gemini-3-pro-image-preview...');

  // Load reference image as base64
  const refBuf = fs.readFileSync(REF_PATH);
  const refBase64 = refBuf.toString('base64');
  const refMime = REF_PATH.endsWith('.webp') ? 'image/webp' : REF_PATH.endsWith('.png') ? 'image/png' : 'image/jpeg';
  console.log(`Reference image loaded: ${(refBuf.length / 1024).toFixed(0)} KB (${refMime})`);

  const reqParts: any[] = [
    { text: prompt },
    { inlineData: { mimeType: refMime, data: refBase64 } }
  ];

  const res = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: [{ role: 'user', parts: reqParts }],
    config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } }
  });

  const outParts = res.candidates?.[0]?.content?.parts ?? [];
  for (const part of outParts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? 'image/png';
      const ext = mime.includes('webp') ? 'webp' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
      const buf = Buffer.from(part.inlineData.data, 'base64');
      const outPath = path.join(root, `${OUT_NAME}.${ext}`);
      fs.writeFileSync(outPath, buf);
      console.log(`Saved: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
      return;
    }
  }
  // No image
  const text = outParts.filter((p: any) => p.text).map((p: any) => p.text).join(' ');
  console.error('No image returned. Text response:', text.slice(0, 500));
  console.error('Finish reason:', res.candidates?.[0]?.finishReason);
  console.error('Block reason:', res.promptFeedback?.blockReason);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
