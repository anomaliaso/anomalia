import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { createAgentSessionTools } from './agent-session-tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toolFor(seed: Row[], agent: string) {
  const kit = createTestSupabase({
    chat_threads: seed,
    organizations: [{ id: 'org1', owner_id: 'u1' }],
    brands: [{ id: 'b1', org_id: 'org1' }],
    profiles: [{ id: 'u1', locale: 'it' }]
  });
  const tools = createAgentSessionTools({
    supabase: kit.client,
    brandId: 'b1',
    userId: 'u1',
    threadId: 't1',
    origin: 'https://app.example',
    locale: 'it'
  });
  return { tools, kit };
}

const dmThread: Row = {
  id: 't1',
  brand_id: 'b1',
  user_id: 'u1',
  agent: 'web',
  title: 'Web ⇄ Analyst',
  room_agents: { dm: ['analyst', 'web'], names: { analyst: 'Analyst', web: 'Web Specialist' } }
};

describe('open_session_with_user', () => {
  it('il Web Specialist apre il SUO thread utente e accoda un turno di continuazione', async () => {
    const { tools, kit } = toolFor([dmThread], 'web');
    const out = (await tools.open_session_with_user.execute({ message: 'Sono il Web Specialist, analizzo il tuo sito.' }, {} as never)) as { success: boolean; thread_id: string };

    expect(out.success).toBe(true);
    expect(out.thread_id).toBeTruthy();

    // getOrCreateTeamThread semina la presentazione del diario; la nostra riga è l'ultima.
    const msgs = kit.tables.get('chat_messages')!;
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.name).toBe('web');
    expect(last.content).toBe('Sono il Web Specialist, analizzo il tuo sito.');

    // Il turno è una CONTINUAZIONE: nessun messaggio utente duplicato, agente forzato = web.
    const job = kit.tables.get('chat_jobs')![0];
    expect(job.tool_name).toBe('chat_response');
    expect(job.input_params.agent).toBe('web');
    expect(job.input_params.continuation).toBe(true);
    expect(job.input_params.user_message_saved).toBe(true);
    expect(job.input_params.speaker).toBe('web');
  });

  it('riusa il thread utente già aperto (surface team + surface_key=web), non ne crea un secondo', async () => {
    const existing: Row = {
      id: 'team-web',
      brand_id: 'b1',
      user_id: 'u1',
      agent: 'web',
      surface: 'team',
      surface_key: 'web',
      title: 'Web Specialist'
    };
    const { tools } = toolFor([dmThread, existing], 'web');
    const before = (await tools.open_session_with_user.execute({ message: 'ciao' }, {} as never)) as { thread_id: string };
    // Stesso id del thread esistente.
    expect(before.thread_id).toBe('team-web');
  });

  it('il generalista (Anomalia) non ha una sessione dedicata: rifiuta', async () => {
    const generalist: Row = { id: 't1', brand_id: 'b1', user_id: 'u1', agent: null, title: 'Chat' };
    const { tools } = toolFor([generalist], '');
    const out = (await tools.open_session_with_user.execute({ message: 'ciao' }, {} as never)) as { error: string };
    expect(out.error).toContain('generalist');
  });
});
