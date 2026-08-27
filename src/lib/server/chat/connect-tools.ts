import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APPS_UNAVAILABLE } from '$lib/chat-connect';
import { normalizeToolkitSlug, searchCatalog } from '$lib/composio-catalog';
import { composioConfigured, composioErrorMessage } from '$lib/server/composio';
import {
  loadBrandConnections,
  loadConnectorCatalog,
  reconcileBrandConnections,
  startIntegrationConnectSession
} from '$lib/server/composio-catalog';

/**
 * Il passo PRIMA di list/call_integrations_tools: connettere l'app.
 *
 * `propose_app_connection` valida il toolkit contro il catalogo Composio (lo stesso che vede
 * Settings → Connectors), riusa il flusso Connect Link esistente e restituisce solo ciò che la
 * card in chat deve mostrare: slug, nome, logo, URL di autorizzazione. I token OAuth vivono da
 * Composio e non passano MAI di qui — l'unica cosa che l'utente apre è la Connect Link hostata,
 * e la conferma la fa la reconcile on-read già esistente quando la card la interroga.
 *
 * File separato da tools.ts (stesso motivo di onboarding-tools: tools.ts è multi-writer).
 * Registrazione: una riga dentro createChatTools:
 *
 *   ...createConnectTools({ supabase, brandId, userId, threadId, origin }),
 *
 * Escluso dai sotto-agenti (NEVER_FOR_SUBAGENTS): aprire un link di autorizzazione è un gesto
 * verso la persona, e chi parla con lei è uno solo — l'orchestratore.
 */
export function createConnectTools(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  threadId?: string;
  origin?: string;
}) {
  const { supabase, brandId, userId, threadId, origin } = opts;
  return {
    propose_app_connection: tool({
      description:
        "Propose connecting an external app (Google Calendar, Notion, HubSpot…) to this brand. Renders an in-chat card with the app's name, your reason, and a Connect button that opens the authorization page — the card flips to Connected by itself when the user finishes. Use it whenever an app the user mentions (or that would clearly help) is not connected yet; if it is already connected the result says so. Introduce the card in ONE short line; never paste the URL in text, and never claim the app is connected — the card and this tool's result are the only truth.",
      inputSchema: z.object({
        toolkit: z
          .string()
          .min(1)
          .describe('Toolkit slug, e.g. GOOGLECALENDAR, NOTION, HUBSPOT, SLACK. If unknown, the result suggests close matches.'),
        reason: z
          .string()
          .max(200)
          .describe("One short line, in the user's language: why connecting THIS app helps THIS brand. Shown on the card.")
      }),
      execute: async ({ toolkit, reason }: { toolkit: string; reason: string }) => {
        // Senza servizio non si dice "è rotto" e basta: si dice al modello cosa fare al suo
        // posto, o quel dettaglio di configurazione finisce scritto all'utente in chat.
        if (!composioConfigured()) return { ...APPS_UNAVAILABLE };
        const slug = normalizeToolkitSlug(toolkit);
        if (!slug) return { error: 'missing_toolkit', message: 'Pass the toolkit slug (e.g. GOOGLECALENDAR, NOTION).' };

        // Il catalogo è ciò che Composio risponde (managed auth o credenziali nostre) — la stessa
        // lista di Settings → Connectors. Un toolkit fuori catalogo non è connettibile: proporlo
        // produrrebbe solo un 404 al click.
        const { items, error: catalogError } = await loadConnectorCatalog();
        // Stessa regola per un catalogo irraggiungibile: il perché tecnico resta nel campo per
        // i log, l'utente vede solo la domanda sulle sue app.
        if (catalogError) return { ...APPS_UNAVAILABLE, error: 'catalog_unavailable', message: catalogError };
        const item = items.find((i) => i.toolkitSlug === slug);
        if (!item) {
          // Zero suggerimenti non vuol dire "quest'app non esiste": vuol dire che la stringa non
          // somigliava a niente. Senza dirlo, un modello che ha provato "gcal" conclude che il
          // calendario non è collegabile — ed è la stessa bugia che questo tool doveva togliere.
          const suggestions = searchCatalog(items, toolkit, 5).map((i) => i.toolkitSlug);
          return {
            error: 'unknown_toolkit',
            toolkit: slug,
            suggestions,
            message: suggestions.length
              ? 'Not in the connectable catalog. Pick one of the suggestions or another toolkit.'
              : 'Nothing in the catalog matches that string. Try the app\'s full common name as a person would write it ("google calendar", "hubspot") before telling the user it is unavailable — an abbreviation rarely matches.'
          };
        }

        // Riconcilia prima di rispondere "già connessa": una connessione fatta da un'altra
        // superficie (CLI, Settings) o revocata al provider non deve mentire alla card.
        await reconcileBrandConnections(supabase, brandId).catch(() => undefined);
        const rows = await loadBrandConnections(supabase, brandId).catch(() => []);
        const existing = rows.find((r) => r.toolkit_slug === slug);
        if (existing?.status === 'active') {
          return {
            toolkit: slug,
            name: existing.display_name || item.displayName,
            logo: item.logo,
            status: 'connected',
            already_connected: true,
            message: `${item.displayName} is already connected. Use list_integrations_tools to work with it — no card needed.`
          };
        }

        const { data: brand } = await supabase.from('brands').select('slug').eq('id', brandId).maybeSingle();
        const brandSlug = (brand?.slug as string | undefined) ?? '';
        if (!brandSlug) return { error: 'brand_not_found', message: 'Brand not found.' };

        try {
          const started = await startIntegrationConnectSession({
            supabase,
            brandId,
            brandSlug,
            userId,
            toolkitSlug: slug,
            // Finito il consenso, la tab atterra dove la card può reclamare la connessione: il
            // thread di chat se c'è, altrimenti la pagina Connectors che già gestisce il claim.
            callbackUrl: origin
              ? threadId
                ? `${origin}/app/${brandSlug}/chat/${threadId}`
                : `${origin}/app/${brandSlug}/settings/connectors`
              : null
          });
          if (!started.authorizationUrl) {
            return { error: 'connect_link_unavailable', toolkit: slug, message: 'Composio returned no authorization URL.' };
          }
          // Solo ciò che la card mostra: mai account id, mai token (Composio non ce li dà comunque).
          return {
            toolkit: slug,
            name: item.displayName,
            logo: item.logo,
            reason: reason.trim() || null,
            connect_url: started.authorizationUrl,
            status: 'pending',
            hint: 'The connect card is now in the chat. Tell the user in one line to use its button; the card turns to Connected on its own once they finish.'
          };
        } catch (e) {
          return { error: 'connect_failed', toolkit: slug, message: composioErrorMessage(e).slice(0, 400) };
        }
      }
    })
  };
}
