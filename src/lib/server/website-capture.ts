/**
 * Capture a public (or workflow-navigated) webpage as a PNG and optionally ingest it into the
 * brand Media library — so chat can chain capture → create_post(graphic_brief, media_ids).
 *
 * Security: the agent never supplies Puppeteer source. Multi-step auth/navigation is a fixed DSL
 * of goto / wait / click / click_text / type / press / screenshot, compiled server-side into
 * Browserless `/function` code. Target URLs go through isUrlSafe.
 *
 * Failures are agentic: the workflow snapshots the live page (screenshot + button/input hints)
 * instead of throwing, so the model can correct selectors and retry in the same turn.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { isUrlSafe } from '$lib/server/brand-analysis';
import { blockedPlatformForUrl } from '$lib/platform-terms';
import { browserlessFunction, isBrowserlessConfigured } from '$lib/server/browserless';
import { catalogBrandMedia, insertBrandMedia } from '$lib/server/brand-media';
import { signKnowledgePaths } from '$lib/server/media-archive';

const BUCKET = 'brand-knowledge';

export type CaptureCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
};

export type CaptureStep =
  | { action: 'goto'; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' }
  | { action: 'wait'; ms?: number; selector?: string; visible?: boolean }
  | { action: 'click'; selector: string }
  | { action: 'click_text'; text: string }
  | {
      action: 'type';
      selector: string;
      text: string;
      clear?: boolean;
      /** Internal: never echo this value back in an error. Set by buildLoginSteps, not by the agent. */
      secret?: boolean;
    }
  | { action: 'press'; key: string }
  | { action: 'screenshot'; fullPage?: boolean; selector?: string };

export type PageHintButton = {
  tag: string;
  type: string | null;
  text: string;
  name: string | null;
  id: string | null;
  className: string;
};

export type PageHintInput = {
  tag: string;
  type: string | null;
  name: string | null;
  placeholder: string | null;
  id: string | null;
};

export type CaptureFailedStep = {
  index: number;
  action: string;
  selector?: string;
  text?: string;
};

export type CaptureWebsiteOpts = {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  /** Simple mode: just this URL (no workflow). Ignored when steps are provided. */
  url?: string;
  /** Multi-step workflow. Must end with (or imply) a screenshot. */
  steps?: CaptureStep[];
  cookies?: CaptureCookie[];
  fullPage?: boolean;
  waitForSelector?: string;
  waitMs?: number;
  /** Save into brand_media so the agent can pass media_ids downstream. Default true. */
  saveToLibrary?: boolean;
  title?: string;
  /** Kick off AI catalog after insert (async best-effort). Default true. */
  catalog?: boolean;
  /**
   * Log in with the brand's saved demo account before capturing.
   * Default: auto — injects when a demo account exists and the URL is on the same host.
   * `true` forces login even if the agent also passed type/click steps.
   * `false` never injects.
   */
  useDemoAccount?: boolean;
  /**
   * Demo secret already loaded by the caller (harvest loads it once for N pages).
   * Saves a Vault round-trip per page; omit and it is loaded here.
   */
  demoSecret?: import('$lib/server/demo-account').DemoAccountSecret | null;
};

export type CaptureWebsiteResult = {
  ok: true;
  media_id?: string;
  /** Signed (or public) URL usable as image_urls / background for a few hours. */
  image_url: string;
  width: number;
  height: number;
  bytes: number;
  source_url: string | null;
  saved_to_library: boolean;
  page_url?: string | null;
  page_title?: string | null;
};

export type CaptureWebsiteFailure = {
  ok: false;
  error: string;
  page_url?: string | null;
  page_title?: string | null;
  body_preview?: string | null;
  failed_step?: CaptureFailedStep | null;
  hints?: { buttons: PageHintButton[]; inputs: PageHintInput[] } | null;
  diagnostic_image_url?: string;
  diagnostic_media_id?: string;
  retry_hint: string;
};

export const CAPTURE_RETRY_HINT =
  'Inspect diagnostic_image_url, body_preview, and hints (buttons/inputs). Then retry capture_website in this turn with a different wait_for_selector, click_text, url, or steps. Do not ask the user to continue for a selector/login miss.';

