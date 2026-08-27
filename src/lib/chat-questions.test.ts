import { describe, expect, it } from 'vitest';
import {
  detectQuestionsAnsweredFromHistory,
  formatQuestionAnswers,
  normalizeQuestionsPayload
} from '$lib/chat-questions';

const sample = {
  questions: [
    {
      id: 'priority',
      prompt: 'Priorità principale?',
      options: [
        { id: 'leads', label: 'Più lead' },
        { id: 'brand', label: 'Brand awareness' }
      ]
    },
    {
      id: 'tone',
      prompt: 'Tono?',
      options: [
        { id: 'formal', label: 'Formale' },
        { id: 'casual', label: 'Informale' }
      ]
    }
  ]
};

describe('normalizeQuestionsPayload', () => {
  /**
   * La riga sotto il titolo è quella che rende la scelta comprensibile ("Google Workspace" da
   * solo non dice niente): passa fino alla card, e non deve inventarsi una stringa vuota sulle
   * card vecchie salvate prima che il campo esistesse.
   */
  it('carries the option description through, and omits it when absent', () => {
    const out = normalizeQuestionsPayload({
      questions: [
        {
          id: 'tools',
          prompt: 'Che strumenti usate?',
          options: [
            { id: 'gw', label: 'Google Workspace', description: '  Drive e Gmail, niente altro  ' },
            { id: 'none', label: 'Nessuno' },
            { id: 'blank', label: 'Altro', description: '   ' }
          ]
        }
      ]
    });
    const opts = out!.questions[0].options;
    expect(opts[0].description).toBe('Drive e Gmail, niente altro');
    expect(opts[1]).not.toHaveProperty('description');
    expect(opts[2]).not.toHaveProperty('description');
  });

  it('keeps valid questions and drops bad ones', () => {
    const out = normalizeQuestionsPayload({
      questions: [
        ...sample.questions,
        { id: 'bad', prompt: 'Only one opt', options: [{ id: 'x', label: 'X' }] }
      ]
    });
    expect(out?.questions).toHaveLength(2);
  });
});

describe('formatQuestionAnswers', () => {
  it('returns the label alone for a single question', () => {
    expect(
      formatQuestionAnswers([sample.questions[0]], { priority: 'Più lead' })
    ).toBe('Più lead');
  });

  it('formats multi-question answers', () => {
    const text = formatQuestionAnswers(sample.questions, {
      priority: 'Più lead',
      tone: 'Informale'
    });
    expect(text).toContain('1. Priorità principale?');
    expect(text).toContain('→ Più lead');
    expect(text).toContain('2. Tono?');
    expect(text).toContain('→ Informale');
  });
});

describe('domande saltate nel wizard', () => {
  /**
   * Una domanda saltata non è una risposta vuota: deve arrivare al modello DETTA, o lui la
   * ripropone (o peggio, legge il buco come "nessuno strumento").
   */
  it('names the skipped question instead of leaving a hole', () => {
    const text = formatQuestionAnswers(sample.questions, { priority: 'Più lead' }, 'saltata');
    expect(text).toContain('1. Priorità principale?\n→ Più lead');
    expect(text).toContain('2. Tono?\n→ (saltata)');
  });

  /**
   * Il caso che rompeva la card: una domanda sola, saltata. Il messaggio esce in forma numerata
   * (l'etichetta nuda non esiste), e senza il ramo numerato anche per una domanda sola la card
   * tornava "da rispondere" a ogni riapertura della chat.
   */
  it('a single skipped question still reads back as settled', () => {
    const text = formatQuestionAnswers([sample.questions[0]], {}, 'saltata');
    expect(text).toBe('1. Priorità principale?\n→ (saltata)');
    const r = detectQuestionsAnsweredFromHistory([sample.questions[0]], [text]);
    expect(r.done).toBe(true);
  });

  /** Una risposta scritta a mano (l'opzione libera) non è fra le opzioni, ma è una risposta. */
  it('reads back a free-text answer', () => {
    const text = formatQuestionAnswers(sample.questions, {
      priority: 'Vendere il corso di ottobre',
      tone: 'Formale'
    });
    const r = detectQuestionsAnsweredFromHistory(sample.questions, [text]);
    expect(r.done).toBe(true);
    expect(r.answers.priority).toBe('Vendere il corso di ottobre');
  });
});

describe('detectQuestionsAnsweredFromHistory', () => {
  it('detects a single-question answer by label', () => {
    const r = detectQuestionsAnsweredFromHistory([sample.questions[0]], ['Più lead']);
    expect(r.done).toBe(true);
    expect(r.answers.priority).toBe('Più lead');
  });

  it('detects multi-question formatted answers', () => {
    const msg = formatQuestionAnswers(sample.questions, {
      priority: 'Più lead',
      tone: 'Formale'
    });
    const r = detectQuestionsAnsweredFromHistory(sample.questions, [msg]);
    expect(r.done).toBe(true);
    expect(r.answers).toEqual({ priority: 'Più lead', tone: 'Formale' });
  });
});
