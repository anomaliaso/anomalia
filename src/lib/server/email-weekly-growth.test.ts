import { describe, expect, it } from 'vitest';
import { weeklyRecapEmailHtml, weeklyRecapEmailText, type RecapData } from './email';

function baseRecap(over: Partial<RecapData> = {}): RecapData {
  return {
    brandName: 'Acme',
    brandSlug: 'acme',
    weekLabel: '1 – 8 Aug',
    postsPublished: 2,
    postsPending: 0,
    postsScheduled: 1,
    totalEngagement: 10,
    totalImpressions: 100,
    totalSaves: 0,
    engagementDeltaPct: null,
    prevEngagement: 0,
    prevImpressions: 0,
    prevPosts: 0,
    topPostCaption: null,
    topPostPlatform: null,
    platformStats: [],
    trends: [],
    suggestions: [],
    actionItems: [],
    dashboardUrl: 'https://app.example/app/acme',
    connectedAccounts: [{ platform: 'instagram', username: 'acme' }],
    growth: null,
    ...over
  };
}

describe('weekly recap growth section', () => {
  it('renders growth remediation in html and text when incomplete', () => {
    const data = baseRecap({
      growth: {
        ready: false,
        blockingCount: 2,
        warningCount: 1,
        fixes: [
          { key: 'about', blocking: true, url: 'https://app.example/app/acme/settings/brand' },
          { key: 'competitors', blocking: true, url: 'https://app.example/app/acme/settings/brand' },
          { key: 'audience', blocking: false, url: 'https://app.example/app/acme/settings/brand' }
        ]
      }
    });
    const html = weeklyRecapEmailHtml('en', data);
    expect(html).toContain('Growth data readiness');
    expect(html).toContain('required fixes before produce');
    expect(html).toContain('Add a clear brand About in Studio');
    expect(html).toContain('https://app.example/app/acme/settings/brand');

    const text = weeklyRecapEmailText('en', data);
    expect(text).toContain('Growth data readiness');
    expect(text).toContain('Add a clear brand About in Studio');
  });

  it('omits growth section when brand data is complete', () => {
    const html = weeklyRecapEmailHtml('en', baseRecap({ growth: null }));
    expect(html).not.toContain('Growth data readiness');
  });

  it('renders Italian growth copy', () => {
    const html = weeklyRecapEmailHtml(
      'it',
      baseRecap({
        growth: {
          ready: false,
          blockingCount: 1,
          warningCount: 0,
          fixes: [{ key: 'voice', blocking: true, url: 'https://app.example/app/acme/plan' }]
        }
      })
    );
    expect(html).toContain('Dati pronti per la crescita');
    expect(html).toContain('Definisci voce / personalità');
  });
});

describe('weekly recap link clicks section', () => {
  it('renders link clicks in html and text when > 0', () => {
    const data = baseRecap({ linkClicks: 42 });
    const html = weeklyRecapEmailHtml('en', data);
    expect(html).toContain('Link clicks');
    expect(html).toContain('42');

    const text = weeklyRecapEmailText('en', data);
    expect(text).toContain('Link clicks: 42');
  });

  it('omits the section when linkClicks is missing or 0', () => {
    expect(weeklyRecapEmailHtml('en', baseRecap())).not.toContain('Link clicks');
    expect(weeklyRecapEmailHtml('en', baseRecap({ linkClicks: 0 }))).not.toContain('Link clicks');
    expect(weeklyRecapEmailText('en', baseRecap())).not.toContain('Link clicks');
  });
});

