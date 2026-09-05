import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ALT_CAPTION_PLATFORMS,
  PLATFORM_CHAR_LIMITS,
  platformLabel,
  splitForPlatform,
  truncateForPlatform
} from '$lib/platform-limits';
import { llmConfigured, llmStructured } from '$lib/server/llm';

export type CaptionFormat = 'single' | 'thread';

export type WrittenCaption = {
  platform: string;
  parts: string[];
  limit: number;
  publishable: boolean;
};

const SYSTEM = [
  'You write social captions in the brand voice.',
  'Every platform gets a caption written natively for it — its own hook, its own rhythm, its own',
  'use of hashtags and line breaks — never one text reshaped to fit the others.',
  'Stay inside the character limit given for each platform.'
].join(' ');

const canRunLong = (platform: string) =>
  ALT_CAPTION_PLATFORMS.some((short) => short === platform);

const schemaFor = (platforms: string[]) => ({
  type: 'object',
  properties: {
    captions: {
      type: 'array',
      minItems: platforms.length,
      maxItems: platforms.length,
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: platforms },
          text: { type: 'string' }
        },
        required: ['platform', 'text']
      }
    }
  },
  required: ['captions']
});

const briefFor = (platform: string, format: CaptionFormat) => {
  const limit = PLATFORM_CHAR_LIMITS[platform] ?? 0;
  const room =
    format === 'thread' && canRunLong(platform)
      ? `write it at the length the idea needs — it will be split into a numbered sequence of posts of ${limit} characters each`
      : `at most ${limit} characters, and it must read as finished at that length`;

  return `- ${platformLabel(platform)} (${platform}): ${room}`;
};

const promptFor = (opts: { topic: string; platforms: string[]; format: CaptionFormat; voice: string }) =>
  [
    `Topic: ${opts.topic}`,
    opts.voice ? `\nBrand:\n${opts.voice}` : '',
    `\nWrite one caption for each of these platforms, and no others:`,
    opts.platforms.map((platform) => briefFor(platform, opts.format)).join('\n')
  ]
    .filter(Boolean)
    .join('\n');

const shape = (platform: string, text: string, format: CaptionFormat): WrittenCaption => {
  const limit = PLATFORM_CHAR_LIMITS[platform] ?? 0;
  const parts =
    format === 'thread' && canRunLong(platform)
      ? splitForPlatform(text, limit)
      : [truncateForPlatform(text, limit)];

  return { platform, parts, limit, publishable: parts.length === 1 };
};

export async function brandVoice(supabase: SupabaseClient, brandId: string): Promise<string> {
  const { data } = await supabase
    .from('brand_kit')
    .select('about, ai_context, category, target_audience, brand_style, content_pillars')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!data) return '';

  return Object.entries(data)
    .filter(([, value]) => value)
    .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join('\n');
}

export async function writeCaptions(opts: {
  topic: string;
  platforms: string[];
  format: CaptionFormat;
  voice: string;
}): Promise<WrittenCaption[]> {
  if (!llmConfigured() || !opts.platforms.length) return [];

  const written = await llmStructured<{ captions?: Array<{ platform?: string; text?: string }> }>({
    label: 'generate_captions',
    system: SYSTEM,
    prompt: promptFor(opts),
    schema: schemaFor(opts.platforms)
  });

  const byPlatform = new Map(
    (written?.captions ?? [])
      .filter((c) => typeof c?.text === 'string' && c.text.trim())
      .map((c) => [String(c.platform ?? ''), String(c.text)])
  );

  return opts.platforms
    .filter((platform) => byPlatform.has(platform))
    .map((platform) => shape(platform, byPlatform.get(platform) as string, opts.format));
}
