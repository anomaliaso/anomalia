import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('chat thinking presentation', () => {
  it('keeps live reasoning collapsed and uses the shared thought row', () => {
    const live = read('./components/ChatLiveStatus.svelte');

    expect(live).toContain('<ChatThought reasoning={streamReasoning} live={loading} />');
    expect(live).not.toContain('reasoning-content');
    expect(live).not.toContain('autoscroll');
  });

  it('offers the full thought in the same desktop dialog and mobile sheet as tool details', () => {
    const thought = read('./components/ChatThought.svelte');

    expect(thought).toContain("live ? $_('chat.thinking') : $_('chat.thought')");
    expect(thought).toContain('aria-haspopup="dialog"');
    expect(thought).toContain('<Dialog.Root bind:open>');
    expect(thought).toContain('<Sheet.Root bind:open>');
    expect(thought).toContain("reasoning.replace(/\\u200b/g, '')");
  });
});
