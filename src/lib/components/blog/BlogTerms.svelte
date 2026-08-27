<script lang="ts">
  // Templated terms of use for a hosted brand blog (content site — no accounts, no purchases).
  // Generic on purpose; brand name injected for identification.
  let { brand, base = '' } = $props();
  const updated = '19 agosto 2026';
</script>

<article class="legal">
  <h1>Termini di utilizzo</h1>
  <p class="upd">Ultimo aggiornamento: {updated}</p>

  <p>
    Questo sito è il blog di <strong>{brand.name}</strong>. Accedendo e consultando i contenuti accetti
    i termini qui descritti.
  </p>

  <h2>Contenuti</h2>
  <p>
    Gli articoli hanno finalità informativa e divulgativa. Pur curandone l'accuratezza, non
    garantiamo che siano sempre completi, aggiornati o privi di errori, e non costituiscono
    consulenza professionale.
  </p>

  <h2>Contenuti generati con l'intelligenza artificiale</h2>
  <p>
    Gli articoli e le immagini di questo blog sono redatti con l'ausilio di sistemi di intelligenza
    artificiale, sotto la supervisione e con l'approvazione di {brand.name}. Le immagini e i video
    prodotti in questo modo sono contenuti sintetici: non ritraggono persone, luoghi o eventi reali,
    salvo quando indicato diversamente nell'articolo. Segnaliamo questa circostanza in trasparenza,
    anche in linea con l'articolo 50 del Regolamento (UE) 2024/1689 (AI Act).
  </p>
  <p>
    Come per ogni contenuto informativo, ti invitiamo a verificare dati, cifre e indicazioni
    sensibili (sanitarie, finanziarie o legali) presso fonti primarie prima di prendere decisioni.
  </p>

  <h2>Proprietà intellettuale</h2>
  <p>
    Testi, immagini e marchi presenti sul sito appartengono a {brand.name} o ai rispettivi titolari.
    Puoi leggere e condividere i link agli articoli; la riproduzione integrale senza autorizzazione
    non è consentita.
  </p>

  <h2>Link esterni</h2>
  <p>
    Il sito può contenere collegamenti a siti di terze parti, sui cui contenuti non abbiamo controllo
    e per i quali non ci assumiamo responsabilità.
  </p>

  <h2>Limitazione di responsabilità</h2>
  <p>
    Il sito è fornito "così com'è". Nei limiti consentiti dalla legge, {brand.name} non è responsabile
    per eventuali danni derivanti dall'uso o dall'impossibilità di utilizzare i contenuti.
  </p>

  <h2>Contatti e legge applicabile</h2>
  <p>
    Per qualsiasi richiesta puoi contattare il titolare del sito ({brand.name}). I presenti termini
    sono regolati dalla legge italiana.
  </p>

  <p class="back"><a href={base || '/'}>← Torna al blog</a></p>
</article>

<style>
  .legal { max-width: 720px; margin: 0 auto; padding: 8px 0 40px; }
  .legal h1 { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 6px; }
  .upd { font-size: 13px; color: var(--ink-faint, #86868b); margin: 0 0 28px; }
  .legal h2 { font-size: 20px; font-weight: 600; margin: 32px 0 10px; }
  .legal p { font-size: 16px; line-height: 1.7; margin: 0 0 14px; }
  .back { margin-top: 32px; }
  .back a { color: var(--accent); text-decoration: none; }
  .back a:hover { text-decoration: underline; }
</style>
