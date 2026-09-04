<script lang="ts">
  let { data } = $props();

  const snapshot = $derived(data.snapshot as Record<string, any>);
  const isCalendar = $derived(data.view === 'calendar');

  const METRICS = ['views', 'likes', 'comments', 'shares'] as const;

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

  const number = (n: unknown) => Number(n ?? 0).toLocaleString();
</script>

<svelte:head>
  <title>{snapshot.brand_name} — {snapshot.month_label}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
  <header>
    <p class="eyebrow">{snapshot.brand_name}</p>
    <h1>{isCalendar ? 'Content calendar' : 'Monthly report'}</h1>
    <p class="sub">{snapshot.month_label}</p>
  </header>

  {#if isCalendar}
    {#if snapshot.posts.length === 0}
      <p class="empty">Nothing planned for this month yet.</p>
    {:else}
      <ol class="calendar">
        {#each snapshot.posts as post, i (i)}
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
    {/if}
  {:else}
    <section class="tiles">
      <div class="tile"><span class="n">{number(snapshot.published)}</span><span class="l">published</span></div>
      {#each METRICS as metric (metric)}
        <div class="tile"><span class="n">{number(snapshot.totals[metric])}</span><span class="l">{metric}</span></div>
      {/each}
    </section>

    {#if snapshot.platforms.length}
      <table>
        <thead>
          <tr><th>Platform</th><th>Posts</th>{#each METRICS as metric (metric)}<th>{metric}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each snapshot.platforms as row (row.platform)}
            <tr>
              <td>{row.platform}</td>
              <td>{number(row.published)}</td>
              {#each METRICS as metric (metric)}<td>{number(row[metric])}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if snapshot.top_posts.length}
      <h2>Best performing</h2>
      <ol class="tops">
        {#each snapshot.top_posts as post, i (i)}
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
  .empty {
    color: #71717a;
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
