import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_IDS, buildAgentHead } from './agents';
import { REPLY_CONTRACT_BLOCK } from './reply-contract';

/**
 * IL CONTRATTO DI CONSEGNA, PINNATO — e pinnato con le sue MUTAZIONI, non solo con la sua presenza.
 *
 * «Final replies: concise and actionable» stava in due file e non ha retto per due ragioni
 * separate: era vaga (un aggettivo, non una forma) ed era doppia (due copie divergono, e la
 * versione che diverge è sempre quella che il modello legge). Questo file impedisce il ritorno di
 * entrambe.
 *
 * La terza asserzione è la più importante e non riguarda la brevità: il difetto misurato di questo
 * prodotto è che l'agente si ferma troppo presto. Se qualcuno un giorno alleggerisse il blocco
 * togliendo il paragrafo che separa «trasmettere meno» da «lavorare meno», questo lavoro avrebbe
 * prodotto risposte più corte comprando turni più poveri — il baratto peggiore possibile.
 */
describe('contratto di consegna', () => {
  it('entra nella testa di tutti e cinque gli specialisti', () => {
    for (const id of AGENT_IDS) {
      const head = buildAgentHead(id, 'it', 'prova', 'Brand di prova');
      expect(head, id).toContain(REPLY_CONTRACT_BLOCK);
    }
  });

  /** Anche un consulto: la sua risposta la legge un collega, che ha lo stesso diritto ai fatti. */
  it('entra anche nella testa di un consulto (senza orchestrazione)', () => {
    const head = buildAgentHead('content', 'en', 'prova', 'Brand di prova', false);
    expect(head).toContain(REPLY_CONTRACT_BLOCK);
  });

  it('entra nella testa omni', () => {
    const src = readFileSync('src/lib/server/chat/system-prompt.ts', 'utf8');
    expect(src).toContain('${REPLY_CONTRACT_BLOCK}');
  });

  /**
   * UN POSTO SOLO. Le due copie che questo blocco sostituisce erano l'una la parafrasi dell'altra;
   * il modo in cui il difetto torna è che qualcuno riscriva una riga sulla lunghezza «dove serve».
   */
  it('non esiste una seconda copia della regola nelle due teste', () => {
    for (const f of ['src/lib/server/chat/agents.ts', 'src/lib/server/chat/system-prompt.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('concise and actionable');
      // La forma vive in reply-contract.ts: nelle due teste ci sta solo il riferimento.
      expect(src, f).not.toContain('WHAT EXISTS NOW');
    }
  });

  /**
   * LA COSA DA NON ROMPERE. Scrivere meno non è lavorare meno, e il blocco lo deve dire con i
   * numeri del budget veri — 75 passi — non con un'esortazione.
   */
  it('separa a voce alta trasmettere da lavorare', () => {
    expect(REPLY_CONTRACT_BLOCK).toContain('NEVER HOW MUCH YOU WORK');
    expect(REPLY_CONTRACT_BLOCK).toContain('75 steps');
    expect(REPLY_CONTRACT_BLOCK).toMatch(/short message on top of a short job is the failure/);
  });

  /** Un errore spiegato male produce l'utente che non capisce: quel pezzo non si taglia mai. */
  it('esenta dalla brevità il fallimento e il rifiuto', () => {
    expect(REPLY_CONTRACT_BLOCK).toContain('NEVER trimmed for brevity');
  });

  /**
   * Il divieto in prosa della domanda di cortesia esisteva già (WORK_ETHIC_BLOCK) e il modello la
   * faceva lo stesso. Un divieto senza un sostituto è un vuoto che il modello riempie: qui il
   * sostituto è dichiarato, ed è «niente».
   */
  it('dice cosa mettere al posto della domanda finale', () => {
    expect(REPLY_CONTRACT_BLOCK).toContain('NOTHING replaces that closing question');
  });

  /** Gli elenchi sono la consegna, non la prosa: un tetto unico avrebbe tagliato la parte utile. */
  it('conta gli elenchi diversamente dalla prosa', () => {
    expect(REPLY_CONTRACT_BLOCK).toMatch(/ten posts are ten short lines/);
  });

  /**
   * LA DIRETTIVA NUOVA: il minimo è la REGOLA, non un gusto. «Scrivi poco» da solo il modello lo
   * scarta come consiglio estetico; qui la regola è operativa — ogni frase deve guadagnarsi il
   * posto con un fatto, e la prova di forza è la domanda «cosa sparisce se la taglio?».
   */
  it('dice CHE COSA È il minimo: la frase si guadagna il posto con un fatto', () => {
    expect(REPLY_CONTRACT_BLOCK).toContain('MINIMAL BY DEFAULT');
    expect(REPLY_CONTRACT_BLOCK).toMatch(/if cutting it would lose no fact, cut it/);
    // I riempitivi classici sono NOMINATI, non descritti: un divieto vago si ignora.
    for (const filler of ['No greeting', 'no transitions']) {
      expect(REPLY_CONTRACT_BLOCK).toContain(filler);
    }
  });
});
