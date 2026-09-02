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
		expect(policyForChoice('gpt-terra', 'medium')).toEqual({ family: 'gpt-terra', thinking: 'medium' });
	});

	it('nessuna scelta non salva nulla: null = il thread torna al default', () => {
		expect(policyForChoice(null, 'low')).toBeNull();
	});

	/**
	 * Un id del gateway porta con se` la famiglia solo per dire la SCALA: il modello e` l'id, e
	 * la scala di un modello che non conosciamo e` quella comune (luna).
	 */
	it('il thinking si adagia sui gradini della scala comune (max → high)', () => {
		expect(policyForChoice('anthropic/claude-opus-5', 'max')).toEqual({
			family: 'luna',
			thinking: 'high',
			model: 'anthropic/claude-opus-5'
		});
	});
});

describe('choiceForPolicy — dal DB al picker, al reload da un altro device', () => {
	it('riprende il tier e il thinking salvati', () => {
		expect(choiceForPolicy({ family: 'gpt-terra', thinking: 'max' })).toEqual({
			tier: 'gpt-terra',
			reasoning: 'max'
		});
	});

	/**
	 * Luna e Grok erano i preset Fast e Pro. Una riga che nomina solo la famiglia non sa piu` dire
	 * QUALE modello: ripristinarla vorrebbe dire scegliere per conto dell'utente. Torna null, e la
	 * chat riparte dal default.
	 */
	it('una famiglia che era un preset non si ripristina piu\'', () => {
		expect(choiceForPolicy({ family: 'grok', thinking: 'max' })).toBeNull();
		expect(choiceForPolicy({ family: 'luna', thinking: 'medium' })).toBeNull();
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

  it('le righe salvate prima, senza `model`, tornano al loro tier se e\' un custom model', () => {
    const row = policyForChoice('gpt-terra', 'high');
    expect(row?.model).toBeUndefined();
    expect(choiceForPolicy(row)?.tier).toBe('gpt-terra');
  });

  it('nessuna scelta resta null: il thread torna al default', () => {
    expect(policyForChoice(null, 'high')).toBeNull();
  });
});
