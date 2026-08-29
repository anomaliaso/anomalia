import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
const disconnectFormStart = page.indexOf('<form method="POST" action="?/disconnect"');
const disconnectForm = page.slice(disconnectFormStart, page.indexOf('</form>', disconnectFormStart));

describe('connected accounts disconnect feedback', () => {
  it('keeps the selected removal action visibly pending until the form update completes', () => {
    expect(page).toContain('let disconnecting = $state<string | null>(null);');
    expect(disconnectForm).toContain('use:enhance={withDisconnectSpinner(a.id)}');
    expect(disconnectForm).toContain('disabled={disconnecting === a.id}');
    expect(disconnectForm).toContain("$_('app.settings.del.deleting')");
    expect(page).toMatch(
      /const withDisconnectSpinner = \(id: string\) => \(\) => \{[\s\S]*?disconnecting = id;[\s\S]*?finally \{[\s\S]*?disconnecting = null;/
    );
  });
});
