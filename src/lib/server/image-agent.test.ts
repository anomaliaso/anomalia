import { describe, expect, it, vi } from 'vitest';

const { renderPostImage, uploadPostImage, generateText, logAiCall } = vi.hoisted(() => ({
  renderPostImage: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  uploadPostImage: vi.fn().mockResolvedValue('https://cdn.example/img.png'),
  generateText: vi.fn(),
  logAiCall: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
  env: { GEMINI_API_KEY: 'test', IMAGE_AGENT_ENABLED: 'true' }
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText };
});

vi.mock('$lib/server/content-preview', () => ({
  aspectRatioFor: () => '4:5',
  extractVisualPlaybook: () => '',
  loadBrandMoodImageUrls: async () => [],
  loadCompetitorThumbUrls: async () => [],
  renderPostImage,
  uploadPostImage
}));

vi.mock('$lib/server/brand-media', () => ({
  listBrandMedia: async () => [],
  loadLibraryMediaParts: async () => [{ inlineData: { mimeType: 'image/png', data: 'BBBB' } }],
  publishLibraryImageAsPostMedia: async () => ({ error: 'nope' })
}));

vi.mock('$lib/server/credits', () => ({
  getCreditsUsage: async () => ({
    remaining: 500,
    used: 0,
    quota: 500,
    bonus: 0,
    percent: 0,
    periodStart: new Date(),
    periodEnd: new Date()
  })
}));

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: 'b1', plan: 'pro', activated_at: null, status: 'active' } })
        })
      })
    })
  })
}));

vi.mock('$lib/server/ai-log', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/ai-log')>('$lib/server/ai-log');
  return { ...actual, logAiCall };
});

import {
  addStepCost,
  appendBudgetToSystem,
  buildPrepareStepSystem,
  capRunUsdBudget,
  consumeInspectBudget,
  consumeRenderBudget,
  createAgentBudget,
  runImageAgent,
  stallDetected,
  IMAGE_AGENT_MODEL,
  MAX_AGENT_RENDERS,
  NANO_BANANA_PRO_LIST_RENDER_USD,
  PER_RUN_USD_CAP,
  STALL_STEP_THRESHOLD,
  estimatedRenderCostUsd
} from './image-agent';
import { geminiFlash } from './gemini';

// Re-export fingerprint for tests — it's private; test via stall simulation instead.

const stubSupabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        order: () => ({ limit: async () => ({ data: [] }) }),
        limit: async () => ({ data: [] }),
        maybeSingle: async () => ({ data: null })
      }),
      in: () => ({ eq: async () => ({ data: [] }) })
    })
  })
} as never;

describe('image-agent model', () => {
  it('uses geminiFlash() so a Flash bump or GEMINI_FLASH env override rolls this agent too', () => {
    expect(IMAGE_AGENT_MODEL()).toBe(geminiFlash());
  });
});

describe('image-agent budgets', () => {
  it('rejects the 5th render_image in the executor', () => {
    const budget = createAgentBudget({ renders: MAX_AGENT_RENDERS });
    for (let i = 0; i < MAX_AGENT_RENDERS; i++) {
      expect(consumeRenderBudget(budget).ok).toBe(true);
    }
    const fifth = consumeRenderBudget(budget);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.error).toMatch(/render_image budget exhausted/i);
  });

  it('caps per-run USD budget below full brand balance', () => {
    expect(capRunUsdBudget(10_000)).toBe(PER_RUN_USD_CAP);
    expect(capRunUsdBudget(50)).toBe(0.5);
  });

  it('accumulates step token cost into the USD budget', () => {
    const budget = createAgentBudget({ usdRemaining: 1 });
    const spent = addStepCost(budget, { inputTokens: 10_000, outputTokens: 500 });
    expect(spent).toBeGreaterThan(0);
    expect(budget.usdSpent).toBe(spent);
    expect(budget.usdRemaining).toBeLessThan(1);
  });

  // The in-loop cap must estimate what the brand is actually charged: full list on every plan.
  // Under the old per-plan discount a Pro brand estimated $0.037 a render and the same
  // PER_RUN_USD_CAP bought ~3.7× more renders — the cap was spending money it wasn't counting.
  it('estimates a Nano Banana Pro render at full list, on every plan', () => {
    for (const plan of [null, 'go', 'starter', 'pro', 'scale']) {
      expect(estimatedRenderCostUsd(plan)).toBeCloseTo(NANO_BANANA_PRO_LIST_RENDER_USD, 6);
    }
  });
});

