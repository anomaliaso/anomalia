/**
 * Composio trigger instances owned by a brand.
 *
 * A trigger only exists while two things hold: the brand has an endpoint to deliver to, and the
 * toolkit is connected with something selected to watch. When either stops being true the
 * instance is deleted at Composio — an orphan keeps firing into our ingress for a connection the
 * brand already dropped, and we would be paying to relay events nobody asked for.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseGithubRepoSelection } from '$lib/github-repos';
import {
  composioConfigured,
  composioErrorMessage,
  composioUserId,
  deleteTriggerInstance,
  upsertTriggerInstance
} from '$lib/server/composio';

/** What a brand's endpoint can receive today. Adding a trigger type is adding a row here. */
export const GITHUB_PULL_REQUEST_TRIGGER = 'GITHUB_PULL_REQUEST_EVENT';

export type BrandTriggerRow = {
  id: string;
  brand_id: string;
  toolkit_slug: string;
  trigger_slug: string;
  trigger_instance_id: string;
  config: Record<string, unknown>;
  status: string;
};

const TRIGGER_COLUMNS =
  'id, brand_id, toolkit_slug, trigger_slug, trigger_instance_id, config, status';

export function repoTriggerConfig(fullName: string): { owner: string; repo: string } | null {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** Stable identity of a trigger: same slug, same config → the same instance. */
export function triggerKey(triggerSlug: string, config: Record<string, unknown>): string {
  const entries = Object.entries(config)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  return `${triggerSlug}|${entries.join('&')}`;
}

export async function loadBrandTriggers(
  supabase: SupabaseClient,
  brandId: string
): Promise<BrandTriggerRow[]> {
  const { data } = await supabase
    .from('brand_triggers')
    .select(TRIGGER_COLUMNS)
    .eq('brand_id', brandId)
    .eq('status', 'active');
  return (data ?? []) as BrandTriggerRow[];
}

/** The set of triggers this brand should have right now, derived from its own state. */
export function desiredTriggers(opts: {
  hasEndpoint: boolean;
  githubConnected: boolean;
  githubRepos: string[];
}): { toolkitSlug: string; triggerSlug: string; config: Record<string, unknown> }[] {
  if (!opts.hasEndpoint || !opts.githubConnected) return [];
  const out: { toolkitSlug: string; triggerSlug: string; config: Record<string, unknown> }[] = [];
  for (const fullName of opts.githubRepos) {
    const config = repoTriggerConfig(fullName);
    if (!config) continue;
    out.push({ toolkitSlug: 'GITHUB', triggerSlug: GITHUB_PULL_REQUEST_TRIGGER, config });
  }
  return out;
}

/**
 * Bring Composio in line with what the brand's state implies: create what is missing, delete what
 * is no longer wanted. Safe to call on every change — upsert returns the same instance id for the
 * same (trigger, connection, config).
 */
export async function syncBrandTriggers(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ created: number; deleted: number }> {
  if (!composioConfigured()) return { created: 0, deleted: 0 };

  const [{ data: webhook }, { data: connections }, { data: source }] = await Promise.all([
    supabase.from('brand_webhooks').select('id, status').eq('brand_id', brandId).maybeSingle(),
    supabase
      .from('brand_app_connections')
      .select('toolkit_slug, connected_account_id, status')
      .eq('brand_id', brandId)
      .eq('status', 'active'),
    supabase
      .from('brand_knowledge_sources')
      .select('settings, status')
      .eq('brand_id', brandId)
      .eq('provider', 'github')
      .neq('status', 'disconnected')
      .maybeSingle()
  ]);

  const github = (connections ?? []).find((c) => String(c.toolkit_slug) === 'GITHUB');
  const wanted = desiredTriggers({
    hasEndpoint: Boolean(webhook?.id),
    githubConnected: Boolean(github?.connected_account_id),
    githubRepos: parseGithubRepoSelection(source?.settings)
  });

  const existing = await loadBrandTriggers(supabase, brandId);
  const existingByKey = new Map(
    existing.map((row) => [triggerKey(row.trigger_slug, row.config), row])
  );
  const wantedKeys = new Set(wanted.map((t) => triggerKey(t.triggerSlug, t.config)));

  let created = 0;
  for (const target of wanted) {
    const key = triggerKey(target.triggerSlug, target.config);
    if (existingByKey.has(key)) continue;
    try {
      const triggerInstanceId = await upsertTriggerInstance({
        triggerSlug: target.triggerSlug,
        userId: composioUserId(brandId),
        connectedAccountId: github?.connected_account_id as string,
        triggerConfig: target.config
      });
      await supabase.from('brand_triggers').insert({
        brand_id: brandId,
        toolkit_slug: target.toolkitSlug,
        trigger_slug: target.triggerSlug,
        trigger_instance_id: triggerInstanceId,
        config: target.config
      });
      created += 1;
    } catch (e) {
      console.error('[brand-triggers] create', target.triggerSlug, composioErrorMessage(e));
    }
  }

  let deleted = 0;
  for (const row of existing) {
    if (wantedKeys.has(triggerKey(row.trigger_slug, row.config))) continue;
    await deleteTriggerInstance(row.trigger_instance_id).catch((e) =>
      console.error('[brand-triggers] delete', composioErrorMessage(e))
    );
    await supabase.from('brand_triggers').delete().eq('id', row.id);
    deleted += 1;
  }

  return { created, deleted };
}

/** Drop every trigger for one toolkit — used when a brand disconnects it. */
export async function deleteTriggersForToolkit(
  supabase: SupabaseClient,
  brandId: string,
  toolkitSlug: string
): Promise<void> {
  const rows = await loadBrandTriggers(supabase, brandId);
  for (const row of rows) {
    if (row.toolkit_slug !== toolkitSlug) continue;
    await deleteTriggerInstance(row.trigger_instance_id).catch((e) =>
      console.error('[brand-triggers] delete', composioErrorMessage(e))
    );
    await supabase.from('brand_triggers').delete().eq('id', row.id);
  }
}
