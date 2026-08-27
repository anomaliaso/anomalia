import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Store (create or update) integration secrets as encrypted JSON in Vault.
 * Called from connect actions with the service-role admin client.
 */
export async function storeSecrets(
  admin: SupabaseClient,
  brandId: string,
  platform: string,
  secrets: Record<string, string>
): Promise<void> {
  const { error } = await admin.rpc('upsert_integration_secret', {
    p_brand_id: brandId,
    p_platform: platform,
    p_secrets: secrets,
  });
  if (error) throw new Error(`Vault store failed: ${error.message}`);
}

/**
 * Load and decrypt integration secrets from Vault.
 * Returns null if no secret exists for this brand+platform.
 */
export async function loadSecrets(
  admin: SupabaseClient,
  brandId: string,
  platform: string
): Promise<Record<string, string> | null> {
  const { data } = await admin.rpc('read_integration_secret', {
    p_brand_id: brandId,
    p_platform: platform,
  });
  if (!data) return null;
  try {
    return JSON.parse(data as string) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Delete integration secrets from Vault.
 * Normally not needed — the DELETE trigger on blog_integrations handles
 * cleanup automatically. Provided for explicit/manual cleanup if needed.
 */
export async function deleteSecrets(
  admin: SupabaseClient,
  brandId: string,
  platform: string
): Promise<void> {
  await admin.rpc('delete_integration_secret', {
    p_brand_id: brandId,
    p_platform: platform,
  });
}
