import { describe, expect, it } from 'vitest';
import {
  strategyPlanReadyEmailSubject,
  strategyPlanReadyEmailHtml,
  strategyPlanReadyEmailText
} from './email';

describe('strategyPlanReadyEmail', () => {
  it('uses Italian copy for strategy + editorial plan ready', () => {
    const subject = strategyPlanReadyEmailSubject('it', 'Deepseek');
    expect(subject).toContain('Deepseek');
    expect(subject.toLowerCase()).toContain('strategia');
    expect(subject.toLowerCase()).toContain('piano editoriale');

    const text = strategyPlanReadyEmailText('it', 'Deepseek', 4, 'https://example.com/continue');
    expect(text.toLowerCase()).toContain('strategia');
    expect(text).toContain('https://example.com/continue');

    const html = strategyPlanReadyEmailHtml('it', 'Deepseek', 4, 'https://example.com/continue');
    expect(html).toContain('https://example.com/continue');
    expect(html.toLowerCase()).toContain('strategia');
  });

  it('uses English subject', () => {
    expect(strategyPlanReadyEmailSubject('en', 'Acme')).toBe(
      'Acme: strategy and editorial plan ready'
    );
  });
});
