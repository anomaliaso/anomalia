import { describe, expect, it } from 'vitest';
import {
  formatArtifactsForPrompt,
  inferArtifactKind,
  isTextualKind,
  mimeForFile,
  safeFileName,
  type ChatArtifact
} from './artifacts';

describe('inferArtifactKind', () => {
  it('il mime vince quando c’è', () => {
    expect(inferArtifactKind('qualcosa.bin', 'image/png')).toBe('image');
  });

  it('altrimenti decide l’estensione', () => {
    expect(inferArtifactKind('report.md')).toBe('document');
    expect(inferArtifactKind('metriche.csv')).toBe('data');
    expect(inferArtifactKind('analisi.py')).toBe('code');
    expect(inferArtifactKind('bundle.zip')).toBe('archive');
    expect(inferArtifactKind('grafico.PNG')).toBe('image');
  });

  it('quello che non riconosce resta un documento, non un errore', () => {
    expect(inferArtifactKind('senza-estensione')).toBe('document');
  });

  it('SVG e HTML non sono immagini da aprire: sono file da scaricare', () => {
    // Li scrive un modello che può averli copiati da una pagina appena letta. `image` li
    // renderebbe inline e darebbe loro un tab sul dominio dello storage.
    expect(inferArtifactKind('grafico.svg')).toBe('code');
    expect(inferArtifactKind('grafico.svg', 'image/svg+xml')).toBe('code');
    expect(inferArtifactKind('report.html')).toBe('code');
    expect(inferArtifactKind('report.htm', 'text/html')).toBe('code');
  });
});

describe('isTextualKind', () => {
  it('solo i formati che ha senso mostrare in chiaro', () => {
    expect(isTextualKind('document')).toBe(true);
    expect(isTextualKind('data')).toBe(true);
    expect(isTextualKind('code')).toBe(true);
    expect(isTextualKind('image')).toBe(false);
    expect(isTextualKind('archive')).toBe(false);
  });
});

describe('safeFileName', () => {
  it('toglie il percorso: un artefatto è un file, non una directory', () => {
    expect(safeFileName('work/out/report.md')).toBe('report.md');
    expect(safeFileName('..\\..\\etc\\passwd')).toBe('passwd');
  });

  it('normalizza spazi e caratteri che romperebbero una storage key', () => {
    expect(safeFileName('report finale (v2).md')).toBe('report-finale-_v2_.md');
  });

  it('un nome che resta vuoto prende il fallback', () => {
    expect(safeFileName('///')).toBe('artifact.txt');
    expect(safeFileName('')).toBe('artifact.txt');
  });
});

describe('mimeForFile', () => {
  it('mappa le estensioni che l’agente produce davvero', () => {
    expect(mimeForFile('a.csv')).toBe('text/csv');
    expect(mimeForFile('a.md')).toBe('text/markdown');
    expect(mimeForFile('a.png')).toBe('image/png');
  });

  it('sconosciuto = octet-stream, non una supposizione', () => {
    expect(mimeForFile('a.qqq')).toBe('application/octet-stream');
  });
});

describe('formatArtifactsForPrompt', () => {
  const rows = [
    { id: 'abcdef123456', title: 'Analisi engagement', file_name: 'engagement.csv', bytes: 4096, description: 'per piattaforma' }
  ] as ChatArtifact[];

  it('dice cosa esiste già, così non lo ripubblica con un altro nome', () => {
    const block = formatArtifactsForPrompt(rows);
    expect(block).toContain('Analisi engagement');
    expect(block).toContain('engagement.csv');
    expect(block).toContain('Non ripubblicare');
  });

  it('nessun artefatto = nessuna sezione (non una sezione vuota)', () => {
    expect(formatArtifactsForPrompt([])).toBe('');
  });
});
