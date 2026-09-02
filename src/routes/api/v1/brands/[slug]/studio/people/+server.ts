import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { personConsentColumns, CONSENT_NOT_ATTESTED } from '$lib/server/people-consent';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { name, role, description, gender, ageRange, ethnicity, vibe, consent } = body;

  if (!name) return json({ error: 'name is required' }, { status: 400 });

  const kind = body.kind === 'ai' ? 'ai' : 'real';
  const consentColumns = personConsentColumns(kind, consent === true ? 'owner_attested' : 'none');
  if (!consentColumns) return json({ error: CONSENT_NOT_ATTESTED }, { status: 400 });

  if (kind === 'ai') {
    try {
      const { generateAiPersonImages } = await import('$lib/server/people');
      const images = await generateAiPersonImages({
        attributes: { gender, ageRange, ethnicity, vibe },
        description,
      });

      const { data, error: insertError } = await supabase
        .from('people')
        .insert({
          brand_id: brand.id,
          name,
          role: role ?? null,
          description: description ?? null,
          kind: 'ai',
          images: images ?? [],
          attributes: { gender, ageRange, ethnicity, vibe },
          ...consentColumns
        })
        .select('id, name, role, kind')
        .single();

      if (insertError) return json({ error: insertError.message }, { status: 500 });
      return json({ ok: true, person: data });
    } catch (e) {
      return json({ error: `AI generation failed: ${String(e)}` }, { status: 500 });
    }
  } else {
    const { data, error: insertError } = await supabase
      .from('people')
      .insert({
        brand_id: brand.id,
        name,
        role: role ?? null,
        description: description ?? null,
        kind: 'real',
        images: [],
        attributes: { gender, ageRange, ethnicity, vibe },
        ...consentColumns
      })
      .select('id, name, role, kind')
      .single();

    if (insertError) return json({ error: insertError.message }, { status: 500 });
    return json({ ok: true, person: data });
  }
};
