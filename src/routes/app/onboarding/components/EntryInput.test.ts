import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./EntryInput.svelte', import.meta.url), 'utf8');
const streamErrorStart = source.indexOf("else if (msg.type === 'error') {");
const streamErrorEnd = source.indexOf('\n        }', streamErrorStart);
const streamErrorBranch = source.slice(streamErrorStart, streamErrorEnd);

describe('onboarding analysis errors', () => {
  it('shows the localized failure while retaining server detail for diagnostics', () => {
    expect(streamErrorBranch).toContain("onerror?.('analyze', msg.message)");
    expect(streamErrorBranch).toContain("error = $_('onboarding.status.analysisFailed')");
    expect(streamErrorBranch).not.toContain('error = msg.message');
  });
});
