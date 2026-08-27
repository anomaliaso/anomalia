import { describe, expect, it } from 'vitest';
import {
  buildUgcPlanAgentPrompt,
  buildUgcPlanAgentSystem
} from './ugc-plan-agent';

describe('ugc plan agent prompts', () => {
  it('requires read_brand_studio before scripts and forbids off-brand drama', () => {
    const system = buildUgcPlanAgentSystem({
      count: 3,
      brandName: 'Anomalia',
      language: 'Italian'
    });
    expect(system).toMatch(/read_brand_studio FIRST/i);
    expect(system).toMatch(/read_media/);
    expect(system).toMatch(/submit_ugc_scripts/);
    expect(system).toMatch(/medical\/health/);
    expect(system).toMatch(/Italian/);
  });

  it('user prompt tells the agent to start with brand tools', () => {
    const prompt = buildUgcPlanAgentPrompt({
      prompt: 'Illustra le features di Anomalia con gli screenshots nei media',
      count: 2,
      assignmentLines: '#1: feature Anomalia; invent a concrete speaker look',
      brand: {
        name: 'Anomalia',
        about: 'Social AI autopilot',
        category: 'SaaS',
        audience: 'Marketers',
        brandStyle: 'Direct',
        aiContext: '',
        offerings: [{ title: 'UGC Creator', description: 'Talking videos', kind: 'feature' }],
        language: 'Italian'
      }
    });
    expect(prompt).toMatch(/Start with read_brand_studio/);
    expect(prompt).toMatch(/read_media/);
    expect(prompt).toMatch(/screenshots/);
    expect(prompt).toMatch(/BRAND IDENTITY/);
  });
});
