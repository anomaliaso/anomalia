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
  const { name, role, description, kind, gender, ageRange, ethnicity, vibe } = body;

  if (!name) return json({ error: 'name is required' }, { status: 400 });

  if (kind === 'ai') {
    // Generate AI person
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
          consent: true,
          images: images ?? [],
          attributes: { gender, ageRange, ethnicity, vibe },
        })
        .select('id, name, role, kind')
        .single();

      if (insertError) return json({ error: insertError.message }, { status: 500 });
      return json({ ok: true, person: data });
    } catch (e) {
      return json({ error: `AI generation failed: ${String(e)}` }, { status: 500 });
    }
  } else {
    // Add real person (no photos via API — user can upload separately). Persist attributes
    // (gender/age) so the image generator honours them and doesn't invent the wrong gender.
    const { data, error: insertError } = await supabase
      .from('people')
      .insert({
        brand_id: brand.id,
        name,
        role: role ?? null,
        description: description ?? null,
        kind: 'real',
        consent: true,
        images: [],
        attributes: { gender, ageRange, ethnicity, vibe },
      })
      .select('id, name, role, kind')
      .single();

    if (insertError) return json({ error: insertError.message }, { status: 500 });
    return json({ ok: true, person: data });
  }
};
