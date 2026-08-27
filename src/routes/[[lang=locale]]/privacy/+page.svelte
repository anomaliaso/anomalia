<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { _ } from 'svelte-i18n';
  import { legal } from '$lib/legal';
  import LegalLayout from '$lib/components/LegalLayout.svelte';
</script>

<svelte:head>
  <title>{$_('meta.privacy.title')}</title>
  <meta name="description" content={$_('meta.privacy.description')} />
  <meta property="og:title" content={$_('meta.privacy.title')} />
  <meta property="og:description" content={$_('meta.privacy.description')} />
</svelte:head>

<LegalLayout activePage="privacy">
  <div class="text-[13px] font-semibold tracking-wide text-primary uppercase">{$_('legal.privacy.eyebrow')}</div>
  <h1 class="font-[family-name:var(--serif)] text-[clamp(30px,6vw,44px)] mt-2.5 mb-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.title')}</h1>
  <p class="text-sm text-muted-foreground mb-2">{$_('legal.privacy.updated', { values: { date: legal.lastUpdated } })}</p>
  <p class="text-[17px] text-muted-foreground mb-2">
    {$_('legal.privacy.intro', { values: { service: legal.service } })}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s1.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s1.controllerPre')} <strong class="font-semibold">{legal.owner}</strong>{$_('legal.privacy.s1.controllerMid')} (<em>{$_('legal.privacy.s1.dittaIndividuale')}</em>){$_('legal.privacy.s1.controllerVat')} <strong class="font-semibold">{legal.vat}</strong>.
  </p>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s1.contact')}
    <a class="text-primary no-underline hover:underline" href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>.
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s2.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.privacy.s2.intro')}</p>
  <h3 class="text-base font-semibold mt-6 mb-2">{$_('legal.privacy.s2.youGive.heading')}</h3>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.youGive.account.label')}</strong> — {$_('legal.privacy.s2.youGive.account.text')}</li>
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.youGive.brand.label')}</strong> — {$_('legal.privacy.s2.youGive.brand.text', { values: { service: legal.service } })}</li>
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.youGive.billing.label')}</strong> — {$_('legal.privacy.s2.youGive.billing.textPre')} <strong class="font-semibold">{$_('legal.privacy.s2.youGive.billing.textStrong')}</strong>.</li>
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.youGive.comms.label')}</strong> — {$_('legal.privacy.s2.youGive.comms.text')}</li>
  </ul>
  <h3 class="text-base font-semibold mt-6 mb-2">{$_('legal.privacy.s2.connected.heading')}</h3>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.connected.access.label')}</strong> — {$_('legal.privacy.s2.connected.access.text')}</li>
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.connected.history.label')}</strong> — {$_('legal.privacy.s2.connected.history.text')}</li>
  </ul>
  <h3 class="text-base font-semibold mt-6 mb-2">{$_('legal.privacy.s2.automatic.heading')}</h3>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.automatic.usage.label')}</strong> — {$_('legal.privacy.s2.automatic.usage.text')}</li>
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.privacy.s2.automatic.cookies.label')}</strong> — {$_('legal.privacy.s2.automatic.cookies.text')}</li>
  </ul>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s3.heading')}</h2>
  <table class="w-full border-collapse my-1 mb-5 text-[15px]">
    <thead><tr><th class="text-left align-top py-2.5 px-3 border-b border-border font-semibold text-muted-foreground text-[13px] uppercase tracking-wide">{$_('legal.privacy.s3.colPurpose')}</th><th class="text-left align-top py-2.5 px-3 border-b border-border font-semibold text-muted-foreground text-[13px] uppercase tracking-wide">{$_('legal.privacy.s3.colBasis')}</th></tr></thead>
    <tbody>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">{$_('legal.privacy.s3.row1.purpose')}</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s3.row1.basis')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">{$_('legal.privacy.s3.row2.purpose')}</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s3.row2.basis')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">{$_('legal.privacy.s3.row3.purpose')}</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s3.row3.basis')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">{$_('legal.privacy.s3.row4.purpose')}</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s3.row4.basis')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">{$_('legal.privacy.s3.row5.purpose')}</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s3.row5.basis')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">{$_('legal.privacy.s3.row6.purpose')}</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s3.row6.basis')}</td></tr>
    </tbody>
  </table>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s3.notePre')}
    <strong class="font-semibold">{$_('legal.privacy.s3.noteStrong')}</strong> {$_('legal.privacy.s3.notePost')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s4.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s4.body', { values: { service: legal.service } })}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s5.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.privacy.s5.p1')}</p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.privacy.s5.p2')}</p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.privacy.s5.p3')}</p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.privacy.s5.p4')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s6.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s6.introPre')} <strong class="font-semibold">{$_('legal.privacy.s6.introStrong')}</strong> {$_('legal.privacy.s6.introPost')}
  </p>
  <table class="w-full border-collapse my-1 mb-5 text-[15px]">
    <thead><tr><th class="text-left align-top py-2.5 px-3 border-b border-border font-semibold text-muted-foreground text-[13px] uppercase tracking-wide">{$_('legal.privacy.s6.colProvider')}</th><th class="text-left align-top py-2.5 px-3 border-b border-border font-semibold text-muted-foreground text-[13px] uppercase tracking-wide">{$_('legal.privacy.s6.colPurpose')}</th></tr></thead>
    <tbody>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Supabase</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.supabase')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Vercel</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.vercel')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Stripe</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.stripe')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Google (Gemini API)</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.google')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">kie.ai</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.kie')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">ScrapeCreators</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.scrapecreators')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Resend</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.resend')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">{$_('legal.privacy.s6.metaProvider')}</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.meta')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">PostHog</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.posthog')}</td></tr>
      <tr><td class="text-left align-top py-2.5 px-3 border-b border-border font-semibold whitespace-nowrap">Microsoft Clarity</td><td class="text-left align-top py-2.5 px-3 border-b border-border">{$_('legal.privacy.s6.clarity')}</td></tr>
    </tbody>
  </table>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s6.disclose')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s7.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s7.p1Pre')} <strong class="font-semibold">{$_('legal.privacy.s7.p1Strong')}</strong> {$_('legal.privacy.s7.p1Post')}
  </p>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s7.p2Pre')} <strong class="font-semibold">{$_('legal.privacy.s7.p2Strong')}</strong> {$_('legal.privacy.s7.p2Post')}
  </p>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s7.p3Pre')} <strong class="font-semibold">{$_('legal.privacy.s7.p3Accept')}</strong> {$_('legal.privacy.s7.p3Mid1')}
    <strong class="font-semibold">{$_('legal.privacy.s7.p3FullAnalytics')}</strong>{$_('legal.privacy.s7.p3Mid2')}
    <strong class="font-semibold">Microsoft Clarity</strong>{$_('legal.privacy.s7.p3Mid3')}
    <strong class="font-semibold">{$_('legal.privacy.s7.p3CookiePrefs')}</strong> {$_('legal.privacy.s7.p3Post')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s8.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s8.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s9.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s9.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s10.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.privacy.s10.intro')}</p>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2">{$_('legal.privacy.s10.right1')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.privacy.s10.right2')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.privacy.s10.right3')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.privacy.s10.right4')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.privacy.s10.right5')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.privacy.s10.right6')}</li>
  </ul>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s10.exercisePre')} <a class="text-primary no-underline hover:underline" href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>.
    {$_('legal.privacy.s10.complaintPre')}
    (<a class="text-primary no-underline hover:underline" href="https://www.garanteprivacy.it" target="_blank" rel="noopener">{$_('legal.privacy.s10.garante')}</a>).
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s11.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s11.body', { values: { service: legal.service } })}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s12.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s12.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.privacy.s13.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.privacy.s13.body')}
  </p>

  <hr class="border-0 border-t border-border my-10" />
  <p class="bg-muted border border-border rounded-xl px-[18px] py-4 text-[15px] text-muted-foreground">
    {$_('legal.privacy.note.pre')}
    <a class="text-primary no-underline hover:underline" href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>.
  </p>
</LegalLayout>
