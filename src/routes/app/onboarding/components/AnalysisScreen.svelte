<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { _ } from 'svelte-i18n';

  let { progress = '' }: { progress?: string } = $props();

  const ANALYSIS_STEPS = [
    { titleKey: 'onboarding.analyzing.site', svg: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="16" y="16" width="88" height="72" rx="8" stroke="var(--accent, #7c5cff)" stroke-width="2.5"/><line x1="16" y1="34" x2="104" y2="34" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".4"/><circle cx="28" cy="25" r="3" fill="#ff5f57"/><circle cx="38" cy="25" r="3" fill="#febc2e"/><circle cx="48" cy="25" r="3" fill="#28c840"/><line x1="28" y1="46" x2="72" y2="46" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".3"/><line x1="28" y1="54" x2="60" y2="54" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".3"/><line x1="28" y1="62" x2="80" y2="62" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".3"/><circle cx="82" cy="74" r="16" stroke="var(--accent, #7c5cff)" stroke-width="2.5" opacity=".8"/><line x1="93" y1="85" x2="104" y2="96" stroke="var(--accent, #7c5cff)" stroke-width="3" stroke-linecap="round" opacity=".8"/></svg>` },
    { titleKey: 'onboarding.analyzing.socials', svg: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="10" fill="var(--accent, #7c5cff)" opacity=".9"/><circle cx="60" cy="60" r="24" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".6"/><circle cx="60" cy="60" r="38" stroke="var(--accent, #7c5cff)" stroke-width="1.5" opacity=".35"/><circle cx="60" cy="60" r="50" stroke="var(--accent, #7c5cff)" stroke-width="1" opacity=".2"/><circle cx="60" cy="14" r="6" fill="#ff5f57"/><circle cx="98" cy="42" r="6" fill="#1877f2"/><circle cx="98" cy="78" r="6" fill="#111"/><circle cx="60" cy="106" r="6" fill="#0285ff"/><circle cx="22" cy="78" r="6" fill="#ff4500"/><circle cx="22" cy="42" r="6" fill="#dd2a7b"/></svg>` },
    { titleKey: 'onboarding.analyzing.studio', svg: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="20" width="40" height="36" rx="6" stroke="var(--accent, #7c5cff)" stroke-width="2.5"/><rect x="66" y="20" width="40" height="36" rx="6" stroke="var(--accent, #7c5cff)" stroke-width="2.5"/><rect x="14" y="68" width="40" height="36" rx="6" stroke="var(--accent, #7c5cff)" stroke-width="2.5"/><rect x="66" y="68" width="40" height="36" rx="6" fill="var(--accent, #7c5cff)" opacity=".15" stroke="var(--accent, #7c5cff)" stroke-width="2.5"/><circle cx="34" cy="38" r="8" fill="var(--accent, #7c5cff)" opacity=".3"/><line x1="26" y1="50" x2="42" y2="50" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".4"/><line x1="78" y1="34" x2="94" y2="34" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".4"/><line x1="78" y1="42" x2="86" y2="42" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".4"/><rect x="26" y="80" width="16" height="12" rx="3" fill="var(--accent, #7c5cff)" opacity=".3"/><line x1="78" y1="82" x2="94" y2="82" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".4"/><line x1="78" y1="90" x2="86" y2="90" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".4"/></svg>` },
    { titleKey: 'onboarding.analyzing.products', svg: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 42 60 24l38 18-38 18-38-18Z" stroke="var(--accent, #7c5cff)" stroke-width="2.5" stroke-linejoin="round"/><path d="M22 42v34l38 18 38-18V42" stroke="var(--accent, #7c5cff)" stroke-width="2.5" stroke-linejoin="round"/><line x1="60" y1="60" x2="60" y2="94" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".4"/><path d="M22 60l38 18 38-18" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".25"/><circle cx="60" cy="42" r="5" fill="var(--accent, #7c5cff)" opacity=".35"/></svg>` },
    { titleKey: 'onboarding.analyzing.voice', svg: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="18" y1="60" x2="102" y2="60" stroke="var(--accent, #7c5cff)" stroke-width="1.5" opacity=".2"/><g stroke="var(--accent, #7c5cff)" stroke-width="5" stroke-linecap="round"><line x1="24" y1="50" x2="24" y2="70" opacity=".35"/><line x1="38" y1="40" x2="38" y2="80" opacity=".55"/><line x1="52" y1="28" x2="52" y2="92" opacity=".8"/><line x1="66" y1="44" x2="66" y2="76" opacity=".6"/><line x1="80" y1="34" x2="80" y2="86" opacity=".45"/><line x1="94" y1="52" x2="94" y2="68" opacity=".3"/></g></svg>` },
    { titleKey: 'onboarding.analyzing.colours', svg: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="42" stroke="var(--accent, #7c5cff)" stroke-width="2.5" opacity=".7"/><circle cx="44" cy="42" r="9" fill="var(--accent, #7c5cff)" opacity=".85"/><circle cx="76" cy="42" r="9" fill="var(--accent-2, #ff8a5c)" opacity=".75"/><circle cx="86" cy="66" r="9" fill="var(--accent, #7c5cff)" opacity=".45"/><circle cx="60" cy="84" r="9" fill="var(--accent-2, #ff8a5c)" opacity=".4"/><circle cx="34" cy="66" r="9" fill="var(--accent, #7c5cff)" opacity=".25"/><circle cx="60" cy="60" r="7" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".5"/></svg>` },
    { titleKey: 'onboarding.analyzing.audience', svg: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="44" r="15" stroke="var(--accent, #7c5cff)" stroke-width="2.5"/><path d="M34 92c0-14 12-23 26-23s26 9 26 23" stroke="var(--accent, #7c5cff)" stroke-width="2.5" stroke-linecap="round"/><circle cx="26" cy="52" r="10" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".45"/><path d="M10 88c0-11 7-18 16-18" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".45" stroke-linecap="round"/><circle cx="94" cy="52" r="10" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".45"/><path d="M110 88c0-11-7-18-16-18" stroke="var(--accent, #7c5cff)" stroke-width="2" opacity=".45" stroke-linecap="round"/><circle cx="60" cy="44" r="6" fill="var(--accent, #7c5cff)" opacity=".2"/></svg>` }
  ];
  let step = $state(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    timer = setInterval(() => {
      step = (step + 1) % ANALYSIS_STEPS.length;
    }, 4500);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="analysis-stage">
  {@html ANALYSIS_STEPS[step].svg}
  <h2>{$_(ANALYSIS_STEPS[step].titleKey)}</h2>
  <p class="prog">{progress}</p>
</div>

<style>
  .analysis-stage { text-align: center; max-width: 340px; margin: 40px auto 0; }
  .analysis-stage :global(svg) { width: 140px; height: 140px; margin: 0 auto; }
  .analysis-stage h2 { font-size: 1.3rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 24px 0 0; }
  .prog { color: var(--ink-soft, #6e6e73); margin-top: 12px; font-size: 14px; }
</style>
