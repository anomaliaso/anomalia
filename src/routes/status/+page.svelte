<script lang="ts">
  import { onMount } from 'svelte';

  interface ServiceCheck {
    name: string;
    status: 'ok' | 'error';
    latencyMs: number;
    error?: string;
  }

  interface StatusResponse {
    status: 'ok' | 'degraded';
    timestamp: string;
    services: ServiceCheck[];
  }

  let data = $state<StatusResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      data = await res.json();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to fetch';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  });

  function ago(ts: string): string {
    const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    return `${Math.floor(sec / 60)}m ago`;
  }
</script>

<svelte:head>
  <title>Anomalia — Status</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="status-page">
  <header>
    <a class="logo" href="/">Anomalia</a>
    <h1>System Status</h1>
  </header>

  {#if loading}
    <div class="loading">Checking services…</div>
  {:else if error}
    <div class="banner error">
      <span class="dot"></span>
      Unable to reach status API
      <span class="detail">{error}</span>
    </div>
  {:else if data}
    <div class="banner {data.status}">
      <span class="dot"></span>
      {#if data.status === 'ok'}
        All systems operational
      {:else if data.status === 'degraded'}
        Partial outage — some services are degraded
      {:else}
        Major outage — multiple services are down
      {/if}
    </div>

    <div class="services">
      {#each data.services as svc}
        <div class="card {svc.status}">
          <div class="card-head">
            <span class="dot"></span>
            <span class="name">{svc.name}</span>
          </div>
          <div class="card-body">
            <span class="latency">{svc.latencyMs}ms</span>
            {#if svc.error}
              <span class="err-msg">{svc.error}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <footer>
      Last checked {ago(data.timestamp)} · Auto-refreshes every 30s
    </footer>
  {/if}
</main>

<style>
  .status-page {
    max-width: 640px;
    margin: 0 auto;
    padding: 3rem 1.5rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a2e;
    background: #fafafa;
    min-height: 100vh;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .logo {
    font-weight: 800;
    font-size: 1.25rem;
    text-decoration: none;
    color: #1a1a2e;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #555;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.25rem;
    border-radius: 12px;
    font-weight: 600;
    font-size: 0.95rem;
    margin-bottom: 1.5rem;
  }

  .banner.ok {
    background: #ecfdf5;
    color: #065f46;
  }

  .banner.degraded {
    background: #fffbeb;
    color: #92400e;
  }

  .banner.critical {
    background: #fef2f2;
    color: #991b1b;
  }

  .banner .detail {
    font-weight: 400;
    font-size: 0.8rem;
    opacity: 0.7;
    margin-left: 0.25rem;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ok .dot {
    background: #10b981;
  }

  .degraded .dot {
    background: #f59e0b;
  }

  .critical .dot {
    background: #ef4444;
  }

  .services {
    display: grid;
    gap: 0.75rem;
  }

  .card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.9rem 1.25rem;
    border-radius: 10px;
    background: #fff;
    border: 1px solid #e5e7eb;
    transition: border-color 0.2s;
  }

  .card.ok {
    border-left: 3px solid #10b981;
  }

  .card.error {
    border-left: 3px solid #ef4444;
  }

  .card.error .card-head .dot {
    background: #ef4444;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .card-head .dot {
    width: 8px;
    height: 8px;
  }

  .card.ok .card-head .dot {
    background: #10b981;
  }

  .card.error .card-head .dot {
    background: #ef4444;
  }

  .name {
    font-weight: 600;
    font-size: 0.9rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .card-body {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .latency {
    font-size: 0.8rem;
    color: #9ca3af;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .err-msg {
    font-size: 0.75rem;
    color: #ef4444;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .loading {
    text-align: center;
    padding: 4rem 0;
    color: #9ca3af;
  }

  footer {
    margin-top: 2rem;
    text-align: center;
    font-size: 0.75rem;
    color: #9ca3af;
  }
</style>
