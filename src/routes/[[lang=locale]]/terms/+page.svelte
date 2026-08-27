<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { _ } from 'svelte-i18n';
  import { legal } from '$lib/legal';
  import LegalLayout from '$lib/components/LegalLayout.svelte';
</script>

<svelte:head>
  <title>{$_('meta.terms.title')}</title>
  <meta name="description" content={$_('meta.terms.description')} />
  <meta property="og:title" content={$_('meta.terms.title')} />
  <meta property="og:description" content={$_('meta.terms.description')} />
</svelte:head>

<LegalLayout activePage="terms">
  <div class="text-[13px] font-semibold tracking-wide text-primary uppercase">{$_('legal.terms.eyebrow')}</div>
  <h1 class="font-[family-name:var(--serif)] text-[clamp(30px,6vw,44px)] mt-2.5 mb-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.title')}</h1>
  <p class="text-sm text-muted-foreground mb-2">{$_('legal.terms.updated', { values: { date: legal.lastUpdated } })}</p>
  <p class="text-[17px] text-muted-foreground mb-2">
    {$_('legal.terms.intro', { values: { service: legal.service } })}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s1.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s1.operatedPre')} <strong class="font-semibold">{legal.owner}</strong>{$_('legal.terms.s1.operatedMid')} (<em>{$_('legal.terms.s1.dittaIndividuale')}</em>){$_('legal.terms.s1.operatedVat')} <strong class="font-semibold">{legal.vat}</strong>{$_('legal.terms.s1.operatedPost')}
    <a class="text-primary no-underline hover:underline" href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>.
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s2.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s2.body', { values: { service: legal.service } })}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s3.heading')}</h2>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s3.item1')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s3.item2')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s3.item3')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s3.item4Pre')} <a class="text-primary no-underline hover:underline" href="mailto:{legal.contactEmail}">{legal.contactEmail}</a> {$_('legal.terms.s3.item4Post')}</li>
  </ul>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s4.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s4.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s5.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s5.p1Pre')} <a class="text-primary no-underline hover:underline" href="/privacy">{$_('legal.terms.s5.privacyLink')}</a>{$_('legal.terms.s5.p1Post')}
  </p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s5.p2')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s6.heading')}</h2>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s6.item1')}</li>
    <li class="text-base text-foreground/80 mb-2"><strong class="font-semibold">{$_('legal.terms.s6.item2Strong')}</strong> {$_('legal.terms.s6.item2Post')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s6.item3')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s6.item4')}</li>
  </ul>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s7.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s7.p1')}</p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s7.p2')}</p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s7.p3')}</p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s7.p4')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s8.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s8.intro')}</p>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item1')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item2')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item3')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item4')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item5')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item6')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item7')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s8.item8')}</li>
  </ul>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s8.outro1')}</p>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s8.outro2')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s9.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s9.intro')}</p>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s9.item1')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s9.item2')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s9.item3')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s9.item4')}</li>
  </ul>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s9.textNote')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s10.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s10.intro')}</p>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s10.item1')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s10.item2')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s10.item3')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s10.item4')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s10.item5')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s10.item6')}</li>
  </ul>
  <p class="text-base text-foreground/80 mb-3.5">{$_('legal.terms.s10.outro')}</p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s11.heading')}</h2>
  <ul class="mb-4 pl-[22px]">
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s11.item1')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s11.item2')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s11.item3')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s11.item4')}</li>
    <li class="text-base text-foreground/80 mb-2">{$_('legal.terms.s11.item5')}</li>
  </ul>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s12.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s12.body', { values: { service: legal.service } })}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s13.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s13.body')}
  </p>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s13.body2')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s14.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s14.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s15.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s15.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s16.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s16.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s17.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s17.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s18.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s18.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s19.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s19.body')}
  </p>

  <h2 class="font-[family-name:var(--serif)] text-xl mt-11 mb-3 pt-2" style="font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking)">{$_('legal.terms.s20.heading')}</h2>
  <p class="text-base text-foreground/80 mb-3.5">
    {$_('legal.terms.s20.body')}
  </p>

  <hr class="border-0 border-t border-border my-10" />
  <p class="bg-muted border border-border rounded-xl px-[18px] py-4 text-[15px] text-muted-foreground">
    {$_('legal.terms.note.pre')}
    <a class="text-primary no-underline hover:underline" href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>.
  </p>
</LegalLayout>
