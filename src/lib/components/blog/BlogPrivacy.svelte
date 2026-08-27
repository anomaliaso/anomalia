<script lang="ts">
  import { openBlogCookieSettings } from './blog-consent.svelte';
  // Templated privacy & cookie notice for a hosted brand blog. It discloses the ONE tracker that
  // runs here (Meta Pixel, loaded only after consent). Generic on purpose — the same policy fits
  // every blog because they all run the same setup. Brand name is injected for identification.
  let { brand, base = '' } = $props();
  const updated = '19 agosto 2026';
</script>

<article class="legal">
  <h1>Privacy &amp; Cookie Policy</h1>
  <p class="upd">Ultimo aggiornamento: {updated}</p>

  <p>
    Questo sito è il blog di <strong>{brand.name}</strong>. Di seguito spieghiamo quali dati vengono
    raccolti durante la navigazione e come gestirli. La lettura degli articoli non richiede alcuna
    registrazione.
  </p>

  <h2>Cookie e strumenti di misurazione</h2>
  <p>
    Per capire quante persone leggono gli articoli, il sito può caricare il <strong>Meta Pixel</strong>
    (Meta Platforms Ireland Ltd.). Questo strumento imposta cookie di terze parti e viene attivato
    <strong>solo dopo il tuo consenso</strong>: se rifiuti, nessun cookie di misurazione viene installato.
  </p>
  <ul>
    <li><strong>Finalità:</strong> statistiche di visita in forma aggregata.</li>
    <li><strong>Base giuridica:</strong> il tuo consenso (art. 6.1.a GDPR), revocabile in ogni momento.</li>
    <li><strong>Destinatari:</strong> Meta Platforms Ireland Ltd. e la piattaforma tecnica che ospita il sito.</li>
    <li><strong>Cookie strettamente funzionali</strong> (es. la scelta del tema chiaro/scuro) sono salvati nel tuo browser senza richiedere consenso e non tracciano la navigazione.</li>
  </ul>

  <h2>Gestire il consenso</h2>
  <p>Puoi cambiare idea quando vuoi: riapri il pannello e scegli di nuovo.</p>
  <button type="button" class="pref-btn" onclick={openBlogCookieSettings}>Gestisci preferenze cookie</button>

  <h2>Intelligenza artificiale</h2>
  <p>
    I contenuti del blog sono prodotti con l'ausilio di sistemi di intelligenza artificiale e
    approvati da {brand.name} prima della pubblicazione (lo indichiamo anche nei
    <a href={`${base}/terms`}>Termini di utilizzo</a>). La lettura degli articoli non comporta alcuna
    profilazione automatizzata dei visitatori né decisioni automatizzate che li riguardino.
  </p>

  <h2>I tuoi diritti</h2>
  <p>
    Puoi chiedere accesso, rettifica o cancellazione dei dati che ti riguardano e revocare il consenso
    in qualsiasi momento, scrivendo al titolare del sito ({brand.name}). Hai inoltre diritto di reclamo
    all'autorità di controllo (in Italia, il Garante per la protezione dei dati personali).
  </p>

  <p class="back"><a href={base || '/'}>← Torna al blog</a></p>
</article>

<style>
  .legal { max-width: 720px; margin: 0 auto; padding: 8px 0 40px; }
  .legal h1 { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 6px; }
  .upd { font-size: 13px; color: var(--ink-faint, #86868b); margin: 0 0 28px; }
  .legal h2 { font-size: 20px; font-weight: 600; margin: 32px 0 10px; }
  .legal p { font-size: 16px; line-height: 1.7; margin: 0 0 14px; }
  .legal ul { font-size: 16px; line-height: 1.7; margin: 0 0 14px; padding-left: 22px; }
  .legal li { margin: 0 0 6px; }
  .pref-btn {
    display: inline-block; margin: 4px 0 8px; padding: 9px 18px;
    font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--line-2, #d2d2d7); border-radius: 999px;
    background: transparent; color: var(--ink, #1a1a1a); transition: background 0.15s, border-color 0.15s;
  }
  .pref-btn:hover { border-color: var(--accent); color: var(--accent); }
  .back { margin-top: 32px; }
  .back a { color: var(--accent); text-decoration: none; }
  .back a:hover { text-decoration: underline; }
</style>
