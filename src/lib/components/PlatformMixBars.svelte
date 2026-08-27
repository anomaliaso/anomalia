<script lang="ts">
  import { siInstagram, siTiktok, siFacebook, siX, siThreads, siYoutube, siBluesky, siReddit } from 'simple-icons';

  // Horizontal platform-mix chart: one row per platform — social logo + name on the left, a
  // %-proportional bar in the platform's colour, the percentage on the right. Shared by the
  // onboarding manifesto, the editorial-plan cards and the GTM phase panel so a "mix" always
  // looks the same everywhere (brief §8: consistent per-platform colours).
  type MixItem = { platform: string; percent?: number; share?: string; role?: string };
  let { mix = [] }: { mix: MixItem[] } = $props();

  const META: Record<string, { l: string; c: string; g: string }> = {
    instagram: { l: 'Instagram', c: '#dd2a7b', g: 'IG' },
    tiktok: { l: 'TikTok', c: '#111111', g: 'TT' },
    facebook: { l: 'Facebook', c: '#1877f2', g: 'f' },
    linkedin: { l: 'LinkedIn', c: '#0a66c2', g: 'in' },
    x: { l: 'X', c: '#0a0a0a', g: 'X' },
    threads: { l: 'Threads', c: '#444444', g: '@' },
    youtube: { l: 'YouTube', c: '#ff0000', g: 'YT' },
    bluesky: { l: 'Bluesky', c: '#0285ff', g: 'BS' },
    reddit: { l: 'Reddit', c: '#ff4500', g: 'RD' }
  };
  const ICONS: Record<string, { path: string; hex: string }> = {
    instagram: siInstagram,
    tiktok: siTiktok,
    facebook: siFacebook,
    x: siX,
    threads: siThreads,
    youtube: siYoutube,
    bluesky: siBluesky,
    reddit: siReddit
  };

  // Resolve a percentage per row. Sources, in order: an explicit `percent` (GTM weights), a
  // share string containing '%' ("40%"), else the first number in the share normalised across
  // rows ("2/week" style), else an equal split. Always clamped to 0–100.
  const rows = $derived.by(() => {
    const parsed = mix
      .filter((m) => m?.platform)
      .map((m) => {
        const key = String(m.platform).toLowerCase().trim();
        let p: number | null = typeof m.percent === 'number' && Number.isFinite(m.percent) ? m.percent : null;
        if (p == null && m.share) {
          const pm = String(m.share).match(/(\d+(?:[.,]\d+)?)\s*%/);
          if (pm) p = parseFloat(pm[1].replace(',', '.'));
        }
        return { key, role: m.role ?? '', share: m.share ?? '', p };
      });
    if (parsed.some((r) => r.p == null)) {
      const nums = parsed.map((r) => {
        const nm = String(r.share).match(/(\d+(?:[.,]\d+)?)/);
        return nm ? parseFloat(nm[1].replace(',', '.')) : 1;
      });
      const tot = nums.reduce((a, b) => a + b, 0) || 1;
      parsed.forEach((r, i) => {
        if (r.p == null) r.p = Math.round((nums[i] / tot) * 100);
      });
    }
    return parsed.map((r) => ({ ...r, p: Math.max(0, Math.min(100, Math.round(r.p ?? 0))) }));
  });
</script>

{#if rows.length}
  <div class="pmix">
    {#each rows as r (r.key)}
      {@const ic = ICONS[r.key]}
      <div class="pm-row">
        <span class="pm-icon">
          {#if ic}<svg viewBox="0 0 24 24" fill={`#${ic.hex}`}><path d={ic.path} /></svg>
          {:else}<span class="pm-badge" style={`background:${META[r.key]?.c ?? '#999'}`}>{META[r.key]?.g ?? r.key.slice(0, 2)}</span>{/if}
        </span>
        <span class="pm-name">
          {META[r.key]?.l ?? r.key}
          {#if r.role}<small>{r.role}</small>{/if}
        </span>
        <span class="pm-track"><span class="pm-fill" style={`width:${r.p}%`}></span></span>
        <span class="pm-pct">{r.p}%</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .pmix { display: flex; flex-direction: column; gap: 9px; }
  .pm-row { display: grid; grid-template-columns: 20px minmax(86px, auto) 1fr 42px; align-items: center; gap: 10px; }
  .pm-icon { display: flex; align-items: center; justify-content: center; }
  .pm-icon svg { width: 16px; height: 16px; }
  .pm-badge { width: 16px; height: 16px; border-radius: 5px; display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 8px; font-weight: 700; }
  .pm-name { font-size: 13px; font-weight: 600; color: var(--ink, #1d1d1f); line-height: 1.25; display: flex; flex-direction: column; }
  .pm-name small { font-weight: 400; font-size: 11.5px; color: var(--ink-soft, #6e6e73); }
  .pm-track { height: 9px; border-radius: 999px; background: rgba(0, 0, 0, 0.06); overflow: hidden; }
  .pm-fill { display: block; height: 100%; border-radius: 999px; background: var(--ink-faint, #86868b); transition: width 0.4s var(--ease, ease); }
  .pm-pct { text-align: right; font-size: 12.5px; font-weight: 700; color: var(--ink-soft, #6e6e73); }
</style>