type WorkflowPayload = {
  ok: boolean;
  screenshot?: string | null;
  url?: string | null;
  title?: string | null;
  bodyStart?: string | null;
  error?: string | null;
  failedStep?: CaptureFailedStep | null;
  hints?: { buttons: PageHintButton[]; inputs: PageHintInput[] } | null;
};

export function parseWorkflowResponse(out: unknown): WorkflowPayload {
  if (typeof out === 'string') {
    try {
      return JSON.parse(out) as WorkflowPayload;
    } catch {
      return { ok: true, screenshot: out };
    }
  }
  if (out && typeof out === 'object') {
    const rec = out as Record<string, unknown>;
    if (typeof rec.base64 === 'string' && rec.ok === undefined) {
      return { ok: true, screenshot: rec.base64 };
    }
    return rec as WorkflowPayload;
  }
  return { ok: false, error: 'Unexpected Browserless workflow response' };
}

function assertSafeUrl(url: string): string {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u) || !isUrlSafe(u)) {
    throw new Error(`URL not allowed: ${u.slice(0, 120)}`);
  }
  return u;
}

function normalizeSteps(opts: CaptureWebsiteOpts): CaptureStep[] {
  if (opts.steps?.length) {
    const steps = opts.steps.map((s) => {
      if (s.action === 'goto') return { ...s, url: assertSafeUrl(s.url) };
      return s;
    });
    const hasShot = steps.some((s) => s.action === 'screenshot');
    if (!hasShot) steps.push({ action: 'screenshot', fullPage: opts.fullPage ?? false });
    return steps;
  }
  if (!opts.url) throw new Error('Provide url or steps');
  const url = assertSafeUrl(opts.url);
  const steps: CaptureStep[] = [{ action: 'goto', url, waitUntil: 'load' }];
  if (opts.waitForSelector) {
    steps.push({ action: 'wait', selector: opts.waitForSelector, visible: true });
  } else if (opts.waitMs) {
    steps.push({ action: 'wait', ms: Math.min(opts.waitMs, 15_000) });
  }
  steps.push({ action: 'screenshot', fullPage: opts.fullPage ?? false });
  return steps;
}

