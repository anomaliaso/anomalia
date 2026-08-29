<script lang="ts">
  import PageHead from '$lib/components/PageHead.svelte';
  import AgentEmptyOffer from '$lib/components/AgentEmptyOffer.svelte';
  import { page } from '$app/stores';
  import LeadsTrend from '$lib/components/LeadsTrend.svelte';
  import { enhance } from '$app/forms';
  import { _, locale } from 'svelte-i18n';
  import { siReddit, siThreads, siX } from 'simple-icons';
  import { ArrowUpRight, Check, FileText, Mail, MessageSquare, X } from '@lucide/svelte';
  import { fade, fly } from 'svelte/transition';

  let { data } = $props();
  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
    };
  };

  type Lead = {
    id: string; title: string; url: string; source_name: string | null; snippet: string | null; gist: string | null; status: string;
    relevance: number | null; intent: string | null; suggestion: string | null; dm_draft: string | null; dm_target: string | null; created_at: string;
    // Com'è andata al commento 48h dopo che l'hai incollato. Null finché il controllo non è passato.
    outcome: { found: boolean; upvotes: number | null; replies: number | null; removed: boolean | null } | null;
  };

  // Platform derived from the URL — reddit is the default (Radar's original engage surface).
  function platformOf(url: string): 'reddit' | 'threads' | 'x' | 'linkedin' {
    if (url.includes('threads.net') || url.includes('threads.com')) return 'threads';
    if (url.includes('linkedin.com')) return 'linkedin';
    if (url.includes('x.com') || url.includes('twitter.com')) return 'x';
    return 'reddit';
  }

  // Buying intent — how close this person is to a decision, judged by the Radar. It is what
  // orders the queue (server-side), so it earns a visible badge on the card.
  const INTENT_LABELS: Record<string, string> = $derived({
    seeking_now: $_('app.leads.intentSeeking'),
    comparing: $_('app.leads.intentComparing'),
    researching: $_('app.leads.intentResearching'),
    venting: $_('app.leads.intentVenting')
  });

  // Rising RSS is scraped from old.reddit.com and historically stored those hostnames. Always open
  // the current Reddit UI (www), never the classic old.reddit skin.
  function openUrl(url: string): string {
    const u = (url ?? '').trim();
    if (!u) return u;
    if (u.startsWith('/r/') || u.startsWith('/user/') || u.startsWith('/u/')) return `https://www.reddit.com${u}`;
    if (!/reddit\.com/i.test(u)) return u;
    return u.replace(/^https?:\/\/(old\.|new\.|www\.)?reddit\.com/i, 'https://www.reddit.com');
  }

  // simple-icons dropped LinkedIn (trademark policy), so its glyph is inlined — same shape the
  // post mockup already uses.
  const LINKEDIN_ICON = { path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z', hex: '0A66C2' };
  const PLAT_ICONS: Record<string, { path: string; hex: string }> = { reddit: siReddit, threads: siThreads, x: siX, linkedin: LINKEDIN_ICON };
  const PLAT_COLORS: Record<string, string> = { reddit: '#ff4500', threads: '#000', x: '#0a0a0a', linkedin: '#0a66c2' };
  const PLAT_LABELS: Record<string, string> = { reddit: 'Reddit', threads: 'Threads', x: 'X', linkedin: 'LinkedIn' };

  // Handle with the platform-native prefix (u/ for reddit, @ for threads/x).
  function handleOf(l: Lead): string {
    const a = (l.dm_target ?? '').replace(/^[@u]\/?|^@/, '').trim();
    if (!a) return '';
    if (l.url.includes('linkedin.com')) return a; // LinkedIn authors are display names, not handles
    if (l.url.includes('threads.net') || l.url.includes('x.com') || l.url.includes('twitter.com')) return `@${a}`;
    return `u/${a}`;
  }

  let statusFilter = $state('suggested');
  let platformFilter = $state('');
  let sourceFilter = $state('');
  let query = $state('');

  // A source that existed in the previous status/platform set may no longer exist — reset it.
  $effect(() => {
    statusFilter;
    platformFilter;
    sourceFilter = '';
  });

  const statusCounts = $derived.by(() => {
    const c = { suggested: 0, done: 0, dismissed: 0 };
    for (const l of data.leads as Lead[]) if (l.status in c) c[l.status as keyof typeof c]++;
    return c;
  });

  const byStatus = $derived((data.leads as Lead[]).filter((l) => l.status === statusFilter));

  const platformCounts = $derived.by(() => {
    const c = { reddit: 0, threads: 0, x: 0, linkedin: 0 };
    for (const l of byStatus) c[platformOf(l.url)]++;
    return c;
  });

  const byPlatform = $derived(platformFilter ? byStatus.filter((l) => platformOf(l.url) === platformFilter) : byStatus);

  // Distinct sources with counts, for the subreddit filter — only shown when there's at least one.
  const sources = $derived.by(() => {
    const m = new Map<string, number>();
    for (const l of byPlatform) { const s = (l.source_name ?? '').trim(); if (s) m.set(s, (m.get(s) ?? 0) + 1); }
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  });

  const bySource = $derived(sourceFilter ? byPlatform.filter((l) => (l.source_name ?? '') === sourceFilter) : byPlatform);

  // Global search across content (title + snippet), comment and DM text.
  const leads = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bySource;
    return bySource.filter((l) =>
      [l.title, l.gist, l.snippet, l.suggestion, l.dm_draft, l.dm_target, l.source_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  });

  // Right drawer — one lead at a time, opened from the grid cards.
  let selectedId = $state('');
  const selectedLead = $derived((data.leads as Lead[]).find((l) => l.id === selectedId) ?? null);
  function closeDrawer() { selectedId = ''; }

  // The workbench frame sets `contain: layout` + `container-type`, which re-bases position:fixed to
  // itself — the drawer has to live on <body> to sit above the top bar and the global sidebar.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.parentNode?.removeChild(node); } };
  }

  let copiedKey = $state('');
  async function copyText(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); copiedKey = key; setTimeout(() => { if (copiedKey === key) copiedKey = ''; }, 1500); } catch { /* blocked */ }
  }
  function dmUrl(l: Lead): string {
    const a = (l.dm_target ?? '').replace(/^[@u]\/?|^@/, '');
    if (!a) return l.url;
    if (l.url.includes('threads.net')) return `https://www.threads.net/@${a}`;
    if (l.url.includes('x.com') || l.url.includes('twitter.com')) return `https://x.com/${a}`;
    return `https://www.reddit.com/user/${a}`;
  }

  // AI rewrite state — track which lead/field is being rewritten and the feedback text.
  let rewriteTarget = $state<string>(''); // lead.id + ':' + field
  let rewriteFeedback = $state('');
  let rewriting = $state(false);
  let rewriteResult = $state<{ id: string; field: string; text: string } | null>(null);

  function startRewrite(leadId: string, field: string) {
    rewriteTarget = `${leadId}:${field}`;
    rewriteFeedback = '';
    rewriteResult = null;
  }
  function cancelRewrite() {
    rewriteTarget = '';
    rewriteFeedback = '';
  }

  async function submitRewrite(id: string, field: string) {
    if (!rewriteFeedback.trim() || rewriting) return;
    rewriting = true;
    try {
      const fd = new FormData();
      fd.set('id', id);
      fd.set('feedback', rewriteFeedback.trim());
      fd.set('field', field);
      const res = await fetch(`?/rewrite`, { method: 'POST', body: fd });
      const body = await res.json();
      if (body?.data?.rewritten) {
        rewriteResult = { id, field, text: body.data.text };
        rewriteTarget = '';
        // Update the local lead data so the UI reflects the change immediately.
        const lead = (data.leads as Lead[]).find((l) => l.id === id);
        if (lead) {
          if (field === 'dm') lead.dm_draft = body.data.text;
          else lead.suggestion = body.data.text;
        }
      }
    } catch { /* */ }
    rewriting = false;
  }

  // Helper: snippet truncated for preview — strips HTML tags, decodes entities, removes Reddit footer.
  function snippetPreview(s: string | null, maxLen = 180): string {
    if (!s) return '';
    const clean = s
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/submitted by\s*\/?u\/\S+.*$/i, '')
      .replace(/\[link\]\s*\[comments\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
  }

  // Relative age of the lead — Intl does the wording, in the app locale.
  function ago(iso: string): string {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    const rtf = new Intl.RelativeTimeFormat($locale ?? undefined, { numeric: 'auto' });
    if (mins < 60) return rtf.format(-mins, 'minute');
    if (mins < 1440) return rtf.format(-Math.round(mins / 60), 'hour');
    return rtf.format(-Math.round(mins / 1440), 'day');
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && selectedId) closeDrawer(); }} />

