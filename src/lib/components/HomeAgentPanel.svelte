<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { name = 'Content Creator' }: { name?: string } = $props();

  const desktopNav = [
    'app.nav.homeOverview',
    'app.nav.calendar',
    'app.nav.content',
    'app.nav.analytics'
  ];
  const calendarRows = [
    { title: 'landing.chat.remote.launchStory', status: 'app.status.pending_user' },
    { title: 'landing.chat.remote.behindScenes', status: 'app.status.scheduled' },
    { title: 'landing.chat.remote.customerNote', status: 'app.status.published' }
  ];
</script>

<aside class="home-agent-panel" data-state="open" aria-label={$_('chat.computer.toggle')}>
  <header class="home-agent-head">
    <div class="home-agent-heading">
      <span class="home-agent-kicker">{$_('chat.computer.toggle')}</span>
      <h3>{$_('chat.computer.title', { values: { name } })}</h3>
    </div>
    <span class="home-agent-status"><span aria-hidden="true"></span>{$_('chat.computer.nowWorking')}</span>
  </header>

  <div class="home-agent-scroll">
    <section class="home-agent-identity">
      <span class="home-agent-avatar" aria-hidden="true">CC</span>
      <div>
        <strong>{name}</strong>
        <span>{$_('app.nav.content')} · {$_('chat.computer.activity')}</span>
      </div>
    </section>

    <section class="home-agent-section">
      <div class="home-agent-section-head">
        <h4>{$_('chat.computer.activity')}</h4>
        <span>{$_('chat.computer.nowWorking')}</span>
      </div>

      <div class="home-computer-window">
        <div class="home-computer-window-head">
          <span class="home-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>{$_('chat.computer.desktopTitle')}</span>
          <span class="home-window-live">{$_('landing.chat.remote.live')}</span>
        </div>

        <div class="home-computer-screen" data-testid="remote-computer-screen" role="img" aria-label={$_('chat.computer.machine')}>
          <div class="home-desktop-bar">
            <span class="home-desktop-brand">ANOMALIA</span>
            <span class="home-desktop-time">09:24</span>
          </div>
          <div class="home-desktop-body">
            <nav class="home-desktop-nav" aria-hidden="true">
              {#each desktopNav as item, i (item)}
                <span class:active={i === 1}><i></i>{$_(item)}</span>
              {/each}
            </nav>

            <div class="home-desktop-workspace">
              <div class="home-browser-bar"><span>⌕</span><span>anomalia.so/app/flash-camp</span><b>•••</b></div>
              <div class="home-workspace-head">
                <div>
                  <span class="home-workspace-overline">{$_('landing.chat.remote.brand')}</span>
                  <strong>{$_('app.calendar.title')}</strong>
                </div>
                <span class="home-workspace-menu">•••</span>
              </div>

              <div class="home-calendar-stats">
                <span><b>12</b>{$_('app.status.published')}</span>
                <span><b>04</b>{$_('app.status.pending_user')}</span>
              </div>

              <div class="home-calendar-list">
                {#each calendarRows as row, i (row.title)}
                  <div class="home-calendar-row">
                    <span class="home-calendar-date">{i === 0 ? $_('landing.chat.remote.today') : i === 1 ? $_('landing.chat.remote.tue') : $_('landing.chat.remote.wed')}</span>
                    <span class="home-calendar-title"><i></i>{$_(row.title)}</span>
                    <span class:pending={i === 0} class="home-calendar-status">{$_(row.status)}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>
          <span class="home-desktop-cursor" aria-hidden="true"></span>
        </div>
      </div>

      <p class="home-agent-working"><span aria-hidden="true"></span>{$_('chat.computer.nowWorking')} · {$_('app.nav.calendar')}</p>
    </section>

    <section class="home-agent-section home-agent-report">
      <h4>{$_('chat.computer.lastReport')}</h4>
      <p>{$_('landing.chat.remote.calendarChecked', { values: { count: 4 } })}</p>
      <p>{$_('landing.chat.remote.nextPost')}</p>
    </section>

    <a class="home-agent-open" href="#top">{$_('chat.computer.openWork')}</a>
  </div>
</aside>

<style>
  .home-agent-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--paper);
    color: var(--ink);
    border-left: 1px solid var(--line);
  }
  .home-agent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  .home-agent-heading { min-width: 0; }
  .home-agent-kicker,
  .home-agent-section-head h4,
  .home-agent-report h4 {
    margin: 0;
    font-size: 0.67rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .home-agent-heading h3 {
    margin: 4px 0 0;
    font-size: 0.95rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .home-agent-status,
  .home-agent-section-head > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 0 0 auto;
    font-size: 0.65rem;
    font-weight: 650;
    color: #16a34a;
    white-space: nowrap;
  }
  .home-agent-status span,
  .home-agent-working span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #16a34a;
  }
  .home-agent-scroll {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: 0;
    padding: 16px;
    overflow-y: auto;
  }
  .home-agent-identity {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .home-agent-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    border-radius: 11px;
    background: linear-gradient(135deg, var(--accent-2), var(--accent));
    color: #fff;
    font-size: 0.63rem;
    font-weight: 750;
  }
  .home-agent-identity div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .home-agent-identity strong { font-size: 0.82rem; font-weight: 650; }
  .home-agent-identity span { font-size: 0.7rem; color: var(--ink-faint); }
  .home-agent-section { display: flex; flex-direction: column; gap: 8px; }
  .home-agent-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .home-agent-section-head > span { font-size: 0.63rem; }
  .home-computer-window {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper-2);
  }
  .home-computer-window-head {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 9px;
    border-bottom: 1px solid var(--line);
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .home-window-dots { display: flex; gap: 4px; margin-right: 3px; }
  .home-window-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-faint); opacity: 0.55; }
  .home-window-live { margin-left: auto; color: #16a34a; font-size: 0.55rem; letter-spacing: 0.06em; }
  .home-computer-screen {
    position: relative;
    overflow: hidden;
    aspect-ratio: 1.08;
    background: #f6f7f9;
    color: #28303d;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .home-desktop-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 20px;
    padding: 0 8px;
    background: #242b37;
    color: #dbe2eb;
    font-size: 0.49rem;
    letter-spacing: 0.04em;
  }
  .home-desktop-brand { font-weight: 750; }
  .home-desktop-time { opacity: 0.65; }
  .home-desktop-body { display: grid; grid-template-columns: 58px minmax(0, 1fr); height: calc(100% - 20px); }
  .home-desktop-nav { padding: 8px 5px; background: #fff; border-right: 1px solid #e4e7ec; }
  .home-desktop-nav span { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; overflow: hidden; color: #8992a2; font-size: 0.43rem; white-space: nowrap; }
  .home-desktop-nav span.active { color: #4952c6; font-weight: 700; }
  .home-desktop-nav i { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 2px; background: currentColor; opacity: 0.65; }
  .home-desktop-workspace { min-width: 0; padding: 7px; }
  .home-browser-bar { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 3px 5px; border: 1px solid #e2e6ec; border-radius: 4px; background: #fff; color: #9aa2af; font-size: 0.43rem; }
  .home-browser-bar span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .home-browser-bar b { margin-left: auto; font-size: 0.48rem; letter-spacing: 0.03em; }
  .home-workspace-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 10px 1px 7px; }
  .home-workspace-head div { display: flex; flex-direction: column; gap: 2px; }
  .home-workspace-overline { color: #9ba3b0; font-size: 0.4rem; letter-spacing: 0.08em; }
  .home-workspace-head strong { color: #293241; font-size: 0.67rem; }
  .home-workspace-menu { color: #9ba3b0; font-size: 0.55rem; }
  .home-calendar-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 7px; }
  .home-calendar-stats span { display: flex; flex-direction: column; gap: 1px; padding: 5px; border: 1px solid #e2e6ec; border-radius: 5px; background: #fff; color: #8992a2; font-size: 0.42rem; }
  .home-calendar-stats b { color: #293241; font-size: 0.68rem; }
  .home-calendar-list { display: flex; flex-direction: column; gap: 4px; }
  .home-calendar-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 4px; padding: 5px; border: 1px solid #e7e9ee; border-radius: 5px; background: #fff; }
  .home-calendar-date { color: #a4abb6; font-size: 0.38rem; font-weight: 700; }
  .home-calendar-title { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; color: #4d5767; font-size: 0.43rem; text-overflow: ellipsis; white-space: nowrap; }
  .home-calendar-title i { width: 4px; height: 4px; flex: 0 0 auto; border-radius: 50%; background: #6470d8; }
  .home-calendar-status { color: #8d96a4; font-size: 0.36rem; }
  .home-calendar-status.pending { color: #6470d8; font-weight: 700; }
  .home-desktop-cursor { position: absolute; right: 26%; bottom: 25%; width: 0; height: 0; border-top: 8px solid #1f2937; border-right: 5px solid transparent; border-bottom: 2px solid transparent; border-left: 5px solid transparent; transform: rotate(-28deg); filter: drop-shadow(1px 1px 0 #fff); }
  .home-agent-working { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--ink-soft); font-size: 0.68rem; }
  .home-agent-working span { animation: home-agent-pulse 1.6s ease-in-out infinite; }
  .home-agent-report { gap: 5px; padding: 10px 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-2); }
  .home-agent-report p { margin: 0; color: var(--ink-soft); font-size: 0.68rem; line-height: 1.4; }
  .home-agent-open { align-self: flex-start; color: var(--accent); font-size: 0.72rem; font-weight: 650; text-decoration: none; }
  .home-agent-open:hover { text-decoration: underline; }
  @keyframes home-agent-pulse { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .home-agent-working span { animation: none; } }
</style>
