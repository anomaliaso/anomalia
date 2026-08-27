import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { COMPOSIO_API_KEY: 'ak_test' } }));

import { composioKeyProblem } from './composio';

describe('composioKeyProblem', () => {
  it('names the wrong-product key instead of letting every call 401', () => {
    const problem = composioKeyProblem('ck_abcd1234');
    expect(problem).toContain('For You');
    expect(problem).toContain('Project Settings');
  });

  it('accepts a project key and stays quiet when nothing is configured', () => {
    expect(composioKeyProblem('ak_abcd1234')).toBeNull();
    expect(composioKeyProblem('')).toBeNull();
  });
});