<!-- Relevance ring — same read as the post score in Calendar: arc length is the value, colour is
     the verdict, number sits alongside. -->
{#snippet relRing(v: number)}
  {@const pct = Math.min(1, Math.max(0, v / 100))}
  <span class="rel" data-tone={v >= 70 ? 'good' : v >= 45 ? 'mid' : 'low'} title={$_('app.leads.relevanceLabel')}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle class="track" cx="12" cy="12" r="9" />
      <circle class="arc" cx="12" cy="12" r="9" stroke-dasharray={2 * Math.PI * 9} stroke-dashoffset={2 * Math.PI * 9 * (1 - pct)} transform="rotate(-90 12 12)" />
    </svg>
    <b>{v}%</b>
  </span>
{/snippet}

<div class="radar-page">
  <PageHead title={$_('app.leads.title')} subtitle={$_('app.leads.sub')} />

  <LeadsTrend days={data.trend} day={data.found.day} threeDays={data.found.threeDays} week={data.found.week} />

  <div class="filter-row">
    <label class="fld">
      <span class="lb">{$_('app.leads.filterStatus')}</span>
      <select bind:value={statusFilter}>
        <option value="suggested">{$_('app.leads.statusTodo')} ({statusCounts.suggested})</option>
        <option value="done">{$_('app.leads.statusDone')} ({statusCounts.done})</option>
        <option value="dismissed">{$_('app.leads.statusIgnored')} ({statusCounts.dismissed})</option>
      </select>
    </label>
    <label class="fld">
      <span class="lb">{$_('app.leads.filterPlatform')}</span>
      <select bind:value={platformFilter}>
        <option value="">{$_('app.leads.platformAll')}</option>
        <option value="reddit">Reddit ({platformCounts.reddit})</option>
        {#if data.hasProRadarLeads}
          <option value="threads">Threads ({platformCounts.threads})</option>
          <option value="x">X ({platformCounts.x})</option>
          <option value="linkedin">LinkedIn ({platformCounts.linkedin})</option>
        {/if}
      </select>
    </label>
    {#if sources.length}
      <label class="fld">
        <span class="lb">{$_('app.leads.filterSub')}</span>
        <select bind:value={sourceFilter}>
          <option value="">{$_('app.leads.platformAll')}</option>
          {#each sources as s (s.name)}
            <option value={s.name}>{s.name} ({s.count})</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="fld is-search">
      <span class="lb">{$_('app.leads.search')}</span>
      <input type="search" bind:value={query} placeholder={$_('app.leads.searchPh')} />
    </label>
  </div>

  <section class="section">
    {#if leads.length}
      <ul class="leads-grid">
        {#each leads as l (l.id)}
          {@const plat = platformOf(l.url)}
          {@const icon = PLAT_ICONS[plat]}
          <li>
            <button type="button" class="lead-card" onclick={() => (selectedId = l.id)}>
              <span class="lead-card-head">
                <span class="plat-badge sm" style="background:{PLAT_COLORS[plat]}" title={PLAT_LABELS[plat]} aria-label={PLAT_LABELS[plat]}>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="#fff"><path d={icon.path} /></svg>
                </span>
                {#if l.source_name}<span class="lead-source">{l.source_name}</span>{/if}
                {#if l.intent && INTENT_LABELS[l.intent]}
                  <span class="intent" data-intent={l.intent} title={$_('app.leads.intentLabel')}>{INTENT_LABELS[l.intent]}</span>
                {/if}
                <span class="lead-time">{ago(l.created_at)}</span>
              </span>
              <span class="lead-card-title">{l.title}</span>
              {#if l.gist || l.snippet}<span class="lead-card-snippet">{snippetPreview(l.gist ?? l.snippet, 220)}</span>{/if}
              <span class="lead-card-foot">
                {#if l.dm_target}<span class="lead-user">{handleOf(l)}</span>{/if}
                <span class="lead-chips">
                  {#if l.outcome}
                    {#if l.outcome.removed}
                      <span class="outcome bad" title={$_('app.leads.outcomeRemovedHint')}>{$_('app.leads.outcomeRemoved')}</span>
                    {:else if l.outcome.found}
                      <span class="outcome" title={$_('app.leads.outcomeHint')}>▲{l.outcome.upvotes ?? 0} · {l.outcome.replies ?? 0}↩</span>
                    {/if}
                  {/if}
                  {#if l.suggestion}<span class="chip" title={$_('app.leads.comment')}><MessageSquare size={12} /></span>{/if}
                  {#if l.dm_draft}<span class="chip" title="DM"><Mail size={12} /></span>{/if}
                  {#if l.relevance != null}{@render relRing(l.relevance)}{/if}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      {#if $page.data.flags?.navTeam}
        <!-- FEATURE_NAV_TEAM: il vuoto lo riempie il proprietario (Radar), non un imperativo. -->
        <p class="empty"><AgentEmptyOffer job="radar_recap" /></p>
      {:else}
        <p class="empty">{$_('app.leads.empty')}</p>
      {/if}
    {/if}
  </section>
</div>

{#if selectedLead}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="drawer-backdrop" use:portal aria-hidden="true" transition:fade={{ duration: 180 }} onclick={closeDrawer}></div>
  <div class="lead-drawer" use:portal role="dialog" aria-modal="true" aria-label={selectedLead.title} transition:fly={{ x: 460, duration: 260, easing: (t: number) => 1 - Math.pow(1 - t, 3) }}>
    <div class="drawer-head">
      <span class="plat-badge" style="background:{PLAT_COLORS[platformOf(selectedLead.url)]}" title={PLAT_LABELS[platformOf(selectedLead.url)]} aria-label={PLAT_LABELS[platformOf(selectedLead.url)]}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d={PLAT_ICONS[platformOf(selectedLead.url)].path} /></svg>
      </span>
      <span class="dh-meta">
        <span class="dh-source">{selectedLead.source_name || PLAT_LABELS[platformOf(selectedLead.url)]}</span>
        <span class="dh-sub">{ago(selectedLead.created_at)}{selectedLead.dm_target ? ` · ${handleOf(selectedLead)}` : ''}{selectedLead.intent && INTENT_LABELS[selectedLead.intent] ? ` · ${INTENT_LABELS[selectedLead.intent]}` : ''}</span>
      </span>
      {#if selectedLead.relevance != null}{@render relRing(selectedLead.relevance)}{/if}
      <button type="button" class="drawer-close" aria-label={$_('app.leads.close')} onclick={closeDrawer}><X size={15} /></button>
    </div>

    <div class="drawer-body">
    <!-- The conversation itself -->
    <div class="sugg-block post-block">
      <div class="sugg-header">
        <span class="sugg-icon"><FileText size={13} /></span>
        <span class="sugg-label">{selectedLead.gist ? $_('app.leads.postGist') : $_('app.leads.postLabel')}</span>
        <a class="head-link" href={openUrl(selectedLead.url)} target="_blank" rel="noopener noreferrer">{$_('app.leads.openPost')} <ArrowUpRight size={12} /></a>
      </div>
      <a href={openUrl(selectedLead.url)} target="_blank" rel="noopener noreferrer" class="lead-title">{selectedLead.title}</a>
      {#if selectedLead.gist || selectedLead.snippet}
        <p class="lead-snippet-full">{snippetPreview(selectedLead.gist ?? selectedLead.snippet, 4000)}</p>
      {/if}
    </div>

    <!-- Comment section -->
    <div class="sugg-block">
      <div class="sugg-header">
        <span class="sugg-icon"><MessageSquare size={13} /></span>
        <span class="sugg-label">{$_('app.leads.comment')}</span>
      </div>
      {#if rewriteResult?.id === selectedLead.id && rewriteResult?.field === 'comment'}
        <p class="sugg-text rewritten">{rewriteResult.text}</p>
      {:else}
        <p class="sugg-text">{selectedLead.suggestion}</p>
      {/if}
      <div class="sugg-actions">
        <a class="btn primary sm" href={openUrl(selectedLead.url)} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={14} />{$_('app.radar.openAndComment')}</a>
        <button class="btn ghost sm" type="button" onclick={() => copyText(selectedLead.suggestion ?? '', 'c-' + selectedLead.id)}>{copiedKey === 'c-' + selectedLead.id ? $_('app.leads.copied') : $_('app.leads.copy')}</button>
        {#if statusFilter === 'suggested'}
          <button class="btn ghost sm" type="button" onclick={() => startRewrite(selectedLead.id, 'comment')}>{$_('app.leads.rewrite')}</button>
        {/if}
      </div>
      {#if rewriteTarget === `${selectedLead.id}:comment`}
        <form class="rewrite-form" onsubmit={(e) => { e.preventDefault(); submitRewrite(selectedLead.id, 'comment'); }}>
          <input class="rewrite-input" type="text" bind:value={rewriteFeedback} placeholder={$_('app.leads.feedbackPh')} disabled={rewriting} />
          <button class="btn primary sm" type="submit" disabled={rewriting || !rewriteFeedback.trim()}>
            {#if rewriting}<span class="spin"></span>{:else}{$_('app.leads.rewriteGo')}{/if}
          </button>
          <button class="btn ghost sm" type="button" onclick={cancelRewrite}>{$_('app.leads.rewriteCancel')}</button>
        </form>
      {/if}
    </div>

    <!-- DM section -->
    {#if selectedLead.dm_draft}
      <div class="sugg-block dm-block">
        <div class="sugg-header">
          <span class="sugg-icon"><Mail size={13} /></span>
          <span class="sugg-label">DM{selectedLead.dm_target ? ` · ${handleOf(selectedLead)}` : ''}</span>
        </div>
        {#if rewriteResult?.id === selectedLead.id && rewriteResult?.field === 'dm'}
          <p class="sugg-text rewritten">{rewriteResult.text}</p>
        {:else}
          <p class="sugg-text">{selectedLead.dm_draft}</p>
        {/if}
        <div class="sugg-actions">
          <a class="btn primary sm dm-btn" href={dmUrl(selectedLead)} target="_blank" rel="noopener noreferrer">{$_('app.leads.openAndDm')}</a>
          <button class="btn ghost sm" type="button" onclick={() => copyText(selectedLead.dm_draft ?? '', 'd-' + selectedLead.id)}>{copiedKey === 'd-' + selectedLead.id ? $_('app.leads.copied') : $_('app.leads.copy')}</button>
          {#if statusFilter === 'suggested'}
            <button class="btn ghost sm" type="button" onclick={() => startRewrite(selectedLead.id, 'dm')}>{$_('app.leads.rewrite')}</button>
          {/if}
        </div>
        {#if rewriteTarget === `${selectedLead.id}:dm`}
          <form class="rewrite-form" onsubmit={(e) => { e.preventDefault(); submitRewrite(selectedLead.id, 'dm'); }}>
            <input class="rewrite-input" type="text" bind:value={rewriteFeedback} placeholder={$_('app.leads.feedbackPh')} disabled={rewriting} />
            <button class="btn primary sm" type="submit" disabled={rewriting || !rewriteFeedback.trim()}>
              {#if rewriting}<span class="spin"></span>{:else}{$_('app.leads.rewriteGo')}{/if}
            </button>
            <button class="btn ghost sm" type="button" onclick={cancelRewrite}>{$_('app.leads.rewriteCancel')}</button>
          </form>
        {/if}
      </div>
    {/if}

    </div>

    <!-- Status actions — pinned so the decision is always reachable -->
    <div class="lead-actions">
      {#if selectedLead.status === 'suggested'}
        <form method="POST" action="?/markDone" use:enhance={withBusy}>
          <input type="hidden" name="id" value={selectedLead.id} />
          <button class="btn primary sm" type="submit" disabled={busy}><Check size={14} />{$_('app.leads.markDone')}</button>
        </form>
        <form method="POST" action="?/dismiss" use:enhance={withBusy}>
          <input type="hidden" name="id" value={selectedLead.id} />
          <button class="btn ghost sm" type="submit" disabled={busy}>{$_('app.leads.dismiss')}</button>
        </form>
        <form method="POST" action="?/suppress" use:enhance={withBusy}>
          <input type="hidden" name="id" value={selectedLead.id} />
          <button class="btn ghost sm" type="submit" disabled={busy}>{$_('app.leads.dontContact')}</button>
        </form>
      {:else}
        <form method="POST" action="?/restore" use:enhance={withBusy}>
          <input type="hidden" name="id" value={selectedLead.id} />
          <button class="btn ghost sm" type="submit" disabled={busy}>{$_('app.leads.restore')}</button>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Capped at three comfortable cards per row (3 × 340 + gaps). */
  .radar-page { width: 100%; min-width: 0; max-width: 1080px; margin: 0 auto; padding: 0; box-sizing: border-box; overflow-x: hidden; }

  /* Inline dropdown filters + global search — controls come from the global .fld system
     (src/app.css) so they follow the theme. */
  .filter-row { --control-h: 34px; display: flex; flex-wrap: wrap; gap: 10px 12px; margin: 0 0 20px; }
  /* Dropdowns stay narrow; the search field takes whatever is left. */
  .filter-row .fld { flex: 0 1 140px; min-width: 0; gap: 4px; }
  .filter-row :global(.lb) { font-size: 11px; }
  .filter-row :global(select), .filter-row :global(input) { font-size: 13px; border-radius: 10px; }
  .filter-row .fld.is-search { flex: 1 1 240px; min-width: 180px; }
  /* WebKit renders input[type=search] as a native pill with its own decorations — opt out so it
     sits in the row exactly like the selects. */
  .filter-row .fld.is-search input { appearance: none; -webkit-appearance: none; }
  .filter-row .fld.is-search input::-webkit-search-decoration,
  .filter-row .fld.is-search input::-webkit-search-cancel-button,
  .filter-row .fld.is-search input::-webkit-search-results-button { -webkit-appearance: none; }

  .section { margin-top: 20px; }

  /* Lead cards — the post text is the card: meta shrinks to a thin header/footer around it. */
  .leads-grid {
    list-style: none; margin: 0; padding: 0;
    display: grid; gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  }
  .lead-card {
    width: 100%; height: 100%; text-align: left; cursor: pointer;
    display: flex; flex-direction: column; gap: 8px;
    background: var(--paper); border: 1px solid var(--line); border-radius: 14px;
    padding: 12px 14px 10px;
    font: inherit; color: var(--ink);
    transition: border-color 0.2s var(--ease, ease), box-shadow 0.2s var(--ease, ease), transform 0.2s var(--ease, ease);
  }
  .lead-card:hover {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
    box-shadow: 0 10px 28px -14px rgba(var(--accent-rgb), 0.4);
    transform: translateY(-1px);
  }
  .lead-card-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  /* Icon-only circular platform badge — the name lives in the tooltip/aria-label. */
  .plat-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; flex-shrink: 0;
    border-radius: 50%; color: #fff;
  }
  .plat-badge.sm { width: 18px; height: 18px; }
  .plat-badge svg { flex-shrink: 0; }
  .lead-source {
    font-size: 11.5px; font-weight: 600; color: var(--ink-faint);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Buying intent: the only chip on the card that changes the queue order, so the one that is
     allowed to carry colour. Someone asking right now reads as green at a glance. */
  .intent {
    flex-shrink: 0; font-size: 10.5px; font-weight: 650; letter-spacing: 0.01em;
    padding: 1px 6px; border-radius: 999px; white-space: nowrap;
    background: color-mix(in srgb, var(--ink-faint) 12%, transparent); color: var(--ink-faint);
  }
  .intent[data-intent='seeking_now'] { background: color-mix(in srgb, #16a34a 16%, transparent); color: #15803d; }
  .intent[data-intent='comparing'] { background: color-mix(in srgb, #f59e0b 18%, transparent); color: #b45309; }
  /* L'esito: l'unico numero della card che dice cosa è successo DOPO, invece di prevedere. */
  .outcome {
    font-size: 10.5px; font-weight: 650; white-space: nowrap;
    padding: 1px 6px; border-radius: 999px;
    background: color-mix(in srgb, #16a34a 14%, transparent); color: #15803d;
  }
  .outcome.bad { background: color-mix(in srgb, #dc2626 14%, transparent); color: #b91c1c; }
  .lead-time { margin-left: auto; flex-shrink: 0; font-size: 11px; color: var(--ink-faint); }
  .lead-user { font-size: 12px; font-weight: 600; color: var(--ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* The post: title first, body under it — everything else is secondary. */
  .lead-card-title {
    font-size: 15px; font-weight: 650; line-height: 1.35; letter-spacing: -0.01em; color: var(--ink);
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden; word-break: break-word;
  }
  .lead-card-snippet {
    margin: 0; font-size: 12.5px; color: var(--ink-soft); line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical;
    overflow: hidden; word-break: break-word;
  }
  .lead-card-foot {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-top: auto; padding-top: 8px; border-top: 1px solid var(--line);
    min-width: 0;
  }
  .lead-chips { display: flex; align-items: center; gap: 4px; margin-left: auto; flex-shrink: 0; }
  .chip {
    display: inline-flex; align-items: center;
    font-size: 11px; line-height: 1; padding: 4px 6px; border-radius: 999px;
    background: var(--paper-2); border: 1px solid var(--line); color: var(--ink-soft);
  }

  /* Right drawer: full post + comment + DM, overlaid on the grid. Portaled to <body>, so these
     z-indexes sit above the shell (top bar 30, tab bar 80) — only dialogs rank higher. */
  .drawer-backdrop {
    position: fixed; inset: 0; z-index: 110;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(2px);
  }
  .lead-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 111;
    width: min(480px, 100%);
    box-sizing: border-box;
    display: flex; flex-direction: column;
    background: var(--paper);
    border-left: 1px solid var(--line);
    box-shadow: -32px 0 80px -24px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  /* Header: who + where + how relevant, pinned above the scroll. */
  .drawer-head {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border-bottom: 1px solid var(--line);
    background: var(--paper);
  }
  .dh-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .dh-source {
    font-size: 13px; font-weight: 700; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dh-sub { font-size: 11px; color: var(--ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .drawer-body {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px;
    padding: 14px 16px 18px;
  }
  .drawer-close {
    flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--line); background: var(--paper-2);
    color: var(--ink-soft); cursor: pointer;
    transition: background 0.2s var(--ease, ease), color 0.2s var(--ease, ease);
  }
  .drawer-close:hover { background: var(--paper-3); color: var(--ink); }

  /* Relevance ring */
  .rel { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--ink-soft); }
  .rel svg { flex-shrink: 0; }
  .rel .track { fill: none; stroke: var(--line); stroke-width: 3; }
  .rel .arc { fill: none; stroke-width: 3; stroke-linecap: round; }
  .rel[data-tone='good'] .arc { stroke: #3d9a5f; }
  .rel[data-tone='mid'] .arc { stroke: #d4a017; }
  .rel[data-tone='low'] .arc { stroke: #e0564a; }
  .drawer-head .rel { margin-left: auto; }

  /* Title: the conversation the lead is about */
  .lead-title {
    display: block;
    font-size: 15px; font-weight: 650; color: var(--ink); text-decoration: none;
    line-height: 1.4; letter-spacing: -0.01em;
  }
  .lead-title:hover { text-decoration: underline; }

  /* Full post content */
  .lead-snippet-full {
    font-size: 13px; color: var(--ink-soft); line-height: 1.55; margin: 8px 0 0;
    white-space: pre-wrap; word-break: break-word;
  }

  /* Blocks: the post, then the drafted comment and DM — each labelled so it's obvious
     which text goes where. */
  .sugg-block {
    background: var(--paper-2, #f9f9f9); border-radius: 12px; padding: 12px 14px;
    border: 1px solid var(--line, #ededef);
  }
  .sugg-block.post-block { background: transparent; }
  .sugg-block.dm-block { background: rgba(var(--accent-rgb), 0.04); border-color: rgba(var(--accent-rgb), 0.15); }
  .sugg-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .head-link {
    margin-left: auto; display: inline-flex; align-items: center; gap: 3px;
    font-size: 11px; font-weight: 600; color: var(--ink-faint); text-decoration: none;
  }
  .head-link:hover { color: var(--accent); }
  .sugg-icon { display: inline-flex; color: var(--ink-soft); }
  .sugg-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
  .sugg-text { font-size: 13.5px; color: var(--ink); margin: 0; line-height: 1.55; white-space: pre-wrap; }
  .sugg-text.rewritten { border-left: 3px solid var(--accent, #7c5cff); padding-left: 10px; }
  .sugg-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }

  /* AI rewrite form */
  .rewrite-form {
    display: flex; gap: 6px; align-items: center; margin-top: 8px;
    animation: rewrite-in 0.2s var(--ease, cubic-bezier(0.22, 1, 0.36, 1)) both;
  }
  @keyframes rewrite-in { from { opacity: 0; transform: translateY(-4px); } }
  .rewrite-input {
    flex: 1; min-width: 0; border: 1.5px solid var(--line, #ededef); border-radius: 10px;
    padding: 8px 12px; font: inherit; font-size: 13px; background: var(--paper, #fff); color: var(--ink, #1d1d1f);
    transition: border-color 0.2s var(--ease, ease), box-shadow 0.2s var(--ease, ease);
  }
  .rewrite-input:focus { outline: none; border-color: var(--accent, #c485fe); box-shadow: 0 0 0 3px rgba(var(--accent-rgb, 196, 133, 254), 0.12); }

  /* Status actions — pinned footer */
  .lead-actions {
    flex-shrink: 0; display: flex; gap: 8px; flex-wrap: wrap;
    padding: 12px 16px; border-top: 1px solid var(--line); background: var(--paper);
  }

  .empty { font-size: 14px; color: var(--ink-faint); text-align: center; padding: 24px 0; }

  /* Buttons */
  .btn { font-size: 13px; font-weight: 600; border-radius: 10px; padding: 8px 16px; cursor: pointer; border: 1px solid transparent; line-height: 1; display: inline-flex; align-items: center; gap: 5px; }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .btn.ghost { background: transparent; color: var(--ink-soft); border-color: var(--line); }
  .btn.sm { font-size: 12px; padding: 6px 12px; border-radius: 8px; }
  .dm-btn { background: #111; }

  .spin { width: 12px; height: 12px; border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff; border-radius: 50%; animation: spin-rew 0.8s linear infinite; display: inline-block; }
  @keyframes spin-rew { to { transform: rotate(360deg); } }

  @container workbench (max-width: 1020px) {
    .radar-page { padding: 0; overflow-x: hidden; }
    .filter-row .fld { flex: 1 1 45%; }
    .filter-row .fld.is-search { flex: 1 1 100%; }
    .leads-grid { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
    .lead-card { padding: 12px 12px 10px; }
    .sugg-actions { flex-direction: column; }
    .sugg-actions .btn { width: 100%; text-align: center; justify-content: center; }
    .rewrite-form { flex-wrap: wrap; }
    .rewrite-input { width: 100%; }
    .lead-title { word-break: break-word; }
    .sugg-text { word-break: break-word; }
  }
</style>
