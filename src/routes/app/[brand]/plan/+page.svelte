<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { pageQuery } from '$lib/page-query';
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { siInstagram, siTiktok, siFacebook, siX, siThreads, siYoutube, siBluesky, siReddit } from 'simple-icons';
  import PageHead from '$lib/components/PageHead.svelte';
  import GrowthReadiness from '$lib/components/GrowthReadiness.svelte';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';

  let { data, form } = $props();
  // I parametri della pagina, non quelli dell'URL: nella modal l'URL non cambia.
  const q = pageQuery();

  // Ponte dal badge "angolo" di una card contenuto (/plan?row=…): scorre e illumina quella riga.
  let highlightRow = $state<string | null>(null);
  onMount(() => {
    const row = q('row');
    if (!row) return;
    highlightRow = row;
    requestAnimationFrame(() => {
      document.querySelector(`[data-row="${CSS.escape(row)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setTimeout(() => (highlightRow = null), 4000);
  });

  const PMETA: Record<string, { l: string; g: string; bg: string }> = {
    instagram: { l: 'Instagram', g: 'IG', bg: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)' },
    tiktok: { l: 'TikTok', g: 'TT', bg: '#111' },
    facebook: { l: 'Facebook', g: 'f', bg: '#1877f2' },
    linkedin: { l: 'LinkedIn', g: 'in', bg: '#0a66c2' },
    x: { l: 'X', g: 'X', bg: '#0a0a0a' },
    threads: { l: 'Threads', g: '@', bg: '#000' },
    youtube: { l: 'YouTube', g: 'YT', bg: '#ff0000' },
    bluesky: { l: 'Bluesky', g: 'BS', bg: '#0285ff' },
    reddit: { l: 'Reddit', g: 'RD', bg: '#ff4500' }
  };
  const ICONS: Record<string, { path: string; hex: string }> = {
    instagram: siInstagram, tiktok: siTiktok, facebook: siFacebook, x: siX, threads: siThreads, youtube: siYoutube, bluesky: siBluesky, reddit: siReddit
  };

  // Valori canonici dei giorni: sono quelli che planner e scheduler sanno leggere.
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // I formati veri del motore (enum ContentFormat). I valori legacy delle righe vecchie
  // ('reel', 'story'…) si vedono comunque, via l'opzione di ripiego nella select qui sotto.
  const FORMATS = ['single_image', 'carousel', 'text_post', 'link_post', 'video'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let strategy = $state<any>(null);
  $effect(() => {
    strategy = data.draft ? JSON.parse(JSON.stringify(data.draft.strategy)) : null;
  });

  // Il `?? 0` serve solo al tipo: questi punti si renderizzano solo quando un piano esiste.
  const wk = $derived(data.weekIdx ?? 0);

  const unplannedWeeks = $derived.by(() => {
    if (!data.weeks?.length || !data.weekHasContent?.length) return [];
    const start = data.currentWeekIdx ?? 0;
    return data.weeks.filter((w) => w.index >= start && !data.weekHasContent[w.index]);
  });

  let busy = $state('');
  const working = (name: string) => () => {
    busy = name;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = '';
    };
  };

  function addRow() {
    if (!strategy) return;
    strategy.seeds = [
      ...strategy.seeds,
      {
        platform: data.platforms[0] ?? 'instagram', format: 'post', media: 'image', pillar: '',
        day: 'Monday', time: '09:00', product: '', person: '', angle: '', subject: '', setting: '', props: ''
      }
    ];
    editing = strategy.seeds.length - 1;
  }
  function removeRow(i: number) {
    strategy.seeds = strategy.seeds.filter((_: unknown, idx: number) => idx !== i);
    if (editing === i) editing = null;
  }

  let editing = $state<number | null>(null);
  let delPostId = $state<string | null>(null);
  let editingMix = $state<Array<{ type: string; count: number }> | null>(null);
  let mixEditing = $state(false);

  // La tabella unisce due cose: i post già prodotti (in qualunque stato) e i seed ancora da produrre.
  const dayIdx = (d: string) => { const i = DAYS.indexOf(d); return i < 0 ? 7 : i; };
  function slotParts(slot: string | null): { day: string; time: string } {
    const [day = '', time = ''] = String(slot ?? '').split(' ');
    return { day, time };
  }
  const shortDay = (day: string) => (DAYS.includes(day) ? $_('weekPlan.days.' + day).slice(0, 3) : day.slice(0, 3));

  type Row =
    | { kind: 'post'; sort: number; id: string; planRowId: string; day: string; time: string; platform: string; pillar: string; format: string; text: string; status: string }
    | { kind: 'seed'; sort: number; day: string; i: number };

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    for (const p of data.weekPosts ?? []) {
      const { day, time } = slotParts(p.slot as string | null);
      out.push({
        kind: 'post',
        sort: dayIdx(day) * 10000 + Number(String(time).replace(':', '') || 0),
        id: String(p.id),
        planRowId: String(p.plan_row_id ?? ''),
        day, time,
        platform: String(p.platform ?? ''),
        pillar: String(p.pillar ?? ''),
        format: String(p.format ?? '') || (String(p.content_type ?? '').includes('video') ? 'video' : 'single_image'),
        text: String(p.caption ?? '').slice(0, 110),
        status: p.published_at ? 'published' : String(p.status ?? 'pending_user')
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [i, s] of ((strategy?.seeds ?? []) as any[]).entries()) {
      out.push({ kind: 'seed', sort: dayIdx(s.day) * 10000 + Number(String(s.time).replace(':', '') || 0), day: String(s.day ?? ''), i });
    }
    return out.sort((a, b) => a.sort - b.sort);
  });

  // Le righe sono già ordinate per orario dalla chiave `sort`: ogni gruppo si legge dall'alto.
  const grouped = $derived.by(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const d = DAYS.includes(r.day) ? r.day : 'Other';
      const arr = map.get(d) ?? [];
      arr.push(r);
      map.set(d, arr);
    }
    return [...DAYS, 'Other'].filter((d) => map.has(d)).map((d) => ({ day: d, rows: map.get(d)! }));
  });

  // Legenda "Scopo": colore stabile per pillar, assegnato all'ordine di prima comparsa.
  const PILLAR_COLORS = ['#7c5cff', '#1f8a4c', '#c2410c', '#0a66c2', '#b91c1c', '#0f766e', '#a16207'];
  const pillars = $derived.by(() => {
    const seen: string[] = [];
    const add = (p: string) => { if (p && !seen.includes(p)) seen.push(p); };
    for (const p of data.weekPosts ?? []) add(String(p.pillar ?? ''));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of (strategy?.seeds ?? []) as any[]) add(String(s.pillar ?? ''));
    return seen;
  });
  const pillarColor = (p: string) => PILLAR_COLORS[Math.max(0, pillars.indexOf(p)) % PILLAR_COLORS.length];

  // Comandano i pesi di piattaforma della fase GTM; in mancanza, le quote della settimana editoriale.
  const mixChips = $derived.by((): Array<{ platform: string; label: string }> => {
    const w = data.gtmPhase?.weights ?? [];
    if (w.length) return w.map((x: { platform: string; percent: number }) => ({ platform: String(x.platform), label: `${x.percent}%` }));
    const mix = data.inheritance?.mix ?? [];
    return mix.map((m: { platform: string; share: string }) => ({ platform: String(m.platform), label: String(m.share) }));
  });

  const mixSummary = $derived.by(() => {
    const counts = new Map<string, number>();
    const bump = (k: string) => { if (k) counts.set(k, (counts.get(k) ?? 0) + 1); };
    for (const p of data.weekPosts ?? []) bump(String(p.platform ?? '').toLowerCase());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of (strategy?.seeds ?? []) as any[]) bump(String(s.platform ?? '').toLowerCase());
    return [...counts.entries()].map(([p, n]) => `${n} ${PMETA[p]?.l ?? p}`).join(' · ');
  });
  const totalRows = $derived((data.weekPosts?.length ?? 0) + (strategy?.seeds?.length ?? 0));
  const platformsInvolved = $derived.by(() => {
    const set = new Set<string>();
    for (const p of data.weekPosts ?? []) if (p.platform) set.add(String(p.platform).toLowerCase());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of (strategy?.seeds ?? []) as any[]) if (s.platform) set.add(String(s.platform).toLowerCase());
    return set.size;
  });

  let producing = $state(false);
  let producingRow = $state<number | null>(null);
  let produceProgress = $state('');
  let produceError = $state('');
  let produceExhausted = $state(false);
  let producedCount = $state(0);

  // Prima si salvano le modifiche alle righe: la produzione deve seguire ciò che è a schermo.
  async function saveDraft() {
    if (!data.draft || !strategy) return;
    const fd = new FormData();
    fd.set('draft_id', data.draft.id);
    fd.set('seeds', JSON.stringify(strategy));
    await fetch('?/save', { method: 'POST', body: fd });
  }

  async function streamGenerate(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/app/${$page.params.brand}/content/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok || !res.body) { produceError = $_('weekPlan.produceFailed'); return false; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done = false;
    while (!done) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'progress') produceProgress = msg.message;
        else if (msg.type === 'post') producedCount += 1;
        else if (msg.type === 'error') {
          // Il server manda un `code`, la pagina sceglie la stringa: `msg.message` grezzo sarebbe
          // inglese crudo in tutte e quattro le lingue.
          produceExhausted = msg.code === 'credits_exhausted';
          produceError = produceExhausted
            ? $_('app.content.single.creditsExhausted')
            : msg.code === 'posts_quota'
              ? $_('app.content.single.quotaFull')
              : msg.message;
        }
        else if (msg.type === 'done') done = true;
      }
    }
    return !produceError;
  }

  async function produce() {
    if (!data.draft || !strategy?.seeds?.length) return;
    if (data.growth && !data.growth.ready) {
      produceError = $_('app.growthReadiness.ledeBlocked');
      produceExhausted = false;
      return;
    }
    producing = true;
    produceError = '';
    produceExhausted = false;
    producedCount = 0;
    produceProgress = $_('weekPlan.producing');
    try {
      await saveDraft();
      if (await streamGenerate({ draftPlanId: data.draft.id })) {
        await goto(`/app/${$page.params.brand}/calendar`);
        return;
      }
    } catch {
      if (!produceError) produceError = $_('weekPlan.produceFailed');
    }
    producing = false;
  }

  async function produceRow(i: number) {
    if (!data.draft || producing || producingRow != null) return;
    if (data.growth && !data.growth.ready) {
      produceError = $_('app.growthReadiness.ledeBlocked');
      produceExhausted = false;
      return;
    }
    producingRow = i;
    produceError = '';
    produceExhausted = false;
    producedCount = 0;
    produceProgress = $_('weekPlan.producing');
    try {
      await saveDraft();
      if (await streamGenerate({ draftPlanId: data.draft.id, rowIndex: i })) await invalidateAll();
    } catch {
      if (!produceError) produceError = $_('weekPlan.produceFailed');
    }
    producingRow = null;
  }
</script>

<svelte:head><title>Anomalia — {$_('weekPlan.title')}</title></svelte:head>

<div class="content">
  <PageHead
    title={$_('weekPlan.title')}
    subtitle={!data.editorialDoc ? $_('weekPlan.subtitle') : null}
  />

  {#if data.growth?.checks?.length}
    <GrowthReadiness checks={data.growth.checks} compact={data.growth.ready} />
  {/if}

  {#if !data.editorialDoc}
    <p class="pe-lead">{$_('weekPlan.lead')}</p>
  {/if}
  {#if totalRows}
    <div class="pe-badges">
      <span class="pe-badge"><b>{totalRows}</b> {$_('weekPlan.badges.ideas')}</span>
      <span class="pe-badge"><b>{platformsInvolved}</b> {$_('weekPlan.badges.platforms')}</span>
    </div>
  {/if}

  {#if data.editorialDoc?.strategy}
    <p class="pe-strategy">{data.editorialDoc.strategy}</p>
  {/if}

  {#if data.gtmPhase || data.inheritance}
    <div class="inherit">
      <span class="inherit-main">
        {#if data.gtmPhase}
          <span class="inherit-label">{$_('weekPlan.inheritsGtm', { values: { n: data.gtmPhase.index + 1 } })}</span>
          {#if data.gtmPhase.name}<span class="inherit-arrow">→</span><b class="inherit-theme">{data.gtmPhase.name}</b>{/if}
        {:else if data.inheritance}
          <span class="inherit-label">{$_('weekPlan.inherits', { values: { n: data.inheritance.week + 1 } })}</span>
          {#if data.inheritance.theme}<span class="inherit-arrow">→</span><b class="inherit-theme">{data.inheritance.theme}</b>{/if}
        {/if}
      </span>
      {#if mixChips.length}
        <span class="inherit-mix">
          {#each mixChips as c (c.platform)}
            {@const ic = ICONS[c.platform]}
            <span class="mix-chip">
              {#if ic}<svg class="mix-ic" viewBox="0 0 24 24" fill={`#${ic.hex}`}><path d={ic.path} /></svg>
              {:else}<span class="mix-glyph" style={`background:${PMETA[c.platform]?.bg ?? '#999'}`}>{PMETA[c.platform]?.g ?? '?'}</span>{/if}
              {PMETA[c.platform]?.l ?? c.platform} {c.label}
            </span>
          {/each}
        </span>
      {/if}
    </div>
  {/if}

  {#if data.weeks?.length}
    {@const totalW = data.weeks.length}
    <div class="week-timeline">
      <div class="tl-bar-wrap">
        <div class="tl-bar-track">
          {#each data.weeks as w (w.index)}
            {@const left = (w.index / totalW) * 100}
            {@const width = (1 / totalW) * 100}
            <button
              type="button"
              class="tl-seg"
              class:sel={w.index === data.weekIdx}
              data-s={w.index < (data.currentWeekIdx ?? 0) ? 'done' : w.index === data.currentWeekIdx ? 'now' : 'next'}
              style={`left:${left}%;width:${width}%`}
              onclick={() => goto(`?week=${w.index}`)}
              title={w.theme ?? $_('weekPlan.weekNav.week', { values: { n: w.index + 1 } })}
            >
              <span class="tl-seg-name">{$_('weekPlan.weekNav.week', { values: { n: w.index + 1 } })}</span>
            </button>
          {/each}
          {#if data.currentWeekIdx != null}
            <div class="tl-now" style={`left:${((data.currentWeekIdx + 0.5) / totalW) * 100}%`}>
              <span class="tl-now-label">{$_('weekPlan.weekNav.now')}</span>
            </div>
          {/if}
        </div>
        <div class="tl-ticks">
          {#each data.weeks as w (w.index)}
            <span class="tl-tick" style={`left:${((w.index + 0.5) / totalW) * 100}%`}>{w.theme ?? ''}</span>
          {/each}
        </div>
      </div>
    </div>

    {#if unplannedWeeks.length}
      <section class="unplanned">
        <span class="unplanned-h">{$_('weekPlan.unplanned.title')}</span>
        <div class="unplanned-list">
          {#each unplannedWeeks as uw (uw.index)}
            <button
              type="button"
              class="unplanned-chip"
              class:current={uw.index === data.currentWeekIdx}
              onclick={() => goto(`?week=${uw.index}`)}
            >
              <span class="uc-n">{$_('weekPlan.weekNav.week', { values: { n: uw.index + 1 } })}</span>
              {#if uw.theme}<span class="uc-th">{uw.theme}</span>{/if}
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.editorialDoc?.weeks?.[data.weekIdx ?? 0]}
      {@const sw = data.editorialDoc.weeks[data.weekIdx ?? 0]}
      <section class="wk-detail">
        <div class="wk-detail-head">
          <span class="wk-detail-n">{$_('editorialPlan.week', { values: { n: (data.weekIdx ?? 0) + 1 } })}</span>
          {#if sw.week_start}<span class="wk-detail-date">{new Date(`${sw.week_start}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>{/if}
          {#if sw.content_mix?.length}
            <span class="wk-detail-count">{$_('editorialPlan.postCount', { values: { count: sw.content_mix.reduce((a, m) => a + (m.count || 0), 0) } })}</span>
          {/if}
        </div>
        {#if sw.theme}<div class="wk-detail-theme">{sw.theme}</div>{/if}
        {#if sw.focus}<p class="wk-detail-focus">{sw.focus}</p>{/if}
        {#if sw.content_mix?.length}
          {#if mixEditing && editingMix !== null}
            <form method="POST" action="?/saveMix" use:enhance={working('saveMix')}>
              <input type="hidden" name="plan_id" value={data.editorialDoc?.id ?? ''} />
              <input type="hidden" name="week" value={wk} />
              <input type="hidden" name="mix" value={JSON.stringify(editingMix)} />
              <div class="mix-editor">
                <div class="mix-rows">
                  {#each editingMix as m, i (i)}
                    {@const total = editingMix.reduce((a, x) => a + (Number(x.count) || 0), 0)}
                    {@const pct = total > 0 ? Math.round((Number(m.count) || 0) / total * 100) : 0}
                    <div class="mix-row">
                      <input
                        type="text"
                        class="mix-type-input"
                        placeholder={$_('editorialPlan.contentType', { default: 'Content type' })}
                        value={m.type}
                        onchange={(e) => { m.type = (e.target as HTMLInputElement).value; editingMix = editingMix; }}
                      />
                      <input
                        type="number"
                        class="mix-count-input"
                        min="0"
                        value={m.count}
                        onchange={(e) => { m.count = Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)); editingMix = editingMix; }}
                      />
                      <span class="mix-pct">{pct}%</span>
                      <button
                        type="button"
                        class="mix-remove"
                        onclick={() => { if (editingMix) editingMix = editingMix.filter((_, idx) => idx !== i); }}
                        title={$_('editorialPlan.removeType', { default: 'Remove' })}
                      >✕</button>
                    </div>
                  {/each}
                </div>
                <button
                  type="button"
                  class="mix-add-btn"
                  onclick={() => { if (editingMix) editingMix = [...editingMix, { type: '', count: 1 }]; }}
                >
                  + {$_('editorialPlan.addType', { default: 'Add type' })}
                </button>
                <div class="mix-actions">
                  <button type="submit" class="btn-primary" disabled={busy === 'saveMix'}>
                    {busy === 'saveMix' ? $_('editorialPlan.saving', { default: 'Saving...' }) : $_('editorialPlan.saveMix', { default: 'Save mix' })}
                  </button>
                  <button
                    type="button"
                    class="btn-ghost"
                    onclick={() => { mixEditing = false; editingMix = null; }}
                    disabled={busy === 'saveMix'}
                  >
                    {$_('editorialPlan.cancel', { default: 'Cancel' })}
                  </button>
                </div>
              </div>
            </form>
          {:else}
            <div class="wk-detail-mix">
              {#each sw.content_mix as m (m.type)}<span class="wk-mixchip">{m.count}× {m.type}</span>{/each}
              {#if data.currentWeekIdx == null || wk >= data.currentWeekIdx}
                <button
                  type="button"
                  class="wk-mixchip-edit"
                  onclick={() => { editingMix = sw.content_mix.map(m => ({ ...m })); mixEditing = true; }}
                  title={$_('editorialPlan.editMix', { default: 'Edit mix' })}
                >
                  ✎
                </button>
              {/if}
            </div>
          {/if}
        {/if}
        {#if sw.rationale}
          <div class="wk-detail-why">
            <span class="wk-detail-label">{$_('editorialPlan.why')}</span>
            <p class="wk-detail-text">{sw.rationale}</p>
          </div>
        {/if}
        {#if sw.brief}
          <p class="wk-detail-brief"><b>{$_('editorialPlan.briefLabel')}:</b> {sw.brief}</p>
        {/if}
      </section>
    {/if}
  {/if}

  {#if data.quota.remaining <= 0}
    <div class="banner warn">{$_('weekPlan.quotaBanner')}</div>
  {/if}
  {#if form?.error === 'week_has_posts'}
    {@const dup = form as unknown as { week?: number; produced?: number }}
    <div class="banner warn">{$_('weekPlan.duplicate', { values: { n: (Number(dup.week) || 0) + 1, c: dup.produced } })}</div>
  {:else if form?.error}
    <p class="err">{$_('weekPlan.actionFailed')}</p>
  {/if}

  {#if !strategy && !data.weekPosts?.length}
    {#if data.currentWeekIdx != null && wk < data.currentWeekIdx}
      <section class="empty">
        <h3>{$_('weekPlan.past.title', { values: { n: wk + 1 } })}</h3>
        <p>{$_('weekPlan.past.body')}</p>
      </section>
    {:else if data.inheritance}
      <!-- Si pianificano le righe di QUESTA settimana, non ciecamente quella corrente. -->
      <section class="empty">
        <h3>{$_('weekPlan.future.title', { values: { n: wk + 1 } })}</h3>
        {#if data.inheritance.theme}<p class="future-theme">{data.inheritance.theme}</p>{/if}
        <p>{$_('weekPlan.future.body')}</p>
        <form method="POST" action="?/plan" use:enhance={working('plan')}>
          <input type="hidden" name="week" value={wk} />
          <button class="btn-primary" disabled={busy === 'plan' || data.quota.remaining <= 0}>
            {busy === 'plan' ? $_('weekPlan.planning') : $_('weekPlan.future.cta', { values: { n: wk + 1 } })}
          </button>
        </form>
      </section>
    {:else}
      <section class="empty">
        {#if !data.hasStrategy}
          <!-- Il piano si costruisce DALLA strategia: senza, si manda prima lì. -->
          <img class="empty-hero" src="/plan-hero-plan.webp" alt="" />
          <h3>{$_('weekPlan.noStrategy.title')}</h3>
          <p>{$_('weekPlan.noStrategy.body')}</p>
          <a class="btn-primary" style="text-decoration:none; display:inline-block;" href="/app/{$page.params.brand}/editorial">{$_('weekPlan.noStrategy.cta')}</a>
        {:else}
          <h3>{$_('weekPlan.noPlan.title')}</h3>
          <p>{$_('weekPlan.noPlan.body')}</p>
          <form method="POST" action="?/proposeFull" use:enhance={working('proposeFull')}>
            <button class="btn-primary" disabled={busy !== ''}>
              {busy === 'proposeFull' ? $_('weekPlan.noPlan.busy') : $_('weekPlan.noPlan.cta')}
            </button>
          </form>
          <form method="POST" action="?/plan" use:enhance={working('plan')}>
            <button class="btn-ghost" disabled={busy !== '' || data.quota.remaining <= 0}>
              {busy === 'plan' ? $_('weekPlan.planning') : $_('weekPlan.empty.cta')}
            </button>
          </form>
        {/if}
      </section>
    {/if}
  {:else}
    {#if pillars.length}
      <div class="legend">
        <span class="legend-l">{$_('weekPlan.col.pillar')}:</span>
        {#each pillars as p (p)}
          <span class="legend-item"><span class="legend-dot" style={`background:${pillarColor(p)}`}></span>{p}</span>
        {/each}
      </div>
    {/if}

    <div class="wtable">
      <div class="wt-row wt-head">
        <span>{$_('weekPlan.col.when')}</span>
        <span>{$_('weekPlan.col.platform')}</span>
        <span>{$_('weekPlan.col.pillar')}</span>
        <span>{$_('weekPlan.col.format')}</span>
        <span>{$_('weekPlan.col.angle')}</span>
        <span>{$_('weekPlan.col.status')}</span>
        <span class="ta-r">{$_('weekPlan.col.actions')}</span>
      </div>

      {#each grouped as g (g.day)}
        <div class="wt-day">{g.day === 'Other' ? $_('weekPlan.unscheduled') : $_('weekPlan.days.' + g.day)}</div>
        {#each g.rows as r (r.kind === 'post' ? `p${r.id}` : `s${r.i}`)}
        {#if r.kind === 'post'}
          {@const ic = ICONS[r.platform]}
          <div class="wt-row" class:row-hl={r.planRowId && r.planRowId === highlightRow} data-row={r.planRowId}>
            <span class="wt-when">{shortDay(r.day)} {r.time}</span>
            <span class="wt-plat">
              {#if ic}<svg class="picon" viewBox="0 0 24 24" fill={`#${ic.hex}`}><path d={ic.path} /></svg>
              {:else}<span class="picon-badge" style={`background:${PMETA[r.platform]?.bg ?? '#999'}`}>{PMETA[r.platform]?.g ?? '?'}</span>{/if}
              {PMETA[r.platform]?.l ?? r.platform}
            </span>
            <span>{#if r.pillar}<span class="pillar-chip" style={`color:${pillarColor(r.pillar)};background:${pillarColor(r.pillar)}1a`}>● {r.pillar}</span>{/if}</span>
            <span class="wt-fmt">{r.format}</span>
            <span class="wt-text">{r.text}</span>
            <span><span class="st-chip" data-s={r.status}><span class="st-dot"></span>{$_('weekPlan.status.' + r.status)}</span></span>
            <span class="wt-actions">
              {#if r.status === 'failed'}
                <a class="mini-btn retry" href={`/app/${$page.params.brand}/calendar${r.planRowId ? `?row=${r.planRowId}` : ''}`}>↻ {$_('weekPlan.retry')}</a>
              {:else}
                <a class="mini-btn" href={`/app/${$page.params.brand}/calendar${r.planRowId ? `?row=${r.planRowId}` : ''}`}>👁 {$_('weekPlan.seeContent')}</a>
              {/if}
              <a class="icon-mini" title={$_('weekPlan.edit')} href={`/app/${$page.params.brand}/calendar${r.planRowId ? `?row=${r.planRowId}` : ''}`}>✎</a>
              {#if delPostId === r.id}
                <form method="POST" action="?/deletePost" use:enhance={working('delpost')}>
                  <input type="hidden" name="id" value={r.id} />
                  <button class="icon-mini del confirm" type="submit" title={$_('weekPlan.deletePost')} disabled={busy !== ''}>✓</button>
                </form>
                <button type="button" class="icon-mini" onclick={() => (delPostId = null)} title={$_('history.cancel')}>×</button>
              {:else}
                <button type="button" class="icon-mini del" onclick={() => (delPostId = r.id)} title={$_('weekPlan.deletePost')} aria-label={$_('weekPlan.deletePost')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              {/if}
            </span>
          </div>
        {:else}
          {@const s = strategy.seeds[r.i]}
          {#if s}
            {@const k = (s.platform ?? '').toLowerCase()}
            {@const ic = ICONS[k]}
            <div class="wt-row" class:editing={editing === r.i} class:row-hl={s.id && s.id === highlightRow} data-row={s.id}>
              <span class="wt-when">{shortDay(s.day)} {s.time}</span>
              <span class="wt-plat">
                {#if ic}<svg class="picon" viewBox="0 0 24 24" fill={`#${ic.hex}`}><path d={ic.path} /></svg>
                {:else}<span class="picon-badge" style={`background:${PMETA[k]?.bg ?? '#999'}`}>{PMETA[k]?.g ?? '?'}</span>{/if}
                {PMETA[k]?.l ?? s.platform}
              </span>
              <span>{#if s.pillar}<span class="pillar-chip" style={`color:${pillarColor(s.pillar)};background:${pillarColor(s.pillar)}1a`}>● {s.pillar}</span>{/if}</span>
              <span class="wt-fmt">{s.format}</span>
              <span class="wt-text">{s.angle}{#if s.beats?.length}<span class="beats-chip" title={s.beats.map((b: { shows: string }) => b.shows).join(' · ')}>{s.beats.length} ⧉</span>{/if}</span>
              <span><span class="st-chip" data-s="todo"><span class="st-dot"></span>{$_('weekPlan.status.todo')}</span></span>
              <span class="wt-actions">
                <button type="button" class="mini-btn gen" onclick={() => produceRow(r.i)} disabled={producing || producingRow != null || data.quota.remaining <= 0}>
                  {producingRow === r.i ? '…' : '✦ ' + $_('weekPlan.generateRow')}
                </button>
                <button type="button" class="icon-mini" title={$_('weekPlan.edit')} onclick={() => (editing = editing === r.i ? null : r.i)}>✎</button>
                <button type="button" class="icon-mini del" title={$_('weekPlan.removeRow')} onclick={() => removeRow(r.i)}>×</button>
              </span>
            </div>
            {#if editing === r.i}
              <div class="wt-editor">
                <label class="f"><span class="fl">{$_('weekPlan.col.when')}</span>
                  <span class="when">
                    <select bind:value={s.day}>{#each DAYS as d (d)}<option value={d}>{$_('weekPlan.days.' + d)}</option>{/each}</select>
                    <input class="time" type="time" bind:value={s.time} />
                  </span>
                </label>
                <label class="f"><span class="fl">{$_('weekPlan.col.platform')}</span>
                  <select bind:value={s.platform}>{#each data.platforms as p (p)}<option value={p}>{PMETA[p]?.l ?? p}</option>{/each}</select>
                </label>
                <label class="f"><span class="fl">{$_('weekPlan.col.format')}</span>
                  <select bind:value={s.format}>
                    {#each FORMATS as f (f)}<option value={f}>{f}</option>{/each}
                    {#if !FORMATS.includes(s.format)}<option value={s.format}>{s.format}</option>{/if}
                  </select>
                </label>
                <label class="f"><span class="fl">{$_('weekPlan.col.pillar')}</span><input bind:value={s.pillar} placeholder="—" /></label>
                <label class="f wide"><span class="fl">{$_('weekPlan.col.angle')}</span>
                  <textarea rows="2" bind:value={s.angle} placeholder={$_('weekPlan.anglePlaceholder')}></textarea>
                </label>
                <label class="f"><span class="fl">{$_('weekPlan.col.product')}</span><input list="wp-products" bind:value={s.product} placeholder="—" /></label>
                <label class="f"><span class="fl">{$_('weekPlan.col.person')}</span><input list="wp-people" bind:value={s.person} placeholder="—" /></label>
                <label class="f"><span class="fl">{$_('weekPlan.col.subject')}</span><input bind:value={s.subject} placeholder={$_('weekPlan.subjectPlaceholder')} /></label>
                {#if s.format === 'carousel'}
                  <label class="f wide"><span class="fl">{$_('weekPlan.col.beats')}</span>
                    <textarea rows={Math.max(3, (s.beats ?? []).length)} placeholder={$_('weekPlan.beatsPlaceholder')}
                      value={(s.beats ?? []).map((b: { shows: string; thinks: string; says?: string }) => [b.shows, b.thinks, b.says].filter(Boolean).join(' | ')).join('\n')}
                      oninput={(e) => (s.beats = e.currentTarget.value.split('\n').map((line) => {
                        const [shows = '', thinks = '', says = ''] = line.split('|').map((x) => x.trim());
                        return { shows, thinks, ...(says ? { says } : {}) };
                      }).filter((b) => b.shows))}></textarea>
                  </label>
                {/if}
                <label class="f wide"><span class="fl">{$_('weekPlan.col.artDirection')}</span>
                  <textarea rows="2" bind:value={s.art_direction} placeholder="—"></textarea>
                </label>
              </div>
            {/if}
          {/if}
        {/if}
        {/each}
      {/each}

      {#if strategy}
        <button type="button" class="wt-add" onclick={addRow}>{$_('weekPlan.addRow')}</button>
      {/if}
    </div>
    <datalist id="wp-products">{#each data.productNames as p (p)}<option value={p}></option>{/each}</datalist>
    <datalist id="wp-people">{#each data.peopleNames as p (p)}<option value={p}></option>{/each}</datalist>

    {#if mixSummary}
      <p class="mix">
        <b>{$_('weekPlan.mixLabel')}:</b> {mixSummary}
        {#if data.inheritance?.posts}
          {#if totalRows === data.inheritance.posts}
            <span class="mix-ok">✓ {$_('weekPlan.mixOk')}</span>
          {:else}
            <span class="mix-warn">{$_('weekPlan.mixOff', { values: { n: data.inheritance.posts } })}</span>
          {/if}
        {/if}
      </p>
    {/if}

    {#if producing || producingRow != null}
      <div class="producing"><span class="hsp"></span>{produceProgress} {producedCount ? `(${producedCount})` : ''}</div>
    {/if}
    {#if produceError}
      <p class="err">
        {produceError}
        {#if producedCount}{' '}{$_('weekPlan.producedBeforeStop', { values: { n: producedCount } })}{/if}
        {#if produceExhausted}{' '}<UpgradeLink />{/if}
      </p>
    {/if}

    {#if data.weekComplete}
      <!-- Settimana finita: si punta avanti (pianifica la prossima), non a un foglio bianco che
           sembrerebbe "non c'è niente". -->
      <div class="approve-bar done">
        <p class="note">✓ {$_('weekPlan.complete.body', { values: { n: wk + 1 } })}</p>
        <div class="ab-actions">
          {#if wk + 1 < data.weeks.length}
            <button type="button" class="btn-primary" onclick={() => goto(`?week=${wk + 1}`)}>
              {$_('weekPlan.complete.next', { values: { n: wk + 2 } })} →
            </button>
          {:else}
            <a class="btn-primary" href={`/app/${$page.params.brand}/editorial`}>{$_('weekPlan.complete.cycle')}</a>
          {/if}
        </div>
      </div>
    {:else if strategy?.seeds?.length}
      <div class="approve-bar">
        <p class="note">{$_('weekPlan.note')}</p>
        <div class="ab-actions">
          <form method="POST" action="?/plan" use:enhance={working('plan')}>
            <input type="hidden" name="week" value={wk} />
            <button class="btn-ghost" disabled={busy !== '' || producing}>{busy === 'plan' ? $_('weekPlan.planning') : $_('weekPlan.replan') + ' ↻'}</button>
          </form>
          <button
            class="btn-primary"
            onclick={produce}
            disabled={producing || producingRow != null || !strategy.seeds.length || (data.growth && !data.growth.ready)}
          >
            {producing
              ? $_('weekPlan.producingCta')
              : data.growth && !data.growth.ready
                ? $_('app.growthReadiness.blocked', { values: { n: data.growth.blocking.length } })
                : '✓ ' + $_('weekPlan.approve')}
          </button>
        </div>
      </div>
      <div class="under-bar">
        <form method="POST" action="?/save" use:enhance={working('save')}>
          <input type="hidden" name="draft_id" value={data.draft?.id} />
          <input type="hidden" name="seeds" value={JSON.stringify(strategy)} />
          <button class="btn-ghost" disabled={busy !== '' || producing}>{busy === 'save' ? $_('weekPlan.saving') : $_('weekPlan.save')}</button>
        </form>
        <form method="POST" action="?/discard" use:enhance={working('discard')}>
          <input type="hidden" name="draft_id" value={data.draft?.id} />
          <button class="btn-ghost" disabled={busy !== '' || producing}>{$_('weekPlan.discard')}</button>
        </form>
        {#if form?.saved}<span class="saved-note">{$_('weekPlan.saved')}</span>{/if}
      </div>
    {:else if !strategy}
      <!-- Ci sono post che aspettano l'utente: si mostrano col conteggio, invece di un "pianifica
           questa settimana" che duplicherebbe il batch. -->
      <div class="approve-bar">
        <p class="note">{$_('weekPlan.pendingNote', { values: { c: data.pendingCount } })}</p>
        <div class="ab-actions">
          <a class="btn-primary" href={`/app/${$page.params.brand}/calendar`}>{$_('weekPlan.goApprovals')}</a>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>

  .page-head h2 { margin: 0; }
  .page-sub { margin: 6px 0 0; color: var(--ink-soft, #6e6e73); font-size: 14px; }
  .err { color: #c0392b; font-size: 14px; margin-top: 12px; }
  .pe-lead { margin: 14px 0 0; max-width: 72ch; font-size: 14px; line-height: 1.6; color: var(--ink-soft, #6e6e73); }
  .pe-badges { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
  .pe-badge { font-size: 13px; color: var(--ink-soft, #6e6e73); background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e3e3e6); border-radius: 999px; padding: 7px 14px; }
  .pe-badge b { color: var(--ink, #1d1d1f); font-weight: 700; }
  .pe-strategy { margin: 14px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--ink-soft, #6e6e73); }
  .banner.warn { margin-top: 16px; padding: 12px 16px; border-radius: 12px; font-size: 13.5px;
    background: #fff7e6; border: 1px solid #f0d9a8; color: #8a6d1a; }

  .inherit { margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; font-size: 13.5px; }
  .inherit-main { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .inherit-label { font-weight: 700; color: var(--accent, #7c5cff); white-space: nowrap; }
  .inherit-arrow { color: var(--accent, #7c5cff); opacity: 0.7; }
  .inherit-theme { color: var(--ink, #1d1d1f); }
  .inherit-mix { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .mix-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--ink, #1d1d1f);
    padding: 4px 11px; border-radius: 999px; background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(var(--accent-rgb), 0.18); white-space: nowrap; }
  .mix-ic { width: 13px; height: 13px; flex: none; }
  .mix-glyph { width: 13px; height: 13px; border-radius: 4px; color: #fff; font-size: 7px; font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center; flex: none; }

  .empty { margin-top: 26px; text-align: center; border: 1.5px dashed var(--line-2, #d2d2d7); border-radius: 18px; padding: 24px; }
  .empty h3 { margin: 0; font-size: 1.15rem; }
  .empty p { color: var(--ink-soft, #6e6e73); font-size: 14px; margin: 8px auto 18px; max-width: 48ch; line-height: 1.5; }
  .empty-hero { width: 100%; max-width: 560px; border-radius: 14px; margin: 0 auto 20px; display: block; }
  .future-theme { color: var(--ink, #1d1d1f); font-size: 15px; font-weight: 600; margin: 10px auto 0; max-width: 52ch; }

  .week-timeline { margin-top: 48px; }
  .tl-bar-wrap { position: relative; }
  .tl-bar-track { position: relative; display: flex; height: 40px; border-radius: 10px; overflow: hidden; background: var(--paper-2, #f5f5f7); }
  .tl-seg { position: absolute; top: 0; height: 100%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    font: inherit; color: var(--ink-soft, #6e6e73); font-size: 12px; font-weight: 600; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: var(--paper-2, #f5f5f7); transition: filter 0.15s ease, box-shadow 0.15s ease; }
  .tl-seg:not(:last-child) { border-right: 2px solid var(--paper, #fff); }
  .tl-seg[data-s='done'] { color: var(--ink, #1d1d1f); }
  .tl-seg[data-s='now'] { color: var(--ink, #1d1d1f); }
  .tl-seg:hover { filter: brightness(0.96); }
  .tl-seg.sel { background: var(--accent, #7c5cff); color: #fff; }
  .tl-seg-name { pointer-events: none; }
  .tl-now { position: absolute; top: -4px; bottom: -18px; width: 2px; background: #c0392b; transform: translateX(-50%); z-index: 2; pointer-events: none; }
  .tl-now::before { content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 8px; height: 8px; border-radius: 50%; background: #c0392b; }
  .tl-now-label { position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 700; color: #c0392b; white-space: nowrap; }
  .tl-ticks { position: relative; height: 28px; margin-top: 4px; }
  .tl-tick { position: absolute; top: 0; transform: translateX(-50%); font-size: 10px; color: var(--ink-faint, #86868b); font-weight: 500; white-space: nowrap; max-width: 24%; overflow: hidden; text-overflow: ellipsis; }
  .tl-tick::before { content: ''; position: absolute; top: -4px; left: 50%; transform: translateX(-50%); width: 1px; height: 4px; background: var(--line-2, #d2d2d7); }

  .unplanned { margin-top: 20px; }
  .unplanned-h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint, #86868b); display: block; margin-bottom: 10px; }
  .unplanned-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .unplanned-chip { display: flex; align-items: center; gap: 8px; padding: 9px 15px; border-radius: 12px; border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff); cursor: pointer; font-family: inherit; }
  .unplanned-chip:hover { border-color: var(--accent, #7c5cff); }
  .unplanned-chip.current { border-color: var(--accent, #7c5cff); background: rgba(var(--accent-rgb), 0.06); }
  .uc-n { font-size: 12.5px; font-weight: 700; color: var(--ink, #1d1d1f); }
  .uc-th { font-size: 12px; color: var(--ink-soft, #6e6e73); }

  .wk-detail { margin-top: 24px; padding: 8px 0; display: flex; flex-direction: column; gap: 10px; }
  .wk-detail-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .wk-detail-n { font-size: 11px; font-weight: 700; color: var(--accent, #7c5cff); text-transform: uppercase; letter-spacing: 0.06em; }
  .wk-detail-date { font-size: 12.5px; color: var(--ink-faint, #86868b); }
  .wk-detail-count { font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(0, 0, 0, 0.05); color: var(--ink-soft, #6e6e73); }
  .wk-detail-theme { font-size: clamp(28px, 4vw, 32px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.15; }
  .wk-detail-focus { margin: 0; font-size: 15px; line-height: 1.7; color: var(--ink, #1d1d1f); }
  .wk-detail-mix { display: flex; flex-wrap: wrap; gap: 6px; }
  .wk-mixchip { font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 980px; border: 1px solid var(--line-2, #d2d2d7); background: var(--paper-2, #f5f5f7); color: var(--ink, #1d1d1f); }
  .wk-detail-why { margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--line, #e3e3e6); display: flex; flex-direction: column; gap: 4px; }
  .wk-detail-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint, #86868b); margin-bottom: 4px; }
  .wk-detail-text { margin: 0; font-size: 15px; line-height: 1.7; color: var(--ink, #1d1d1f); }
  .wk-detail-brief { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--ink, #1d1d1f); background: rgba(var(--accent-rgb), 0.06); border-radius: 10px; padding: 10px 14px; margin-top: 8px; }

  .approve-bar.done { background: #f4fbf6; border-color: #cdeed8; }
  .approve-bar.done .note { color: #1f8a4c; font-weight: 600; }

  .legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 16px 2px 0; font-size: 12.5px; color: var(--ink-soft, #6e6e73); }
  .legend-l { font-weight: 700; }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; }

  .wtable { margin-top: 14px; border: 1px solid var(--line, #e3e3e6); border-radius: 16px; background: var(--paper, #fff);
    overflow: hidden; overflow-x: auto; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); }
  .wt-row { display: grid; grid-template-columns: 88px 132px 156px 90px minmax(220px, 1fr) 124px 182px;
    gap: 0 14px; align-items: center; padding: 14px 18px; border-top: 1px solid var(--line, #e3e3e6); min-width: 992px; }
  .wt-row:first-child { border-top: none; }
  .wt-row:not(.wt-head):hover { background: rgba(var(--accent-rgb), 0.025); }
  .wt-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint, #86868b);
    padding: 13px 18px; background: var(--paper-2, #fafafa); }
  .wt-day { min-width: 992px; padding: 11px 18px; font-size: 12px; font-weight: 700; text-transform: capitalize;
    letter-spacing: 0.02em; color: var(--ink, #1d1d1f); background: rgba(var(--accent-rgb), 0.05);
    border-top: 1px solid var(--line, #e3e3e6); }
  .ta-r { text-align: right; }
  .wt-when { font-size: 13.5px; font-weight: 700; white-space: nowrap; text-transform: capitalize; }
  .wt-plat { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; }
  .picon { width: 16px; height: 16px; flex: none; }
  .picon-badge { width: 16px; height: 16px; border-radius: 5px; color: #fff; font-size: 8px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .pillar-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .wt-fmt { font-size: 13px; text-transform: capitalize; color: var(--ink-soft, #6e6e73); }
  .wt-text { font-size: 13px; line-height: 1.4; color: var(--ink, #1d1d1f); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .beats-chip { margin-left: 6px; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: rgba(0, 0, 0, 0.05); color: var(--ink-soft, #6e6e73); white-space: nowrap; }
  .st-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; padding: 4px 11px; border-radius: 999px; white-space: nowrap;
    background: rgba(0, 0, 0, 0.05); color: var(--ink-soft, #6e6e73); }
  .st-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
  .st-chip[data-s='todo'] { background: rgba(0, 0, 0, 0.05); color: var(--ink-soft, #6e6e73); }
  .st-chip[data-s='published'] { background: #ecf8f0; color: #1f8a4c; }
  .st-chip[data-s='scheduled'] { background: rgba(10, 102, 194, 0.1); color: #0a66c2; }
  .st-chip[data-s='approved'] { background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); }
  .st-chip[data-s='pending_user'] { background: rgba(var(--accent-rgb), 0.1); color: var(--accent, #7c5cff); }
  .st-chip[data-s='failed'] { background: #fde8e6; color: #c0392b; }
  .wt-actions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .mini-btn { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line-2, #d2d2d7);
    background: var(--paper, #fff); color: var(--ink, #1d1d1f); text-decoration: none; cursor: pointer; white-space: nowrap; }
  .mini-btn:hover { border-color: var(--accent, #7c5cff); color: var(--accent, #7c5cff); }
  .mini-btn.gen { background: var(--accent, #7c5cff); border-color: var(--accent, #7c5cff); color: #fff; }
  .mini-btn.gen:hover { opacity: 0.9; }
  .mini-btn.gen:disabled { opacity: 0.4; cursor: default; }
  .mini-btn.retry { color: #c0392b; border-color: rgba(192, 57, 43, 0.3); }
  .mini-btn.retry:hover { border-color: #c0392b; color: #c0392b; background: #fef4f3; }
  .icon-mini { width: 28px; height: 28px; border: none; border-radius: 8px; background: transparent; color: var(--ink-faint, #86868b);
    font-size: 14px; cursor: pointer; line-height: 1; text-decoration: none;
    display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .icon-mini:hover { background: var(--paper-2, #f5f5f7); color: var(--ink, #1d1d1f); }
  .icon-mini.del:hover { background: #fde8e6; color: #c0392b; }
  .icon-mini svg { width: 15px; height: 15px; }
  .icon-mini.del.confirm { background: #c0392b; color: #fff; }
  .icon-mini.del.confirm:hover { background: #a93226; color: #fff; }
  .wt-row.editing { background: rgba(var(--accent-rgb), 0.04); }
  .wt-row.row-hl { box-shadow: inset 3px 0 0 var(--accent, #7c5cff); animation: rowflash 3.5s ease-out; }
  @keyframes rowflash { from { background: rgba(var(--accent-rgb), 0.2); } to { background: transparent; } }

  .wt-editor { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; padding: 14px 18px 18px;
    border-top: 1px dashed var(--line-2, #d2d2d7); background: rgba(var(--accent-rgb), 0.03); min-width: 980px; }
  .f { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .f.wide { grid-column: span 4; }
  .fl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint, #86868b); }
  .f select, .f input, .f textarea { font-size: 13.5px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line-2, #d2d2d7);
    font-family: inherit; background: var(--paper, #fff); color: var(--ink, #1d1d1f); box-sizing: border-box; width: 100%; }
  .f textarea { resize: vertical; line-height: 1.45; }
  .f select:focus, .f input:focus, .f textarea:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .when { display: flex; gap: 6px; }
  .time { max-width: 104px; }

  .wt-add { display: block; width: 100%; padding: 13px 18px; border: none; border-top: 1px solid var(--line, #e3e3e6);
    background: none; font-size: 13.5px; font-weight: 600; color: var(--ink-soft, #6e6e73); cursor: pointer; text-align: left; }
  .wt-add:hover { color: var(--accent, #7c5cff); }

  .mix { margin: 14px 2px 0; font-size: 13.5px; color: var(--ink, #1d1d1f); }
  .mix-ok { color: #1f8a4c; font-weight: 600; }
  .mix-warn { color: #8a6d1a; font-weight: 600; }

  .producing { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 14px; color: var(--ink-soft, #6e6e73); }
  .hsp { width: 16px; height: 16px; border-radius: 50%; border: 2.5px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent, #7c5cff);
    animation: spin 0.8s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .approve-bar { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    border: 1px solid var(--line, #e3e3e6); border-radius: 16px; background: var(--paper, #fff); padding: 14px 18px; }
  .note { margin: 0; font-size: 13px; color: var(--ink-soft, #6e6e73); line-height: 1.5; max-width: 52ch; }
  .ab-actions { display: flex; align-items: center; gap: 10px; }
  .under-bar { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .btn-primary { background: var(--accent, #7c5cff); color: #fff; border: none; border-radius: 12px;
    padding: 12px 22px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.4; cursor: default; }
  .btn-ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border: none; border-radius: 980px;
    padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-ghost:disabled { opacity: 0.4; cursor: default; }
  .saved-note { font-size: 13px; color: var(--accent, #7c5cff); font-weight: 600; }

  .mix-editor { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
  .mix-rows { display: flex; flex-direction: column; gap: 6px; }
  .mix-row { display: flex; align-items: center; gap: 8px; }
  .mix-type-input, .mix-count-input { font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line-2, #d2d2d7);
    font-family: inherit; background: var(--paper, #fff); color: var(--ink, #1d1d1f); box-sizing: border-box; }
  .mix-type-input { flex: 1; min-width: 120px; }
  .mix-count-input { width: 60px; }
  .mix-type-input:focus, .mix-count-input:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .mix-pct { font-size: 12px; font-weight: 600; color: var(--ink-soft, #6e6e73); width: 40px; text-align: right; }
  .mix-remove { font-size: 16px; padding: 4px 8px; border: none; background: none; color: var(--ink-soft, #6e6e73); cursor: pointer; }
  .mix-remove:hover { color: #c0392b; }
  .mix-add-btn { display: block; padding: 8px 0; border: none; background: none; font-size: 13px; font-weight: 600; color: var(--accent, #7c5cff); cursor: pointer; text-align: left; }
  .mix-add-btn:hover { opacity: 0.8; }
  .mix-actions { display: flex; gap: 8px; margin-top: 6px; }
  .wk-detail-mix { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .wk-mixchip-edit { font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 980px; border: none; background: var(--paper-2, #f1f1f3);
    color: var(--ink-soft, #6e6e73); cursor: pointer; }
  .wk-mixchip-edit:hover { background: rgba(var(--accent-rgb), 0.1); color: var(--accent, #7c5cff); }
</style>