function pngFromBase64(raw: string | null | undefined): Buffer | null {
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.byteLength > 32 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Compile a safe step DSL into Browserless /function code.
 * On a failed step it snapshots the current page so the agent can correct and retry.
 */
async function runWorkflow(
  steps: CaptureStep[],
  cookies: CaptureCookie[] | undefined
): Promise<WorkflowPayload> {
  const code = `export default async ({ page, context }) => {
  const steps = context.steps || [];
  const cookies = context.cookies || [];
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  if (cookies.length) {
    await page.setCookie(...cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
    })));
  }

  async function snap() {
    try { return await page.screenshot({ type: 'png', encoding: 'base64' }); }
    catch (e) { return null; }
  }
  async function meta() {
    let bodyStart = '';
    try { bodyStart = await page.evaluate(() => (document.body && document.body.innerText || '').slice(0, 900)); }
    catch (e) { bodyStart = ''; }
    let hints = { buttons: [], inputs: [] };
    try {
      hints = await page.evaluate(() => {
        const btnSel = 'button, [role="button"], input[type="submit"], a.btn, a.cta, a.oauth';
        const buttons = Array.from(document.querySelectorAll(btnSel)).slice(0, 24).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          text: ((el.innerText || el.getAttribute('value') || '') + '').trim().slice(0, 80),
          name: el.getAttribute('name'),
          id: el.id || null,
          className: (el.getAttribute('class') || '').slice(0, 80)
        }));
        const inputs = Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 16).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          name: el.getAttribute('name'),
          placeholder: el.getAttribute('placeholder'),
          id: el.id || null
        }));
        return { buttons, inputs };
      });
    } catch (e) { /* leave empty */ }
    return {
      url: page.url(),
      title: await page.title().catch((error) => { swallow('page.title failed', error); return ''; }),
      bodyStart: bodyStart,
      hints: hints
    };
  }
  async function fail(i, step, err) {
    const shot = await snap();
    const m = await meta();
    const msg = err && err.message ? err.message : String(err || 'step_failed');
    return {
      ok: false,
      screenshot: shot,
      error: msg.slice(0, 400),
      failedStep: {
        index: i,
        action: step && step.action,
        selector: step && step.selector,
        text: step && step.text
      },
      url: m.url,
      title: m.title,
      bodyStart: m.bodyStart,
      hints: m.hints
    };
  }

  let lastShot = null;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      if (step.action === 'goto') {
        try {
          await page.goto(step.url, { waitUntil: step.waitUntil || 'load', timeout: 45000 });
        } catch (e) {
          const href = page.url();
          if (!href || href === 'about:blank') throw e;
        }
      } else if (step.action === 'wait') {
        if (step.selector) {
          await page.waitForSelector(step.selector, {
            visible: step.visible !== false,
            timeout: Math.min(step.ms || 20000, 30000)
          });
        } else if (step.ms) {
          await new Promise((r) => setTimeout(r, Math.min(step.ms, 15000)));
        }
      } else if (step.action === 'click') {
        const parts = String(step.selector || '').split(',').map((s) => s.trim()).filter(Boolean);
        let clicked = false;
        let lastErr = null;
        for (const sel of parts) {
          try {
            await page.waitForSelector(sel, { visible: true, timeout: parts.length > 1 ? 5000 : 15000 });
            const handle = await page.$(sel);
            if (!handle) continue;
            await handle.click();
            clicked = true;
            break;
          } catch (e) { lastErr = e; }
        }
        if (!clicked) throw lastErr || new Error('click selector not found: ' + step.selector);
      } else if (step.action === 'click_text') {
        const needle = String(step.text || '').trim().toLowerCase();
        if (needle.length < 2) throw new Error('click_text needs at least 2 characters');
        const handles = await page.$$('button, a, [role="button"], input[type="submit"]');
        let clicked = false;
        for (const h of handles) {
          const t = await h.evaluate((el) => ((el.innerText || el.value || '') + '').trim().toLowerCase());
          if (t.indexOf(needle) !== -1) {
            await h.click();
            clicked = true;
            break;
          }
        }
        if (!clicked) throw new Error('click_text not found: ' + step.text);
      } else if (step.action === 'type') {
        await page.waitForSelector(step.selector, { visible: true, timeout: 15000 });
        const text = String(step.text || '');
        // A framework that hydrates mid-typing resets the input and eats the characters
        // entered so far — the field ends up holding a truncated value that then fails
        // native validation. Read the value back and retype until it sticks.
        let seen = '';
        let typed = false;
        for (let attempt = 0; attempt < 3 && !typed; attempt++) {
          if (step.clear) {
            await page.click(step.selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
          }
          await page.type(step.selector, text, { delay: 20 });
          seen = await page.$eval(step.selector, (el) => el.value || '').catch((error) => { swallow('page.$eval failed', error); return ''; });
          typed = step.clear ? seen === text : seen.indexOf(text) !== -1;
          if (!typed) await new Promise((r) => setTimeout(r, 400));
        }
        if (!typed) {
          throw new Error(
            step.secret
              ? 'field did not accept the full value: ' + step.selector +
                ' (expected ' + text.length + ' characters, field holds ' + seen.length + ')'
              : 'field did not accept the full value: ' + step.selector +
                ' (expected "' + text + '", field holds "' + seen + '")'
          );
        }
      } else if (step.action === 'press') {
        await page.keyboard.press(step.key || 'Enter');
      } else if (step.action === 'screenshot') {
        if (step.selector) {
          const el = await page.$(step.selector);
          if (!el) throw new Error('screenshot selector not found: ' + step.selector);
          lastShot = await el.screenshot({ type: 'png', encoding: 'base64' });
        } else {
          lastShot = await page.screenshot({ type: 'png', fullPage: !!step.fullPage, encoding: 'base64' });
        }
      }
    } catch (err) {
      return await fail(i, step, err);
    }
  }
  if (!lastShot) lastShot = await snap();
  const m = await meta();
  return {
    ok: true,
    screenshot: lastShot,
    url: m.url,
    title: m.title,
    bodyStart: m.bodyStart,
    hints: m.hints
  };
}`;

  const out = await browserlessFunction(
    code,
    { steps, cookies: cookies ?? [] },
    { timeoutMs: 60_000 }
  );
  return parseWorkflowResponse(out);
}

async function persistPng(
  opts: CaptureWebsiteOpts,
  png: Buffer,
  title: string,
  sourceUrl: string | null,
  catalog: boolean
): Promise<
  | { media_id?: string; image_url: string; width: number; height: number; bytes: number; saved_to_library: boolean }
  | { error: string }
> {
  if (!png?.byteLength) return { error: 'Screenshot was empty' };
  if (png.byteLength > 12_000_000) return { error: 'Screenshot too large (>12MB)' };

  const meta = await sharp(png).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const save = opts.saveToLibrary !== false;

  if (!save) {
    const { uploadPostImage } = await import('$lib/server/content-preview');
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const imageUrl = await uploadPostImage(opts.supabase, opts.userId, dataUrl);
    if (!imageUrl) return { error: 'Could not store screenshot' };
    return { image_url: imageUrl, width, height, bytes: png.byteLength, saved_to_library: false };
  }

  const stamp = Date.now();
  const storagePath = `${opts.userId}/${opts.brandId}/media/capture-${stamp}.png`;
  const { error: upErr } = await opts.supabase.storage.from(BUCKET).upload(storagePath, png, {
    contentType: 'image/png',
    upsert: false
  });
  if (upErr) return { error: upErr.message };

  const host = (() => {
    try {
      return sourceUrl ? new URL(sourceUrl).hostname : 'website';
    } catch {
      return 'website';
    }
  })();

  const { row, error: insErr } = await insertBrandMedia(opts.supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    storagePath,
    mime: 'image/png',
    bytes: png.byteLength,
    width,
    height,
    fileName: `screenshot-${host}-${stamp}.png`,
    title,
    source: 'website_capture'
  });
  if (insErr || !row) return { error: insErr ?? 'insert failed' };

  if (catalog) {
    void catalogBrandMedia(opts.supabase, row.id, opts.brandId).catch(swallow('catalog brand media'));
  }

  const signed = await signKnowledgePaths(opts.supabase, [storagePath]).catch((error) => { swallow('sign media urls', error); return new Map(); });
  let imageUrl = signed.get(storagePath);
  if (!imageUrl) {
    const { uploadPostImage } = await import('$lib/server/content-preview');
    imageUrl =
      (await uploadPostImage(opts.supabase, opts.userId, `data:image/png;base64,${png.toString('base64')}`)) ??
      undefined;
  }
  if (!imageUrl) return { error: 'Screenshot saved but could not sign URL' };
  return {
    media_id: row.id,
    image_url: imageUrl,
    width,
    height,
    bytes: png.byteLength,
    saved_to_library: true
  };
}

