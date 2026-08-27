import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { mood, tone, register, emotion, character, syntax, platform_instructions, avoid } = body;

  // Load current content_prefs
  const { data: brandData } = await supabase
    .from('brands').select('content_prefs').eq('id', brand.id).maybeSingle();

  const prefs = (brandData?.content_prefs ?? {}) as Record<string, unknown>;
  const framework = (prefs.voiceFramework ?? {}) as Record<string, unknown>;

  // Update voice framework fields
  if (mood !== undefined) framework.mood = mood;
  if (tone !== undefined) framework.tone = tone;
  if (register !== undefined) framework.register = register;
  if (emotion !== undefined) framework.emotion = emotion;
  if (character !== undefined) framework.character = character;
  if (syntax !== undefined) framework.syntax = syntax;

  prefs.voiceFramework = framework;
  prefs.voiceMode = 'manual';

  // Update platform instructions
  if (platform_instructions !== undefined) {
    prefs.platformInstructions = {
      ...((prefs.platformInstructions as Record<string, string>) ?? {}),
      ...platform_instructions,
    };
  }

  // Update banned words
  if (avoid !== undefined) {
    prefs.avoid = avoid;
  }

  const { error: updateError } = await supabase
    .from('brands').update({ content_prefs: prefs }).eq('id', brand.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};
