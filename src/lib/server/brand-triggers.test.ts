import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { COMPOSIO_API_KEY: 'ak_test' } }));

import {
  desiredTriggers,
  GITHUB_PULL_REQUEST_TRIGGER,
  repoTriggerConfig,
  triggerKey
} from './brand-triggers';

describe('repoTriggerConfig', () => {
  it('splits owner/repo, and refuses anything else', () => {
    expect(repoTriggerConfig('andreabuttarelli/021-app')).toEqual({
      owner: 'andreabuttarelli',
      repo: '021-app'
    });
    expect(repoTriggerConfig('nope')).toBeNull();
  });
});

describe('desiredTriggers', () => {
  const repos = ['acme/site', 'acme/api'];

  it('wants one pull-request trigger per watched repository', () => {
    const wanted = desiredTriggers({ hasEndpoint: true, githubConnected: true, githubRepos: repos });
    expect(wanted).toHaveLength(2);
    expect(wanted[0]).toMatchObject({
      toolkitSlug: 'GITHUB',
      triggerSlug: GITHUB_PULL_REQUEST_TRIGGER,
      config: { owner: 'acme', repo: 'site' }
    });
  });

  it('wants nothing without an endpoint to deliver to', () => {
    expect(desiredTriggers({ hasEndpoint: false, githubConnected: true, githubRepos: repos })).toEqual([]);
  });

  it('wants nothing while GitHub is not connected', () => {
    expect(desiredTriggers({ hasEndpoint: true, githubConnected: false, githubRepos: repos })).toEqual([]);
  });

  it('wants nothing when no repository is selected', () => {
    expect(desiredTriggers({ hasEndpoint: true, githubConnected: true, githubRepos: [] })).toEqual([]);
  });
});

describe('triggerKey', () => {
  it('identifies a trigger by slug and config, whatever the key order', () => {
    expect(triggerKey('T', { owner: 'a', repo: 'b' })).toBe(triggerKey('T', { repo: 'b', owner: 'a' }));
    expect(triggerKey('T', { owner: 'a', repo: 'b' })).not.toBe(triggerKey('T', { owner: 'a', repo: 'c' }));
  });
});
