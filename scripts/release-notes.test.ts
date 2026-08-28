// No git available in the unit test — buildNotes() is the pure core of
// scripts/release-notes.mjs: it turns changelog entries (and, when there are
// none, commit subjects) into the markdown body of a GitHub Release.
import { describe, expect, it } from 'vitest';
import { buildNotes } from './release-notes.mjs';

const file = (name: string, content: string) => ({ name, content });

describe('buildNotes', () => {
  it('renders one section per changelog entry, title from the # line', () => {
    const notes = buildNotes({
      files: [file('2026-08-28-cli-in-monorepo.md', '# CLI, MCP e skill vivono qui\n\nPerché: una sola casa.\n')],
      commits: []
    });
    expect(notes).toBe('## CLI, MCP e skill vivono qui\n\nPerché: una sola casa.');
  });

  it('orders entries newest first by filename', () => {
    const notes = buildNotes({
      files: [
        file('2026-08-20-old.md', '# Old'),
        file('2026-08-28-new.md', '# New')
      ],
      commits: []
    });
    expect(notes.indexOf('## New')).toBeLessThan(notes.indexOf('## Old'));
  });

  it('skips README.md and entries without a title line', () => {
    const notes = buildNotes({
      files: [
        file('README.md', '# Changelog interno'),
        file('2026-08-28-titled.md', '# Titled\n\nBody.'),
        file('2026-08-27-untitled.md', 'solo corpo, senza titolo')
      ],
      commits: []
    });
    expect(notes).toContain('## Titled');
    expect(notes).not.toContain('README');
    expect(notes).not.toContain('senza titolo');
    expect(notes).not.toContain('solo corpo');
  });

  it('falls back to commit subjects when no changelog file was added', () => {
    const notes = buildNotes({
      files: [],
      commits: ['Move CLI, MCP and skills into the monorepo (#22)', 'Split both changelogs (#23)']
    });
    expect(notes).toBe('- Move CLI, MCP and skills into the monorepo (#22)\n- Split both changelogs (#23)');
  });

  it('returns an empty string when there is nothing at all', () => {
    expect(buildNotes({ files: [], commits: [] })).toBe('');
  });
});
