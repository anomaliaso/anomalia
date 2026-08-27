<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { openCookieSettings } from '$lib/consent';

  let { legal }: { legal: { owner: string; vat: string } } = $props();
</script>

<footer class="bg-black text-white/45 text-[13px] py-8 text-center">
  <div class="max-w-[760px] mx-auto px-6">
    <a href="/start" class="flex items-center justify-center w-full min-h-[110px] box-border mb-7 py-11 px-[30px] bg-[#ff2d8f] text-white font-semibold text-[clamp(1.4rem,3vw,2.1rem)] uppercase tracking-[0.05em] rounded-[980px] text-center no-underline transition-all hover:-translate-y-0.5 hover:bg-[#ff5ca8] hover:text-white dark:bg-white dark:text-black dark:hover:bg-white dark:hover:text-black dark:hover:brightness-90">{$_('landing.cta.getStarted')}</a>
    <a href="/" class="text-white/70 no-underline mx-2 hover:text-white">{$_('legal.privacy.foot.home')}</a> · <a href="/privacy" class="text-white/70 no-underline mx-2 hover:text-white">{$_('legal.privacy.foot.privacy')}</a> · <a href="/terms" class="text-white/70 no-underline mx-2 hover:text-white">{$_('legal.privacy.foot.terms')}</a> · <button type="button" class="bg-transparent border-0 p-0 mx-2 font-inherit text-white/70 cursor-pointer hover:text-white" onclick={() => openCookieSettings()}>{$_('legal.privacy.foot.cookies')}</button>
    <div class="mt-2.5">{$_('legal.privacy.foot.copy', { values: { owner: legal.owner, vat: legal.vat } })}</div>
  </div>
</footer>
