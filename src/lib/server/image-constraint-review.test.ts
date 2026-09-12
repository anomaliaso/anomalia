import { describe, expect, it, vi } from 'vitest';
import {
  APPAREL_BRANDING_DIRECTIVE,
  extractBrandConstraints,
  reviewImageConstraints,
  type ImageConstraintJudge
} from './image-constraint-review';

const IMAGE = 'data:image/png;base64,AAAA';

describe('reviewImageConstraints', () => {
  it('gives saved brand constraints precedence over a requested garment logo', () => {
    expect(APPAREL_BRANDING_DIRECTIVE).toContain('Brand rules override this exception.');
  });

  it('uses the saved brand constraints and nothing else from memory', () => {
    const constraints = extractBrandConstraints(`
## BRAND MEMORY

### CONSTRAINTS & RULES
- Tajima is allowed only on embroidery machines, never on garments.

### VOICE & TONE
- Write in a direct, practical tone.
`);

    expect(constraints).toBe('Tajima is allowed only on embroidery machines, never on garments.');
  });

  it('rejects a machine brand embroidered on a garment', async () => {
    const judge = vi.fn<ImageConstraintJudge>().mockResolvedValue({
      pass: false,
      issues: ['TAJIMA is embroidered on the polo shirt.']
    });

    const review = await reviewImageConstraints(
      {
        image: IMAGE,
        brief: 'A Tajima embroidery machine beside a folded polo shirt.',
        brandRules: 'Tajima is allowed only on embroidery machines, never on garments.'
      },
      { judge }
    );

    expect(review).toEqual({ pass: false, issues: ['TAJIMA is embroidered on the polo shirt.'] });
    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('never on a garment, hat, uniform, accessory or textile')
      })
    );
  });

  it('allows a manufacturer mark that appears only on the machine', async () => {
    const judge = vi.fn<ImageConstraintJudge>().mockResolvedValue({ pass: true, issues: [] });

    const review = await reviewImageConstraints(
      {
        image: IMAGE,
        brief: 'A Tajima embroidery machine stitching a plain polo shirt.'
      },
      { judge }
    );

    expect(review).toEqual({ pass: true, issues: [] });
    expect(APPAREL_BRANDING_DIRECTIVE).toContain('machine, tool or equipment');
  });
});
