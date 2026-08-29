import type { SupabaseClient } from '@supabase/supabase-js';
import { getCustomAgent } from '$lib/server/custom-agents-read';

// Kept out of custom-agents.ts on purpose: that module talks to the chat queue, and the queue
// needs the persona — a leaf module keeps the two from importing each other in a circle.

/** The bits of a custom agent the chat needs to wear its persona. */
export type CustomAgentPersona = {
  id: string;
  name: string;
  prompt: string;
  agent: string | null;
  /** Il colore dell'avatar scelto dall'utente: firma gli sticker che l'agente fa in chat. */
  color: string | null;
  /** La preferenza di modello permanente dell'agente (0225). */
  model: unknown;
};

/** Load a custom agent by id, scoped to the brand. */
export async function getCustomAgentPersona(
  supabase: SupabaseClient,
  brandId: string,
  id: string
): Promise<CustomAgentPersona | null> {
  // L'identità sta su `custom_agents` (0210): il persona è CHI è l'agente, non cosa fa il lunedì
  // alle 9 — quello è il prompt della singola routine, che arriva già come messaggio del turno.
  const agent = await getCustomAgent(supabase, brandId, id);
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    prompt: agent.prompt,
    agent: agent.agent,
    color: agent.avatar_color,
    model: agent.model ?? null
  };
}

/** The overlay the kit turn needs to wear a custom agent over its craft spec. */
export function kitPersonaOverlay(persona: CustomAgentPersona, locale: string): {
  id: string;
  memoryKey: string;
  systemBlock: string;
} {
  return {
    id: persona.id,
    memoryKey: `custom:${persona.id}`,
    systemBlock: customAgentSystemBlock(persona, locale)
  };
}

/**
 * System block for a thread the user pointed at one of their custom agents: the brief they
 * wrote becomes the standing objective, without muting what they type turn by turn.
 */
export function customAgentSystemBlock(persona: CustomAgentPersona, locale: string): string {
  const it = locale !== 'en';
  return it
    ? `\n\n## Agente custom — "${persona.name}"\n` +
        `L'utente sta parlando con un agente custom che ha configurato lui. Questa è la sua consegna permanente:\n\n` +
        `${persona.prompt}\n\n` +
        `Trattala come il tuo ruolo e il tuo obiettivo di default in questo thread. Se il messaggio dell'utente chiede altro, fai quello che chiede — la consegna resta lo sfondo, non un muro.`
    : `\n\n## Custom agent — "${persona.name}"\n` +
        `The user is talking to a custom agent they configured. This is its standing brief:\n\n` +
        `${persona.prompt}\n\n` +
        `Treat it as your role and default objective in this thread. If the user's message asks for something else, do what they ask — the brief is the backdrop, not a wall.`;
}