describe('image-agent stall', () => {
  it('needs three identical fingerprints, not two', () => {
    expect(stallDetected(['a', 'a'])).toBe(false);
    expect(stallDetected(['a', 'a', 'a'])).toBe(true);
  });

  it('does not double-count fingerprints (one push per step)', () => {
    const fingerprints: string[] = [];
    const pushOnce = (hash: string) => fingerprints.push(hash);
    pushOnce('idle');
    pushOnce('idle');
    expect(stallDetected(fingerprints, STALL_STEP_THRESHOLD)).toBe(false);
    pushOnce('idle');
    expect(stallDetected(fingerprints, STALL_STEP_THRESHOLD)).toBe(true);
  });
});

describe('prepareStep system prompt', () => {
  it('appends budget without replacing the QC checklist', () => {
    const base = 'You are an expert art-director agent.\n4. After each render_image, judge the result using this QC checklist:\n1. PRODUCT FIDELITY';
    const budget = createAgentBudget({ renders: 4, inspects: 2, usdRemaining: 1.5 });
    const merged = buildPrepareStepSystem(base, budget, 4, 2, 120);
    expect(merged).toContain('PRODUCT FIDELITY');
    expect(merged).toContain('Renders left: 4/4');
    expect(appendBudgetToSystem(base, 'time')).toContain(base);
  });
});

describe('image-agent loop integration', () => {
  it('runs prepareStep with the full system prompt and finishes with a generated imagePrompt', async () => {
    generateText.mockImplementation(async ({ prepareStep, onStepFinish, tools }) => {
      const stepSystem = prepareStep?.({ stepNumber: 0, steps: [] })?.system ?? '';
      expect(stepSystem).toContain('PRODUCT FIDELITY');
      expect(stepSystem).toContain('Renders left');

      onStepFinish?.({ usage: { inputTokens: 50, outputTokens: 20 } });
      onStepFinish?.({ usage: { inputTokens: 40, outputTokens: 10 } });

      const first = await tools.render_image.execute({ prompt: 'Hero product shot', aspect: '9:16' });
      expect(first).toMatchObject({ ok: true });
      expect(renderPostImage).toHaveBeenCalledWith(
        expect.anything(),
        'Hero product shot',
        expect.objectContaining({ aspectRatio: '9:16' })
      );

      await tools.finish.execute({
        imagePrompt: 'Hero product shot',
        notes: 'Rendered vertical hero.',
        imageUrl: 'https://cdn.example/img.png'
      });

      return { text: '', totalUsage: { inputTokens: 200, outputTokens: 80 } };
    });

    const result = await runImageAgent({
      supabase: stubSupabase,
      userId: 'u1',
      brandId: 'b1',
      brief: 'Product hero shot',
      platform: 'instagram',
      aspectRatio: '9:16',
      pinnedLibraryMediaIds: ['media-1'],
      budget: { renders: 1, inspects: 0 },
      deadlineMs: 30_000
    });

    expect(result.source).toBe('generated');
    expect(result.imagePrompt.length).toBeGreaterThan(0);
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'image-agent', ok: true, context: 'image-agent' }));
  });

  it('logs failed generateText runs', async () => {
    generateText.mockRejectedValueOnce(new Error('model unavailable'));
    await expect(
      runImageAgent({
        supabase: stubSupabase,
        userId: 'u1',
        brandId: 'b1',
        brief: 'fail path',
        platform: 'instagram',
        budget: { renders: 1, inspects: 0 },
        deadlineMs: 5_000
      })
    ).rejects.toThrow('model unavailable');
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'image-agent', ok: false, error: 'model unavailable' }));
  });

  it('bills the steps that completed before the failure', async () => {
    // generateText loses totalUsage when it throws, so the finally-block must fall back to the
    // usage onStepFinish accumulated — otherwise cost_usd is null and the failed run bills nothing.
    generateText.mockImplementationOnce(async ({ onStepFinish }) => {
      onStepFinish?.({ usage: { inputTokens: 9_000, outputTokens: 400 } });
      throw new Error('model exploded mid-loop');
    });
    await expect(
      runImageAgent({
        supabase: stubSupabase,
        userId: 'u1',
        brandId: 'b1',
        brief: 'partial spend',
        platform: 'instagram',
        budget: { renders: 1, inspects: 0 },
        deadlineMs: 5_000
      })
    ).rejects.toThrow('model exploded mid-loop');
    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'image-agent', ok: false, inputTokens: 9_000, outputTokens: 400 })
    );
  });
});

describe('image-agent inspect budget', () => {
  it('rejects inspect_assets after the inspect budget is spent', () => {
    const budget = createAgentBudget({ inspects: 2 });
    expect(consumeInspectBudget(budget).ok).toBe(true);
    expect(consumeInspectBudget(budget).ok).toBe(true);
    expect(consumeInspectBudget(budget).ok).toBe(false);
  });
});
