import { describe, expect, it } from 'vitest';
import {
  PRODUCE_MAX_ROUNDS,
  applyProduceCraft,
  produceAgentEnabled,
  type PostCraft
} from './produce-agent';
import type { WeeklyStrategy } from './content-preview';

describe('produce agent', () => {
  it('is enabled by default (opt-out via PRODUCE_AGENT_ENABLED=false)', () => {
    expect(produceAgentEnabled()).toBe(true);
  });

  it('caps produce↔review retries at 4', () => {
    expect(PRODUCE_MAX_ROUNDS).toBe(4);
  });

  it('maps crafts onto seeds with justifications and platform cuts', () => {
    const strategy: WeeklyStrategy = {
      theme: 'Ship in public',
      rationale: 'Founder-led proof',
      doDont: 'DO be concrete. DON\'T hype.',
      seeds: [
        {
          id: 's1',
          platform: 'instagram',
          platforms: ['instagram', 'x'],
          format: 'single_image',
          media: 'image',
          day: 'Mon',
          time: '10:00',
          angle: 'Behind the build',
          subject: 'laptop on desk',
          setting: 'morning light',
          props: 'notebook',
          product: '',
          person: '',
          pillar: 'Product'
        },
        {
          id: 's2',
          platform: 'reddit',
          platforms: ['reddit'],
          format: 'text_post',
          media: 'text',
          day: 'Tue',
          time: '11:00',
          angle: 'Founder workflow',
          subject: '',
          setting: '',
          props: '',
          product: '',
          person: '',
          pillar: 'Product',
          subreddit: 'SaaS',
          title: 'Old title'
        }
      ]
    };
    const crafts: PostCraft[] = [
      {
        index: 0,
        caption: 'We shipped the ugly first version. Here is what broke.',
        image_prompt: 'Overhead desk shot, morning window light, open notebook with messy notes.',
        justification: 'read_post_history: top posts were founder candor; avoid polished stock.',
        scene_deviation: 'Messy notes beat the proposed clean laptop shot: candor is the angle.',
        x_caption: 'Shipped the ugly v1. Here is what broke.'
      },
      {
        index: 1,
        caption: 'Here is the exact checklist I use…',
        image_prompt: '',
        title: 'Solo founder social without a hire',
        subreddit: 'microsaas',
        justification: 'r/microsaas fits indie tooling talk; no waitlist URL to avoid promo kill.'
      }
    ];
    const posts = applyProduceCraft(strategy, crafts, { language: 'English' });
    expect(posts).toHaveLength(2);
    expect(posts[0].caption).toContain('ugly first version');
    expect(posts[0].image_prompt).toContain('Overhead desk');
    expect(posts[0].justification).toContain('read_post_history');
    expect(posts[0].platform_captions?.x).toContain('ugly v1');
    expect(posts[0].planRowId).toBe('s1');
    expect(posts[0].angle).toBe('Behind the build');
    expect(posts[1].subreddit).toBe('microsaas');
    expect(posts[1].title).toBe('Solo founder social without a hire');
  });

  // Contratto a due livelli: la deviazione dichiarata atterra sul post con la sua riga di motivo,
  // i campi VINCOLANTI del seed restano copiati verbatim, e chi segue la proposta resta pulito.
  it('carries a declared scene deviation and keeps binding fields verbatim', () => {
    const strategy: WeeklyStrategy = {
      theme: 't',
      rationale: 'r',
      doDont: 'd',
      seeds: [
        {
          id: 's1',
          platform: 'instagram',
          platforms: ['instagram'],
          format: 'single_image',
          media: 'image',
          day: 'Mon',
          time: '10:00',
          angle: 'Behind the build',
          subject: 'laptop on desk',
          setting: 'morning light',
          props: 'notebook',
          product: 'Anomalia',
          person: '',
          pillar: 'Product'
        }
      ]
    };
    const crafts: PostCraft[] = [
      {
        index: 0,
        caption: 'c',
        image_prompt: 'Hands ripping a printed report in half, harsh flash.',
        justification: 'j',
        scene_deviation: 'The ripped report dramatises the angle better than a desk still life.'
      }
    ];
    const [post] = applyProduceCraft(strategy, crafts);
    expect(post.sceneDeviation).toContain('ripped report');
    // Binding tier: strategy/logistics copied verbatim regardless of the deviation.
    expect(post.platform).toBe('instagram');
    expect(post.format).toBe('single_image');
    expect(post.day).toBe('Mon');
    expect(post.time).toBe('10:00');
    expect(post.product).toBe('Anomalia');
    expect(post.pillar).toBe('Product');
    expect(post.planRowId).toBe('s1');
    // No deviation declared → no note.
    const [clean] = applyProduceCraft(strategy, [{ index: 0, caption: 'c', image_prompt: 'x', justification: 'j' }]);
    expect(clean.sceneDeviation).toBeUndefined();
  });

  it('maps carousel slide_prompts onto image_prompts', () => {
    const strategy: WeeklyStrategy = {
      theme: 'Process',
      rationale: 'r',
      doDont: 'd',
      seeds: [
        {
          id: 'c1',
          platform: 'instagram',
          platforms: ['instagram'],
          format: 'carousel',
          media: 'image',
          slide_count: 3,
          day: 'Wed',
          time: '12:00',
          angle: 'Three steps',
          subject: 'desk',
          setting: 'studio',
          props: 'notebook',
          product: '',
          person: '',
          pillar: 'Product'
        }
      ]
    };
    const posts = applyProduceCraft(strategy, [
      {
        index: 0,
        caption: 'Three steps to ship',
        image_prompt: 'Slide 1 cover',
        slide_prompts: ['Slide 1 cover', 'Slide 2 detail', 'Slide 3 result'],
        justification: 'carousel series'
      }
    ]);
    expect(posts[0].image_prompts).toEqual(['Slide 1 cover', 'Slide 2 detail', 'Slide 3 result']);
    expect(posts[0].image_prompt).toBe('Slide 1 cover');
  });
});
