<script lang="ts">
  import { deserialize } from '$app/forms';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';

  // Internal founders tool — plain Italian labels, no i18n by design.
  let { data, form } = $props();

  type Req = {
    id: string;
    brand: { id: string; name: string; slug: string; plan: string | null } | null;
    platform: string | null;
    brief: string;
    reference_urls: string[];
    status: string;
    admin_note: string | null;
    delivered_media_url: string | null;
    created_at: string;
    month_key: string;
  };
  const requests = $derived(data.requests as Req[]);
  const open = $derived(requests.filter((r) => r.status === 'requested' || r.status === 'in_progress'));
  const closed = $derived(requests.filter((r) => r.status === 'delivered' || r.status === 'rejected'));

  let deliverFor = $state<string | null>(null); // request id with the delivery form open
  let rejectFor = $state<string | null>(null);
  let file = $state<File | null>(null);
  let caption = $state('');
  let note = $state('');
  let busy = $state('');
  let err = $state('');

  function pickVideo(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    file = f && (f.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(f.name)) ? f : null;
  }

  // Delivery = 3 steps: signed URL from the server → browser uploads the clip straight to
  // Storage (serverless bodies are too small for video) → deliver action creates the post.
  async function deliver(id: string) {
    if (!file || busy) return;
    busy = id;
    err = '';
    try {
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
      const fd1 = new FormData();
      fd1.set('id', id);
      fd1.set('ext', ext);
      const res1 = await fetch('?/uploadUrl', { method: 'POST', body: fd1 });
      const r1 = deserialize(await res1.text());
      if (r1.type !== 'success' || !r1.data?.uploadToken) {
        err = 'Firma upload fallita.';
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from('media')
        .uploadToSignedUrl(String(r1.data.uploadPath), String(r1.data.uploadToken), file, {
          contentType: file.type || 'video/mp4'
        });
      if (upErr) {
        err = `Upload fallito: ${upErr.message}`;
        return;
      }
      const fd2 = new FormData();
      fd2.set('id', id);
      fd2.set('path', String(r1.data.uploadPath));
      fd2.set('caption', caption.trim());
      const res2 = await fetch('?/deliver', { method: 'POST', body: fd2 });
      const r2 = deserialize(await res2.text());
      if (r2.type !== 'success') {
        err = 'Consegna fallita.';
        return;
      }
      deliverFor = null;
      file = null;
      caption = '';
      await invalidateAll();
    } catch (e) {
      err = e instanceof Error ? e.message : 'Errore imprevisto.';
    } finally {
      busy = '';
    }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head><title>Anomalia · Video commissionati</title></svelte:head>

<div class="adm">
  <h1>Video commissionati <span class="count">{open.length} aperti</span></h1>
  {#if err}<p class="err">{err}</p>{/if}
  {#if form?.error}<p class="err">{form.error}</p>{/if}

  {#if !open.length}
    <p class="muted">Nessuna richiesta aperta. 🎉</p>
  {/if}

  {#each open as r (r.id)}
    <div class="card">
      <div class="card-top">
        <b>{r.brand?.name ?? '?'}</b>
        <span class="muted">/{r.brand?.slug ?? '?'} · piano {r.brand?.plan ?? '?'} · {r.platform || 'piattaforma libera'} · {fmtDate(r.created_at)}</span>
        <span class="chip {r.status}">{r.status === 'requested' ? 'Da fare' : 'In lavorazione'}</span>
      </div>
      <p class="brief">{r.brief}</p>
      {#if r.reference_urls.length}
        <div class="refs">
          {#each r.reference_urls as u (u)}
            <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="reference" /></a>
          {/each}
        </div>
      {/if}

      <div class="actions">
        {#if r.status === 'requested'}
          <form method="POST" action="?/start" use:enhance>
            <input type="hidden" name="id" value={r.id} />
            <button class="btn">Prendi in carico</button>
          </form>
        {/if}
        <button class="btn primary" onclick={() => { deliverFor = deliverFor === r.id ? null : r.id; rejectFor = null; }}>Consegna video</button>
        <button class="btn danger" onclick={() => { rejectFor = rejectFor === r.id ? null : r.id; deliverFor = null; }}>Rifiuta</button>
      </div>

      {#if deliverFor === r.id}
        <div class="panel">
          <input type="file" accept="video/mp4,video/quicktime,video/webm" onchange={pickVideo} />
          <textarea rows="2" placeholder="Caption per il post (opzionale — l'utente può modificarla)" bind:value={caption}></textarea>
          <button class="btn primary" disabled={!file || busy === r.id} onclick={() => deliver(r.id)}>
            {busy === r.id ? 'Carico e consegno…' : 'Carica e consegna'}
          </button>
          <small>Il video diventa un post "in attesa di approvazione" sul brand; la richiesta passa a Consegnato.</small>
        </div>
      {/if}
      {#if rejectFor === r.id}
        <form class="panel" method="POST" action="?/reject" use:enhance={() => async ({ update }) => { rejectFor = null; note = ''; await update(); }}>
          <input type="hidden" name="id" value={r.id} />
          <textarea rows="2" name="note" placeholder="Motivo per l'utente (visibile nella piattaforma)" bind:value={note}></textarea>
          <button class="btn danger">Conferma rifiuto</button>
        </form>
      {/if}
    </div>
  {/each}

  {#if closed.length}
    <h2>Chiuse di recente</h2>
    {#each closed.slice(0, 15) as r (r.id)}
      <div class="card closed">
        <div class="card-top">
          <b>{r.brand?.name ?? '?'}</b>
          <span class="muted">{fmtDate(r.created_at)}</span>
          <span class="chip {r.status}">{r.status === 'delivered' ? 'Consegnato' : 'Rifiutato'}</span>
          {#if r.delivered_media_url}<a class="muted" href={r.delivered_media_url} target="_blank" rel="noreferrer">clip ↗</a>{/if}
        </div>
        <p class="brief small">{r.brief.length > 140 ? r.brief.slice(0, 140) + '…' : r.brief}</p>
      </div>
    {/each}
  {/if}
</div>

<style>
  .adm { max-width: 760px; margin: 0 auto; padding: 32px 20px 80px; font-size: 14px; }
  h1 { font-size: 22px; display: flex; align-items: baseline; gap: 12px; }
  h2 { font-size: 15px; margin-top: 34px; color: #48484a; }
  .count { font-size: 13px; font-weight: 600; color: #86868b; }
  .muted { color: #86868b; font-size: 12.5px; }
  .err { color: #b3362e; }
  .card { border: 1px solid #e5e5e7; border-radius: 14px; padding: 14px 16px; margin: 12px 0; background: #fff; }
  .card.closed { opacity: 0.75; }
  .card-top { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .chip { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 980px; text-transform: uppercase; }
  .chip.requested { background: rgba(240, 173, 78, 0.15); color: #a8721c; }
  .chip.in_progress { background: rgba(52, 120, 246, 0.12); color: #2a63c4; }
  .chip.delivered { background: rgba(52, 199, 89, 0.14); color: #2c7a3d; }
  .chip.rejected { background: rgba(255, 59, 48, 0.1); color: #b3362e; }
  .brief { margin: 10px 0; white-space: pre-wrap; }
  .brief.small { font-size: 12.5px; margin: 6px 0 0; }
  .refs { display: flex; gap: 8px; margin: 8px 0; }
  .refs img { width: 72px; height: 72px; object-fit: cover; border-radius: 10px; border: 1px solid #e5e5e7; }
  .actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .btn { border: 1px solid #d2d2d7; background: #fff; border-radius: 980px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: #1d1d1f; color: #fff; border-color: transparent; }
  .btn.danger { color: #b3362e; border-color: rgba(255, 59, 48, 0.35); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .panel { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding: 12px; border: 1px dashed #d2d2d7; border-radius: 12px; }
  .panel textarea { border: 1px solid #d2d2d7; border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; }
  .panel small { color: #86868b; }
</style>
