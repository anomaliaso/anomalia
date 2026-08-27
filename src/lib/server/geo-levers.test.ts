import { describe, expect, it } from 'vitest';
import {
  GEO_LEVER_WEIGHTS,
  antiCitationSignalsOf,
  corroborationOf,
  entityClarityOf,
  evidenceDensityOf,
  extractabilityOf,
  geoCitability
} from './geo-levers';

const citable = `
<h2>Quanto costa approvare una fattura?</h2>
<p>In media 6 giorni nel 2025, secondo il campione di 240 studi che abbiamo misurato a marzo.
Il 68% del tempo se ne va nell'attesa fra l'invio e la prima risposta, non nella verifica.
La verifica vera richiede circa 11 minuti per fattura.</p>
<blockquote>"Non avevo idea che il collo di bottiglia fosse l'attesa" — Marco Rossi, Rossi Architetti</blockquote>
<table><tr><td>Attesa</td><td>68%</td></tr><tr><td>Verifica</td><td>32%</td></tr></table>
<h2>Come si riduce l'attesa?</h2>
<p>Un sollecito automatico a 24 ore recupera un preventivo su quattro, misurato su 240 casi.
Il meccanismo è banale: la fattura viene abbinata all'ordine e sale solo quello che non riconcilia.
Nel nostro campione era il 6% delle fatture.</p>
<ul><li>Abbinamento automatico</li><li>Escalation solo sugli scarti</li></ul>
<h2>Perché il sollecito automatico funziona?</h2>
<p>Perché sposta il costo cognitivo dallo studio al sistema. Chi ha inviato il preventivo non deve
ricordarsi di richiamare: il sistema lo fa a 24 ore, con lo stesso testo che lo studio avrebbe usato,
e smette appena arriva una risposta. Nel campione di 240 studi misurato a marzo 2025, gli studi che
lo avevano attivo hanno recuperato il 24% dei preventivi rimasti in silenzio, contro il 9% di chi
solleciterebbe a mano ma nella pratica non lo fa quasi mai. La differenza non è il testo del
sollecito: è che il sollecito parte. Su 240 studi, 31 avevano già una procedura scritta per farlo a
mano e solo 4 la applicavano in modo continuativo, il che rende la procedura scritta un indicatore
quasi inutile della pratica reale. Il costo di mantenimento è vicino a zero perché il sistema legge
lo stato del preventivo dal gestionale invece di chiedere allo studio di aggiornarlo.</p>
<h2>Chi dovrebbe attivarlo e chi no?</h2>
<p>Ha senso per chi manda più di dieci preventivi al mese e li perde nel silenzio, non per chi ne
manda due e li segue di persona. Sotto quella soglia il sollecito automatico risolve un problema che
non esiste e aggiunge un canale in più da controllare. Nel campione, gli studi sotto i dieci
preventivi mensili non hanno mostrato differenze misurabili fra chi lo aveva attivo e chi no.</p>
<p><a href="https://example.org/studio">Fonte: studio 2025</a></p>
`;

const generic = `
<h2>La nostra soluzione</h2>
<p>In questo articolo parliamo di come trasformare il tuo flusso di lavoro. Le nostre soluzioni
innovative aiutano le aziende a semplificare i processi e a raggiungere risultati straordinari.
Come detto sopra, questo cambia tutto per il tuo business. Scopri di più oggi stesso.</p>
`;

describe('extractabilityOf', () => {
  it('rewards question headings, liftable blocks and structured facts', () => {
    const r = extractabilityOf(citable);
    expect(r.questionHeadings).toBe(4);
    expect(r.structuredFacts).toBeGreaterThan(0);
    expect(r.value).toBeGreaterThan(0.4);
  });

  it('punishes a section that cannot be read on its own', () => {
    const r = extractabilityOf(generic);
    expect(r.danglingSections + r.preambleBlocks).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(extractabilityOf(citable).value);
  });

  it('scores a page with no headings at zero and says why', () => {
    const r = extractabilityOf('<p>Un blocco unico senza struttura.</p>');
    expect(r.value).toBe(0);
    expect(r.note).toContain('Nessun heading');
  });
});

describe('evidenceDensityOf', () => {
  it('rewards quotations, statistics, sources and dates', () => {
    const r = evidenceDensityOf(citable);
    expect(r.quotations).toBeGreaterThan(0);
    expect(r.numbers).toBeGreaterThan(0);
    expect(r.citedSources).toBeGreaterThan(0);
    expect(r.value).toBeGreaterThan(0.3);
  });

  it('tells a page that a model could have written it itself', () => {
    const r = evidenceDensityOf(generic);
    expect(r.value).toBeLessThan(0.3);
    expect(r.note).toContain('può già produrre questo testo');
  });
});

