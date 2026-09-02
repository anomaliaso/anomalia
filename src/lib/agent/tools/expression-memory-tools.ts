import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { CHAT_EXPRESSIONS, CHAT_EXPRESSION_NOTES, normalizeChatExpression } from '$lib/chat-expression';
import type { ChatToolCtx } from './shared';
import { startLongToolJob, type AnyRec } from './shared';

export function expressionMemoryTools(ctx: ChatToolCtx) {
  const { supabase, brandId, threadId, agentColor, memoryAgent } = ctx;
  return {
    /**
     * L'ESPRESSIONE — l'unico tool che non fa niente, e serve a questo.
     *
     * Non legge, non scrive, non chiama nessuno: mette in chat uno sticker animato dell'avatar
     * dell'agente che sta parlando. Esiste perché il testo non porta il tono, e "fatto" con la
     * faccia che strizza l'occhio e "fatto" con la faccia preoccupata sono due messaggi diversi.
     *
     * Vive quanto l'output della sua chiamata: si rilegge riaprendo il thread, e sparisce quando
     * un turno lungo viene compattato. È voluto — uno sticker è un gesto del momento, non un
     * documento, e dargli un campo suo che sopravvive alla compattazione significherebbe
     * conservare per sempre la faccia che l'agente ha fatto tre settimane fa.
     *
     * La chip del tool NON si mostra: lo sticker parla da solo, e vedere accanto "ha chiamato
     * set_expression" lo ucciderebbe. Stessa scelta di `propose_custom_agent`, stesso punto di
     * filtro (ChatColumn).
     */
    set_expression: tool({
      description: [
        'Show a small animated sticker of your own avatar in the chat, going from neutral to one expression and back, on a loop.',
        'It is the only way you have to carry TONE: the same sentence lands differently with a wink than with a worried face, and text alone gives you neither.',
        'Use it when the tone is part of what you are saying — finishing something you are pleased with, delivering bad news, being caught out by what you found, or a bit of complicity. NOT on every message: something that appears every time stops being read.',
        'It changes nothing and costs nothing, and it stays in the conversation like any other message.'
      ].join(' '),
      inputSchema: z.object({
        expression: z
          .enum(CHAT_EXPRESSIONS as unknown as [string, ...string[]])
          .describe(
            Object.entries(CHAT_EXPRESSION_NOTES)
              .map(([k, v]) => `${k} = ${v}`)
              .join(' · ')
          ),
        note: z
          .string()
          .max(120)
          .optional()
          .describe('One short line on why this expression, for the trace. Never drawn on screen.')
      }),
      // Il colore si scrive QUI, nel momento in cui il gesto viene fatto: è l'unico istante in cui
      // si sa di chi è. La UI lo leggeva dalla selezione corrente del composer, e cambiare agente
      // nel picker ricolorava tutti gli sticker vecchi della conversazione.
      execute: async (input: { expression: string; note?: string }) => ({
        expression: normalizeChatExpression(input.expression),
        note: input.note?.trim() || null,
        ...(agentColor ? { color: agentColor } : {})
      })
    }),

    read_memory: tool({
      description:
        "Read structured memory. Default is brand project/global knowledge. Pass include_session=true to also list facts from this chat thread only. Use category='skill' to get the FULL STEPS of the skills the system prompt lists by trigger only — do that before following one.",
      inputSchema: z.object({
        category: z.enum(['voice', 'constraint', 'fact', 'preference', 'insight', 'skill']).optional().describe('Filter by category'),
        include_session: z
          .boolean()
          .optional()
          .describe('If true, also return session memories for this thread')
      }),
      execute: async (
        { category, include_session }: { category?: string; include_session?: boolean },
        opts: ToolExecutionOptions<unknown>
      ) => {
        const { loadMemoryEntries, recordMemoryUsage } = await import('$lib/server/brand-memory');
        const cat = category
          ? { category: category as 'voice' | 'constraint' | 'fact' | 'preference' | 'insight' | 'skill' }
          : {};
        // Memoria del brand + le proprie note di mestiere. Mai quelle dei colleghi: una nota di
        // metodo altrui è rumore, non conoscenza.
        const project = await loadMemoryEntries(supabase, brandId, { ...cat, agent: memoryAgent });
        let session: typeof project = [];
        if (include_session && threadId) {
          session = await loadMemoryEntries(supabase, brandId, {
            ...cat,
            layer: 'session',
            threadId,
            agent: memoryAgent
          });
        }
        const entries = [...project, ...session];
        void recordMemoryUsage(
          supabase,
          entries.map((e) => e.id)
        );
        // Skill di default del prodotto (default-skills.ts): stesse regole delle skill del brand
        // ma definite in codice — id `builtin:` (mai in recordMemoryUsage: aggiorna per uuid),
        // non rimovibili con remove_memory, aggiornate col deploy.
        const { defaultSkillEntries } = await import('$lib/server/default-skills');
        const builtin = !category || category === 'skill' ? defaultSkillEntries() : [];
        return {
          entries: [...entries, ...builtin],
          count: entries.length + builtin.length,
          project_count: project.length,
          session_count: session.length,
          builtin_count: builtin.length
        };
      }
    }),

    add_memory: tool({
      description:
        "Save a fact about the brand. Default scope is 'session' (this chat only). Use scope='project' only when the user clearly wants a lasting brand rule that should affect all future work. Use scope='mine' for a lesson about YOUR OWN craft on this brand (\"my carousels do better with the price on slide 3\") — permanent, but it only ever reaches you, so never put a fact about the brand there. category='skill' saves a repeatable PROCEDURE instead of a fact (always permanent): use it when the user teaches you a way of working to reuse, or when you notice you keep redoing the same steps.",
      inputSchema: z.object({
        key: z.string().describe('Short identifier (e.g. "dietary_restriction", "brand_tone")'),
        value: z
          .string()
          .describe(
            'The fact in one clear sentence. For category="skill": markdown whose FIRST LINE is a single "Use when …" sentence, followed by the steps, one per line.'
          ),
        category: z.enum(['voice', 'constraint', 'fact', 'preference', 'insight', 'skill']).describe('Type of knowledge'),
        scope: z
          .enum(['session', 'project', 'mine'])
          .optional()
          .describe(
            "session = this chat only (default); project = permanent brand knowledge every agent reads; mine = a note about HOW YOU WORK on this brand, permanent but private to you (voice/constraint/fact are always the brand's and are saved as project even here)"
          )
      }),
      execute: async (
        {
          key,
          value,
          category,
          scope
        }: { key: string; value: string; category: string; scope?: 'session' | 'project' | 'mine' },
        opts: ToolExecutionOptions<unknown>
      ) => {
        const { writeMemory } = await import('$lib/server/brand-memory');
        // A skill is a standing procedure — session scope would throw it away with the thread.
        const layer = scope === 'project' || scope === 'mine' || category === 'skill' ? 'project' : 'session';
        if (layer === 'session' && !threadId) {
          return { success: false, error: 'No thread — cannot write session memory' };
        }
        try {
          const result = await writeMemory(supabase, brandId, {
            key,
            value,
            category: category as 'voice' | 'constraint' | 'fact' | 'preference' | 'insight' | 'skill',
            source: 'chat',
            confidence: 0.9,
            layer,
            // `scope='mine'` = nota di MESTIERE, visibile solo a chi la scrive. writeMemory la
            // riporta comunque al brand se la categoria è voice/constraint/fact.
            ...(scope === 'mine' ? { agent: memoryAgent } : {}),
            ...(layer === 'session' ? { threadId } : {})
          });
          return { success: true, layer, ...result };
        } catch (e) {
          // The skill cap is a normal outcome to report back, not a turn-killing crash.
          const msg = e instanceof Error ? e.message : String(e);
          return { success: false, error: msg };
        }
      }
    }),

    remove_memory: tool({
      description: 'Remove a memory entry the brand no longer needs or that is incorrect.',
      inputSchema: z.object({
        entry_id: z.string().describe('The memory entry ID to remove')
      }),
      execute: async ({ entry_id }: { entry_id: string }, opts: ToolExecutionOptions<unknown>) => {
        // Un id `builtin:` non è una riga: è una skill di prodotto (default-skills.ts). Senza
        // questa guardia il delete passerebbe un non-uuid alla colonna id e verrebbe giù un
        // errore Postgres invece di una risposta.
        if (entry_id.startsWith('builtin:')) {
          return { error: 'This is a built-in product skill — it cannot be removed; it updates with the product itself.' };
        }
        const { deleteMemory } = await import('$lib/server/brand-memory');
        await deleteMemory(supabase, brandId, entry_id);
        return { success: true, deleted: entry_id };
      }
    }),
  };
}
