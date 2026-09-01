import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import HomeAgentPanel from './HomeAgentPanel.svelte';

const translations: Record<string, string> = {
  'chat.computer.toggle': 'Agent panel',
  'chat.computer.title': "Content Creator's computer",
  'chat.computer.activity': 'Activity',
  'chat.computer.nowWorking': 'Working now',
  'chat.computer.desktopTitle': 'Agent desktop',
  'chat.computer.controlTake': 'Take control',
  'chat.computer.lastReport': 'Latest report',
  'chat.computer.openWork': "Open where it's working"
};

const translate = (key: string, options?: { values?: Record<string, string> }) => {
  const template = translations[key] ?? key;
  return template.replace('{name}', options?.values?.name ?? '');
};

vi.mock('svelte-i18n', () => ({
  _: { subscribe: (run: (value: typeof translate) => void) => (run(translate), () => {}) },
  locale: { subscribe: (run: (value: string) => void) => (run('en'), () => {}) }
}));

describe('HomeAgentPanel', () => {
  it('opens on a live remote-computer preview with the agent work beside it', () => {
    const { body } = render(HomeAgentPanel);

    expect(body).toContain('data-state="open"');
    expect(body).toContain('Agent panel');
    expect(body).toContain('Content Creator\'s computer');
    expect(body).toContain('Agent desktop');
    expect(body).toContain('Working now');
    expect(body).toContain('data-testid="remote-computer-screen"');
  });
});
