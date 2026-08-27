import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  dmReplyBackMessage,
  dmSendsFromCall,
  dmSendsFromOutput,
  isDmReplyBackMessage
} from './chat-dm';

const payload = {
  success: true,
  dm_thread_id: 'thread-1',
  to: 'analyst',
  to_name: 'Analyst',
  sends: [{ dm_thread_id: 'thread-1', to: 'analyst', to_name: 'Analyst' }]
};

describe('dmSendsFromOutput — srotola il kit', () => {
  it('legge l\'oggetto piano (pre-kit)', () => {
    expect(dmSendsFromOutput(payload)).toEqual([
      { threadId: 'thread-1', to: 'analyst', name: 'Analyst' }
    ]);
  });

  it('srotola il ToolResult del kit `{ content: [{ type:text, text: JSON }] }`', () => {
    expect(
      dmSendsFromOutput({ content: [{ type: 'text', text: JSON.stringify(payload) }] })
    ).toEqual([{ threadId: 'thread-1', to: 'analyst', name: 'Analyst' }]);
  });

  it('srotola il wrapper SDK `{ type:content, value }`', () => {
    expect(
      dmSendsFromOutput({
        type: 'content',
        value: [{ type: 'text', text: JSON.stringify(payload) }]
      })
    ).toEqual([{ threadId: 'thread-1', to: 'analyst', name: 'Analyst' }]);
  });

  it('un fan-out riempie un invio per destinatario, senza dm_thread_id in cima', () => {
    const fan = {
      success: true,
      sends: [
        { dm_thread_id: 't-a', to: 'content', to_name: 'Content Creator' },
        { dm_thread_id: 't-b', to: 'motion', to_name: 'Motion' }
      ]
    };
    expect(dmSendsFromOutput(fan)).toEqual([
      { threadId: 't-a', to: 'content', name: 'Content Creator' },
      { threadId: 't-b', to: 'motion', name: 'Motion' }
    ]);
  });

  it('preferisce dmSends hoisted (compattazione) all\'output', () => {
    expect(
      dmSendsFromCall({
        output: { error: 'gone' },
        dmSends: [{ threadId: 't-1', to: 'web', name: 'Web Specialist' }]
      })
    ).toEqual([{ threadId: 't-1', to: 'web', name: 'Web Specialist' }]);
  });

  it('un output vuoto o un errore non è una chip', () => {
    expect(dmSendsFromOutput({ error: 'Unknown agent' })).toEqual([]);
    expect(dmSendsFromOutput(null)).toEqual([]);
  });
});

describe('isDmReplyBackMessage', () => {
  it('riconosce la vecchia riga versata nel thread utente, e nient\'altro', () => {
    expect(isDmReplyBackMessage(dmReplyBackMessage('Analyst', 'ok', 'it'))).toBe(true);
    expect(isDmReplyBackMessage(dmReplyBackMessage('Analyst', 'ok', 'en'))).toBe(true);
    expect(isDmReplyBackMessage('Ciao, come va?')).toBe(false);
    expect(isDmReplyBackMessage('📩 altro')).toBe(false);
  });
});

describe('la chip sta su ogni surface, come lo sticker', () => {
  const reads = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

  it('ChatLiveStatus / ChatColumn / ChatTurn montano ChatDmChip', () => {
    for (const f of [
      './components/ChatColumn.svelte',
      './components/ChatLiveStatus.svelte',
      '../routes/app/[brand]/chat/components/ChatTurn.svelte'
    ]) {
      expect(reads(f)).toContain('<ChatDmChip');
    }
  });
});
