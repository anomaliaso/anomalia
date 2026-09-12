import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  render: vi.fn(),
  review: vi.fn(),
  gateCredits: vi.fn()
}));

vi.mock('$lib/server/ai-log', () => ({
  getBrandContext: () => 'brand-1',
  getOrgContext: () => undefined
}));

vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => state.gateCredits(...args),
  gateOrgCredits: vi.fn()
}));

vi.mock('$lib/server/kie-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/kie-jobs')>()),
  generateImageOnKie: (...args: unknown[]) => state.render(...args)
}));

vi.mock('$lib/server/model-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/model-routing')>()),
  route: () => ({ family: 'nano-banana', endpoint: 'kie', provider: 'kie' })
}));

vi.mock('$lib/server/image-constraint-review', () => ({
  APPAREL_BRANDING_DIRECTIVE: 'APPAREL BRANDING',
  reviewImageConstraints: (...args: unknown[]) => state.review(...args)
}));

const { renderPostImage } = await import('./images');

beforeEach(() => {
  state.render.mockReset();
  state.review.mockReset();
  state.gateCredits.mockReset();
  state.render.mockResolvedValue({ dataUrl: 'data:image/png;base64,AAAA' });
  state.review.mockResolvedValue({ pass: false, issues: ['TAJIMA is embroidered on the polo shirt.'] });
});

describe('renderPostImage brand constraint gate', () => {
  it('does not return an image rejected for branding on apparel', async () => {
    const image = await renderPostImage('A Tajima machine beside a polo shirt.', {
      brandRules: 'Tajima is allowed only on machines.'
    });

    expect(image).toBeUndefined();
    expect(state.render).toHaveBeenCalledTimes(1);
    expect(state.review).toHaveBeenCalledWith({
      image: 'data:image/png;base64,AAAA',
      brief: 'A Tajima machine beside a polo shirt.',
      brandRules: 'Tajima is allowed only on machines.'
    });
  });
});
