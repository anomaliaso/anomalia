<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import PageHead from '$lib/components/PageHead.svelte';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import { refreshCredits } from '$lib/stores/credits';
  import { Link2, RefreshCw } from '@lucide/svelte';

  let { data, form } = $props();

  const brandSlug = $derived($page.params.brand ?? '');
  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
      if (brandSlug) setTimeout(() => refreshCredits(brandSlug), 600);
    };
  };

  const network = $derived(data.network);
  const give = $derived(network.opportunities.filter((o) => o.direction === 'give'));
  const receive = $derived(network.opportunities.filter((o) => o.direction === 'receive'));

  function formatDate(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }
</script>

<svelte:head>
  <title>Anomalia — {$_('app.backlinks.pageTitle')}</title>
</svelte:head>

<div class="content">
  <PageHead title={$_('app.backlinks.pageTitle')} subtitle={$_('app.backlinks.pageSubtitle')}>
    {#snippet actions()}
      {#if data.planAllowed}
        <form class="topbar-cta-wrap" class:is-busy={busy} method="POST" action="?/generate" use:enhance={withBusy}>
          <TopbarCta {busy} Icon={RefreshCw}>
            {busy
              ? $_('app.backlinks.generating')
              : network.opportunities.length
                ? $_('app.backlinks.refresh')
                : $_('app.backlinks.emptyCta')}
          </TopbarCta>
        </form>
      {:else}
        <a class="upgrade-cta" href={`/app/${brandSlug}/activate?plan=starter`}>
          {$_('app.backlinks.upgradeCta')}
        </a>
      {/if}
    {/snippet}
  </PageHead>

  {#if form?.error}<div class="err">{form.error}</div>{/if}

  <section class="card" style="margin:0 0 16px;padding:16px;">
    <h3 style="margin:0 0 8px;">External listings</h3>
    <p class="muted" style="font-size:13px;margin:0 0 10px;">
      Owner-reviewed directory listing (SubmitForBacklinks) — not a paid backlink marketplace.
      {#if data.sfbConfigured}
        Draft → review → attest → submit → publish → install badge → verify
        ({data.externalCredits} credits on successful submit). Free listings stay
        <em>awaiting_badge</em> until the badge is verified — Approved ≠ completed.
      {:else}
        SFB API key not configured — manual URL tracking only (links verified via GET + anchor).
      {/if}
    </p>
    {#if data.dfsBacklinks}
      <p class="muted" style="font-size:13px;margin:0 0 8px;">
        Profile: DR {data.dfsBacklinks.rank ?? '—'} · {data.dfsBacklinks.referringDomains ?? 0} referring domains · {data.dfsBacklinks.backlinks ?? 0} backlinks
      </p>
    {/if}
    {#if data.planAllowed}
      <form method="POST" action="?/createExternalOrder" use:enhance={withBusy} style="display:grid;gap:8px;max-width:480px;">
        <input name="target_url" placeholder="https://yoursite.com" required />
        <input name="topic" placeholder="Topic / angle (optional)" />
        {#if data.sfbConfigured}
          <label style="font-size:12px;display:flex;gap:6px;align-items:center;">
            <input type="radio" name="mode" value="sfb" checked /> Create SFB draft for review
          </label>
          <label style="font-size:12px;display:flex;gap:6px;align-items:center;">
            <input type="radio" name="mode" value="manual" /> Manual track only
          </label>
        {:else}
          <input type="hidden" name="mode" value="manual" />
        {/if}
        <button type="submit" disabled={busy}>{data.sfbConfigured ? 'Create draft / order' : 'Create manual order'}</button>
      </form>
      {#if data.orders?.length}
        <ul style="margin:12px 0 0;padding:0;list-style:none;display:grid;gap:10px;">
          {#each data.orders as o (o.id)}
            {@const badge = o.listing?.badge}
            {@const sfb = o.listing?.sfb}
            <li style="border:1px solid var(--line,#eee);border-radius:8px;padding:10px;font-size:13px;">
              <div><strong>{o.status}</strong> · {o.provider} · {o.target_url}</div>
              {#if sfb?.status || sfb?.isPublished != null}
                <div class="muted" style="font-size:12px;margin-top:2px;">
                  SFB: {sfb?.status ?? '—'}
                  · published={sfb?.isPublished ? 'yes' : 'no'}
                  {#if badge?.status} · badge {badge.status}{#if badge.linkPolicy} ({badge.linkPolicy}){/if}{/if}
                </div>
              {/if}
              {#if o.last_error}<div class="err" style="margin-top:4px;">{o.last_error}</div>{/if}
              {#if o.status === 'draft' && o.provider === 'submitforbacklinks'}
                <form method="POST" action="?/submitDraft" use:enhance={withBusy} style="margin-top:10px;display:grid;gap:6px;">
                  <input type="hidden" name="id" value={o.id} />
                  <input name="name" value={o.listing?.name ?? ''} placeholder="Name" required />
                  <input name="tagline" value={o.listing?.tagline ?? ''} placeholder="Tagline" required />
                  <textarea name="shortDescription" rows="2" placeholder="Short description" required value={o.listing?.shortDescription ?? ''}></textarea>
                  <textarea name="fullDescription" rows="4" placeholder="Full description" required value={o.listing?.fullDescription ?? ''}></textarea>
                  <input name="primaryCategorySlug" value={o.listing?.primaryCategorySlug ?? 'productivity'} placeholder="Category slug" />
                  <input name="tags" value={(o.listing?.tags ?? []).join(', ')} placeholder="Tags (comma-separated)" />
                  <input type="hidden" name="pricingModel" value={o.listing?.pricingModel ?? 'SUBSCRIPTION'} />
                  <input type="hidden" name="platformType" value={o.listing?.platformType ?? 'WEB'} />
                  <input type="hidden" name="productType" value={o.listing?.productType ?? 'SAAS'} />
                  <label style="font-size:12px;"><input type="checkbox" name="guidelinesAccepted" value="1" required /> I accept the listing guidelines</label>
                  <label style="font-size:12px;"><input type="checkbox" name="badgeRequirementAcknowledged" value="1" required /> I acknowledge the badge requirement</label>
                  <label style="font-size:12px;"><input type="checkbox" name="canRepresentProduct" value="1" required /> I can represent this product</label>
                  <label style="font-size:12px;"><input type="checkbox" name="reviewedGeneratedContent" value="1" required /> I reviewed the generated content</label>
                  <button type="submit" disabled={busy}>Submit listing ({data.externalCredits} credits)</button>
                </form>
              {:else if o.provider === 'submitforbacklinks' && ['submitted', 'awaiting_publish', 'awaiting_badge', 'needs_changes'].includes(o.status)}
                <div style="margin-top:8px;display:grid;gap:8px;">
                  <form method="POST" action="?/pollOrder" use:enhance={withBusy}>
                    <input type="hidden" name="id" value={o.id} />
                    <button type="submit" disabled={busy} style="font-size:12px;">Refresh status</button>
                  </form>
                  {#if o.status === 'awaiting_badge' || o.status === 'awaiting_publish' || o.status === 'submitted'}
                    {#if !badge?.markup}
                      <form method="POST" action="?/issueBadge" use:enhance={withBusy}>
                        <input type="hidden" name="id" value={o.id} />
                        <button type="submit" disabled={busy} style="font-size:12px;">Issue badge markup</button>
                      </form>
                    {:else}
                      <div>
                        <div class="muted" style="font-size:12px;margin-bottom:4px;">
                          Install one theme on a public HTTPS page of your site, then verify:
                        </div>
                        <textarea readonly rows="3" style="width:100%;font-family:ui-monospace,monospace;font-size:11px;">{badge.markup}</textarea>
                      </div>
                      <form method="POST" action="?/verifyBadge" use:enhance={withBusy} style="display:grid;gap:6px;">
                        <input type="hidden" name="id" value={o.id} />
                        <input name="badge_page_url" type="url" placeholder="https://yoursite.com/partners" required value={badge.targetUrl ?? ''} />
                        <button type="submit" disabled={busy} style="font-size:12px;">Verify badge</button>
                      </form>
                    {/if}
                  {/if}
                </div>
              {:else if o.provider === 'manual' && (o.status === 'pending' || o.status === 'submitted')}
                <form method="POST" action="?/completeExternalOrder" use:enhance={withBusy} style="margin-top:8px;display:grid;gap:6px;">
                  <input type="hidden" name="id" value={o.id} />
                  <textarea name="links" rows="2" placeholder="Page URLs that link to your target (one per line) — verified via GET"></textarea>
                  <button type="submit">Verify &amp; complete</button>
                </form>
              {:else if o.resulting_links?.length}
                <ul>{#each o.resulting_links as l}<li><a href={l.url} target="_blank" rel="noopener">{l.url}</a></li>{/each}</ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="muted" style="font-size:13px;">Starter+ required for external listing orders.</p>
    {/if}
  </section>

  {#if form?.error}<div class="err">{form.error}</div>{/if}

  {#if !data.planAllowed}
    <div class="empty locked">
      <Link2 size={28} strokeWidth={1.6} />
      <h3>{$_('app.backlinks.lockedTitle')}</h3>
      <p class="muted">{$_('app.backlinks.lockedDesc')}</p>
      <a class="upgrade-cta" href={`/app/${brandSlug}/activate?plan=starter`}>
        {$_('app.backlinks.upgradeCta')}
      </a>
    </div>
  {:else}
  <section class="card focus">
    <div class="focus-meta">
      <span class="pill">{network.unlocked ? $_('app.backlinks.networkOn') : $_('app.backlinks.networkOff')}</span>
      <span class="muted tiny">{$_('app.backlinks.networkHint')}</span>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-val">{network.stats.outgoingCount}</div>
        <div class="stat-label">{$_('app.backlinks.statOutgoing')}</div>
      </div>
      <div class="stat">
        <div class="stat-val">{network.stats.incomingCount}</div>
        <div class="stat-label">{$_('app.backlinks.statIncoming')}</div>
      </div>
      <div class="stat">
        <div class="stat-val">{network.stats.openGive}</div>
        <div class="stat-label">{$_('app.backlinks.statGive')}</div>
      </div>
      <div class="stat">
        <div class="stat-val">{network.stats.openReceive}</div>
        <div class="stat-label">{$_('app.backlinks.statReceive')}</div>
      </div>
    </div>
    <form method="POST" action="?/toggle" class="toggle-form" use:enhance>
      <input type="hidden" name="enabled" value={network.enabled ? 'false' : 'true'} />
      <button type="submit" class="btn ghost">
        {network.enabled ? $_('app.backlinks.disable') : $_('app.backlinks.enable')}
      </button>
    </form>
  </section>

  {#if !network.opportunities.length && !network.outgoing.length && !network.incoming.length}
    <div class="empty">
      <Link2 size={28} strokeWidth={1.6} />
      <h3>{$_('app.backlinks.emptyTitle')}</h3>
      <p class="muted">{$_('app.backlinks.emptyDesc')}</p>
      <form method="POST" action="?/generate" use:enhance={withBusy}>
        <TopbarCta {busy} Icon={RefreshCw} class="empty-cta">
          {busy ? $_('app.backlinks.generating') : $_('app.backlinks.emptyCta')}
        </TopbarCta>
      </form>
    </div>
  {:else}
    {#if give.length}
      <section class="bl-section">
        <h3>{$_('app.backlinks.giveTitle')}</h3>
        <p class="muted section-sub">{$_('app.backlinks.giveSubtitle')}</p>
        <div class="opp-list">
          {#each give as o (o.id)}
            <div class="opp card">
              <div class="opp-main">
                <div class="opp-title">{o.partnerTitle}</div>
                <div class="opp-meta">
                  <span class="chip">{o.partnerBrandName}</span>
                  <span class="chip score">{o.relevance}</span>
                  {#if o.suggestedAnchor}<span class="muted tiny">“{o.suggestedAnchor}”</span>{/if}
                </div>
                {#if o.rationale}<p class="opp-rationale">{o.rationale}</p>{/if}
                <a class="opp-url" href={o.partnerUrl} target="_blank" rel="noopener">{o.partnerUrl}</a>
              </div>
              <form method="POST" action="?/dismiss" use:enhance>
                <input type="hidden" name="id" value={o.id} />
                <button type="submit" class="btn ghost tiny">{$_('app.backlinks.dismiss')}</button>
              </form>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if receive.length}
      <section class="bl-section">
        <h3>{$_('app.backlinks.receiveTitle')}</h3>
        <p class="muted section-sub">{$_('app.backlinks.receiveSubtitle')}</p>
        <div class="opp-list">
          {#each receive as o (o.id)}
            <div class="opp card">
              <div class="opp-main">
                <div class="opp-title">{o.partnerTitle}</div>
                <div class="opp-meta">
                  <span class="chip">{$_('app.backlinks.fromPartner', { values: { name: o.partnerBrandName } })}</span>
                  <span class="chip score">{o.relevance}</span>
                </div>
                {#if o.rationale}<p class="opp-rationale">{o.rationale}</p>{/if}
              </div>
              <form method="POST" action="?/dismiss" use:enhance>
                <input type="hidden" name="id" value={o.id} />
                <button type="submit" class="btn ghost tiny">{$_('app.backlinks.dismiss')}</button>
              </form>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if network.outgoing.length}
      <section class="bl-section">
        <h3>{$_('app.backlinks.outgoingTitle')}</h3>
        <p class="muted section-sub">{$_('app.backlinks.outgoingSubtitle')}</p>
        <div class="place-list">
          {#each network.outgoing as p (p.id)}
            <div class="place card">
              <div class="place-main">
                <a href={p.targetUrl} target="_blank" rel="noopener">{p.anchorText || p.targetUrl}</a>
                <div class="place-meta muted tiny">
                  → {p.partnerName ?? '—'} · {p.status} · {formatDate(p.createdAt)}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if network.incoming.length}
      <section class="bl-section">
        <h3>{$_('app.backlinks.incomingTitle')}</h3>
        <p class="muted section-sub">{$_('app.backlinks.incomingSubtitle')}</p>
        <div class="place-list">
          {#each network.incoming as p (p.id)}
            <div class="place card">
              <div class="place-main">
                <div class="place-title">{p.partnerName ?? '—'}</div>
                <div class="place-meta muted tiny">
                  {p.anchorText || p.targetUrl} · {p.status} · {formatDate(p.createdAt)}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
  {/if}
</div>

<style>
  .content {
    max-width: 920px;
  }
  .err {
    background: color-mix(in oklab, #ef4444 12%, var(--paper));
    border: 1px solid color-mix(in oklab, #ef4444 35%, var(--line));
    color: #b91c1c;
    padding: 10px 14px;
    border-radius: 10px;
    margin-bottom: 14px;
  }
  .empty {
    text-align: center;
    padding: 48px 24px;
    border: 1px dashed var(--line);
    border-radius: 16px;
    background: var(--paper);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .empty h3 {
    margin: 8px 0 0;
  }
  .empty p {
    margin: 0 0 16px;
    max-width: 440px;
  }
  .upgrade-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 11px 20px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 10px;
    background: var(--ink);
    color: var(--paper);
    text-decoration: none;
  }
  :global(.empty-cta.topbar-cta) {
    padding: 11px 20px;
    font-size: 14px;
  }
  .card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
  }
  .focus {
    margin-bottom: 22px;
  }
  .focus-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-bottom: 14px;
  }
  .pill {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .stats {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  .stat-val {
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1;
  }
  .stat-label {
    font-size: 12px;
    color: var(--ink-soft);
    margin-top: 4px;
  }
  .toggle-form {
    margin-top: 14px;
  }
  .btn {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--paper-2);
    border-radius: 10px;
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
  }
  .btn.tiny {
    padding: 6px 10px;
    font-size: 12px;
  }
  .bl-section {
    margin-bottom: 28px;
  }
  .bl-section h3 {
    margin: 0 0 4px;
    font-size: 1.05rem;
  }
  .section-sub {
    margin: 0 0 14px;
    font-size: 13px;
  }
  .opp-list,
  .place-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .opp {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
  }
  .opp-title,
  .place-title {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .opp-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 6px;
  }
  .chip {
    font-size: 11px;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 2px 8px;
    background: var(--paper-2);
  }
  .chip.score {
    font-variant-numeric: tabular-nums;
  }
  .opp-rationale {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .opp-url {
    font-size: 12px;
    word-break: break-all;
  }
  .place-meta {
    margin-top: 4px;
  }
  .muted {
    color: var(--ink-soft);
  }
  .tiny {
    font-size: 12px;
  }
</style>
