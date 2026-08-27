import { describe, expect, it } from 'vitest';
import { goalCommandInstruction, parseGoalCommand } from './goal-command';
import { CHAT_COMMANDS, matchCommands, slashQuery } from './chat-commands';

describe('parseGoalCommand', () => {
  it('riconosce il comando con il testo dietro, in entrambe le lingue', () => {
    expect(parseGoalCommand('/goal tutti i post di settembre approvati')).toEqual({
      kind: 'set',
      statement: 'tutti i post di settembre approvati'
    });
    expect(parseGoalCommand('  /obiettivo blog senza articoli scoperti  ')).toEqual({
      kind: 'set',
      statement: 'blog senza articoli scoperti'
    });
  });

  it('da solo chiede lo stato, con una parola di stop lo chiude', () => {
    expect(parseGoalCommand('/goal')).toEqual({ kind: 'show' });
    expect(parseGoalCommand('/goal stop')).toEqual({ kind: 'stop' });
    expect(parseGoalCommand('/obiettivo annulla')).toEqual({ kind: 'stop' });
    expect(parseGoalCommand('/goal CANCEL')).toEqual({ kind: 'stop' });
  });

  it('non si prende una parola che inizia per goal', () => {
    // il caso che rende inservibile un parser scritto con startsWith e basta
    expect(parseGoalCommand('/goalkeeper serve una foto')).toBeNull();
    expect(parseGoalCommand('/goals')).toBeNull();
  });

  it('lascia in pace i messaggi normali', () => {
    expect(parseGoalCommand('come è andato il post di ieri?')).toBeNull();
    expect(parseGoalCommand('il goal era un altro')).toBeNull();
    expect(parseGoalCommand('')).toBeNull();
    expect(parseGoalCommand(null)).toBeNull();
  });

  it('tronca un obiettivo lunghissimo invece di rifiutarlo', () => {
    const cmd = parseGoalCommand(`/goal ${'x'.repeat(900)}`);
    expect(cmd?.kind).toBe('set');
    expect(cmd && cmd.kind === 'set' && cmd.statement.length).toBe(500);
  });
});

describe('goalCommandInstruction', () => {
  it('per un obiettivo dettato dice al modello di scomporlo per primo, con le parole dell’utente', () => {
    const it = goalCommandInstruction({ kind: 'set', statement: 'dodici post approvati' }, 'it');
    expect(it).toContain('dodici post approvati');
    expect(it).toContain('set_goal');
    const en = goalCommandInstruction({ kind: 'set', statement: 'twelve approved posts' }, 'en');
    expect(en).toContain('twelve approved posts');
    expect(en).toContain('set_goal');
  });

  it('chiudere e guardare non chiedono lavoro: una riga e basta', () => {
    expect(goalCommandInstruction({ kind: 'stop' }, 'it')).toContain('una riga');
    expect(goalCommandInstruction({ kind: 'show' }, 'en')).toContain('one short line');
  });
});

describe('slashQuery', () => {
  it('si apre allo slash e filtra mentre si scrive', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/go')).toBe('go');
    expect(slashQuery('/GOAL')).toBe('goal');
  });

  it('si chiude appena inizia l’argomento: `/goal tutti i post` non è più una ricerca', () => {
    expect(slashQuery('/goal tutti i post')).toBeNull();
  });

  it('non scatta su una barra in mezzo a una frase', () => {
    expect(slashQuery('il 12/09 pubblichiamo')).toBeNull();
    expect(slashQuery('ciao')).toBeNull();
  });
});

describe('matchCommands', () => {
  it('senza query mostra tutto, con una query filtra sul token', () => {
    expect(matchCommands('')).toHaveLength(CHAT_COMMANDS.length);
    expect(matchCommands('goal').map((c) => c.id)).toEqual(['goal']);
    expect(matchCommands('seo').map((c) => c.id)).toEqual(['seoAudit', 'seoPlan']);
  });

  it('rispetta il set che il piano rende disponibile', () => {
    const noWeb = CHAT_COMMANDS.filter((c) => c.group !== 'seo' && c.group !== 'blog');
    expect(matchCommands('seo', noWeb)).toEqual([]);
  });

  // I comandi VERI — quelli che il server interpreta invece di passarli al modello — sono due, e
  // stanno tutti e due in cima. Se ne compare un terzo qui, va guardato: ognuno è una regola che
  // deve valere su ogni superficie (browser, CLI, coda), non un suggerimento di testo.
  it('i comandi veri sono `/goal` e `/clear`, e stanno in cima', () => {
    expect(CHAT_COMMANDS[0]?.id).toBe('goal');
    expect(CHAT_COMMANDS.filter((c) => c.kind === 'command').map((c) => c.id)).toEqual([
      'goal',
      'clear'
    ]);
  });

  it('ogni comando ha un token unico: due `/post` sarebbero due voci indistinguibili', () => {
    const tokens = CHAT_COMMANDS.map((c) => c.slash);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
