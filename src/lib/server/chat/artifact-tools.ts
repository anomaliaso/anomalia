/**
 * Il tool con cui l'agente pubblica un artefatto **dalla chat** (testo: un report, un piano, un
 * CSV che ha composto, uno script). Il ramo binario — un grafico, uno screenshot, un file prodotto
 * da un comando — passa da `sandbox_save_output`, perché i byte stanno nella VM.
 *
 * Perché è un tool e non "salva sempre tutto": pubblicare è una scelta editoriale. Un artefatto per
 * ogni turno riempie la conversazione di file che nessuno apre, ed è lo stesso modo in cui una
 * cartella condivisa diventa inutile. La regola sta nella descrizione: si pubblica ciò che l'utente
 * vorrà **riaprire**, non ciò che ha appena letto.
 */
import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_ARTIFACT_BYTES, publishArtifact } from '$lib/server/chat/artifacts';

export const ARTIFACT_TOOL_KEYS = ['publish_artifact'] as const;

/** Artefatti per turno. Oltre, non è una consegna: è un agente che scarica addosso all'utente. */
export const MAX_ARTIFACTS_PER_TURN = 5;

export function createArtifactTools(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  threadId?: string;
}) {
  const { supabase, brandId, userId, threadId } = opts;
  let published = 0;

  return {
    publish_artifact: tool({
      description: [
        'Publish a FILE into this conversation, permanently: it appears as a card the user can open and download, and it is still there when they reopen the chat in a month.',
        'Use it for something they will want to come back to — a report, an analysis, a plan, a CSV you assembled, a script — instead of pasting hundreds of lines into your reply.',
        'Do NOT use it for a short answer, for something you already said in full in the message, or to re-publish a file that is already an artifact of this thread.',
        'Text content only. A file produced inside the sandbox (a chart, a screenshot, a converted file) is published with sandbox_save_output(kind="artifact") instead.'
      ].join(' '),
      inputSchema: z.object({
        title: z.string().min(2).max(200).describe('How the card is named — what this is, in the user’s language'),
        file_name: z
          .string()
          .min(3)
          .max(120)
          .describe('File name WITH extension: .md, .csv, .json, .txt, .py, .sql… it decides how the card renders'),
        content: z.string().min(1).max(MAX_ARTIFACT_BYTES).describe('The full file content'),
        description: z.string().max(500).optional().describe('One line on what it contains and how to read it')
      }),
      execute: async (
        input: { title: string; file_name: string; content: string; description?: string },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        if (!threadId) return { error: 'No thread — an artifact must belong to a conversation.' };
        if (published >= MAX_ARTIFACTS_PER_TURN) {
          return {
            error: `Artifact limit reached for this turn (max ${MAX_ARTIFACTS_PER_TURN}). Put the rest in your reply, or publish one combined file.`
          };
        }
        published++;
        const { artifact, error } = await publishArtifact(supabase, {
          brandId,
          userId,
          threadId,
          title: input.title,
          description: input.description,
          fileName: input.file_name,
          text: input.content,
          // Lega la card alla chiamata che l'ha prodotta: è così che compare nel punto giusto del
          // turno invece che in fondo alla conversazione.
          toolCallId: toolOpts?.toolCallId ?? null,
          createdBy: 'agent',
          source: 'chat'
        });
        if (error || !artifact) return { success: false, error: error ?? 'Could not publish the artifact' };
        return {
          success: true,
          artifact,
          instruction:
            'The card is already visible in the chat. Say in one line what it is and why it is worth opening — do not repeat its content in your reply.'
        };
      }
    })
  };
}
