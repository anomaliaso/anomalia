import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import {
  listDisruptiveIdeas,
  saveDisruptiveIdea,
  updateDisruptiveIdea
} from '$lib/server/disruptive-ideas';
import { isContrastDeviceId, isDisruptiveStatus } from '$lib/disruptive';

// Il banco idee dalla CLI: leggerlo è il punto (`anomalia ideas <slug>`), perché la testa
// creativa non è quasi mai davanti alla pagina quando serve. Nessuna chiamata AI qui — è lettura
// e stato — quindi niente gateAiAction: la scrittura chiede solo che la chiave non sia read-only.

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const statusParam = url.searchParams.get('status');
  const status = statusParam === 'all' || isDisruptiveStatus(statusParam) ? statusParam : undefined;
  const limitRaw = Number(url.searchParams.get('limit'));
  const ideas = await listDisruptiveIdeas(createAdminClient(), brand.id, {
    status,
    unusedOnly: !status,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.round(limitRaw)) : 50
  });
  return json({ ideas, count: ideas.length });
};

// POST — salva una nuova idea, o cambia lo stato di una esistente (`id` + `status`).
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, user, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    title?: string;
    idea?: string;
    device?: string;
    why_it_contrasts?: string;
    who_it_annoys?: string;
    format?: string;
    score?: number;
  };
  const admin = createAdminClient();

  if (body.id) {
    if (!isDisruptiveStatus(body.status)) {
      return json({ error: 'status must be new | shortlisted | used | archived' }, { status: 400 });
    }
    const updated = await updateDisruptiveIdea(admin, brand.id, body.id, { status: body.status });
    if (!updated) return json({ error: 'Idea not found' }, { status: 404 });
    return json({ ok: true, idea: updated });
  }

  if (!body.title?.trim() || !body.idea?.trim()) {
    return json({ error: 'title and idea are required' }, { status: 400 });
  }
  const saved = await saveDisruptiveIdea(admin, brand.id, user?.id ?? null, {
    title: body.title,
    idea: body.idea,
    device: isContrastDeviceId(body.device) ? body.device : null,
    whyItContrasts: body.why_it_contrasts ?? null,
    whoItAnnoys: body.who_it_annoys ?? null,
    format: body.format ?? null,
    score: typeof body.score === 'number' ? body.score : null,
    surface: 'cli'
  });
  if (!saved.ok) return json({ error: saved.error }, { status: 500 });
  return json({ ok: true, idea: saved.idea, duplicate: saved.duplicate });
};