describe('entityClarityOf', () => {
  it('credits schema, an explicit category statement and the brand being named', () => {
    const html = '<p>Anomalia è un autopilota social per studi creativi che pubblica al posto tuo.</p>';
    const r = entityClarityOf(html, 'Anomalia', ['Organization', 'Product']);
    expect(r.hasOrganization).toBe(true);
    expect(r.hasProduct).toBe(true);
    expect(r.brandNamed).toBe(true);
    expect(r.hasCategoryStatement).toBe(true);
    expect(r.value).toBeGreaterThan(0.9);
  });

  it('names the missing category sentence as the fixable gap', () => {
    const r = entityClarityOf('<p>Benvenuti nel nostro sito.</p>', 'Anomalia', []);
    expect(r.hasCategoryStatement).toBe(false);
    expect(r.note).toContain('frase di categoria');
  });
});

describe('corroborationOf', () => {
  it('tracks being NAMED and being CITED as two different events', () => {
    const r = corroborationOf({ probes: 10, mentioned: 8, domainCited: 1 });
    expect(r.mentionRate).toBe(0.8);
    expect(r.domainCitedRate).toBe(0.1);
    expect(r.note).toContain('due eventi diversi');
  });

  it('says it was not measured rather than scoring zero, when no probe ran', () => {
    const r = corroborationOf({ probes: 0, mentioned: 0, domainCited: 0 });
    expect(r.note).toContain('non è stata misurata');
  });
});

describe('antiCitationSignalsOf', () => {
  it('flags a thin, undated page', () => {
    const ids = antiCitationSignalsOf('<p>Poche parole.</p>').map((s) => s.id);
    expect(ids).toContain('thin_page');
    expect(ids).toContain('undated');
  });

  it('flags an interstitial over the content', () => {
    const ids = antiCitationSignalsOf(`${citable}<div class="cookie-consent-banner"></div>`).map((s) => s.id);
    expect(ids).toContain('interstitial');
  });

  it('flags a missing named author only when the caller actually checked', () => {
    expect(antiCitationSignalsOf(citable).map((s) => s.id)).not.toContain('no_author');
    expect(antiCitationSignalsOf(citable, { hasNamedAuthor: false }).map((s) => s.id)).toContain('no_author');
  });

  it('flags client-side-rendered primary content', () => {
    const shell = `<div id="root"></div>${'<div class="a b c d e f g h"></div>'.repeat(200)}`;
    expect(antiCitationSignalsOf(shell).map((s) => s.id)).toContain('js_gated');
  });

  it('leaves a clean reference page alone', () => {
    const ids = antiCitationSignalsOf(citable).map((s) => s.id);
    expect(ids).not.toContain('thin_page');
    expect(ids).not.toContain('undated');
  });
});

describe('geoCitability', () => {
  const full = { extractability: 0.8, evidence: 0.7, entity: 0.9, corroboration: 0.5, machineAccess: 0.95 };

  it('weights the technical audit at 10%, not at 100%', () => {
    expect(GEO_LEVER_WEIGHTS.machine_access).toBe(10);
    expect(GEO_LEVER_WEIGHTS.extractability + GEO_LEVER_WEIGHTS.evidence).toBe(50);
  });

  it('scores across the five levers', () => {
    const r = geoCitability(full);
    expect(r.graded.score).toBeGreaterThan(60);
    expect(r.graded.coverage).toBe(100);
    expect(r.levers).toHaveLength(5);
  });

  it('treats an unmeasured lever as unknown, never as zero', () => {
    const withProbes = geoCitability(full);
    const noProbes = geoCitability({ ...full, corroboration: null });
    expect(noProbes.graded.score).toBeGreaterThan(withProbes.graded.score!);
    expect(noProbes.graded.coverage).toBeLessThan(100);
    expect(noProbes.gaps).toContain('Corroborazione');
  });

  it('names the binding constraint by weighted loss, not by lowest raw score', () => {
    // machine_access is lower in absolute terms but only carries 10 points.
    const r = geoCitability({ extractability: 0.4, evidence: 0.9, entity: 0.9, corroboration: 0.9, machineAccess: 0.3 });
    expect(r.bindingConstraint?.id).toBe('extractability');
    expect(r.bindingConstraint?.why).toContain('non muove la citazione');
  });

  it('ranks evidence work first when evidence is thin', () => {
    const r = geoCitability({ ...full, evidence: 0.1 });
    expect(r.priorities[0]).toContain('citazioni verificabili');
    expect(r.priorities[0]).toContain('Princeton');
  });

  it('never recommends keyword tactics — they measured at zero in generative engines', () => {
    const r = geoCitability({ extractability: 0.1, evidence: 0.1, entity: 0.1, corroboration: 0.1, machineAccess: 0.1 });
    expect(r.priorities.join(' ').toLowerCase()).not.toContain('densità di keyword');
    expect(r.priorities.join(' ').toLowerCase()).not.toContain('keyword stuffing');
  });

  it('carries the disclaimer and the gaps section every time', () => {
    const r = geoCitability(full);
    expect(r.disclaimer).toContain('non è deterministica');
    expect(r.disclaimer).toContain('non promettiamo la citazione');
    expect(r.gaps).toBeTruthy();
  });

  it('turns every anti-citation signal into a ranked fix', () => {
    const r = geoCitability({ ...full, antiSignals: [{ id: 'undated', note: 'nessuna data', fix: 'esporre la data' }] });
    expect(r.priorities.some((p) => p.includes('disqualificante'))).toBe(true);
  });
});
