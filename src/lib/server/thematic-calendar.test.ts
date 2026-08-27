import { describe, it, expect } from 'vitest';
import { buildCalendarPrompt } from './thematic-calendar';

describe('buildCalendarPrompt', () => {
  it('includes the current date and the niche bits provided', () => {
    const p = buildCalendarPrompt({ category: 'coffee', archetype: 'local_service', language: 'it', today: '2026-06-08' });
    expect(p).toContain('Today is 2026-06-08');
    expect(p).toContain('Category: coffee.');
    expect(p).toContain('Brand type: local_service.');
    expect(p).toContain('language/region: it.');
  });

  it('omits empty bits and forbids inventing holidays', () => {
    const p = buildCalendarPrompt({ today: '2026-06-08' });
    expect(p).not.toContain('Category:');
    expect(p).not.toContain('Brand type:');
    expect(p).toContain('never invent fake holidays');
  });
});
