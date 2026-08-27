import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PUBLISHING_POLICY, getPublishingSettings } from './publishing-settings';

// These tests exist to make removing the human approval gate LOUD. The gate is what the AI Act's
// Art. 50(2) human-review exemption rests on, so "someone quietly added an auto-publish branch
// back" has to fail CI rather than ship.

const SCHEDULER = readFileSync('src/lib/server/scheduler.ts', 'utf8');
const BLOG = readFileSync('src/lib/server/blog-generate.ts', 'utf8');

describe('publishing policy', () => {
  it('is a constant, not a setting', () => {
    expect(PUBLISHING_POLICY).toBe('review_required');
  });

  it('lists active accounts without any per-account publishing flag', async () => {
    const calls: string[] = [];
    const supabase = {
      from(table: string) {
        calls.push(table);
        const chain = {
          select(cols: string) {
            calls.push(cols);
            return chain;
          },
          eq() {
            return chain;
          },
          then(resolve: (v: { data: unknown }) => void) {
            resolve({ data: [{ id: 'a1', platform: 'instagram' }] });
          }
        };
        return chain;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const out = await getPublishingSettings(supabase, 'brand-1');
    expect(out).toEqual({
      policy: 'review_required',
      accounts: [{ id: 'a1', platform: 'instagram' }]
    });
    expect(calls.join(' ')).not.toMatch(/auto_publish/);
  });
});

describe('the approval gate is enforced in code', () => {
  it('the scheduler never publishes a post it produced', () => {
    // The autopilot produces into pending_user and stops. If it ever imports the publish path
    // again, that is the bypass coming back.
    expect(SCHEDULER).not.toMatch(/publishApprovedPost/);
    expect(SCHEDULER).toMatch(/const needsApproval = freshPosts \?\? \[\];/);
  });

  it('the scheduler has no publishing mode or per-account auto-publish left', () => {
    for (const gone of ['auto_all', 'auto_curated', 'publishingMode', 'fullAuto', 'auto_publish']) {
      expect(SCHEDULER, `scheduler still references ${gone}`).not.toMatch(new RegExp(gone));
    }
  });

  it('the blog cron only publishes articles a human approved', () => {
    // publishDueArticles selects status 'approved'; drafts written by the autopilot are 'draft'
    // and can never be picked up, whatever scheduled_for they carry.
    expect(BLOG).toMatch(/\.eq\('status', 'approved'\)/);
    expect(BLOG).toMatch(/status: 'draft'/);
    expect(BLOG).not.toMatch(/\.in\('status', \['draft', 'approved'\]\)/);
  });
});
