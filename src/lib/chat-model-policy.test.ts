import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { turnModelFamily, policyForChoice, choiceForPolicy } from './chat-model-policy';

describe('chat-model-policy — la catena thread.model → custom_agent.model', () => {
	it('la preferenza salvata sul thread vince su quella del custom agent', () => {
		const out = turnModelFamily(
			{ family: 'grok', thinking: 'high' },
			{ family: 'luna', thinking: 'medium' }
		);
		expect(out).toEqual({ family: 'grok', thinking: 'high' });
	});

	it('senza preferenza sul thread conta quella del custom agent del thread', () => {
		const out = turnModelFamily(
			null,
			{ family: 'deepseek-pro', thinking: 'low' }
		);
		expect(out).toEqual({ family: 'deepseek-pro', thinking: 'low' });
	});

	it('null su entrambe = nessuna preferenza: decide il tier del turno', () => {
		expect(turnModelFamily(null, null)).toBeNull();
		expect(turnModelFamily(undefined, undefined)).toBeNull();
	});

	it('una riga sporca nel database si scarta invece di esplodere', () => {
		expect(turnModelFamily({ family: 'pippo' }, null)).toBeNull();
		expect(turnModelFamily('grok', null)).toBeNull();
		expect(turnModelFamily({ family: 'grok', thinking: 'tantissimo' }, null)).toBeNull();
	});
});

describe('policyForChoice — la scelta del picker diventa la riga da salvare sul thread', () => {
	it('un modello esplicito risolve alla sua famiglia col thinking scelto', () => {
		expect(policyForChoice('pro', 'high')).toEqual({ family: 'grok', thinking: 'high' });
		expect(policyForChoice('gpt-terra', 'medium')).toEqual({ family: 'gpt-terra', thinking: 'medium' });
	});

	it('Auto non salva nulla: null = torna la risoluzione di default (tier → env)', () => {
		expect(policyForChoice('auto', 'low')).toBeNull();
	});

	it('il thinking si adagia sui gradini della famiglia (max su luna → high)', () => {
		expect(policyForChoice('fast', 'max')).toEqual({ family: 'luna', thinking: 'high' });
	});
});

describe('choiceForPolicy — dal DB al picker, al reload da un altro device', () => {
	it('riprende il tier e il thinking salvati', () => {
		expect(choiceForPolicy({ family: 'grok', thinking: 'max' })).toEqual({
			tier: 'pro',
			reasoning: 'max'
		});
		expect(choiceForPolicy({ family: 'luna', thinking: 'medium' })).toEqual({
			tier: 'fast',
			reasoning: 'medium'
		});
	});

	it('null / assente / riga sporca = nessun ripristino', () => {
		expect(choiceForPolicy(null)).toBeNull();
		expect(choiceForPolicy(undefined)).toBeNull();
		expect(choiceForPolicy({ family: 'pippo', thinking: 'low' })).toBeNull();
	});

	it('gemini-flash non ha un tier nel picker: nessun ripristino finto', () => {
		expect(choiceForPolicy({ family: 'gemini-flash', thinking: 'low' })).toBeNull();
	});
});

describe('migration 0225_agent_model_preference', () => {
	const sql = readFileSync('supabase/migrations/0225_agent_model_preference.sql', 'utf8');

	it('custom_agents guadagna la colonna model jsonb', () => {
		expect(sql).toContain('alter table public.custom_agents add column if not exists model jsonb');
	});

	it('chat_threads guadagna la colonna model jsonb', () => {
		expect(sql).toContain('alter table public.chat_threads add column if not exists model jsonb');
	});

	it('nessuna policy RLS colonnare: la colonna eredita quelle di riga', () => {
		expect(sql).not.toMatch(/create policy/i);
	});
});


/**
 * Il picker offre il catalogo del gateway, quindi la scelta salvata sul thread non è più solo una
 * famiglia: `{family, thinking}` non sa dire "claude-opus-5". Il campo `model` porta l'id, e la
 * famiglia resta a dire quali gradini di ragionamento mostrare.
 */
describe('un modello del gateway sul thread', () => {
  it('salva l\'id e lo ritrova', () => {
    const row = policyForChoice('anthropic/claude-opus-5', 'high');
    expect(row?.model).toBe('anthropic/claude-opus-5');
    expect(choiceForPolicy(row)?.tier).toBe('anthropic/claude-opus-5');
  });

  it('le righe salvate prima, senza `model`, continuano a tornare al loro tier', () => {
    const row = policyForChoice('pro', 'high');
    expect(row?.model).toBeUndefined();
    expect(choiceForPolicy(row)?.tier).toBe('pro');
  });

  it('Auto resta null: il thread torna alla risoluzione di default', () => {
    expect(policyForChoice('auto', 'high')).toBeNull();
  });
});
