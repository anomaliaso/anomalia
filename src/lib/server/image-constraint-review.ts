import { llmConfigured, llmImagesFromInline, llmStructured } from '$lib/server/llm';

export const APPAREL_BRANDING_DIRECTIVE = `APPAREL BRANDING — non-negotiable: never add a logo, label, wordmark, readable brand name, patch or embroidered text to a garment, hat, uniform, accessory or textile unless the original brief explicitly requests that exact mark on that wearable item. Brand rules override this exception. A mark that belongs to a machine, tool or equipment may appear only on that machine, tool or equipment, never on a garment, hat, uniform, accessory or textile. Do not invent or move branding between objects.`;

type ImagePart = { inlineData: { mimeType: string; data: string } };

export type ImageConstraintVerdict = {
  pass: boolean;
  issues: string[];
};

export type ImageConstraintJudge = (input: {
  instructions: string;
  image: ImagePart;
}) => Promise<ImageConstraintVerdict>;

type ReviewInput = {
  image: string;
  brief: string;
  brandRules?: string;
};

const REVIEW_SCHEMA = {
  type: 'object' as const,
  properties: {
    pass: {
      type: 'boolean' as const,
      description: 'False when an unrequested logo, wordmark, label, patch or readable brand name appears on wearable apparel.'
    },
    issues: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Short English descriptions of actual constraint violations. Empty when pass is true.'
    }
  },
  required: ['pass', 'issues']
};

const MAX_REVIEW_ISSUES = 3;
const BRAND_CONSTRAINTS_SECTION = /(?:^|\n)### CONSTRAINTS & RULES\s*\n([\s\S]*?)(?=\n{2,}### |\n{2,}## |\s*$)/;

export function extractBrandConstraints(context: unknown): string {
  const section = String(context ?? '').match(BRAND_CONSTRAINTS_SECTION)?.[1] ?? '';
  return section
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

function imagePart(dataUrl: string): ImagePart | null {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    return null;
  }
  return { inlineData: { mimeType: match[1].toLowerCase(), data: match[2] } };
}

function instructions(input: Pick<ReviewInput, 'brief' | 'brandRules'>): string {
  const rules = input.brandRules?.trim() ? `\n\nBRAND RULES:\n${input.brandRules.trim()}` : '';
  return `You review one generated image before it can be used in brand content.

${APPAREL_BRANDING_DIRECTIVE}

Reject if any unrequested brand mark is visible on a wearable item. Do not reject a mark that is visible only on the machine, tool or equipment it belongs to. Treat a logo on apparel as allowed only when the original brief explicitly requests that exact logo on that garment.
Brand rules override a conflicting original brief.

ORIGINAL BRIEF:
${input.brief.trim() || '(none)'}${rules}`;
}

async function judgeWithLlm(input: { instructions: string; image: ImagePart }): Promise<ImageConstraintVerdict> {
  if (!llmConfigured()) {
    return { pass: false, issues: ['Image constraint reviewer is unavailable'] };
  }
  try {
    const result = await llmStructured<{ pass?: unknown; issues?: unknown }>({
      prompt: input.instructions,
      schema: REVIEW_SCHEMA,
      images: llmImagesFromInline([input.image]),
      label: 'image.constraints',
      reasoningEffort: 'low'
    });
    if (typeof result.pass !== 'boolean' || !Array.isArray(result.issues)) {
      return { pass: false, issues: ['Image constraint reviewer returned an invalid verdict'] };
    }
    return { pass: result.pass, issues: result.issues.map(String).filter(Boolean).slice(0, MAX_REVIEW_ISSUES) };
  } catch {
    return { pass: false, issues: ['Image constraint reviewer could not verify the image'] };
  }
}

export async function reviewImageConstraints(
  input: ReviewInput,
  deps: { judge?: ImageConstraintJudge } = {}
): Promise<ImageConstraintVerdict> {
  const image = imagePart(input.image);
  if (!image) {
    return { pass: false, issues: ['Generated image is not a valid data URL'] };
  }
  return await (deps.judge ?? judgeWithLlm)({ instructions: instructions(input), image });
}
