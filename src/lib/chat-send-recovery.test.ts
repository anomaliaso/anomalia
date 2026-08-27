import { describe, it, expect } from 'vitest';
import { isPreStreamFailure, sendDraftKey } from './chat-send-recovery';

const snap = (over: Partial<Parameters<typeof isPreStreamFailure>[0] & object> = {}) => ({
  error: 'chat.error' as string | null,
  jobId: null as string | null,
  streamBuf: '',
  streamToolCalls: [] as never[],
  ...over
});

describe('isPreStreamFailure — il POST non è mai arrivato', () => {
  it('errore senza job né buffer: vero (rete caduta sul POST, o HTTP pre-stream)', () => {
    expect(isPreStreamFailure(snap())).toBe(true);
  });

  it('nessuna sessione: falso — niente da tenere vivo', () => {
    expect(isPreStreamFailure(null)).toBe(false);
    expect(isPreStreamFailure(undefined)).toBe(false);
  });

  it('nessun errore: falso, anche a sessione vergine', () => {
    expect(isPreStreamFailure(snap({ error: null }))).toBe(false);
  });

  it('errore MA il job esiste (gli header sono atterrati): falso — il server ha il messaggio', () => {
    expect(isPreStreamFailure(snap({ jobId: 'job-1' }))).toBe(false);
  });

  it('errore MA testo già streamato: falso — il partial va foldato, non congelato', () => {
    expect(isPreStreamFailure(snap({ streamBuf: 'ciao' }))).toBe(false);
  });

  it('errore MA un tool call già arrivato: falso', () => {
    expect(isPreStreamFailure(snap({ streamToolCalls: [{} as never] }))).toBe(false);
  });
});

describe('sendDraftKey', () => {
  it('è per brand e non collide con le chiavi del composer (anomalia:chat-draft:…)', () => {
    expect(sendDraftKey('acme')).toBe('anomalia:chat-send-draft:acme');
    expect(sendDraftKey('acme')).not.toBe('anomalia:chat-draft:acme');
  });
});
