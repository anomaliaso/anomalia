<script lang="ts">
  import PageHead from '$lib/components/PageHead.svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { SvelteSet } from 'svelte/reactivity';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();
  let busy = $state(false);

  // Which instant-post captions are expanded to full length.
  let expanded = $state(new SvelteSet<string>());
  const toggleExpand = (id: string) => {
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
  };
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
    };
  };

  // All scanned items, newest first — suggestions (with their comment/DM draft) now live on the
  // dedicated Leads page; this view stays a transparency log of everything Radar has looked at.
  const scanned = $derived(data.radarItems);
  const settingsRadarHref = $derived(`/app/${$page.params.brand}/settings/radar`);

  // Status label map for recent items
  const statusLabel: Record<string, { cls: string; label: string }> = {
    proposed: { cls: 'ok', label: 'Proposto' },
    posted: { cls: 'ok', label: 'Pubblicato' },
    suggested: { cls: 'ok', label: 'Suggerito' },
    skipped: { cls: 'skip', label: 'Scartato' },
    seen: { cls: '', label: 'Visto' }
  };
</script>

<div class="radar-page">
  <PageHead title={$_('app.radar.title')} subtitle={$_('app.radar.sub')} />

  {#if form?.blogGenerated}<p class="radar-banner ok">📝 Articolo blog generato come bozza — lo trovi in Blog.</p>
  {:else if form?.error === 'blog_gen_failed'}<p class="radar-banner err">Generazione articolo blog non riuscita. Riprova.</p>{/if}

  <!-- How it works -->
  <section class="how">
    <div class="how-grid">
      <div class="how-step">
        <span class="step-n">1</span>
        <div>
          <h3>{$_('app.radar.step1Title')}</h3>
          <p>{$_('app.radar.step1Desc')}</p>
          <a class="sources-link" href={settingsRadarHref}
            >{$_('app.radar.manageSources', { values: { count: data.sourceCount } })} →</a
          >
        </div>
      </div>
      <div class="how-step">
        <span class="step-n">2</span>
        <div>
          <h3>{$_('app.radar.step2Title')}</h3>
          <p>{$_('app.radar.step2Desc')}</p>
        </div>
      </div>
      <div class="how-step">
        <span class="step-n">3</span>
        <div>
          <h3>{$_('app.radar.step3Title')}</h3>
          <p>{$_('app.radar.step3Desc')}</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Settings -->
  <section class="section">
    <div class="section-head">
      <h2>{$_('app.radar.settings')}</h2>
    </div>
    <div class="card">
      <form method="POST" action="?/radarSettings" use:enhance={withBusy} class="settings-form">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{$_('app.studio.radar.enabled')}</span>
            <span class="setting-desc">Attiva o disattiva il monitoraggio automatico</span>
          </div>
          <label class="ios-switch">
            <input type="checkbox" name="enabled" checked={data.radar?.enabled} />
            <span class="ios-slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Modalità</span>
            <span class="setting-desc">Come vuoi ricevere i contenuti</span>
          </div>
          <div class="ios-segmented">
            <label class:active={data.radar?.mode !== 'breaking'}>
              <input type="radio" name="mode" value="digest" checked={data.radar?.mode !== 'breaking'} />
              <span>{$_('app.studio.radar.modeDigest')}</span>
            </label>
            <label class:active={data.radar?.mode === 'breaking'}>
              <input type="radio" name="mode" value="breaking" checked={data.radar?.mode === 'breaking'} />
              <span>{$_('app.studio.radar.modeBreaking')}</span>
            </label>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{$_('app.studio.radar.maxPerDay')}</span>
            <span class="setting-desc">Numero massimo di post al giorno</span>
          </div>
          <div class="ios-stepper">
            <button type="button" class="stepper-btn" onclick={(e) => { const inp = e.currentTarget.parentElement!.querySelector('input')!; inp.value = String(Math.max(1, Number(inp.value) - 1)); }}>−</button>
            <input type="number" name="maxPerDay" min="1" max="3" value={data.radar?.maxPerDay ?? 1} class="stepper-val" readonly />
            <button type="button" class="stepper-btn" onclick={(e) => { const inp = e.currentTarget.parentElement!.querySelector('input')!; inp.value = String(Math.min(3, Number(inp.value) + 1)); }}>+</button>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{$_('app.radar.emailPerRunLabel')}</span>
            <span class="setting-desc">{$_('app.radar.emailPerRunDesc')}</span>
          </div>
          <label class="ios-switch">
            <input type="checkbox" name="emailPerRun" checked={data.radar?.emailPerRun} />
            <span class="ios-slider"></span>
          </label>
        </div>

        <div class="setting-divider"></div>
        <div class="setting-section-title">{$_('app.radar.leadSection')}</div>

        <div class="setting-row vertical">
          <div class="setting-info">
            <span class="setting-label">{$_('app.radar.leadInstructionsLabel')}</span>
            <span class="setting-desc">{$_('app.radar.leadInstructionsDesc')}</span>
          </div>
          <textarea name="leadInstructions" rows="3" class="style-textarea" placeholder={$_('app.radar.leadInstructionsPlaceholder')}>{data.radar?.leadInstructions ?? ''}</textarea>
        </div>

        <div class="setting-divider"></div>
        <div class="setting-section-title">{$_('app.radar.replySection')}</div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{$_('app.radar.replyToneLabel')}</span>
            <span class="setting-desc">{$_('app.radar.replyToneDesc')}</span>
          </div>
          <div class="ios-segmented tone-picker">
            {#each ['professional', 'casual', 'friendly', 'expert', 'witty'] as tone}
              <label class:active={data.radar?.replyTone === tone}>
                <input type="radio" name="replyTone" value={tone} checked={data.radar?.replyTone === tone} />
                <span>{$_('app.radar.tones.' + tone)}</span>
              </label>
            {/each}
          </div>
        </div>

        <div class="setting-row vertical">
          <div class="setting-info">
            <span class="setting-label">{$_('app.radar.replyStyleLabel')}</span>
            <span class="setting-desc">{$_('app.radar.replyStyleDesc')}</span>
          </div>
          <textarea name="replyStyle" rows="2" class="style-textarea" placeholder={$_('app.radar.replyStylePlaceholder')}>{data.radar?.replyStyle ?? ''}</textarea>
        </div>

        <div class="setting-actions">
          <button class="btn primary" type="submit" disabled={busy}>{$_('app.studio.radar.save')}</button>
        </div>
      </form>
    </div>
  </section>

  <!-- Instant posts created by the Radar -->
  {#if data.radarPosts.length}
    <section class="section">
      <div class="section-head"><h2>⚡ {$_('app.radar.instantPosts')}</h2></div>
      <div class="card">
        <ul class="items-list">
          {#each data.radarPosts as p (p.id)}
            <li class="item-row post-row">
              {#if p.media_url}<img class="post-thumb" src={p.media_url} alt="" />{/if}
              <div style="flex:1;min-width:0;">
                <div class="item-top">
                  <span class="status-badge instant">⚡ Instant</span>
                  <span class="status-badge {p.status === 'pending_user' ? '' : 'ok'}">{p.status === 'pending_user' ? $_('app.radar.pending') : p.status}</span>
                  {#if p.needs_attention}<span class="status-badge warn" title={p.attention_reason ?? ''}>⚠</span>{/if}
                  {#if p.source_url}<a class="item-source" href={p.source_url} target="_blank" rel="noopener noreferrer">{$_('app.radar.sourceLink')} ↗</a>{/if}
                </div>
                <p class="post-caption">{expanded.has(p.id) || (p.caption ?? '').length <= 180 ? (p.caption ?? '') : (p.caption ?? '').slice(0, 180) + '…'}</p>
                {#if (p.caption ?? '').length > 180}
                  <button type="button" class="link-btn" onclick={() => toggleExpand(p.id)}>{expanded.has(p.id) ? $_('app.radar.showLess') : $_('app.radar.showMore')}</button>
                {/if}
                {#if p.status === 'pending_user'}
                  <div class="post-actions">
                    <form method="POST" action="?/approve" use:enhance={withBusy}>
                      <input type="hidden" name="id" value={p.id} />
                      <button class="btn primary" type="submit" disabled={busy}>{$_('app.radar.approve')}</button>
                    </form>
                    <form method="POST" action="?/reject" use:enhance={withBusy}>
                      <input type="hidden" name="id" value={p.id} />
                      <button class="btn ghost" type="submit" disabled={busy}>{$_('app.radar.reject')}</button>
                    </form>
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/if}

  <!-- Reply suggestions moved to the dedicated Leads page -->
  <a class="leads-banner" href={`/app/${$page.params.brand}/leads`}>{$_('app.radar.leadsMoved')}</a>

  <!-- Recent items -->
  {#if scanned.length}
    <section class="section">
      <div class="section-head">
        <h2>{$_('app.radar.recent')}</h2>
      </div>
      <div class="card">
        <ul class="items-list">
          {#each scanned as it (it.url)}
            <li class="item-row">
              <div class="item-top">
                <span class="status-badge {statusLabel[it.status]?.cls ?? ''}">{statusLabel[it.status]?.label ?? it.status}{it.relevance != null ? ` · ${it.relevance}` : ''}</span>
                <span class="item-source">{it.source_name ?? ''}</span>
              </div>
              <a href={it.url} target="_blank" rel="noopener noreferrer" class="item-title">{it.title}</a>
              {#if it.angle}<p class="item-meta">→ {it.angle}</p>{/if}
              {#if it.skip_reason}<p class="item-meta skip">✕ {it.skip_reason}</p>{/if}
              {#if it.suggestion}<p class="item-meta">💬 {it.suggestion.slice(0, 200)}…</p>{/if}
              <form method="POST" action="?/generateBlogFromItem" use:enhance={withBusy} class="blog-from-item">
                <input type="hidden" name="title" value={it.title} />
                <input type="hidden" name="url" value={it.url} />
                <input type="hidden" name="context" value={it.angle ?? it.suggestion ?? ''} />
                <button class="btn ghost" type="submit" disabled={busy} style="font-size:12px;">📝 Genera articolo blog</button>
              </form>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/if}

  <section class="section">
    <div class="section-head">
      <h2>{$_('app.radar.searchHistory')}</h2>
    </div>
    <div class="card">
      {#if !data.radarSearches.length}
        <p class="item-meta">{$_('app.radar.searchHistoryEmpty')}</p>
      {:else}
        <ul class="items-list">
          {#each data.radarSearches as s (s.created_at)}
            <li class="item-row">
              <div class="item-top">
                <span class="item-source">{new Date(s.created_at).toLocaleString()}{s.mode ? ` · ${s.mode}` : ''}</span>
                {#if s.ms != null}<span class="item-source">{(s.ms / 1000).toFixed(1)}s</span>{/if}
              </div>
              <p class="item-meta">{$_('app.radar.searchFunnel', { values: { found: s.items_found, fresh: s.items_fresh, relevant: s.items_relevant } })}</p>
              <p class="item-meta">→ {$_('app.radar.searchProposed', { values: { posts: s.posts_proposed, comments: s.comments_proposed, articles: s.articles_proposed } })}</p>
              {#if Array.isArray(s.sources) && s.sources.length}
                <details class="search-sources">
                  <summary>{$_('app.radar.searchSourcesQueried', { values: { count: s.sources.length } })}</summary>
                  <ul>
                    {#each s.sources as src}
                      <!-- A failing source now says WHY. Without the reason a broken source and a
                           quiet one both read as "0", which is how a dead X feed hid for weeks. -->
                      <li class:src-error={src.ok === false}>
                        <code>{src.kind}{src.dynamic ? ' ✦' : ''}</code>
                        <span>{src.value}{src.ok === false && src.error ? ` — ${src.error}` : ''}</span>
                        <span class="src-count">{src.ok === false ? '✕' : `${src.items}`}{src.fromCache ? ' · cache' : ''}</span>
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
</div>

<style>
  .post-row { display: flex; gap: 12px; align-items: flex-start; }
  .post-thumb { width: 68px; height: 68px; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); }
  .post-caption { font-size: 13.5px; color: var(--ink); margin: 4px 0 0; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .link-btn { background: none; border: none; padding: 2px 0; margin: 0; font-size: 12.5px; color: var(--accent, #7c5cff); cursor: pointer; font-family: inherit; }
  .post-actions { display: flex; gap: 8px; margin-top: 10px; }
  .post-actions form { display: contents; }
  .status-badge.instant { color: #7c2d12; background: #ffedd5; }
  .status-badge.warn { color: #92400e; background: #fef3c7; }
  .radar-page { width: 100%; min-width: 0; max-width: var(--content-max, 960px); margin: 0 auto; padding: 0; box-sizing: border-box; overflow-x: hidden; }
  .radar-banner { font-size: 13px; border-radius: 10px; padding: 10px 14px; margin: 0 0 16px; text-align: center; }
  .radar-banner.ok { background: #dcfce7; color: #166534; }
  .radar-banner.err { background: #fef2f2; color: #b91c1c; }
  .blog-from-item { margin-top: 6px; }
  .leads-banner {
    display: block; font-size: 13px; font-weight: 500; text-align: center;
    padding: 12px 16px; margin-bottom: 24px; border-radius: 12px;
    background: var(--paper-2); border: 1px solid var(--line); color: var(--ink-soft);
    text-decoration: none;
  }
  .leads-banner:hover { color: var(--ink); }

  /* ── Full-width glow strip ──────────────────────────────────────── */
  @property --rp {
    syntax: '<percentage>';
    inherits: false;
    initial-value: 0%;
  }

  .glow-strip {
    position: relative; width: 100%; height: 220px;
    margin-bottom: 24px;
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .glow-title {
    position: relative; z-index: 1;
  }
  .glow-r,
  .glow-rg {
    position: absolute;
    width: 100%; height: 100%;
    top: 0; left: 0;
  }
  .glow-r {
    background: repeating-radial-gradient(
      circle at center,
      rgba(var(--accent-rgb), 0.07) 0 1px,
      transparent 1px 50px
    );
    -webkit-mask-image: radial-gradient(circle at center, #000 8%, transparent 65%);
    mask-image: radial-gradient(circle at center, #000 8%, transparent 65%);
  }
  .glow-rg {
    background: repeating-radial-gradient(
      circle at center,
      rgba(var(--accent-rgb), 0.4) 0 1.5px,
      transparent 1.5px 50px
    );
    -webkit-mask-image:
      radial-gradient(circle at center, transparent calc(var(--rp) - 12%), #000 var(--rp), transparent calc(var(--rp) + 12%));
    mask-image:
      radial-gradient(circle at center, transparent calc(var(--rp) - 12%), #000 var(--rp), transparent calc(var(--rp) + 12%));
    animation: radar-ripple 5s linear infinite;
  }
  @keyframes radar-ripple {
    from { --rp: -5%; }
    to   { --rp: 115%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .glow-rg { display: none; }
  }

  /* ── Hero ──────────────────────────────────────────────────────── */
  .hero { text-align: center; margin-bottom: 36px; }
  .hero-sub {
    font-size: 15px; color: var(--ink-soft); line-height: 1.55;
    margin: 0 auto; max-width: 560px; text-align: center;
  }

  /* ── How it works ───────────────────────────────────────────────── */
  .how { margin-bottom: 36px; }
  .how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .how-step {
    display: flex; gap: 14px; align-items: flex-start;
    padding: 18px; border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .step-n {
    flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
    background: var(--ink); color: var(--paper); font-size: 13px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .how-step h3 { font-size: 14px; font-weight: 600; margin: 0 0 5px; color: var(--ink); }
  .how-step p { font-size: 13px; color: var(--ink-soft); margin: 0; line-height: 1.5; }
  .sources-link {
    display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600;
    color: var(--accent); text-decoration: none;
  }
  .sources-link:hover { text-decoration: underline; }

  /* ── Section ────────────────────────────────────────────────────── */
  .search-sources { margin-top: 8px; }
  .search-sources summary { cursor: pointer; font-size: 12px; color: var(--muted); }
  .search-sources ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .search-sources li { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
  .search-sources li span:nth-child(2) { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-sources code { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .search-sources .src-count { color: var(--muted); white-space: nowrap; }
  .search-sources li.src-error { color: var(--danger, #b91c1c); opacity: 0.85; }

  .section { margin-bottom: 28px; }
  .section-head { margin-bottom: 12px; }
  .section-head h2 {
    font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin: 0; color: var(--ink);
  }

  .card {
    background: var(--paper); border: 1px solid var(--line); border-radius: 16px;
    padding: 20px 22px;
  }

  /* ── Settings (Apple-style) ──────────────────────────────────────── */
  .settings-form { display: flex; flex-direction: column; gap: 0; }
  .setting-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 16px 0; border-bottom: 1px solid var(--line);
  }
  .setting-row:last-of-type { border-bottom: none; }
  .setting-info { display: flex; flex-direction: column; gap: 2px; }
  .setting-label { font-size: 15px; font-weight: 500; color: var(--ink); }
  .setting-desc { font-size: 13px; color: var(--ink-faint); }
  .setting-actions { display: flex; justify-content: flex-end; padding-top: 14px; }

  .setting-divider { height: 1px; background: var(--line); margin: 8px 0; }
  .setting-section-title {
    font-size: 13px; font-weight: 600; color: var(--ink-faint); text-transform: uppercase;
    letter-spacing: 0.04em; padding: 4px 0 8px;
  }
  .setting-row.vertical { flex-direction: column; align-items: stretch; gap: 10px; }
  .tone-picker { flex-wrap: wrap; }
  .tone-picker label { flex: none; }
  .style-textarea {
    font-size: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;
    background: var(--paper); color: var(--ink); outline: none; resize: vertical;
    font-family: inherit; line-height: 1.5; transition: border-color 0.2s;
  }
  .style-textarea:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.08); }
  .style-textarea::placeholder { color: var(--ink-faint); }

  /* iOS toggle switch */
  .ios-switch {
    position: relative; display: inline-block; width: 51px; height: 31px; flex-shrink: 0;
  }
  .ios-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
  .ios-slider {
    position: absolute; cursor: pointer; inset: 0;
    background: #e5e5ea; border-radius: 31px; transition: background 0.25s ease;
  }
  .ios-slider::before {
    content: ''; position: absolute; height: 27px; width: 27px; left: 2px; bottom: 2px;
    background: #fff; border-radius: 50%; transition: transform 0.25s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(0,0,0,0.04);
  }
  .ios-switch input:checked + .ios-slider { background: #34c759; }
  .ios-switch input:checked + .ios-slider::before { transform: translateX(20px); }
  .ios-switch.small { width: 43px; height: 26px; }
  .ios-switch.small .ios-slider { border-radius: 26px; }
  .ios-switch.small .ios-slider::before { height: 22px; width: 22px; }
  .ios-switch.small input:checked + .ios-slider::before { transform: translateX(17px); }

  /* iOS segmented control */
  .ios-segmented {
    display: inline-flex; background: var(--paper-2); border: 1px solid var(--line);
    border-radius: 10px; padding: 2px; position: relative;
  }
  .ios-segmented label {
    position: relative; z-index: 1; cursor: pointer;
    font-size: 13px; font-weight: 500; color: var(--ink-soft);
    padding: 6px 16px; border-radius: 8px; transition: all 0.2s ease;
  }
  .ios-segmented label.active {
    background: var(--paper); color: var(--ink);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.04);
  }
  .ios-segmented input { position: absolute; opacity: 0; width: 0; height: 0; }

  /* iOS stepper */
  .ios-stepper {
    display: inline-flex; align-items: center; border: 1px solid var(--line);
    border-radius: 10px; overflow: hidden;
  }
  .stepper-btn {
    width: 36px; height: 32px; border: none; background: var(--paper-2);
    color: var(--accent, #7c5cff); font-size: 18px; font-weight: 500;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .stepper-btn:hover { background: var(--line); }
  .stepper-btn:active { background: var(--line); }
  .stepper-val {
    width: 40px; height: 32px; border: none; border-left: 1px solid var(--line);
    border-right: 1px solid var(--line); text-align: center; font-size: 15px;
    font-weight: 600; color: var(--ink); background: var(--paper);
    -moz-appearance: textfield;
  }
  .stepper-val::-webkit-outer-spin-button,
  .stepper-val::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

  /* ── Recent items ────────────────────────────────────────────────── */
  .items-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .item-row {
    padding: 14px 0; border-bottom: 1px solid var(--line);
    display: flex; flex-direction: column; gap: 5px;
  }
  .item-row:last-child { border-bottom: none; }
  .item-top { display: flex; align-items: center; gap: 8px; }
  .status-badge {
    font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
    background: var(--paper-2); color: var(--ink-faint);
  }
  .status-badge.ok { background: #dcfce7; color: #166534; }
  .status-badge.skip { background: #fef2f2; color: #b91c1c; }
  .item-source { font-size: 12px; color: var(--ink-faint); }
  .item-title { font-size: 14px; color: var(--ink); text-decoration: none; font-weight: 500; }
  .item-title:hover { text-decoration: underline; }
  .item-meta { font-size: 12.5px; color: var(--ink-soft); margin: 0; line-height: 1.45; }
  .item-meta.skip { color: #dc2626; }

  .empty { font-size: 14px; color: var(--ink-faint); text-align: center; padding: 24px 0; }

  .btn { font-size: 13px; font-weight: 600; border-radius: 10px; padding: 8px 16px; cursor: pointer; border: 1px solid transparent; line-height: 1; }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .btn.ghost { background: transparent; color: var(--ink-soft); border-color: var(--line); }

  @container workbench (max-width: 1020px) {
    .radar-page { padding: 0; overflow-x: hidden; }
    .glow-strip { height: 140px; width: 100%; margin-left: 0; }
    .hero-sub { font-size: 14px; }
    .how-grid { grid-template-columns: 1fr; }
    .how-step { padding: 14px; }
    .setting-row { flex-direction: column; align-items: flex-start; gap: 10px; }
    .ios-segmented { width: 100%; display: flex; max-width: 100%; }
    .ios-segmented label { flex: 1; text-align: center; padding: 6px 8px; font-size: 12px; min-width: 0; }
    .tone-picker { gap: 4px; flex-wrap: wrap; }
    .tone-picker label { padding: 5px 8px; font-size: 11px; flex: 1 1 auto; min-width: 0; }
    .ios-stepper { width: 100%; justify-content: center; }
    .add-form { flex-wrap: wrap; border-radius: 12px; max-width: 100%; }
    .add-select, .add-input, .add-btn { height: 44px; max-width: 100%; box-sizing: border-box; }
    .add-select { min-width: 0; flex: 1; }
    .add-input { flex-basis: 100%; border-right: none; border-top: 1px solid var(--line); min-width: 0; }
    .add-btn { flex: 1; }
    .add-btn span { display: inline; }
    .source-item { flex-direction: column; align-items: flex-start; gap: 8px; }
    .source-actions { align-self: flex-end; }
    .post-row { flex-direction: column; }
    .post-thumb { width: 100%; height: 160px; border-radius: 10px; max-width: 100%; }
    .section-head h2 { font-size: 16px; }
    .card { padding: 14px 14px; max-width: 100%; box-sizing: border-box; overflow: hidden; }
    .style-textarea { font-size: 13px; max-width: 100%; box-sizing: border-box; }
    .blog-from-item .btn { width: 100%; text-align: center; }
    .item-top { flex-wrap: wrap; }
    .status-badge { white-space: nowrap; }
    .item-title { word-break: break-word; }
    .item-meta { word-break: break-word; }
  }

  @container workbench (max-width: 480px) {
    .glow-strip { height: 110px; }
    .hero { margin-bottom: 24px; }
    .how-step { padding: 12px; gap: 10px; }
    .step-n { width: 24px; height: 24px; font-size: 12px; }
    .how-step h3 { font-size: 13px; }
    .how-step p { font-size: 12px; }
    .setting-label { font-size: 14px; }
    .setting-desc { font-size: 12px; }
    .section { margin-bottom: 20px; }
    .item-title { font-size: 13px; }
    .item-meta { font-size: 12px; }
    .source-kind { font-size: 10px; padding: 2px 7px; }
    .source-val { font-size: 13px; }
  }
</style>
