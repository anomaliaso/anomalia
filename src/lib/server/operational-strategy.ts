import type { GoogleGenAI } from '@google/genai';
import { structured } from '$lib/server/research';

// Operational-strategy engine: derives the brand's STYLE MANUAL (voice framework + per-platform
// caption rules) from everything the Studio knows. This is what makes 'Auto' mode VISIBLE — the
// page shows the values Anomalia actually works with instead of empty fields — and it runs as part of
// the post-payment setup so every paying brand starts with a populated operational strategy.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrandProfile = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type PlatformRule = { tone: string; length: string; emoji: string; hashtags: string; structure: string };
export type VoiceFramework = {
  purpose: string;
  audience: string;
  tone: string; // 'friendly' | 'neutral' | 'authoritative'
  register: number; // 0 (informal) → 100 (formal)
  emotion: string;
  character: string;
  syntax: string; // 'short' | 'mixed' | 'long'
  terminology: string;
};

// Serialize one platform's structured rules into the free-text instruction guidanceFor() already
// consumes — the prompt pipeline stays untouched while the UI gets real columns.
export function ruleToInstruction(r: Partial<PlatformRule>): string {
  return [
    r.tone?.trim() ? `Tone: ${r.tone.trim()}.` : '',
    r.length?.trim() ? `Length: ${r.length.trim()}.` : '',
    r.emoji?.trim() ? `Emoji: ${r.emoji.trim()}.` : '',
    r.hashtags?.trim() ? `Hashtags: ${r.hashtags.trim()}.` : '',
    r.structure?.trim() ? `Typical structure: ${r.structure.trim()}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

const DERIVE_SCHEMA = {
  type: 'object' as const,
  properties: {
    voice: {
      type: 'object' as const,
      properties: {
        purpose: { type: 'string' as const, description: 'What the communication is FOR, in one honest sentence.' },
        audience: { type: 'string' as const, description: 'Who it talks to, concretely.' },
        tone: { type: 'string' as const, enum: ['friendly', 'neutral', 'authoritative'] as const },
        register: { type: 'number' as const, description: '0 (informal) → 100 (formal).' },
        emotion: { type: 'string' as const, description: 'The emotion every post should leave behind, 2-5 words.' },
        character: { type: 'string' as const, description: "The brand's personality in one sentence." },
        syntax: { type: 'string' as const, enum: ['short', 'mixed', 'long'] as const },
        terminology: { type: 'string' as const, description: 'Language & terminology rules, one sentence.' }
      },
      required: ['purpose', 'audience', 'tone', 'register', 'emotion', 'character', 'syntax', 'terminology']
    },
    rules: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          platform: { type: 'string' as const },
          tone: { type: 'string' as const, description: "This platform's register in 2-4 words (e.g. 'conversational, warm')." },
          length: { type: 'string' as const, description: "Target length in plain words (e.g. 'long-form, 700-1500 chars')." },
          emoji: { type: 'string' as const, description: "Emoji policy (e.g. 'max 2', 'none')." },
          hashtags: { type: 'string' as const, description: "Hashtag policy (e.g. '3-5 niche', 'none')." },
          structure: { type: 'string' as const, description: "The typical post structure (e.g. 'hook → 3 short paragraphs → question')." }
        },
        required: ['platform', 'tone', 'length', 'emoji', 'hashtags', 'structure']
      }
    }
  },
  required: ['voice', 'rules']
};

// Derive the full operational strategy from the Studio's knowledge. Prose fields are written in
// the user's UI language (it's a document the client reads and edits).
export async function deriveOperationalStrategy(
  ai: GoogleGenAI,
  profile: BrandProfile,
  platforms: string[],
  outputLanguage = 'English'
): Promise<{ voiceFramework: VoiceFramework; platformRules: Record<string, PlatformRule> }> {
  const prompt = `Derive this brand's OPERATIONAL STRATEGY — the style manual its social media manager writes with. Ground every choice in the brand data below; be specific, never generic agency filler.

Brand: ${profile?.name ?? ''}
About: ${profile?.about ?? ''}
Category: ${profile?.category ?? ''}
Target audience: ${profile?.target_audience ?? ''}
${profile?.ai_context ? `BRAND CONTEXT & HISTORY (authoritative on voice and what performs):\n${String(profile.ai_context).slice(0, 6000)}` : ''}

Platforms the brand publishes on: ${platforms.join(', ') || 'instagram'}.

Produce:
1) VOICE — purpose, audience, base tone (friendly/neutral/authoritative), register 0-100 (informal→formal), the emotion to convey, the character/personality, sentence style (short/mixed/long), language & terminology rules.
2) RULES — one row per platform listed above: tone, target length, emoji policy, hashtag policy, typical structure. Each platform's row must reflect how that network actually rewards content for THIS brand.
Write all prose in ${outputLanguage}; keep platform names and the enum values unchanged.
Return JSON.`;

  const raw = await structured<AnyRec>(
    ai,
    prompt,
    DERIVE_SCHEMA,
    'You are a senior brand copy chief writing a style manual. Concrete, honest, zero hype.'
  );

  const v = raw?.voice ?? {};
  const voiceFramework: VoiceFramework = {
    purpose: String(v.purpose ?? '').slice(0, 400),
    audience: String(v.audience ?? '').slice(0, 400),
    tone: ['friendly', 'neutral', 'authoritative'].includes(v.tone) ? v.tone : 'friendly',
    register: Math.max(0, Math.min(100, Math.round(Number(v.register) || 50))),
    emotion: String(v.emotion ?? '').slice(0, 200),
    character: String(v.character ?? '').slice(0, 400),
    syntax: ['short', 'mixed', 'long'].includes(v.syntax) ? v.syntax : 'mixed',
    terminology: String(v.terminology ?? '').slice(0, 400)
  };

  const allowed = new Set(platforms.map((p) => p.toLowerCase()));
  const platformRules: Record<string, PlatformRule> = {};
  for (const r of Array.isArray(raw?.rules) ? raw.rules : []) {
    const key = String(r?.platform ?? '').toLowerCase().trim();
    if (!key || !allowed.has(key)) continue;
    platformRules[key] = {
      tone: String(r?.tone ?? '').slice(0, 200),
      length: String(r?.length ?? '').slice(0, 200),
      emoji: String(r?.emoji ?? '').slice(0, 200),
      hashtags: String(r?.hashtags ?? '').slice(0, 200),
      structure: String(r?.structure ?? '').slice(0, 300)
    };
  }
  return { voiceFramework, platformRules };
}

// Derived → prompt-ready: the platformInstructions map the existing pipeline consumes.
export function rulesToInstructions(rules: Record<string, PlatformRule>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, r] of Object.entries(rules)) {
    const text = ruleToInstruction(r);
    if (text) out[k] = text;
  }
  return out;
}
