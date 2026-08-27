<script lang="ts">
  import PlatformGlyph from '$lib/components/PlatformGlyph.svelte';

  type PageKey = 'content' | 'seogeo' | 'radar' | 'leads';
  let { page }: { page: PageKey } = $props();

  const contentCards = [
    { platform: 'instagram', caption: 'Behind the scenes: how we source our materials', status: 'pending_user', pillar: 'Brand Story', thumb: '/showcase-gen/flashcamp-1.webp' },
    { platform: 'tiktok', caption: '3 things nobody tells you about starting a business', status: 'approved', pillar: 'Education', thumb: '/showcase-gen/flashcamp-2.webp' },
    { platform: 'facebook', caption: 'New drop is live — meet the summer lineup', status: 'scheduled', pillar: 'Product', thumb: '/showcase-gen/flashcamp-3.webp' },
  ];

  const geoCitations = [
    { name: 'ChatGPT', share: 48, cited: true },
    { name: 'Perplexity', share: 31, cited: true },
    { name: 'Gemini', share: 14, cited: false },
    { name: 'Claude', share: 7, cited: false },
  ];
  const seoInitiatives = [
    { title: 'How to choose a camping tent: full guide', type: 'Blog', status: 'published' },
    { title: 'Flash Camp vs traditional tents', type: 'Comparison', status: 'draft' },
    { title: 'Landing: ultralight tents', type: 'Landing', status: 'todo' },
  ];

  const radarSources = [
    { name: 'Google News', color: '#4285f4', icon: 'G' },
    { name: 'Reddit', color: '#ff4500', icon: 'r/' },
    { name: 'X', color: '#1d1d1f', icon: '𝕏' },
    { name: 'Threads', color: '#1d1d1f', icon: '@' },
  ];
  const radarNews = {
    source: 'Google News',
    tag: 'Outdoor gear',
    title: 'Europe camping market surges 23% in summer 2026',
    time: '4 min ago',
  };
  const radarDraft = {
    platform: 'instagram',
    caption: 'Il mercato outdoor europeo cresce del 23%. Noi c\'eravamo prima del boom.',
    status: 'pending_user',
  };

  const leadsConversations = [
    { user: 'u/marco_hikes', sub: 'r/CampingGear', msg: 'Looking for a lightweight tent for solo trips, any suggestions?', platform: 'reddit', btn: 'commenta' },
    { user: '@sarah_outdoor', sub: '@flashcamp', msg: 'Love this design! Where can I buy it?', platform: 'instagram', btn: 'manda DM' },
    { user: 'u/alex_travel', sub: 'r/solotravel', msg: 'Best camping gear brands in Europe?', platform: 'reddit', btn: 'commenta' },
    { user: '@giulia.camp', sub: 'Threads', msg: 'Qualcuno ha provato i tendini ultraleggeri?', platform: 'threads', btn: 'manda DM' },
    { user: 'u/outdoor_mike', sub: 'r/CampingEquipment', msg: 'Flash Camp vs Naturehike — worth the price?', platform: 'reddit', btn: 'commenta' },
  ];
  const leadFilters = [
    { name: 'All', count: 12 },
    { name: 'Reddit', count: 7, color: '#ff4500' },
    { name: 'Instagram', count: 3, color: '#e1306c' },
    { name: 'Threads', count: 2, color: '#1d1d1f' },
  ];
  const redditSubs = ['r/CampingGear', 'r/solotravel', 'r/CampingEquipment', 'r/outdoors'];
</script>

