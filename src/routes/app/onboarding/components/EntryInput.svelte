<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { track } from '$lib/analytics';
  import HeroUrlCta from '$lib/components/HeroUrlCta.svelte';
  import { matchLanguage } from './languages';
  import { pmeta } from './platform-utils';
  import type { Phase } from './phase';

  let {
    phase = $bindable('input' as Phase),
    url = $bindable(''),
    noWebsite = $bindable(false),
    brandName = $bindable(''),
    creatorNiche = $bindable(''),
    error = $bindable(''),
    progress = $bindable(''),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile = $bindable<any>(null),
    language = $bindable(''),
    handles = $bindable<Record<string, string>>({}),
    selectedPlatforms = $bindable<string[]>([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formError = '' as any,
    onfinishearly,
    onanalyzed,
    onerror
  }: {
    phase?: Phase;
    url?: string;
    noWebsite?: boolean;
    brandName?: string;
    creatorNiche?: string;
    error?: string;
    progress?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: any;
    language?: string;
    handles?: Record<string, string>;
    selectedPlatforms?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formError?: any;
    onfinishearly: () => void;
    onanalyzed: () => void;
    onerror?: (step: string, message: unknown, context?: Record<string, unknown>) => void;
  } = $props();

  function useNoWebsite() {
    noWebsite = true;
    url = '';
  }

  /** Stesse regole di hostname di /app/onboarding/analyze. */
  function normalizeWebsiteUrl(raw: string): string | null {
    let u = raw.trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      return null;
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
    return u;
  }

  function continueFromInput() {
    if (noWebsite) {
      if (!brandName.trim()) return;
      error = '';
      onfinishearly();
      return;
    }
    const normalized = normalizeWebsiteUrl(url);
    if (!normalized) {
      error = $_('onboarding.status.invalidUrl');
      return;
    }
    url = normalized;
    error = '';
    void analyze();
  }

  async function readStream(res: Response, onMsg: (m: { type: string; [k: string]: unknown }) => void) {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += dec.decode(value, { stream: !done });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) onMsg(JSON.parse(line));
      }
      if (done) {
        const tail = buf.trim();
        if (tail) onMsg(JSON.parse(tail));
        break;
      }
    }
  }

  // L'analisi riempie nome, profilo, lingua e team, e RABBOCCA gli handle senza mai sovrascriverli.
  export async function analyze() {
    phase = 'analyzing';
    error = '';
    progress = $_('onboarding.status.starting');
    try {
      const normalized = normalizeWebsiteUrl(url);
      if (!normalized) {
        onerror?.('analyze', 'Invalid URL');
        error = $_('onboarding.status.invalidUrl');
        phase = 'input';
        return;
      }
      url = normalized;
      const res = await fetch('/app/onboarding/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok || !res.body) {
        onerror?.('analyze', `HTTP ${res.status}`);
        if (res.status === 400) {
          error = $_('onboarding.status.invalidUrl');
          phase = 'input';
          return;
        }
        error = $_('onboarding.status.analysisFailed');
        if (brandName.trim()) {
          onfinishearly();
          return;
        }
        phase = 'input';
        return;
      }
      await readStream(res, (msg) => {
        if (msg.type === 'progress') progress = msg.message as string;
        else if (msg.type === 'result') {
          profile = msg.data;
          if (!brandName.trim()) brandName = (msg.data as { name?: string })?.name ?? '';
          language = language || matchLanguage((msg.data as { language?: string })?.language);
          // I profili linkati sul sito rabboccano gli handle: quelli scritti dall'utente vincono.
          const socials = ((msg.data as { social_handles?: { platform: string; handle: string }[] })?.social_handles ?? [])
            .filter((s) => s?.platform && s?.handle && pmeta(s.platform));
          if (socials.length) {
            const h = { ...handles };
            for (const s of socials) if (!h[s.platform]?.trim()) h[s.platform] = s.handle;
            handles = h;
            if (!selectedPlatforms.length) selectedPlatforms = [...new Set(socials.map((s) => s.platform))];
          }
          track('onboarding_brand_analyzed', { detected_socials: socials.length });
          onanalyzed();
        } else if (msg.type === 'error') {
          onerror?.('analyze', msg.message);
          error = msg.message as string;
        }
      });
    } catch (e) {
      onerror?.('analyze', e instanceof Error ? e.message : 'stream failed');
      error = e instanceof Error ? e.message : $_('onboarding.status.analysisFailedShort');
    }
    // Un'analisi fallita non è un vicolo cieco: si continua con quello che l'utente ha scritto.
    if (!profile && !brandName.trim()) {
      phase = 'input';
      return;
    }
    onfinishearly();
  }
