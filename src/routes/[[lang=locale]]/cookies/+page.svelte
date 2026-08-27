<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { _ } from 'svelte-i18n';
  import { legal } from '$lib/legal';
  import LegalLayout from '$lib/components/LegalLayout.svelte';
</script>

<svelte:head>
  <title>{$_('meta.cookies.title')}</title>
  <meta name="description" content={$_('meta.cookies.description')} />
  <meta property="og:title" content={$_('meta.cookies.title')} />
  <meta property="og:description" content={$_('meta.cookies.description')} />
</svelte:head>

<LegalLayout activePage="cookies">
  <div class="text-[13px] font-semibold tracking-wide text-primary uppercase">{$_('legal.cookies.eyebrow')}</div>
  <h1 class="font-[family-name:var(--serif)] text-[clamp(30px,6vw,44px)] mt-2.5 mb-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.cookies.title')}</h1>
  <p class="text-sm text-muted-foreground mb-2">{$_('legal.cookies.updated', { values: { date: legal.lastUpdated } })}</p>
  <p class="text-[17px] text-muted-foreground mb-2">
    {$_('legal.cookies.intro', { values: { service: legal.service } })}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.cookies.s1.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s1.body')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.cookies.s2.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s2.intro')}</p>
  <h3 class="text-base font-semibold mt-6 mb-2">{$_('legal.cookies.s2.strictly.label')}</h3>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s2.strictly.text')}</p>
  <h3 class="text-base font-semibold mt-6 mb-2">{$_('legal.cookies.s2.analytics.label')}</h3>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s2.analytics.text')}</p>
  <h3 class="text-base font-semibold mt-6 mb-2">{$_('legal.cookies.s2.sessionReplay.label')}</h3>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s2.sessionReplay.text')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.cookies.s3.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s3.body')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.cookies.s4.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s4.body')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.cookies.s5.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s5.intro')}</p>
  <table class="w-full border-collapse my-1 mb-5 text-[15px]">
    <thead><tr><th class="text-left align-top py-2.5 px-3 border-b border-border font-semibold text-muted-foreground text-[13px] uppercase tracking-wide">Provider</th><th class="text-left align-top py-2.5 px-3 border-b border-border font-semibold text-muted-foreground text-[13px] uppercase tracking-wide">Purpose</th></tr></thead>
    <tbody>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">PostHog</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.posthog')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Microsoft Clarity</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.clarity')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Stripe</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.stripe')}</td></tr>
    </tbody>
  </table>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.cookies.s6.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.cookies.s6.body')}</p>

  <hr class="border-0 border-t border-border my-10" />
  <p class="bg-muted border border-border rounded-xl px-[18px] py-4 text-[15px] text-muted-foreground">
    {$_('legal.cookies.note.pre')}
    <a class="text-primary no-underline hover:underline" href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>.
  </p>
</LegalLayout>
