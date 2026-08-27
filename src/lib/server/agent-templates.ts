// Server reads for the Agent Library (`public.agent_templates`, migration 0201).
//
// The catalogue is global and public, so every read goes through the admin client: the public
// /agents pages are rendered for anonymous visitors, and the RLS policy that lets anon read it
// is a safety net, not the access path.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  agentTemplateAvatar,
  isAgentTemplateCategory,
  type AgentTemplate,
  type AgentTemplateCategory
} from '$lib/agent-templates';

const COLUMNS =
  'id, slug, name, tagline, description, category, tags, integrations, prompt, agent, ' +
  'avatar_face, avatar_color, days_of_week, times, reuse_thread, highlights, outputs, ' +
  'featured, sort_order, install_count';

type Row = Record<string, unknown>;

function toTemplate(row: Row): AgentTemplate {
  const slug = String(row.slug);
  // A row that never got an avatar still renders: the seeded pick is stable, so the card looks
  // the same on the server and after hydration.
  const avatar = agentTemplateAvatar({
    slug,
    avatar_face: row.avatar_face as string | null,
    avatar_color: row.avatar_color as string | null
  });
  const category = isAgentTemplateCategory(row.category)
    ? (row.category as AgentTemplateCategory)
    : 'ops';
  return {
    id: String(row.id),
    slug,
    name: String(row.name),
    tagline: String(row.tagline ?? ''),
    description: (row.description as string | null) ?? null,
    category,
    tags: (row.tags as string[] | null) ?? [],
    integrations: (row.integrations as string[] | null) ?? [],
    prompt: String(row.prompt ?? ''),
    agent: (row.agent as string | null) ?? null,
    avatar_face: avatar.face,
    avatar_color: avatar.color,
    days_of_week: (row.days_of_week as number[] | null) ?? [1, 2, 3, 4, 5],
    times: (row.times as string[] | null) ?? ['09:00'],
    reuse_thread: Boolean(row.reuse_thread),
    highlights: (row.highlights as string[] | null) ?? [],
    outputs: (row.outputs as string[] | null) ?? [],
    featured: Boolean(row.featured),
    install_count: Number(row.install_count ?? 0)
  };
}

/** Every published agent, in catalogue order (featured first, then `sort_order`). */
export async function listAgentTemplates(supabase: SupabaseClient): Promise<AgentTemplate[]> {
  const { data, error } = await supabase
    .from('agent_templates')
    .select(COLUMNS)
    .eq('status', 'published')
    .order('featured', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  // The library is decoration on every surface that shows it — a missing table (migration not
  // applied yet) must not take the page down with it.
  if (error) return [];
  // The generated Supabase types predate this table; the shape is pinned by toTemplate().
  return ((data ?? []) as unknown as Row[]).map(toTemplate);
}

export async function getAgentTemplate(
  supabase: SupabaseClient,
  slug: string
): Promise<AgentTemplate | null> {
  const clean = String(slug ?? '').trim();
  if (!clean) return null;
  const { data, error } = await supabase
    .from('agent_templates')
    .select(COLUMNS)
    .eq('slug', clean)
    .eq('status', 'published')
    .maybeSingle();
  if (error || !data) return null;
  return toTemplate(data as unknown as Row);
}

/** Same category first, then anything else — used by the "more like this" strip. */
export function relatedAgentTemplates(
  all: AgentTemplate[],
  current: AgentTemplate,
  limit = 3
): AgentTemplate[] {
  const others = all.filter((t) => t.slug !== current.slug);
  const sameCategory = others.filter((t) => t.category === current.category);
  return [...sameCategory, ...others.filter((t) => t.category !== current.category)].slice(0, limit);
}

/** Best-effort install counter. Never let a stat break the install itself. */
export async function bumpAgentTemplateInstalls(
  supabase: SupabaseClient,
  slug: string
): Promise<void> {
  try {
    await supabase.rpc('bump_agent_template_installs', { p_slug: slug });
  } catch (error) { swallow('bump agent template installs', error); }
}
