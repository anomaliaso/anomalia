<script lang="ts">
  let { data } = $props();

  const snapshot = $derived(data.snapshot as Record<string, any>);

  const METRICS = ['views', 'likes', 'comments', 'shares'] as const;

  const TITLES: Record<string, string> = {
    calendar: 'Content calendar',
    dashboard: 'This month',
    monthly_report: 'Monthly report',
    strategy: 'The plan'
  };

  // Il workspace è la somma delle altre viste, non una vista in più: ogni scheda legge la sezione
  // che quella vista consegnerebbe da sola. Cambiare scheda non chiede niente al server — lo
  // snapshot è già tutto qui, e non c'è niente da chiedere: un link pubblico non scrive mai.
  const TABS = ['dashboard', 'calendar', 'monthly_report', 'strategy'] as const;
  const SECTION: Record<(typeof TABS)[number], string> = {
    dashboard: 'dashboard',
    calendar: 'calendar',
    monthly_report: 'report',
    strategy: 'strategy'
  };

  const isWorkspace = $derived(data.view === 'workspace');
  let tab = $state<(typeof TABS)[number]>('dashboard');
  const view = $derived(isWorkspace ? tab : (data.view as string));
  const section = $derived(isWorkspace ? (snapshot[SECTION[tab]] as Record<string, any>) : snapshot);

  function day(post: { scheduled_for: string | null; slot: string | null }): string {
    const raw = post.scheduled_for ?? post.slot ?? '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function time(post: { scheduled_for: string | null }): string {
    if (!post.scheduled_for) return '';
    const parsed = new Date(post.scheduled_for);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function weekDay(start: string | null): string {
    if (!start) return '';
    const parsed = new Date(`${start}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return start;
    return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  const number = (n: unknown) => Number(n ?? 0).toLocaleString();

  const emptyStrategy = (s: Record<string, any>) =>
    !s.statement && !s.objective && !s.phase && s.weeks.length === 0 && s.platforms.length === 0;
</script>

{#snippet postList(list: Record<string, any>[])}
  <ol class="calendar">
    {#each list as post, i (i)}
      <li>
        <div class="when">
          <span class="date">{day(post)}</span>
          <span class="hour">{time(post)}</span>
        </div>
        <div class="what">
          <div class="meta">
            <span class="platform">{post.platform ?? '—'}</span>
            <span class="status status-{post.status}">{post.status}</span>
          </div>
          {#if post.caption}<p class="caption">{post.caption}</p>{/if}
        </div>
        {#if post.media_url}
          <img class="thumb" src={post.media_url} alt="" loading="lazy" />
        {/if}
      </li>
    {/each}
  </ol>
{/snippet}

{#snippet body(which: string, s: Record<string, any>)}
  {#if which === 'dashboard'}
    <section class="tiles">
      <div class="tile"><span class="n">{number(s.published)}</span><span class="l">published</span></div>
      <div class="tile"><span class="n">{number(s.planned)}</span><span class="l">planned</span></div>
      <div class="tile"><span class="n">{number(s.reach)}</span><span class="l">reach</span></div>
    </section>

    <h2>Next out</h2>
    {#if s.upcoming.length === 0}
      <p class="empty">Nothing planned for the rest of this month.</p>
    {:else}
      {@render postList(s.upcoming)}
    {/if}
  {:else if which === 'calendar'}
    {#if s.posts.length === 0}
      <p class="empty">Nothing planned for this month yet.</p>
    {:else}
      {@render postList(s.posts)}
    {/if}
  {:else if which === 'strategy'}
    {#if emptyStrategy(s)}
      <p class="empty">The plan is not published yet.</p>
    {:else}
      {#if s.statement}<p class="statement">{s.statement}</p>{/if}

      {#if s.objective || s.cadence || s.horizon}
        <dl class="facts">
          {#if s.objective}<div><dt>Objective</dt><dd>{s.objective}</dd></div>{/if}
          {#if s.horizon}<div><dt>Horizon</dt><dd>{s.horizon}</dd></div>{/if}
          {#if s.cadence}<div><dt>Cadence</dt><dd>{s.cadence}</dd></div>{/if}
        </dl>
      {/if}

      {#if s.phase}
        <h2>This phase</h2>
        <p class="statement">{s.phase.name ?? ''}{s.phase.objective ? ` — ${s.phase.objective}` : ''}</p>
        {#if s.phase.goals.length}
          <table>
            <thead><tr><th>Goal</th><th>Target</th></tr></thead>
            <tbody>
              {#each s.phase.goals as goal, i (i)}
                <tr><td>{goal.kpi ?? '—'}</td><td>{goal.target ?? '—'}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}

      {#if s.platforms.length}
        <h2>Platforms</h2>
        <table>
          <thead><tr><th>Platform</th><th>Share</th><th>Role</th></tr></thead>
          <tbody>
            {#each s.platforms as row, i (i)}
              <tr><td>{row.platform ?? '—'}</td><td>{row.share ?? '—'}</td><td class="role">{row.role ?? '—'}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}

      {#if s.weeks.length}
        <h2>Weeks</h2>
        <ol class="calendar">
          {#each s.weeks as w, i (i)}
            <li>
              <div class="when">
                <span class="date">{weekDay(w.week_start) || `Week ${i + 1}`}</span>
                <span class="hour">{w.status ?? ''}</span>
              </div>
              <div class="what">
                <div class="meta"><span class="platform">{w.theme ?? '—'}</span></div>
                {#if w.focus}<p class="caption">{w.focus}</p>{/if}
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    {/if}
  {:else}
    <section class="tiles">
      <div class="tile"><span class="n">{number(s.published)}</span><span class="l">published</span></div>
      {#each METRICS as metric (metric)}
        <div class="tile"><span class="n">{number(s.totals[metric])}</span><span class="l">{metric}</span></div>
      {/each}
    </section>

    {#if s.platforms.length}
      <table>
        <thead>
          <tr><th>Platform</th><th>Posts</th>{#each METRICS as metric (metric)}<th>{metric}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each s.platforms as row (row.platform)}
            <tr>
              <td>{row.platform}</td>
              <td>{number(row.published)}</td>
              {#each METRICS as metric (metric)}<td>{number(row[metric])}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if s.top_posts.length}
      <h2>Best performing</h2>
      <ol class="tops">
        {#each s.top_posts as post, i (i)}
          <li>
            {#if post.thumbnail_url}<img class="thumb" src={post.thumbnail_url} alt="" loading="lazy" />{/if}
            <div class="what">
              <span class="platform">{post.platform ?? '—'}</span>
              {#if post.caption}<p class="caption">{post.caption}</p>{/if}
              <p class="nums">
                {#each METRICS as metric (metric)}<span>{number(post[metric])} {metric}</span>{/each}
              </p>
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="empty">No published posts recorded for this month.</p>
    {/if}
  {/if}
{/snippet}

<svelte:head>
  <title>{snapshot.brand_name} — {snapshot.month_label}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
  <header>
    <p class="eyebrow">{snapshot.brand_name}</p>
    <h1>{TITLES[view] ?? 'Monthly report'}</h1>
    <p class="sub">{snapshot.month_label}</p>
  </header>

  {#if isWorkspace}
    <nav class="tabs">
      {#each TABS as name (name)}
        <button type="button" class:on={name === tab} onclick={() => (tab = name)}>{TITLES[name]}</button>
      {/each}
    </nav>
  {/if}

  {@render body(view, section)}

  <footer>Snapshot taken {new Date(data.created_at).toLocaleDateString()}.</footer>
</main>

<style>
  main {
    max-width: 46rem;
    margin: 0 auto;
    padding: 3rem 1.25rem 4rem;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #18181b;
  }
  .eyebrow {
    margin: 0;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #71717a;
  }
  h1 {
    margin: 0.35rem 0 0;
    font-size: 1.75rem;
    line-height: 1.2;
  }
  h2 {
    margin: 2.5rem 0 0.75rem;
    font-size: 1.05rem;
  }
  .sub {
    margin: 0.25rem 0 2rem;
    color: #52525b;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0 0 2rem;
  }
  .tabs button {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.35rem 0.8rem;
    border: 1px solid #e4e4e7;
    border-radius: 999px;
    background: #fff;
    color: #52525b;
    cursor: pointer;
  }
  .tabs button.on {
    background: #18181b;
    border-color: #18181b;
    color: #fafafa;
  }
  .empty {
    color: #71717a;
  }
  .statement {
    margin: 0 0 1.5rem;
    font-size: 1rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.75rem;
    margin: 0 0 1rem;
  }
  .facts div {
    padding: 0.9rem 1rem;
    border: 1px solid #e4e4e7;
    border-radius: 0.75rem;
  }
  .facts dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #71717a;
  }
  .facts dd {
    margin: 0.2rem 0 0;
    font-size: 0.95rem;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .calendar li,
  .tops li {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    padding: 1rem 0;
    border-top: 1px solid #e4e4e7;
  }
  .when {
    display: flex;
    flex-direction: column;
    min-width: 6rem;
  }
  .date {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .hour {
    color: #71717a;
    font-size: 0.8rem;
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  .meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.25rem;
  }
  .platform {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #52525b;
  }
  .status {
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: #f4f4f5;
    color: #52525b;
  }
  .status-published {
    background: #dcfce7;
    color: #166534;
  }
  .caption {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .thumb {
    width: 4.5rem;
    height: 4.5rem;
    object-fit: cover;
    border-radius: 0.5rem;
    flex: none;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 2rem;
  }
  .tile {
    display: flex;
    flex-direction: column;
    padding: 0.9rem 1rem;
    border: 1px solid #e4e4e7;
    border-radius: 0.75rem;
  }
  .tile .n {
    font-size: 1.4rem;
    font-weight: 650;
  }
  .tile .l {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #71717a;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th,
  td {
    text-align: right;
    padding: 0.5rem 0.4rem;
    border-bottom: 1px solid #e4e4e7;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    text-transform: capitalize;
  }
  td.role {
    text-align: left;
    text-transform: none;
  }
  th {
    color: #71717a;
    font-weight: 500;
    text-transform: capitalize;
  }
  .nums {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0.4rem 0 0;
    font-size: 0.78rem;
    color: #71717a;
  }
  footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #e4e4e7;
    font-size: 0.78rem;
    color: #a1a1aa;
  }
</style>