<div class="sm-wrap">
  <div class="sm-browser">
    <div class="sm-bar">
      <div class="sm-lights">
        <span class="sm-dot sm-r"></span>
        <span class="sm-dot sm-y"></span>
        <span class="sm-dot sm-g"></span>
      </div>
      <div class="sm-url">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span>app.anomalia.so/{page === 'content' ? 'content' : page === 'seogeo' ? 'seo' : page === 'radar' ? 'radar' : 'leads'}</span>
      </div>
    </div>
    <div class="sm-body">
      {#if page === 'content'}
        <div class="sm-page-head"><h3>Content</h3><p>Your post library for <b>Flash Camp</b>.</p></div>
        <div class="sm-post-grid">
          {#each contentCards as card}
            <div class="sm-post-card">
              <div class="sm-post-media">
                <img src={card.thumb} alt="" width="360" height="360" loading="lazy" decoding="async" />
              </div>
              <div class="sm-post-info">
                <div class="sm-post-plat"><PlatformGlyph platform={card.platform} /><span>{card.platform}</span></div>
                <div class="sm-post-cap">{card.caption}</div>
                <div class="sm-post-status" data-s={card.status}>
                  <span class="sm-st-dot"></span>
                  {card.status === 'pending_user' ? 'Pending' : card.status === 'approved' ? 'Approved' : 'Scheduled'}
                </div>
              </div>
            </div>
          {/each}
        </div>

      {:else if page === 'seogeo'}
        <div class="sm-page-head"><h3>SEO &amp; GEO</h3><p>How Google and AI find <b>Flash Camp</b>.</p></div>
        <div class="sm-scores">
          <div class="sm-score"><div class="sm-score-ring" style="--v:78"><span>78</span></div><div class="sm-score-label">Technical readiness</div></div>
          <div class="sm-score"><div class="sm-score-ring" style="--v:62"><span>62</span></div><div class="sm-score-label">GEO</div></div>
        </div>
        <div class="sm-panel">
          <div class="sm-panel-head"><span>GEO <span class="sm-faint">share of voice</span></span></div>
          {#each geoCitations as c}
            <div class="sm-cite">
              <span class="sm-cite-name">{c.name}</span>
              <span class="sm-cite-bar"><span class="sm-cite-fill" style={`width:${c.share}%`}></span></span>
              <span class="sm-cite-share">{c.share}%</span>
              <span class="sm-cite-flag" class:ok={c.cited}>{c.cited ? '✓' : '—'}</span>
            </div>
          {/each}
        </div>
        <div class="sm-panel">
          <div class="sm-panel-head"><span>SEO strategy <span class="sm-faint">initiatives</span></span></div>
          {#each seoInitiatives as ini}
            <div class="sm-init">
              <span class="sm-init-type">{ini.type}</span>
              <span class="sm-init-title">{ini.title}</span>
              <span class="sm-st-chip" data-s={ini.status}><span class="sm-st-dot"></span>{ini.status === 'published' ? 'Published' : ini.status === 'draft' ? 'Draft' : 'To do'}</span>
            </div>
          {/each}
        </div>

      {:else if page === 'radar'}
        <div class="sm-page-head"><h3>Radar</h3><p>News → posts in minutes for <b>Flash Camp</b>.</p></div>
        <div class="sm-radar-split">
          <!-- Left: sources + detected news -->
          <div class="sm-radar-left">
            <div class="sm-sources-label"><span class="sm-live-dot"></span> Scanning</div>
            <div class="sm-sources">
              {#each radarSources as s}
                <div class="sm-source"><span class="sm-source-icon" style={`background:${s.color}`}>{s.icon}</span>{s.name}</div>
              {/each}
            </div>
            <div class="sm-news-detected">
              <div class="sm-news-tag">📰 {radarNews.tag}</div>
              <div class="sm-news-title">{radarNews.title}</div>
              <div class="sm-news-meta">{radarNews.source} · {radarNews.time}</div>
            </div>
          </div>
          <!-- Right: generated draft -->
          <div class="sm-radar-right">
            <div class="sm-draft-label">Generated draft</div>
            <div class="sm-draft-card">
              <div class="sm-draft-plat"><PlatformGlyph platform={radarDraft.platform} /><span>instagram</span></div>
              <div class="sm-draft-cap">{radarDraft.caption}</div>
              <div class="sm-draft-actions">
                <span class="sm-draft-btn primary">✓ Approve</span>
                <span class="sm-draft-btn">Edit</span>
              </div>
            </div>
          </div>
        </div>

      {:else if page === 'leads'}
        <div class="sm-page-head"><h3>Leads</h3><p>Conversations spotted by the radar for <b>Flash Camp</b>.</p></div>
        <div class="sm-leads-layout">
          <!-- Left: filters -->
          <div class="sm-leads-filters">
            <div class="sm-filter-label">Platform</div>
            {#each leadFilters as f, i}
              <div class="sm-filter" class:active={i === 0}>
                {#if f.color}<span class="sm-filter-dot" style={`background:${f.color}`}></span>{/if}
                <span>{f.name}</span>
                <span class="sm-filter-count">{f.count}</span>
              </div>
            {/each}
            <div class="sm-filter-label" style="margin-top:8px">Subreddit</div>
            {#each redditSubs as sub}
              <div class="sm-filter sub">{sub}</div>
            {/each}
          </div>
          <!-- Right: conversation list -->
          <div class="sm-leads-list">
            {#each leadsConversations as c}
              <div class="sm-lead-row">
                <span class="sm-lead-avatar" style={c.platform === 'reddit' ? 'background:#ff4500' : c.platform === 'instagram' ? 'background:#e1306c' : 'background:#1d1d1f'}>{c.user[1].toUpperCase()}</span>
                <div class="sm-lead-body">
                  <div class="sm-lead-meta"><b>{c.user}</b> <span class="sm-lead-sub">{c.sub}</span></div>
                  <div class="sm-lead-msg">{c.msg}</div>
                </div>
                <span class="sm-lead-btn" class:dm={c.btn === 'manda DM'}>{c.btn}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .sm-wrap { width: 100%; display: flex; justify-content: center; min-width: 0; }
  .sm-browser {
    width: 100%; border-radius: 12px; overflow: hidden;
    background: var(--paper); border: 1px solid var(--line);
    min-width: 0;
  }
  .sm-bar {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    background: var(--paper-2); border-bottom: 1px solid var(--line);
  }
  .sm-lights { display: flex; gap: 5px; }
  .sm-dot { width: 8px; height: 8px; border-radius: 50%; }
  .sm-r { background: #ff5f57; } .sm-y { background: #febc2e; } .sm-g { background: #28c840; }
  .sm-url {
    flex: 1; display: flex; align-items: center; gap: 6px;
    background: var(--paper); border: 1px solid var(--line); border-radius: 6px;
    padding: 3px 8px; font-size: 9px; color: var(--ink-faint); margin-left: 8px;
  }
  .sm-url svg { opacity: 0.4; }

  /* Fixed-height body so all 4 mockups are identical height */
  .sm-body { padding: 14px; font-size: 11px; height: 340px; overflow: hidden; min-width: 0; }
  .sm-page-head { margin-bottom: 10px; }
  .sm-page-head h3 { font-size: 14px; font-weight: 700; letter-spacing: -0.03em; margin: 0; }
  .sm-page-head p { color: var(--ink-soft); font-size: 10px; margin: 2px 0 0; }
  .sm-page-head p b { color: var(--accent); font-weight: 600; }

  /* ── Content (social posts) ──────── */
  .sm-post-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; min-width: 0; }
  .sm-post-card { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--paper); min-width: 0; }
  .sm-post-media {
    width: 100%; aspect-ratio: 1; background-color: var(--paper-2); overflow: hidden;
  }
  .sm-post-media img {
    display: block; width: 100%; height: 100%; object-fit: cover;
  }
  .sm-post-info { padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
  .sm-post-plat { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700; text-transform: capitalize; color: var(--ink-faint); }
  .sm-post-cap { font-size: 9px; line-height: 1.3; color: var(--ink-soft); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .sm-post-status { display: inline-flex; align-items: center; gap: 3px; font-size: 8px; font-weight: 700; }
  .sm-post-status[data-s='pending_user'] { color: #a3700a; }
  .sm-post-status[data-s='approved'] { color: var(--accent); }
  .sm-post-status[data-s='scheduled'] { color: #0a66c2; }

  /* ── SEO & GEO ──────── */
  .sm-scores { display: flex; gap: 6px; margin-bottom: 8px; }
  .sm-score { flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); }
  .sm-score-ring {
    width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center;
    background: conic-gradient(var(--accent) calc(var(--v) * 1%), rgba(0,0,0,0.06) 0);
  }
  .sm-score-ring span { width: 26px; height: 26px; border-radius: 50%; background: var(--paper); display: grid; place-items: center; font-size: 10px; font-weight: 700; }
  .sm-score-label { font-size: 9px; font-weight: 600; color: var(--ink); }
  .sm-panel { border: 1px solid var(--line); border-radius: 10px; background: var(--paper); margin-bottom: 6px; overflow: hidden; }
  .sm-panel-head { padding: 6px 10px; border-bottom: 1px solid var(--line); font-size: 10px; font-weight: 700; }
  .sm-faint { color: var(--ink-faint); font-weight: 500; }
  .sm-cite { display: flex; align-items: center; gap: 5px; padding: 4px 10px; }
  .sm-cite:not(:last-child) { border-bottom: 1px solid var(--line); }
  .sm-cite-name { width: 60px; font-size: 9px; font-weight: 600; flex: none; }
  .sm-cite-bar { flex: 1; height: 4px; border-radius: 999px; background: rgba(0,0,0,0.06); overflow: hidden; }
  .sm-cite-fill { display: block; height: 100%; border-radius: 999px; background: var(--accent); }
  .sm-cite-share { width: 24px; text-align: right; font-size: 8px; font-weight: 700; color: var(--ink-soft); flex: none; }
  .sm-cite-flag { width: 16px; text-align: right; font-size: 8px; font-weight: 700; color: var(--ink-faint); flex: none; }
  .sm-cite-flag.ok { color: #1f8a4c; }
  .sm-init { display: flex; align-items: center; gap: 6px; padding: 5px 10px; }
  .sm-init:not(:last-child) { border-bottom: 1px solid var(--line); }
  .sm-init-type { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent); background: rgba(var(--accent-rgb), 0.1); padding: 2px 5px; border-radius: 3px; flex: none; }
  .sm-init-title { flex: 1; font-size: 9px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── Radar (news → post) ──────── */
  .sm-radar-split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; min-width: 0; }
  .sm-radar-left, .sm-radar-right { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .sm-sources-label { font-size: 9px; font-weight: 700; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.06em; display: flex; align-items: center; gap: 5px; }
  .sm-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: sm-pulse 2s infinite; }
  @keyframes sm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .sm-sources { display: flex; flex-wrap: wrap; gap: 4px; }
  .sm-source { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 600; color: var(--ink-soft); padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); }
  .sm-source-icon { width: 14px; height: 14px; border-radius: 3px; color: #fff; font-size: 7px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex: none; }
  .sm-news-detected { padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); margin-top: auto; }
  .sm-news-tag { font-size: 8px; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
  .sm-news-title { font-size: 10px; font-weight: 600; color: var(--ink); line-height: 1.3; }
  .sm-news-meta { font-size: 8px; color: var(--ink-faint); margin-top: 3px; }
  .sm-draft-label { font-size: 9px; font-weight: 700; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.06em; }
  .sm-draft-card { padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .sm-draft-plat { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700; text-transform: capitalize; color: var(--ink-faint); }
  .sm-draft-cap { font-size: 10px; line-height: 1.35; color: var(--ink); }
  .sm-draft-actions { display: flex; gap: 4px; margin-top: auto; }
  .sm-draft-btn { font-size: 9px; font-weight: 700; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft); }
  .sm-draft-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }

  /* ── Leads ──────── */
  .sm-leads-layout { display: grid; grid-template-columns: 100px 1fr; gap: 8px; min-width: 0; }
  .sm-leads-filters { display: flex; flex-direction: column; gap: 2px; }
  .sm-filter-label { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); padding: 2px 0; }
  .sm-filter { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 600; color: var(--ink-soft); padding: 4px 6px; border-radius: 6px; cursor: default; }
  .sm-filter.active { background: rgba(var(--accent-rgb), 0.08); color: var(--accent); font-weight: 700; }
  .sm-filter.sub { font-size: 8px; color: var(--ink-faint); padding: 2px 6px; }
  .sm-filter-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .sm-filter-count { margin-left: auto; font-size: 8px; background: var(--paper-2); border-radius: 999px; padding: 1px 5px; color: var(--ink-faint); }
  .sm-leads-list { display: flex; flex-direction: column; }
  .sm-lead-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
  .sm-lead-row:not(:last-child) { border-bottom: 1px solid var(--line); }
  .sm-lead-avatar { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: none; }
  .sm-lead-body { flex: 1; min-width: 0; }
  .sm-lead-meta { font-size: 9px; display: flex; align-items: center; gap: 5px; }
  .sm-lead-meta b { font-weight: 700; }
  .sm-lead-sub { font-size: 8px; color: var(--ink-faint); }
  .sm-lead-msg { font-size: 9px; color: var(--ink-soft); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sm-lead-btn { font-size: 8px; font-weight: 700; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft); flex: none; white-space: nowrap; }
  .sm-lead-btn.dm { background: var(--accent); color: #fff; border-color: var(--accent); }

  /* ── Shared status chips ──────── */
  .sm-st-chip { display: inline-flex; align-items: center; gap: 3px; font-size: 7px; font-weight: 700; padding: 2px 6px; border-radius: 999px; white-space: nowrap; background: rgba(0,0,0,0.05); color: var(--ink-soft); }
  .sm-st-dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; flex: none; }
  .sm-st-chip[data-s='todo'] { background: rgba(0,0,0,0.05); color: var(--ink-soft); }
  .sm-st-chip[data-s='new'] { background: rgba(var(--accent-rgb), 0.12); color: var(--accent); }
  .sm-st-chip[data-s='published'] { background: #ecf8f0; color: #1f8a4c; }
  .sm-st-chip[data-s='sent'] { background: #ecf8f0; color: #1f8a4c; }
  .sm-st-chip[data-s='scheduled'] { background: rgba(10,102,194,0.1); color: #0a66c2; }
  .sm-st-chip[data-s='approved'] { background: rgba(var(--accent-rgb), 0.12); color: var(--accent); }
  .sm-st-chip[data-s='pending_user'] { background: rgba(var(--accent-rgb), 0.1); color: var(--accent); }
  .sm-st-chip[data-s='draft'] { background: #fef3e2; color: #b45309; }

  @media (max-width: 640px) {
    .sm-body { height: auto; min-height: 200px; padding: 10px; font-size: 10px; }
    .sm-post-grid { grid-template-columns: repeat(2, 1fr); }
    .sm-radar-split { grid-template-columns: 1fr; }
    .sm-leads-layout { grid-template-columns: 1fr; }
    .sm-leads-filters { flex-direction: row; flex-wrap: wrap; gap: 3px; }
    .sm-filter-label { width: 100%; }
    .sm-scores { flex-direction: column; }
  }
</style>
