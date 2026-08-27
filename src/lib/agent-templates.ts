// Client-safe half of the Agent Library: the public directory of ready-made custom agents
// ("someone already wrote the prompt for you"). Rows live in `public.agent_templates` and are
// read on the public /agents pages and inside Automations › Custom Agents.
//
// Server-side reads live in $lib/server/agent-templates.ts — keep this file dependency-free
// so it can be imported from a .svelte component and from the marketing pages alike.
import {
  AGENT_AVATAR_COLORS,
  AGENT_AVATAR_FACES,
  normalizeAvatarColor,
  normalizeAvatarFace,
  type AgentAvatarFace
} from '$lib/agent-avatars';
import type { Locale } from '$lib/i18n/locale';

export const AGENT_TEMPLATE_CATEGORIES = [
  'content',
  'growth',
  'seo',
  'sales',
  'ops',
  'brand'
] as const;

export type AgentTemplateCategory = (typeof AGENT_TEMPLATE_CATEGORIES)[number];

const CATEGORY_LABELS: Record<AgentTemplateCategory, { en: string; it: string }> = {
  content: { en: 'Content', it: 'Contenuti' },
  growth: { en: 'Growth', it: 'Crescita' },
  seo: { en: 'SEO & GEO', it: 'SEO & GEO' },
  sales: { en: 'Sales & Leads', it: 'Vendite & Lead' },
  ops: { en: 'Ops & Reporting', it: 'Ops & Report' },
  brand: { en: 'Brand & Research', it: 'Brand & Ricerca' }
};

export function agentCategoryLabel(category: string, lang: Locale | string = 'en'): string {
  const meta = CATEGORY_LABELS[category as AgentTemplateCategory];
  if (!meta) return category;
  return lang === 'it' ? meta.it : meta.en;
}

export function isAgentTemplateCategory(raw: unknown): raw is AgentTemplateCategory {
  return (AGENT_TEMPLATE_CATEGORIES as readonly string[]).includes(String(raw ?? ''));
}

/** A published library agent, exactly as the public pages and the app picker consume it. */
export type AgentTemplate = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string | null;
  category: AgentTemplateCategory;
  tags: string[];
  integrations: string[];
  /** What lands in the schedule prompt when the agent is installed. */
  prompt: string;
  /** Built-in hub specialist (`publish` | `brand` | `grow` | `web`), null = Anomalia auto. */
  agent: string | null;
  avatar_face: AgentAvatarFace;
  avatar_color: string;
  days_of_week: number[];
  times: string[];
  reuse_thread: boolean;
  /** Bullets rendered on the detail page. */
  highlights: string[];
  /** What the run leaves behind (a recap, drafted posts, a fixed page…). */
  outputs: string[];
  featured: boolean;
  install_count: number;
};

// ── Random avatars ───────────────────────────────────────────────────────────
// Every agent in the library wears its own face and its own colour: a wall of identical
// black balls is exactly what a directory must not look like. Neutrals are dropped from
// the palette here — a library card wants colour, and the picker still offers the greys.

export const VIVID_AVATAR_COLORS = AGENT_AVATAR_COLORS.filter(
  (c) => !['#111111', '#3f3f46', '#64748b', '#94a3b8'].includes(c)
);

export type AgentAvatarChoice = { face: AgentAvatarFace; color: string };

/** Truly random pick — for a brand-new agent the user is about to create. */
export function randomAgentAvatar(): AgentAvatarChoice {
  return {
    face: AGENT_AVATAR_FACES[Math.floor(Math.random() * AGENT_AVATAR_FACES.length)],
    color: VIVID_AVATAR_COLORS[Math.floor(Math.random() * VIVID_AVATAR_COLORS.length)]
  };
}

/**
 * Scattered-but-stable pick, for a row that has no avatar stored. Random-looking (two
 * neighbouring slugs land nowhere near each other) yet identical on the server and in the
 * browser, so the directory does not flicker into a different face on hydration.
 */
export function seededAgentAvatar(seed: string): AgentAvatarChoice {
  // FNV-1a: the *31 hash used elsewhere clusters badly on short, similar slugs.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const face = AGENT_AVATAR_FACES[h % AGENT_AVATAR_FACES.length];
  const color = VIVID_AVATAR_COLORS[((h >>> 8) ^ (h >>> 3)) % VIVID_AVATAR_COLORS.length];
  return { face, color };
}

/** The avatar a template renders with: what the row stores, or a seeded one if it stores nothing. */
export function agentTemplateAvatar(row: {
  slug: string;
  avatar_face?: string | null;
  avatar_color?: string | null;
}): AgentAvatarChoice {
  const fallback = seededAgentAvatar(row.slug);
  return {
    face: row.avatar_face ? normalizeAvatarFace(row.avatar_face, fallback.face) : fallback.face,
    color: row.avatar_color
      ? normalizeAvatarColor(row.avatar_color, fallback.color)
      : fallback.color
  };
}

// ── Schedule helpers (shared by the public detail page and the install flow) ──

const DAY_LABELS: Record<'en' | 'it', string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  it: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
};

export function agentScheduleSummary(
  days: number[],
  times: string[],
  lang: Locale | string = 'en'
): string {
  const l = lang === 'it' ? 'it' : 'en';
  const sorted = [...(days ?? [])].sort((a, b) => a - b);
  const everyday = sorted.length === 7;
  const weekdays = sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5);
  const weekend = sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6;
  const dayPart = everyday
    ? l === 'it'
      ? 'Ogni giorno'
      : 'Every day'
    : weekdays
      ? l === 'it'
        ? 'Feriali'
        : 'Weekdays'
      : weekend
        ? 'Weekend'
        : sorted.map((d) => DAY_LABELS[l][d]).join(', ');
  const timePart = (times ?? []).join(' · ');
  return timePart ? `${dayPart} · ${timePart}` : dayPart;
}

/** Human label for a Composio toolkit slug shown as an integration badge. */
export function integrationLabel(slug: string): string {
  return slug
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
