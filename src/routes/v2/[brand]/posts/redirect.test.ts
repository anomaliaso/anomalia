import { describe, it, expect } from 'vitest';
import { GET } from './+server';

function locationOf(from: string): string {
  try {
    (GET as (event: unknown) => unknown)({
      params: { brand: 'demo' },
      url: new URL(from)
    });
  } catch (thrown) {
    return (thrown as { location: string }).location;
  }

  throw new Error('The old route answered instead of redirecting.');
}

describe('la vecchia rotta dei post entra nel calendario', () => {
  it('atterra sulla vista lista', () => {
    expect(locationOf('https://anomalia.so/v2/demo/posts')).toBe('/v2/demo/calendar?view=list');
  });

  it('non perde il filtro con cui la dashboard ci manda', () => {
    expect(locationOf('https://anomalia.so/v2/demo/posts?status=pending_user')).toBe(
      '/v2/demo/calendar?view=list&status=pending_user'
    );
  });

  it('non perde il post che era stato aperto', () => {
    expect(locationOf('https://anomalia.so/v2/demo/posts?post=p1&status=approved')).toBe(
      '/v2/demo/calendar?view=list&status=approved&post=p1'
    );
  });
});