export async function captureWebsite(
  opts: CaptureWebsiteOpts
): Promise<CaptureWebsiteResult | CaptureWebsiteFailure> {
  if (!isBrowserlessConfigured()) {
    return {
      ok: false,
      error:
        'Website capture is not configured (BROWSERLESS_API_KEY missing). Ask the user for a screenshot upload, or use Media library assets instead.',
      retry_hint: CAPTURE_RETRY_HINT
    };
  }

  const { applyDemoLogin, tryLoadDemoSecret, redactSecret, isStillOnLoginPage, stripUrlNoise } = await import(
    '$lib/server/demo-account'
  );
  const demoSecret =
    opts.useDemoAccount === false ? null : (opts.demoSecret ?? (await tryLoadDemoSecret(opts.brandId)));
  // Login was explicitly requested. Capturing the public page anyway would hand back a
  // marketing screenshot dressed as product UI — fail loudly instead.
  if (opts.useDemoAccount === true && !demoSecret) {
    return {
      ok: false,
      error:
        'no_demo_account: capture was asked to log in but no Product demo account is saved for this brand. Point the user to Settings → Product demo (login URL + email + password). Do not ask them to paste the password in chat.',
      retry_hint: CAPTURE_RETRY_HINT
    };
  }
  // A login saved before the platform rule existed is no longer injected. Forcing it must fail
  // loudly rather than quietly hand back the public page dressed as a logged-in capture.
  const blockedPlatform = demoSecret ? blockedPlatformForUrl(demoSecret.loginUrl) : null;
  if (opts.useDemoAccount === true && blockedPlatform) {
    return {
      ok: false,
      error: `platform_login_not_allowed: the saved login is for ${blockedPlatform.label}, and signing into it with stored credentials breaches that platform's terms and risks the user's account. Capture the public page instead (use_demo_account: false), or publish through the connected account.`,
      retry_hint: CAPTURE_RETRY_HINT
    };
  }
  const prepared = applyDemoLogin(opts, demoSecret);
  const redact = (s: string) => redactSecret(s, demoSecret?.password);

  const fail = async (
    wf: WorkflowPayload,
    sourceUrl: string | null
  ): Promise<CaptureWebsiteFailure> => {
    const png = pngFromBase64(wf.screenshot ?? null);
    const pageUrl = wf.url ?? sourceUrl;
    const host = (() => {
      try {
        return pageUrl ? new URL(pageUrl).hostname : 'website';
      } catch {
        return 'website';
      }
    })();
    let diagnostic_image_url: string | undefined;
    let diagnostic_media_id: string | undefined;
    if (png) {
      const saved = await persistPng(
        opts,
        png,
        `Capture debug · ${host}`,
        pageUrl,
        false
      );
      if (!('error' in saved)) {
        diagnostic_image_url = saved.image_url;
        diagnostic_media_id = saved.media_id;
      }
    }
    return {
      ok: false,
      error: redact(wf.error || 'capture_failed'),
      page_url: wf.url ?? sourceUrl,
      page_title: wf.title ?? null,
      body_preview: wf.bodyStart ? redact(wf.bodyStart) : null,
      failed_step: wf.failedStep ?? null,
      hints: wf.hints ?? null,
      diagnostic_image_url,
      diagnostic_media_id,
      retry_hint: CAPTURE_RETRY_HINT
    };
  };

  try {
    const steps = normalizeSteps(prepared);
    const wf = await runWorkflow(steps, opts.cookies);
    const sourceUrl =
      prepared.steps?.find(
        (s): s is Extract<CaptureStep, { action: 'goto' }> => s.action === 'goto' && s.url !== demoSecret?.loginUrl
      )?.url ??
      prepared.steps?.find((s): s is Extract<CaptureStep, { action: 'goto' }> => s.action === 'goto')?.url ??
      prepared.url ??
      opts.url ??
      wf.url ??
      null;

    if (!wf.ok) return await fail(wf, sourceUrl);

    // The workflow "succeeded" but we never left the sign-in page: the credentials, the submit
    // selector or a captcha stopped us. Downgrade to an agentic failure so the model sees the
    // diagnostics and retries, instead of filing a login screenshot as product UI.
    if (
      demoSecret &&
      sourceUrl &&
      stripUrlNoise(sourceUrl) !== stripUrlNoise(demoSecret.loginUrl) &&
      isStillOnLoginPage(wf.url ?? sourceUrl, demoSecret.loginUrl)
    ) {
      return await fail(
        {
          ...wf,
          ok: false,
          error:
            'Login did not reach the app — still on the sign-in page. Check diagnostic_image_url and hints, then retry with a scoped submit_selector or click_text (or persist the fix via update_demo_account).'
        },
        sourceUrl
      );
    }

    const png = pngFromBase64(wf.screenshot ?? null);
    if (!png) {
      return {
        ok: false,
        error: 'Screenshot was empty',
        page_url: wf.url ?? sourceUrl,
        page_title: wf.title ?? null,
        body_preview: wf.bodyStart ? redact(wf.bodyStart) : null,
        hints: wf.hints ?? null,
        retry_hint: CAPTURE_RETRY_HINT
      };
    }

    const host = (() => {
      try {
        return sourceUrl ? new URL(sourceUrl).hostname : 'website';
      } catch {
        return 'website';
      }
    })();
    const saved = await persistPng(
      opts,
      png,
      opts.title?.trim() || `Screenshot · ${host}`,
      sourceUrl,
      opts.catalog !== false
    );
    if ('error' in saved) {
      return {
        ok: false,
        error: redact(saved.error),
        page_url: wf.url ?? sourceUrl,
        page_title: wf.title ?? null,
        retry_hint: CAPTURE_RETRY_HINT
      };
    }
    return {
      ok: true,
      media_id: saved.media_id,
      image_url: saved.image_url,
      width: saved.width,
      height: saved.height,
      bytes: saved.bytes,
      source_url: sourceUrl,
      saved_to_library: saved.saved_to_library,
      page_url: wf.url ?? sourceUrl,
      page_title: wf.title ?? null
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'capture_failed';
    return { ok: false, error: redact(raw), retry_hint: CAPTURE_RETRY_HINT };
  }
}
