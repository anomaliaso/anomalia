import { describe, it, expect } from 'vitest';
import { computeBrandWarnings, warningCounts } from './warnings';

const base = '/app/acme';
const baseInput = { base, targetPlatforms: [], connectedPlatforms: [], brokenPlatforms: [], autopilotFailureCount: 0, autopilotMaxFailures: 3, hasProposedPlan: false, strategyPlatforms: null, editorialPlanPlatforms: null, contentPlatforms: [], contentCount: 0, failedPostCount: 0, attentionPostCount: 0, postsRemaining: 10, postsQuota: 30, hasStrategy: true, hasEditorialPlan: true, onboardingCompleted: true, pendingCount: 0, calendarConflicts: 0, hasLogo: true, hasVisualStyle: true, hasHashtags: true, peopleCount: 1, competitorCount: 1, blogEnabled: true, hasGeoAudit: true };

describe('computeBrandWarnings', () => {
  it('warns when no platforms are selected', () => {
    const w = computeBrandWarnings({ ...baseInput });
    expect(w.find((x) => x.id === 'no-platforms')?.severity).toBe('warning');
  });

  it('errors about targeted-but-unconnected platforms (twitter → x)', () => {
    const w = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram', 'twitter'], connectedPlatforms: ['x'] });
    const nc = w.find((x) => x.id === 'platforms-not-connected');
    expect(nc?.severity).toBe('error');
    // instagram is unconnected; x (twitter) IS connected → only Instagram flagged.
    expect(nc!.values!.platforms).toBe('Instagram');
  });

  it('does not warn when every targeted platform is connected', () => {
    const w = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram'], connectedPlatforms: ['instagram'] });
    expect(w.find((x) => x.id === 'platforms-not-connected')).toBeUndefined();
  });

  it('flags a strategy built for different platforms than the current targets', () => {
    const drift = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram', 'reddit'], connectedPlatforms: ['instagram', 'reddit'], strategyPlatforms: ['instagram'] });
    expect(drift.find((x) => x.id === 'strategy-platform-mismatch')).toBeTruthy();
    const aligned = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram'], connectedPlatforms: ['instagram'], strategyPlatforms: ['instagram'] });
    expect(aligned.find((x) => x.id === 'strategy-platform-mismatch')).toBeUndefined();
  });

  it('flags an editorial plan built for different platforms', () => {
    const w = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram', 'reddit'], connectedPlatforms: ['instagram', 'reddit'], editorialPlanPlatforms: ['instagram'] });
    expect(w.find((x) => x.id === 'plan-platform-mismatch')).toBeTruthy();
  });

  it('suggests continuing the optional onboarding half when incomplete', () => {
    const w = computeBrandWarnings({ ...baseInput, onboardingCompleted: false });
    const c = w.find((x) => x.id === 'continue-onboarding');
    expect(c?.severity).toBe('suggestion');
    expect(c?.href).toBe('/app/acme');
    // Incomplete onboarding suppresses the separate no-strategy nudge (same gap, one CTA).
    expect(computeBrandWarnings({ ...baseInput, onboardingCompleted: false, hasStrategy: false }).find((x) => x.id === 'no-strategy')).toBeUndefined();
  });

  it('suggests cross-posting generated content to uncovered platforms', () => {
    const w = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram', 'reddit'], connectedPlatforms: ['instagram', 'reddit'], contentPlatforms: ['instagram'], contentCount: 5 });
    const cp = w.find((x) => x.id === 'crosspost-opportunity');
    expect(cp?.severity).toBe('suggestion');
    expect(cp!.values!.platforms).toBe('Reddit');
    // No opportunity when content already covers every target.
    expect(computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram'], connectedPlatforms: ['instagram'], contentPlatforms: ['instagram'], contentCount: 3 }).find((x) => x.id === 'crosspost-opportunity')).toBeUndefined();
  });

  it('surfaces operational states: failed (error), attention/quota (warning), missing layers (suggestion)', () => {
    const w = computeBrandWarnings({ ...baseInput, failedPostCount: 2, attentionPostCount: 1, postsRemaining: 0, postsQuota: 30, hasStrategy: false });
    expect(w.find((x) => x.id === 'failed-posts')?.severity).toBe('error');
    expect(w.find((x) => x.id === 'posts-need-attention')?.severity).toBe('warning');
    expect(w.find((x) => x.id === 'quota-exhausted')?.severity).toBe('warning');
    expect(w.find((x) => x.id === 'no-strategy')?.severity).toBe('suggestion');
    // Missing plan only nudges once the strategy exists (avoid double-nudging).
    expect(computeBrandWarnings({ ...baseInput, hasStrategy: true, hasEditorialPlan: false }).find((x) => x.id === 'no-plan')).toBeTruthy();
    expect(computeBrandWarnings({ ...baseInput, hasStrategy: false, hasEditorialPlan: false }).find((x) => x.id === 'no-plan')).toBeUndefined();
  });

  it('suggests each missing Studio piece', () => {
    const w = computeBrandWarnings({ ...baseInput, hasLogo: false, hasVisualStyle: false, hasHashtags: false, peopleCount: 0, competitorCount: 0 });
    const ids = w.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['studio-no-logo', 'studio-no-visual-style', 'studio-no-people', 'studio-no-competitors', 'studio-no-hashtags']));
    expect(w.filter((x) => x.id.startsWith('studio-no-')).every((x) => x.severity === 'suggestion')).toBe(true);
    // A fully-filled Studio raises none of them.
    expect(computeBrandWarnings({ ...baseInput }).some((x) => x.id.startsWith('studio-no-'))).toBe(false);
  });

  it('errors on a broken account (reconnect), not as never-connected', () => {
    const w = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram'], connectedPlatforms: [], brokenPlatforms: ['instagram'] });
    expect(w.find((x) => x.id === 'account-needs-reconnect')?.severity).toBe('error');
    // A broken (but existing) account must NOT also read as "never connected".
    expect(w.find((x) => x.id === 'platforms-not-connected')).toBeUndefined();
  });

  it('escalates autopilot failures: warning, then auto-disabled error', () => {
    expect(computeBrandWarnings({ ...baseInput, autopilotFailureCount: 1 }).find((x) => x.id === 'autopilot-failing')?.severity).toBe('warning');
    const dead = computeBrandWarnings({ ...baseInput, autopilotFailureCount: 3 });
    expect(dead.find((x) => x.id === 'autopilot-disabled')?.severity).toBe('error');
    expect(dead.find((x) => x.id === 'autopilot-failing')).toBeUndefined(); // one or the other, not both
  });

  it('suggests reviewing an autopilot proposal', () => {
    expect(computeBrandWarnings({ ...baseInput, hasProposedPlan: true }).find((x) => x.id === 'plan-proposed')?.severity).toBe('suggestion');
  });

  it('counts by severity', () => {
    const w = computeBrandWarnings({ ...baseInput, targetPlatforms: ['instagram'], connectedPlatforms: [], pendingCount: 3, hasLogo: false });
    const c = warningCounts(w);
    expect(c.error).toBeGreaterThanOrEqual(1); // not-connected (now an error)
    expect(c.suggestion).toBeGreaterThanOrEqual(2); // pending + no-logo
    expect(c.total).toBe(c.error + c.warning + c.suggestion);
  });
});
