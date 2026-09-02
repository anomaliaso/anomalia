import { describe, it, expect } from 'vitest';
import { costFromJson, costFromStreamText, withUsageAccounting } from './llm-usage-cost';

describe('costo reale dal gateway', () => {
  it('legge il costo dalla risposta non-streaming', () => {
    expect(costFromJson({ usage: { prompt_tokens: 14, completion_tokens: 5, cost: 2.3e-6 } })).toBe(2.3e-6);
  });

  // Il turno di chat è streaming: il costo arriva nell'ULTIMO chunk, dopo che l'utente ha già
  // letto la risposta. Senza leggerlo lì, ogni turno di chat resta senza prezzo.
  it('legge il costo dall\'ultimo chunk di uno stream', () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"O"}}]}',
      'data: {"choices":[{"delta":{"content":"K"}}]}',
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":14,"completion_tokens":5,"cost":0.0000023}}',
      'data: [DONE]'
    ].join('\n\n');
    expect(costFromStreamText(sse)).toBeCloseTo(0.0000023, 10);
  });

  it('senza campo cost non inventa uno zero', () => {
    expect(costFromJson({ usage: { prompt_tokens: 1 } })).toBeNull();
    expect(costFromStreamText('data: {"choices":[]}\n\ndata: [DONE]')).toBeNull();
    expect(costFromStreamText('roba che non è SSE')).toBeNull();
  });

  /**
   * `usage: {include: true}` è un'estensione di OpenRouter. Su un gateway OpenAI-compatibile
   * qualunque un campo sconosciuto nel corpo è un 400 su OGNI chiamata: si aggiunge solo quando
   * si sta parlando davvero con loro.
   */
  it('chiede il conto solo a OpenRouter', () => {
    const body = JSON.stringify({ model: 'x', messages: [] });
    expect(JSON.parse(withUsageAccounting(body, 'https://openrouter.ai/api/v1')!).usage).toEqual({ include: true });
    expect(withUsageAccounting(body, 'https://api.openai.com/v1')).toBeNull();
  });

  it('un corpo che non è JSON resta intatto', () => {
    expect(withUsageAccounting('non-json', 'https://openrouter.ai/api/v1')).toBeNull();
  });
});
