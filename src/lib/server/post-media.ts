import { authenticate, loadBrandForUser, type ApiKeyInfo, type CliBrand } from '$lib/server/cli-auth';
import { loadEditorContext, type EditorTarget } from '$lib/agent/tools/post-editor-tools';

type Target =
  | { error: Response; t?: undefined; brand?: undefined; apiKey?: undefined }
  | { error?: undefined; t: EditorTarget; brand: CliBrand; apiKey: ApiKeyInfo | undefined };

/** Auth, brand and editor context — everything the five media routes need before they act. */
export async function postMediaTarget(
  request: Request,
  slug: string,
  id: string
): Promise<Target> {
  const { supabase, user, apiKey, error } = await authenticate(request);
  if (error) return { error };

  const { brand, error: brandError } = await loadBrandForUser(supabase, slug, apiKey);
  if (brandError) return { error: brandError };

  const ctx = await loadEditorContext(supabase, brand.id);
  return {
    t: {
      supabase,
      brandId: brand.id,
      postId: id,
      tz: (brand.timezone as string) ?? 'Europe/Rome',
      userId: user.id,
      ctx,
      refUrls: []
    },
    brand,
    apiKey
  };
}
