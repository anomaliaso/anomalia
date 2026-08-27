import { describe, expect, it } from 'vitest';
import {
  formatUgcBrandGrounding,
  identityFromAiContext,
  type UgcBrandGrounding
} from './brand-grounding';
import { buildAssignmentLines, buildUgcBatchPlanPrompt } from './ugc-batch';

const anomalia: UgcBrandGrounding = {
  name: 'Anomalia',
  about: 'Social media AI autopilot for brands — plans, produces and posts content.',
  category: 'SaaS / marketing automation',
  audience: 'Founders and marketers who hate manual posting',
  brandStyle: 'Direct, slightly irreverent, practical',
  aiContext: 'Anomalia runs editorial plans, UGC, SEO and studio for brands.',
  offerings: [
    { title: 'Weekly plan', description: 'AI weekly content calendar', kind: 'feature' },
    { title: 'UGC Creator', description: 'Talking-head video batch', kind: 'feature' }
  ],
  language: 'Italian'
};

describe('identityFromAiContext', () => {
  it('strips visual playbook appendix', () => {
    const raw = `Voice: sharp.\nPillars: product.\n\nWHAT WORKS VISUALLY\n- soft light`;
    expect(identityFromAiContext(raw)).toBe('Voice: sharp.\nPillars: product.');
    expect(identityFromAiContext(raw)).not.toMatch(/soft light/);
  });

  it('strips it under the markdown heading the synthesiser writes now', () => {
    const raw = `Voice: sharp.\n\n### WHAT WORKS VISUALLY\n- soft light`;
    expect(identityFromAiContext(raw)).toBe('Voice: sharp.');
  });

  it('never truncates the GUARDRAIL block — a long brief keeps its limits', () => {
    // The old 2200-char clip cut here: the brief is written to ~500 words and closes with the
    // guardrails, so the constraints were the first thing to fall off a spoken script.
    const brief = `### VOICE\n${'Frasi brevi, prima persona, niente entusiasmo. '.repeat(60)}`;
    const raw = `${brief}\n\n### GUARDRAIL\n- COSA NON FA: non spedisce fuori dall'UE.\n- MAI USARE: "rivoluzionario".`;
    const out = identityFromAiContext(raw);
    expect(raw.length).toBeGreaterThan(2200);
    expect(out).toContain('### GUARDRAIL');
    expect(out).toContain('MAI USARE');
    expect(out).toContain('non spedisce fuori');
  });

  it('keeps the markdown structure readable instead of flattening it to one line', () => {
    const out = identityFromAiContext('### VOICE\n- diretta\n\n### GUARDRAIL\n- MAI USARE: "top"');
    expect(out.split('\n').length).toBeGreaterThan(3);
  });
});

describe('formatUgcBrandGrounding', () => {
  it('names the brand and forbids off-category life drama', () => {
    const block = formatUgcBrandGrounding(anomalia);
    expect(block).toMatch(/Anomalia/);
    expect(block).toMatch(/SaaS/);
    expect(block).toMatch(/Weekly plan/);
    expect(block).toMatch(/FORBIDDEN/);
    expect(block).toMatch(/medical/i);
    expect(block).toMatch(/family/i);
  });
});

describe('buildUgcBatchPlanPrompt', () => {
  it('grounds PAS scripts in brand + user brief, not generic Life-Force pain', () => {
    const prompt = buildUgcBatchPlanPrompt({
      count: 2,
      prompt:
        'fai ugc video che parli di anomalia, hai gli screenshots nei media. Illustra le features di anomalia, parlando di una feature a video',
      productAssignments: [null, null],
      modelAssignments: [null, null],
      brand: anomalia
    });
    expect(prompt).toMatch(/BRAND IDENTITY/);
    expect(prompt).toMatch(/Anomalia/);
    expect(prompt).toMatch(/topic bible/i);
    expect(prompt).toMatch(/Illustra le features/);
    expect(prompt).toMatch(/Italian/);
    expect(prompt).toMatch(/medical|family|unrelated/i);
    expect(prompt).not.toMatch(/Life-Force/);
  });

  it('names assigned products in clip assignments', () => {
    const prompt = buildUgcBatchPlanPrompt({
      count: 1,
      prompt: 'Talk about the weekly plan feature',
      productAssignments: [{ id: '1', name: 'Weekly plan', urls: ['https://x.test/a.png'] }],
      modelAssignments: [{ id: 'm', name: 'Sofia', urls: ['https://x.test/f.png'] }],
      brand: anomalia
    });
    expect(prompt).toMatch(/product "Weekly plan"/);
    expect(prompt).toMatch(/speaker\/model "Sofia"/);
  });
});

describe('buildAssignmentLines', () => {
  it('labels empty product slots with brand feature', () => {
    const lines = buildAssignmentLines(2, [null, null], [null, null], 'Anomalia');
    expect(lines).toMatch(/feature Anomalia/);
  });
});
