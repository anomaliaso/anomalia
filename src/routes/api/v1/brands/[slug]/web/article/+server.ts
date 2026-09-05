import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { readArticle, updateArticle } from '$lib/server/article-editing';
import { GET_ARTICLE, UPDATE_ARTICLE, statusForFailure } from '@anomalia/api-contracts';

const DEFAULT_TIMEZONE = 'Europe/Rome';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = GET_ARTICLE.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const timezone = (brand.timezone as string) ?? DEFAULT_TIMEZONE;
  const article = await readArticle(supabase, brand.id, parsed.data.id, timezone);
  if (!article) {
    return json({ error: 'article_not_found' }, { status: statusForFailure(GET_ARTICLE, 'article_not_found') });
  }

  return json({ article });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = UPDATE_ARTICLE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }
  const { id, ...patch } = parsed.data;

  const result = await updateArticle({
    client: createAdminClient(),
    brandId: brand.id,
    articleId: id,
    timezone: (brand.timezone as string) ?? DEFAULT_TIMEZONE,
    patch
  });

  if (!result.ok) {
    return json(
      { error: result.error, details: result.details },
      { status: statusForFailure(UPDATE_ARTICLE, result.error) }
    );
  }

  return json({ ok: true, updated_fields: result.updatedFields, article: result.article });
};
