import { describe, expect, it } from 'vitest';
import { isBrowserlessConfigured } from '$lib/server/browserless';
import {
  CAPTURE_RETRY_HINT,
  parseWorkflowResponse,
  type CaptureStep
} from '$lib/server/website-capture';

describe('website capture wiring', () => {
  it('exports captureWebsite and is gated on Browserless config', async () => {
    const { captureWebsite } = await import('$lib/server/website-capture');
    expect(typeof captureWebsite).toBe('function');
    // Without a mock supabase we only assert the config gate path.
    if (!isBrowserlessConfigured()) {
      const r = await captureWebsite({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: {} as any,
        brandId: 'b',
        userId: 'u',
        url: 'https://example.com'
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/BROWSERLESS/i);
        expect(r.retry_hint).toBe(CAPTURE_RETRY_HINT);
      }
    }
  });

  it('rejects unsafe urls before calling Browserless', async () => {
    const { captureWebsite } = await import('$lib/server/website-capture');
    // Force the configured path only when a key exists; otherwise the gate returns first.
    if (!isBrowserlessConfigured()) return;
    const r = await captureWebsite({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {} as any,
      brandId: 'b',
      userId: 'u',
      url: 'file:///etc/passwd'
    });
    expect(r.ok).toBe(false);
  });
});

describe('parseWorkflowResponse', () => {
  it('parses a JSON string payload', () => {
    const wf = parseWorkflowResponse(
      JSON.stringify({
        ok: false,
        error: 'click selector not found: #missing',
        url: 'https://app.example.com/login',
        title: 'Sign in',
        bodyStart: 'Email Password Sign in Continue with Google',
        failedStep: { index: 4, action: 'click', selector: '#missing' },
        hints: {
          buttons: [{ tag: 'button', type: 'submit', text: 'Sign in', name: null, id: null, className: 'cta' }],
          inputs: [{ tag: 'input', type: 'email', name: 'email', placeholder: 'Email', id: 'email' }]
        }
      })
    );
    expect(wf.ok).toBe(false);
    expect(wf.failedStep).toMatchObject({ action: 'click', selector: '#missing' });
    expect(wf.hints?.buttons[0]?.text).toBe('Sign in');
    expect(wf.bodyStart).toMatch(/Continue with Google/);
  });

  it('treats a raw base64 string as a successful screenshot', () => {
    const wf = parseWorkflowResponse('iVBORw0KGgoAAAANSUhEUg==');
    expect(wf.ok).toBe(true);
    expect(wf.screenshot).toMatch(/^iVBOR/);
  });

  it('unwraps a { base64 } object from older Browserless wrappers', () => {
    const wf = parseWorkflowResponse({ base64: 'abc123' });
    expect(wf.ok).toBe(true);
    expect(wf.screenshot).toBe('abc123');
  });
});

describe('capture step DSL', () => {
  it('includes click_text for live selector recovery', () => {
    const steps: CaptureStep[] = [
      { action: 'goto', url: 'https://app.example.com/login' },
      { action: 'click_text', text: 'Sign in' },
      { action: 'screenshot' }
    ];
    expect(steps[1]).toMatchObject({ action: 'click_text', text: 'Sign in' });
  });
});

describe('demo login is not silently skipped', () => {
  it('fails loudly when login was required but no demo account is saved', async () => {
    if (!isBrowserlessConfigured()) return;
    const { captureWebsite } = await import('$lib/server/website-capture');
    const r = await captureWebsite({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {} as any,
      brandId: '00000000-0000-0000-0000-000000000000',
      userId: 'u',
      url: 'https://app.example.com/dashboard',
      useDemoAccount: true
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/no_demo_account/i);
      expect(r.retry_hint).toBe(CAPTURE_RETRY_HINT);
    }
  });
});

describe('platform logins never pass as a logged-in capture', () => {
  it('fails loudly instead of returning the public page', async () => {
    if (!isBrowserlessConfigured()) return;
    const { captureWebsite } = await import('$lib/server/website-capture');
    const r = await captureWebsite({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {} as any,
      brandId: '00000000-0000-0000-0000-000000000000',
      userId: 'u',
      url: 'https://www.instagram.com/explore/',
      useDemoAccount: true,
      demoSecret: {
        loginUrl: 'https://www.instagram.com/accounts/login',
        username: 'someone@example.com',
        password: 'irrelevant',
        pages: [],
        instructions: null,
        emailSelector: null,
        passwordSelector: null,
        submitSelector: null,
        successSelector: null,
        hasPassword: true,
        lastHarvestedAt: null,
        lastHarvestCount: null,
        lastError: null
      }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/platform_login_not_allowed/);
      expect(r.error).toContain('Instagram');
    }
  });
});
