import { describe, it, expect } from 'vitest';
import { buildToolJobSummary } from './job-summaries';

describe('buildToolJobSummary', () => {
  it('surfaces tool errors', () => {
    expect(buildToolJobSummary('generate_strategy', { error: 'boom' })).toBe(
      '❌ generate_strategy failed: boom'
    );
  });

  it('summarizes strategy phases', () => {
    const text = buildToolJobSummary(
      'generate_strategy',
      {
        objective: 'Crescita',
        phases: [
          { name: 'Awareness', objective: 'farsi conoscere' },
          { name: 'Conversion', objective: 'vendere' }
        ]
      },
      'it'
    );
    expect(text).toContain('Strategia attiva');
    expect(text).toContain('Crescita');
    expect(text).toContain('Awareness');
    expect(text).toContain('Conversion');
  });

  it('summarizes editorial plan weeks', () => {
    const text = buildToolJobSummary(
      'generate_editorial_plan',
      {
        cadence: { instagram: 3 },
        weeks: [{ theme: 'Lancio', focus: 'teaser' }]
      },
      'it'
    );
    expect(text).toContain('Piano editoriale attivo');
    expect(text).toContain('Lancio');
  });

  it('summarizes week production for both tool names', () => {
    const result = {
      week: 0,
      count: 2,
      posts: [
        { n: 1, platform: 'instagram', pillar: 'product', idea: 'hero shot' },
        { n: 2, platform: 'tiktok', format: 'reel', idea: 'ugc' }
      ]
    };
    for (const name of ['produce_week', 'generate_content'] as const) {
      const text = buildToolJobSummary(name, result, 'it');
      expect(text).toContain('Settimana 1');
      expect(text).toContain('2 bozze');
      expect(text).toContain('hero shot');
    }
  });

  it('summarizes campaign creation', () => {
    const text = buildToolJobSummary('create_campaign', {
      campaign_name: 'Black Friday',
      count: 5,
      requested: 5,
      platform: 'instagram'
    });
    expect(text).toContain('Black Friday');
    expect(text).toContain('5/5');
    expect(text).toContain('instagram');
  });

	it('falls back for unknown tools', () => {
    expect(buildToolJobSummary('mystery_tool', { ok: true })).toContain('mystery_tool');
  });

  it('omitted locale is English — never Italian', () => {
    const text = buildToolJobSummary('seo_geo_audit', {
      tech_score: 19,
      issues: 8,
      share_of_voice: 76,
      gaps: 54
    });
    expect(text).toContain('SEO & GEO audit complete');
    expect(text).not.toMatch(/completato|Punteggio|Problemi rilevati/);
  });

  it('writes the SEO audit in English when the chat locale is English — never Italian', () => {
    const text = buildToolJobSummary(
      'seo_geo_audit',
      { tech_score: 19, issues: 8, share_of_voice: 76, gaps: 54 },
      'en'
    );
    expect(text).toContain('SEO & GEO audit complete');
    expect(text).toContain('Technical score: 19/100');
    expect(text).not.toMatch(/completato|Punteggio|Problemi rilevati/);
  });
});
