import { describe, expect, it } from 'vitest';
import { pathFor } from './index';
import { GENERATE_CAPTIONS } from './captions';

describe('il contratto delle didascalie', () => {
  it('chiede solo un topic: senza piattaforme le scrive per tutte', () => {
    expect(GENERATE_CAPTIONS.input.safeParse({ topic: 'un lancio' }).success).toBe(true);
    expect(GENERATE_CAPTIONS.input.safeParse({}).success).toBe(false);
    expect(GENERATE_CAPTIONS.input.safeParse({ topic: '' }).success).toBe(false);
  });

  it('accetta una piattaforma sola e rifiuta un nome che non esiste', () => {
    expect(GENERATE_CAPTIONS.input.safeParse({ topic: 't', platforms: ['x'] }).success).toBe(true);
    expect(GENERATE_CAPTIONS.input.safeParse({ topic: 't', platforms: ['myspace'] }).success).toBe(false);
    expect(GENERATE_CAPTIONS.input.safeParse({ topic: 't', platforms: [] }).success).toBe(false);
  });

  it('conosce due formati soli, e la sequenza va chiesta', () => {
    expect(GENERATE_CAPTIONS.input.safeParse({ topic: 't', format: 'thread' }).success).toBe(true);
    expect(GENERATE_CAPTIONS.input.safeParse({ topic: 't', format: 'sequence' }).success).toBe(false);
  });

  it('non crea niente, e dichiara il 402 perché spende crediti', () => {
    expect(GENERATE_CAPTIONS.destructive).toBe(false);
    expect(GENERATE_CAPTIONS.failures).toContainEqual({ error: 'credits_exhausted', status: 402 });
    expect(pathFor(GENERATE_CAPTIONS, 'demo')).toBe('/api/v1/brands/demo/captions/generate');
  });

  it('dice che non pubblica: chi legge tools/list deve trovare create_post da qui', () => {
    expect(GENERATE_CAPTIONS.description).toContain('create_post');
    expect(GENERATE_CAPTIONS.description).toMatch(/no post is created/i);
  });
});
