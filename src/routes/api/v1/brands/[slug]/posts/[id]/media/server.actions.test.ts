import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Il contratto fra i chiamanti e la rotta è una stringa, e una stringa nessun compilatore la
// controlla: `reorder_slides` mandava `action: 'reorder'` e prendeva 400 da sempre. Qui l'insieme
// delle azioni spedite deve stare dentro quello delle azioni implementate.
const ROOT = process.cwd();
const ROUTE = 'src/routes/api/v1/brands/[slug]/posts/[id]/media/+server.ts';
const CALLERS = ['cli/mcp/tools/brand-content.ts', 'cli/commands/post.ts'];

const source = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const literals = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]);

describe('le azioni che CLI e MCP mandano a /posts/:id/media', () => {
  it('sono tutte azioni che la rotta implementa', () => {
    const handled = literals(source(ROUTE), /body\.action === '([a-z_]+)'/g);
    const sent = [...new Set(CALLERS.flatMap((file) => literals(source(file), /action: '([a-z_]+)'/g)))].sort();

    expect(sent.length).toBeGreaterThan(0);
    for (const action of sent) {
      expect(handled, `'${action}': la rotta risponde 400 a questa azione`).toContain(action);
    }
  });
});
