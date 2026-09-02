<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import {
    SETTINGS_BRAND_SECTIONS,
    SETTINGS_SECTIONS
  } from '$lib/components/settings/platforms';
  import PageHead from '$lib/components/PageHead.svelte';
  import { studioCompleteness } from '$lib/studio-completeness';
  import { _ } from 'svelte-i18n';
  // Stili condivisi con SettingsModal (che ospita le stesse pagine senza questo layout).
  import '$lib/styles/settings-shell.css';

  let { data, children } = $props();
  const brand = $derived(data.brand);
  const settingsBase = $derived(`/app/${brand.slug}/settings`);
  const path = $derived($page.url.pathname);
  /** OAuth intermediate pages keep their own full-page UI. */
  const isOauthFlow = $derived(
    path.includes('/settings/facebook') ||
      path.includes('/settings/linkedin') ||
      path.includes('/settings/connect/')
  );

  const brandSection = $derived(
    (SETTINGS_BRAND_SECTIONS as readonly string[]).find((s) =>
      path.replace(/\/$/, '').endsWith(`/settings/${s}`)
    ) ?? null
  );
  const isBrandKit = $derived(!!brandSection);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Extras = {
    kit: any;
    products: any[];
    documents: any[];
    history: any[];
    people: any[];
    competitors: any[];
  };
  let extras = $state<Extras | null>(null);
  $effect(() => {
    if (!isBrandKit || !data.deferred) return;
    const p = data.deferred;
    p.then((v: Extras) => {
      if (p === data.deferred) extras = v;
    }).catch(() => {});
  });

  const completeness = $derived.by(() => {
    if (!extras) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kit = extras.kit as any;
    const character = (kit?.ai_character ?? {}) as Record<string, unknown>;
    const currentLogo =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (((kit?.logos ?? []) as any[]).find((l) => l?.url && l?.type !== 'og-image')?.url as
        | string
        | undefined) ?? null;
    return studioCompleteness({
      products: extras.products.length,
      history: extras.history.length,
      documents: extras.documents.length,
      voice: !!(character.tone || character.speaking_style || kit?.brand_style),
      about: !!kit?.about,
      audience: !!kit?.target_audience,
      logo: !!currentLogo,
      colors: ((kit?.brand_colors ?? []) as string[]).length > 0
    });
  });

  type SettingsHead = { title: string; subtitle?: string };

  const head = $derived.by((): SettingsHead => {
    const p = path.replace(/\/$/, '');
    const slug = brand.slug;
    const base = `/app/${slug}/settings`;
    const map: Record<string, SettingsHead> = {
      [`${base}/brand`]: {
        title: $_('app.studio.tabs.brand')
      },
      [`${base}/platforms`]: {
        title: $_('app.studio.tabs.platforms')
      },
      [`${base}/hashtags`]: {
        title: $_('app.studio.tabs.hashtags')
      },
      [`${base}/voice-examples`]: {
        title: $_('app.studio.tabs.voiceExamples')
      },
      [`${base}/products`]: {
        title: $_('app.studio.tabs.products', {
          values: { count: extras?.products?.length ?? 0 }
        })
      },
      [`${base}/people`]: {
        title: $_('app.studio.tabs.people')
      },
      [`${base}/library`]: {
        title: $_('app.nav.library'),
        subtitle: $_('app.settings.library.subtitle')
      },
      [`${base}/demo-account`]: {
        title: $_('app.settings.demoAccount.title'),
        subtitle: $_('app.settings.demoAccount.subtitle')
      },
      [`${base}/connected-accounts`]: {
        title: $_('app.settings.connectedAccounts')
      },
      [`${base}/connectors`]: {
        title: $_('app.settings.connectors.title'),
        subtitle: $_('app.settings.connectors.subtitle')
      },
      [`${base}/ads`]: {
        title: $_('app.settings.ads.capsTitle')
      },
      [`${base}/ads/accounts`]: {
        title: $_('app.settings.ads.accountsTitle')
      },
      [`${base}/autopilot`]: {
        title: $_('app.settings.autopilot')
      },
      [`${base}/radar`]: {
        title: $_('app.settings.radar.title'),
        subtitle: $_('app.settings.radar.subtitle')
      },
      [`${base}/timezone`]: {
        title: $_('app.settings.postingTimezone')
      },
      [`${base}/blog-appearance`]: {
        title: $_('app.settings.blog.appearance'),
        subtitle: $_('app.settings.blog.appearanceSub')
      },
      [`${base}/blog-authors`]: {
        title: $_('app.settings.blog.authors')
      },
      [`${base}/blog-categories`]: {
        title: $_('app.settings.blog.categories')
      },
      [`${base}/blog-domain`]: {
        title: $_('app.settings.blog.domain'),
        subtitle: $_('app.settings.blog.domainSub')
      },
      [`${base}/blog-integrations`]: {
        title: $_('app.settings.blog.integrations')
      },
      [`${base}/search-console`]: {
        title: $_('app.settings.searchConsole.title')
      },
      [`${base}/language`]: {
        title: $_('app.settings.language')
      },
      [`${base}/api-keys`]: {
        title: $_('app.settings.apiKeys.title')
      },
      [`${base}/team`]: {
        title: $_('app.settings.team.title')
      },
      [`${base}/profile`]: {
        title: $_('app.settings.profile.title')
      },
      [`${base}/appearance`]: {
        title: $_('app.settings.appearance.title')
      },
      [`${base}/billing`]: {
        title: $_('app.settings.billing.title')
      },
      [`${base}/usage`]: {
        title: $_('app.settings.usage.title')
      },
      [`${base}/chat`]: {
        title: $_('app.settings.chat.title')
      },
      [`${base}/danger`]: {
        title: $_('app.settings.del.title')
      }
    };
    return (
      map[p] ??
      (p.startsWith(`${base}/usage/sessions/`)
        ? { title: $_('app.settings.usage.sessionTitle') }
        : { title: $_('app.nav.settings') })
    );
  });

  // Legacy `#section` bookmarks → path-based pages (hash can survive the root redirect).
  onMount(() => {
    if (isOauthFlow) return;
    const hash = $page.url.hash.replace(/^#/, '');
    if (!hash || !(SETTINGS_SECTIONS as readonly string[]).includes(hash)) return;
    const p = path.replace(/\/$/, '');
    if (p.endsWith(`/${hash}`)) return;
    goto(`${settingsBase}/${hash}${$page.url.search}`, { replaceState: true });
  });
</script>

{#if isOauthFlow}
  {@render children()}
{:else}
  <div class="content settings-shell" class:brand-kit={isBrandKit}>
    {#if completeness}
      <PageHead title={head.title} subtitle={head.subtitle ?? null}>
        {#snippet actions()}
          <div class="cmp-pill" class:done={completeness.pct === 100}>
            <svg viewBox="0 0 36 36" class="cmp-ring">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="rgba(var(--accent-rgb), 0.14)"
                stroke-width="3"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-dasharray={`${completeness.pct * 0.974} 100`}
                stroke-dashoffset="0"
                stroke-linecap="round"
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span class="cmp-pct">{completeness.pct}%</span>
          </div>
        {/snippet}
      </PageHead>
    {:else}
      <PageHead title={head.title} subtitle={head.subtitle ?? null} />
    {/if}
    <div class="settings">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .cmp-pill {
    position: relative;
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    color: var(--accent, #7c5cff);
  }
  .cmp-pill.done {
    color: #1f8a4c;
  }
  .cmp-ring {
    width: 40px;
    height: 40px;
    display: block;
  }
  .cmp-pct {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--ink);
  }
  .cmp-pill.done .cmp-pct {
    color: #1f8a4c;
  }

  .page-section {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft, #6e6e73);
  }
  .page-sub {
    margin: 6px 0 0;
    max-width: 42rem;
  }

  form { margin: 0; }
</style>
