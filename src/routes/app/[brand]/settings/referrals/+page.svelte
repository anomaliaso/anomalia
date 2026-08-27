<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { data } = $props();

  let copiedLink = $state(false);
  let copiedBadge = $state(false);

  async function copy(text: string, which: 'link' | 'badge') {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'link') {
        copiedLink = true;
        setTimeout(() => (copiedLink = false), 1800);
      } else {
        copiedBadge = true;
        setTimeout(() => (copiedBadge = false), 1800);
      }
    } catch {
      // ignore
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.referrals.title')}</div></div>

  <div class="field">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.referrals.headline', { values: { credits: fmt(data.creditsEach) } })}</div>
      <div class="fs">{$_('app.settings.referrals.subtitle', { values: { credits: fmt(data.creditsEach) } })}</div>
    </div>
  </div>

  {#if data.shareUrl && data.code}
    <div class="field">
      <div class="ftxt">
        <div class="fh">{$_('app.settings.referrals.yourLink')}</div>
        <div class="fs mono">{data.shareUrl}</div>
      </div>
      <button class="mini connect" type="button" onclick={() => copy(data.shareUrl!, 'link')}>
        {copiedLink ? $_('app.settings.referrals.copied') : $_('app.settings.referrals.copyLink')}
      </button>
    </div>

    <div class="field">
      <div class="ftxt">
        <div class="fh">{$_('app.settings.referrals.badgeTitle')}</div>
        <div class="fs">{$_('app.settings.referrals.badgeDesc')}</div>
      </div>
    </div>

    <div class="field badge-preview">
      <!-- Preview of the public badge (same markup customers embed). -->
      {@html data.badgeHtml}
    </div>

    <div class="field">
      <button class="mini connect" type="button" onclick={() => copy(data.badgeHtml!, 'badge')}>
        {copiedBadge ? $_('app.settings.referrals.copied') : $_('app.settings.referrals.copyBadge')}
      </button>
    </div>

    <div class="field">
      <div class="ftxt">
        <div class="fh">{$_('app.settings.referrals.blogNoteTitle')}</div>
        <div class="fs">{$_('app.settings.referrals.blogNote')}</div>
      </div>
    </div>
  {/if}

  <div class="field stats">
    <div class="stat">
      <div class="stat-n">{fmt(data.stats.credited)}</div>
      <div class="stat-l">{$_('app.settings.referrals.statCredited')}</div>
    </div>
    <div class="stat">
      <div class="stat-n">{fmt(data.stats.creditsEarned)}</div>
      <div class="stat-l">{$_('app.settings.referrals.statCredits')}</div>
    </div>
  </div>

  {#if data.recent.length}
    <div class="field"><div class="fh">{$_('app.settings.referrals.history')}</div></div>
    {#each data.recent as row (row.id)}
      <div class="acct">
        <div class="nm">
          <div class="h">+{fmt(row.credits_each)} {$_('app.settings.referrals.credits')}</div>
          <div class="s">
            {row.status === 'credited'
              ? $_('app.settings.referrals.statusCredited')
              : $_('app.settings.referrals.statusRejected')}
            · {new Date(row.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>
    {/each}
  {:else}
    <div class="field"><div class="fs">{$_('app.settings.referrals.empty')}</div></div>
  {/if}
</section>

<style>
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12.5px;
    word-break: break-all;
    margin-top: 4px;
  }
  .badge-preview {
    padding: 14px 0;
  }
  .stats {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }
  .stat {
    min-width: 120px;
  }
  .stat-n {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .stat-l {
    font-size: 12.5px;
    color: var(--ink-soft);
    margin-top: 2px;
  }
</style>
