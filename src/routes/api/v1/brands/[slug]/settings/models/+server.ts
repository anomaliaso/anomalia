import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import {
  MEDIA_MODEL_JOBS,
  MEDIA_MODEL_SLOT_IDS,
  SET_MEDIA_MODEL,
  statusForFailure
} from '@anomalia/api-contracts';
import { mediaModelSlot, slotAccepts, slotChoices } from '$lib/media-model-slots';
import { chooseMediaModel } from '$lib/server/media-model-prefs';

// Quale modello disegna e quale gira, per questo brand — la stessa cosa che Settings → Images &
// video mostra nel browser, servita agli agenti esterni.
//
// La lettura esiste perché la scrittura sia possibile: i modelli ammessi cambiano per mestiere
// (Aleph riscrive una clip e non ne genera una; Turbo anima una foto e non parte dal testo), e un
// agente che non li vede tira a indovinare. La validazione però NON sta qui: sta nella scrittura,
// che è l'unico punto che non si può saltare.

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const prefs = (brand.content_prefs ?? {}) as Record<string, unknown>;

  return json({
    brand: brand.slug,
    slots: MEDIA_MODEL_SLOT_IDS.map((id) => {
      const slot = mediaModelSlot(id)!;
      const stored = String(prefs[slot.pref] ?? '').trim();

      return {
        slot: id,
        job: MEDIA_MODEL_JOBS[id],
        // Un modello salvato che quel mestiere non fa più non è una scelta: il renderer lo scarta
        // già, e mostrarlo qui farebbe credere all'agente che sia in vigore.
        model: stored && slotAccepts(slot, stored) ? stored : null,
        choices: slotChoices(slot)
      };
    })
  });
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SET_MEDIA_MODEL.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const slot = mediaModelSlot(parsed.data.slot)!;
  const { prefs, allowed } = chooseMediaModel(
    brand.content_prefs as Record<string, unknown> | null,
    slot,
    parsed.data.model
  );

  if (!prefs) {
    return json(
      { error: 'model_not_for_slot', slot: parsed.data.slot, allowed },
      { status: statusForFailure(SET_MEDIA_MODEL, 'model_not_for_slot') }
    );
  }

  const { error: updateError } = await supabase
    .from('brands')
    .update({ content_prefs: prefs })
    .eq('id', brand.id);

  if (updateError) {
    return json(
      { error: 'update_failed', detail: updateError.message },
      { status: statusForFailure(SET_MEDIA_MODEL, 'update_failed') }
    );
  }

  return json({ ok: true, slot: parsed.data.slot, model: parsed.data.model });
};
