import { describe, expect, it } from 'vitest';
import { ssrNoExternalForDeploy } from './ssr-no-external';

describe('ssrNoExternalForDeploy', () => {
  it('bundles @anomalia/* for node, whose Docker final stage installs without packages/', () => {
    expect(ssrNoExternalForDeploy('node')).toContainEqual(/^@anomalia\//);
  });

  it('leaves simple-icons external for node, which ships full node_modules and needs no dead copy inlined', () => {
    expect(ssrNoExternalForDeploy('node')).not.toContain('simple-icons');
  });

  it('bundles simple-icons for Vercel, whose nft tracer would otherwise duplicate it per function', () => {
    expect(ssrNoExternalForDeploy('')).toContain('simple-icons');
  });

  it('does not bundle @anomalia/* for Vercel, which installs packages/ workspaces normally', () => {
    expect(ssrNoExternalForDeploy('')).not.toContainEqual(/^@anomalia\//);
  });
});