describe('weekly recap visual insights + rank tracking sections', () => {
  it('renders visual insights and rank tracking in html and text when data present', () => {
    const data = baseRecap({
      visualInsights: [
        { dimension: 'genre', value: 'produced_ugc', n: 12, erAvg: 6.2, delta: 35 },
        { dimension: 'platform', value: 'tiktok', n: 8, erAvg: 5.1, delta: 18 },
        { dimension: 'genre', value: 'product_shots', n: 5, erAvg: 1.2, delta: -20 }
      ],
      webKpis: {
        tracked: 42,
        improved: 12,
        worsened: 3,
        improvedList: ['acme pricing', 'acme alternatives']
      }
    });
    const html = weeklyRecapEmailHtml('en', data);
    expect(html).toContain('Visual insights');
    expect(html).toContain('genre: produced_ugc +35% ER vs avg (n=12)');
    expect(html).toContain('genre: product_shots -20% ER vs avg (n=5)');
    expect(html).toContain('Rank tracking');
    expect(html).toContain('tracked: 42 · improved: 12 · worsened: 3');
    expect(html).toContain('acme pricing');
    expect(html).toContain('acme alternatives');

    const text = weeklyRecapEmailText('en', data);
    expect(text).toContain('Visual insights');
    expect(text).toContain('genre: produced_ugc +35% ER vs avg (n=12)');
    expect(text).toContain('Rank tracking');
    expect(text).toContain('tracked: 42 · improved: 12 · worsened: 3');
    expect(text).toContain('acme pricing');
  });

  it('renders at most 3 visual insight rows', () => {
    const data = baseRecap({
      visualInsights: [
        { dimension: 'genre', value: 'a', n: 3, erAvg: 1, delta: 40 },
        { dimension: 'genre', value: 'b', n: 3, erAvg: 1, delta: 30 },
        { dimension: 'genre', value: 'c', n: 3, erAvg: 1, delta: 20 },
        { dimension: 'genre', value: 'd', n: 3, erAvg: 1, delta: 10 }
      ]
    });
    const html = weeklyRecapEmailHtml('en', data);
    expect(html).toContain('genre: a +40% ER vs avg');
    expect(html).not.toContain('genre: d +10% ER vs avg');
  });

  it('omits the sections when there is no data', () => {
    const html = weeklyRecapEmailHtml('en', baseRecap());
    expect(html).not.toContain('Visual insights');
    expect(html).not.toContain('Rank tracking');
    expect(weeklyRecapEmailText('en', baseRecap())).not.toContain('Visual insights');
    expect(weeklyRecapEmailText('en', baseRecap())).not.toContain('Rank tracking');
  });

  it('omits rank tracking when tracked is 0', () => {
    const html = weeklyRecapEmailHtml(
      'en',
      baseRecap({ webKpis: { tracked: 0, improved: 0, worsened: 0, improvedList: [] } })
    );
    expect(html).not.toContain('Rank tracking');
  });

  it('renders Italian copy', () => {
    const html = weeklyRecapEmailHtml(
      'it',
      baseRecap({
        visualInsights: [{ dimension: 'genre', value: 'produced_ugc', n: 12, erAvg: 6.2, delta: 35 }],
        webKpis: { tracked: 1, improved: 1, worsened: 0, improvedList: ['acme'] }
      })
    );
    expect(html).toContain('Insight visivi');
    expect(html).toContain('Monitoraggio posizioni');
    expect(html).toContain('tracciate: 1 · migliorate: 1 · peggiorate: 0');
  });
});

describe('weekly recap weak media reviews', () => {
  const weak = [
    {
      postId: 'post-1',
      overall: 3.2,
      verdict: 'kill' as const,
      kind: 'video',
      judgment: 'No hook in the first 2s',
      caption: 'Summer drop is here',
      postUrl: 'https://app.example/app/acme/posts/post-1/edit'
    },
    {
      postId: 'post-2',
      overall: 5,
      verdict: 'fix' as const,
      kind: 'image',
      judgment: null,
      caption: 'Behind the scenes',
      postUrl: 'https://app.example/app/acme/posts/post-2/edit'
    }
  ];

  it('renders the weakest reviews in html and text', () => {
    const data = baseRecap({ weakReviews: weak });
    const html = weeklyRecapEmailHtml('en', data);
    expect(html).toContain('Weakest media this week');
    expect(html).toContain('Want to redo the visual, or leave them as-is?');
    expect(html).toContain('3.2/10');
    expect(html).toContain('Redo');
    expect(html).toContain('Summer drop is here');
    expect(html).toContain('https://app.example/app/acme/posts/post-1/edit');
    expect(html).toContain('Open post');
    expect(html).toContain('https://app.example/app/acme/settings/media-reviewer');
    expect(html).toContain('See all reviews');

    const text = weeklyRecapEmailText('en', data);
    expect(text).toContain('Weakest media this week');
    expect(text).toContain('3.2/10');
    expect(text).toContain('https://app.example/app/acme/posts/post-1/edit');
    expect(text).toContain('https://app.example/app/acme/settings/media-reviewer');
  });

  it('omits the section when there are no weak reviews', () => {
    expect(weeklyRecapEmailHtml('en', baseRecap())).not.toContain('Weakest media this week');
    expect(weeklyRecapEmailHtml('en', baseRecap({ weakReviews: [] }))).not.toContain(
      'Weakest media this week'
    );
    expect(weeklyRecapEmailText('en', baseRecap())).not.toContain('Weakest media this week');
  });

  it('renders Italian copy', () => {
    const html = weeklyRecapEmailHtml('it', baseRecap({ weakReviews: weak }));
    expect(html).toContain('Media da rivedere');
    expect(html).toContain('Vuoi rifare il visual, o li lasci così?');
    expect(html).toContain('Da rifare');
    expect(html).toContain('Apri post');
    expect(html).toContain('Vedi tutte le review');
  });
});
