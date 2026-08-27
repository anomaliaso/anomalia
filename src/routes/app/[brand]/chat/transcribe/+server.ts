import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { loggedGemini, withBrandContext } from '$lib/server/ai-log';
import { geminiFlash, googleGenaiClient } from '$lib/server/gemini';
import { MAX_AUDIO_BYTES } from '$lib/speech-to-text';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

/**
 * What Gemini takes as audio. The composer always sends WAV (it re-encodes the take, because
 * Chrome and Firefox record Opus-in-WebM and that is not on this list); the rest are here so a
 * future caller with a real mp3 or ogg is not rejected for no reason.
 */
const ACCEPTED = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/ogg',
  'audio/aac',
  'audio/aiff',
  'audio/flac'
]);

/** Same bytes, different spelling: browsers are not consistent about these, Gemini is. */
const ALIASES: Record<string, string> = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/mpeg': 'audio/mp3',
  'audio/x-m4a': 'audio/aac',
  'audio/mp4': 'audio/aac',
  'audio/x-aiff': 'audio/aiff'
};

const PROMPT = `Transcribe the speech in this audio recording.
Return ONLY the transcription — no preamble, no quotes, no markdown, no commentary.
Write it in the SAME language that is spoken; do not translate.
Transcribe what is actually said, verbatim. Do not answer, summarise or complete it.
Add normal punctuation and capitalisation so it reads as written text.
Drop filler sounds ("uhm", "ehm") and false starts.
If there is no intelligible speech, return an empty response.`;

/** A model that ignores the prompt and answers the dictation instead usually opens like this. */
const REFUSALS = /^(i (?:'m |am )?(?:sorry|cannot|can't)|mi dispiace|non (?:posso|riesco))/i;

/**
 * Transcribe one dictation from the chat composer.
 *
 * The clip arrives as multipart (base64 in JSON would inflate it by a third) and is never
 * stored — it goes straight to Gemini and the bytes are dropped with the request. Scoped to the
 * brand so the call lands on that brand's credits like every other AI action in the app.
 */
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, plan')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key) return json({ error: 'Voice input is not configured.' }, { status: 503 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Expected multipart form-data with an "audio" file' }, { status: 400 });
  }

  const file = form.get('audio');
  if (!(file instanceof File) || !file.size) return json({ error: 'No audio' }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES) return json({ error: 'Recording is too long.' }, { status: 413 });

  // A browser may append a codec parameter (`audio/ogg;codecs=opus`) — match on the type alone.
  const declared = (file.type || 'audio/wav').split(';')[0].trim().toLowerCase();
  const mimeType = ALIASES[declared] ?? declared;
  if (!ACCEPTED.has(mimeType)) return json({ error: 'Unsupported audio format' }, { status: 415 });

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const ai = googleGenaiClient();
    const res = await withBrandContext(brand.id, () =>
      loggedGemini('chat.transcribe', () =>
        ai.models.generateContent({
          model: geminiFlash(),
          config: { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType, data: bytes.toString('base64') } },
                { text: PROMPT }
              ]
            }
          ]
        })
      ),
      (brand.plan as string | null) ?? null
    );

    const text = (res.text ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    // Better an empty box the user can retry than a hallucinated reply pasted into their prompt.
    return json({ text: REFUSALS.test(text) ? '' : text });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Transcription failed';
    return json({ error: message }, { status: 502 });
  }
};