</script>

<h1 class="ch-title">{$_('onboarding.input.title')}</h1>
<p class="ch-lead">{$_('onboarding.input.sub')}</p>
{#if error || formError}
  <p class="err">{formError === 'slotLimit' ? $_('onboarding.slotLimit') : (formError || error)}</p>
{/if}
{#if noWebsite}
  <div class="entry-manual">
    <div class="block">
      <div class="lbl">{$_('onboarding.brand.nameLabel')}</div>
      <input bind:value={brandName} placeholder="Latina Coffee Co." />
    </div>
    <div class="block">
      <div class="lbl">{$_('onboarding.brand.nicheLabel')}</div>
      <textarea
        class="ctx-area"
        rows="3"
        bind:value={creatorNiche}
        placeholder={$_('onboarding.brand.nichePlaceholder')}
      ></textarea>
      <p class="hint">{$_('onboarding.brand.nicheHint')}</p>
    </div>
    <div class="cta-row">
      <button type="button" class="ghost" onclick={() => (noWebsite = false)}>{$_('onboarding.brand.haveWebsiteHint')}</button>
      <button class="primary cta-press" onclick={continueFromInput} disabled={!brandName.trim()}>{$_('onboarding.continue')}</button>
    </div>
  </div>
{:else}
  <div class="entry-cta">
    <HeroUrlCta bind:value={url} onsubmiturl={continueFromInput} />
  </div>
  <div class="entry-nosite">
    <button type="button" class="nosite-btn" onclick={useNoWebsite}>{$_('onboarding.input.manual')}</button>
    <p class="nosite-hint">{$_('onboarding.input.manualHint')}</p>
  </div>
{/if}

<style>
  .ch-title { font-size: clamp(1.9rem, 4.5vw, 2.5rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.1; margin: 10px 0 0; overflow-wrap: break-word; word-break: break-word; }
  .ch-lead { color: var(--ink-soft, #6e6e73); font-size: 1.02rem; line-height: 1.5; margin: 12px 0 0; max-width: 52ch; }
  @media (max-width: 860px) {
    .ch-title { font-size: clamp(1.45rem, 5.5vw, 1.8rem); }
  }

  input { flex: 1; font-size: 16px; padding: 13px 16px; border-radius: 12px; border: 1px solid var(--line-2, #d2d2d7); outline: none; width: 100%; height: 44px; }
  input:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.12); }
  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  button:disabled { opacity: 0.4; cursor: default; }
  .primary { border-radius: 980px; padding: 13px 22px; margin-top: 24px; background: var(--accent, #7c5cff); color: #fff; }
  .primary:hover { background: #6b4dff; }
  .ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border-radius: 980px; padding: 13px 22px; }
  .cta-press { transition: transform 0.12s var(--ease, ease); }
  .cta-press:active:not(:disabled) { transform: scale(0.97); }
  .err { color: #c0392b; font-size: 14px; margin-top: 14px; }

  .block { margin-top: 18px; }
  .block .lbl { font-size: 16px; font-weight: 650; margin-bottom: 10px; letter-spacing: -0.01em; }
  .hint { font-size: 13px; color: var(--ink-soft, #6e6e73); margin: 2px 0 8px; line-height: 1.4; }
  .ctx-area { width: 100%; font-size: 15px; padding: 12px 14px; border-radius: 12px;
    border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff); outline: none; font-family: inherit;
    color: var(--ink, #1d1d1f); line-height: 1.5; resize: vertical; box-sizing: border-box; }
  .ctx-area:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .cta-row .primary, .cta-row .ghost { margin-top: 0; }

  .entry-cta { width: 100%; margin-top: 32px; }
  .entry-nosite { margin-top: 40px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .entry-manual { width: 100%; max-width: 520px; text-align: left; margin-top: 24px; }
  /* Allineata alle metriche dell'input del nome sopra: stesso corpo, stessa imbottitura. */
  .entry-manual .ctx-area { font-size: 16px; padding: 13px 16px; min-height: 96px; }
  .nosite-btn { align-self: center; background: none; border: none; color: var(--accent, #7c5cff); font-weight: 600; font-size: 14.5px; cursor: pointer; padding: 0; }
  .nosite-btn:hover { text-decoration: underline; }
  .nosite-hint { margin: 0; font-size: 13px; color: var(--ink-faint, #86868b); }
</style>
