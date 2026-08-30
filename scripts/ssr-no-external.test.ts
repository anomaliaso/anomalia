import { describe, expect, it } from 'vitest';
import { ssrNoExternalForDeploy } from './ssr-no-external';

describe('ssrNoExternalForDeploy', () => {
  it('does not bundle simple-icons for DEPLOY_TARGET=node', () => {
    expect(ssrNoExternalForDeploy('node')).not.toContain('simple-icons');
  });

  it('bundles simple-icons for the Vercel build', () => {
    expect(ssrNoExternalForDeploy('')).toContain('simple-icons');
  });
});
