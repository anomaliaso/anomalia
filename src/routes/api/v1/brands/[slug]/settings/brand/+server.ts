import { json } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { SET_BRAND_SETTINGS, TARGET_PLATFORMS, statusForFailure } from '@anomalia/api-contracts';
import { isKnownTimezone, normalizeHashtags } from '$lib/brand-fields';

type Prefs = Record<string, unknown>;

// Come lavora il brand: fuso di pubblicazione, piattaforme bersaglio, hashtag per piattaforma,
// esempi di voce. Sono le impostazioni che un cliente cambia davvero, e finora esistevano solo
// dietro quattro form diversi.
//
// La lettura porta anche le piattaforme che hanno un account collegato. Non è decorazione:
// `target_platforms` non è validata contro gli account, quindi un agente può bersagliare una
// piattaforma dove non c'è dove pubblicare, e i post per lei restano fermi in `approved` senza
// che nessuno lo dica.

async function connectedPlatforms(supabase: SupabaseClient, brandId: string): Promise<string[]> {
  const { data } = await supabase
    .from('social_accounts')
    .select('platform')
    .eq('brand_id', brandId)
    .eq('status', 'active');

  return [...new Set((data ?? []).map((row) => String(row.platform ?? '').toLowerCase()))].filter(Boolean);
}

const storedHashtags = (prefs: Prefs): Record<string, string[]> =>
  (prefs.platformHashtags as Record<string, string[]>) ?? {};

const storedExamples = (prefs: Prefs): string[] => (prefs.voiceExamples as string[]) ?? [];

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const prefs = (brand.content_prefs ?? {}) as Prefs;

  return json({
    brand: brand.slug,
    timezone: brand.timezone,
    platforms: brand.target_platforms ?? [],
    platform_choices: [...TARGET_PLATFORMS],
    connected_platforms: await connectedPlatforms(supabase, brand.id),
    hashtags: storedHashtags(prefs),
    voice_examples: storedExamples(prefs)
  });
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SET_BRAND_SETTINGS.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const input = parsed.data;
  if (Object.keys(input).length === 0) {
    return json({ error: 'no_fields' }, { status: statusForFailure(SET_BRAND_SETTINGS, 'no_fields') });
  }

  if (input.timezone !== undefined && !isKnownTimezone(input.timezone)) {
    return json(
      { error: 'unknown_timezone', timezone: input.timezone },
      { status: statusForFailure(SET_BRAND_SETTINGS, 'unknown_timezone') }
    );
  }

  const prefs: Prefs = { ...((brand.content_prefs ?? {}) as Prefs) };

  if (input.hashtags !== undefined) {
    const map: Record<string, string[]> = {};
    for (const [platform, tags] of Object.entries(input.hashtags)) {
      // Lo stesso ripulitore del form: uno `#` solo, niente spazi dentro, deduplicati, tetto a 30.
      const clean = normalizeHashtags((tags ?? []).join(' '));
      if (clean.length) map[platform] = clean;
    }
    if (Object.keys(map).length) prefs.platformHashtags = map;
    else delete prefs.platformHashtags;
  }

  if (input.voice_examples !== undefined) {
    const examples = input.voice_examples.map((line) => String(line ?? '').trim()).filter(Boolean);
    if (examples.length) prefs.voiceExamples = examples;
    else delete prefs.voiceExamples;
  }

  const platforms = input.platforms ? [...new Set(input.platforms)] : undefined;

  const patch = {
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    // Elenco vuoto = nessun bersaglio, salvato come null: è la forma che ogni lettore già gestisce.
    ...(platforms !== undefined ? { target_platforms: platforms.length ? platforms : null } : {}),
    ...(input.hashtags !== undefined || input.voice_examples !== undefined
      ? { content_prefs: prefs }
      : {})
  };

  const { error: updateError } = await supabase.from('brands').update(patch).eq('id', brand.id);
  if (updateError) {
    return json(
      { error: 'update_failed', detail: updateError.message },
      { status: statusForFailure(SET_BRAND_SETTINGS, 'update_failed') }
    );
  }

  const saved = platforms ?? brand.target_platforms ?? [];
  const connected = await connectedPlatforms(supabase, brand.id);

  return json({
    ok: true,
    timezone: input.timezone ?? brand.timezone,
    platforms: saved,
    hashtags: storedHashtags(prefs),
    voice_examples: storedExamples(prefs),
    without_account: saved.filter((p: string) => !connected.includes(p))
  });
};
