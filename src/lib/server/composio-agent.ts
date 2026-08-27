/**
 * Resolve a brand's Composio connections and list/call their tools for chat agents.
 *
 * Composio holds the credentials and injects them at execution time; the agent only ever sees
 * toolkit slugs, tool slugs and results.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listedForToolkit, normalizeToolkitSlug } from '$lib/composio-catalog';
import {
  buildConnectorsPrompt,
  isAgentToolkit,
  toAgentTools,
  truncateJson,
  type AgentConnection,
  type AgentTool
} from '$lib/composio-agent';
import { APPS_UNAVAILABLE } from '$lib/chat-connect';
import { loadBrandConnections } from '$lib/server/composio-catalog';
import {
  composioConfigured,
  composioErrorMessage,
  composioUserId,
  executeComposioTool,
  listComposioTools
} from '$lib/server/composio';

export { buildConnectorsPrompt };

export async function loadAgentConnections(
  supabase: SupabaseClient,
  brandId: string
): Promise<AgentConnection[]> {
  try {
    const rows = await loadBrandConnections(supabase, brandId);
    return rows.map((r) => ({
      toolkit: r.toolkit_slug,
      kind: r.kind,
      status: r.status,
      displayName: r.display_name || listedForToolkit(r.toolkit_slug).displayName
    }));
  } catch {
    return [];
  }
}

type ResolvedConn = {
  toolkit: string;
  connectedAccountId: string;
  status: string;
  displayName: string;
};

async function resolveConnection(
  supabase: SupabaseClient,
  brandId: string,
  toolkitSlug: string
): Promise<{ ok: true; conn: ResolvedConn } | { ok: false; result: Record<string, unknown> }> {
  const toolkit = normalizeToolkitSlug(toolkitSlug);
  if (!toolkit) {
    return {
      ok: false,
      result: { error: 'missing_integration', message: 'Pass integration (the toolkit slug).' }
    };
  }
  if (!composioConfigured()) {
    // "Composio non è configurato sul server" era una frase che un agente qualunque poteva
    // ripetere all'utente. Il perché tecnico resta per i log; qui viaggia cosa fare invece.
    return { ok: false, result: { ...APPS_UNAVAILABLE } };
  }
  const rows = await loadBrandConnections(supabase, brandId);
  const row = rows.find((r) => r.toolkit_slug === toolkit);
  if (!row?.connected_account_id) {
    return {
      ok: false,
      result: {
        error: 'not_connected',
        integration: toolkit,
        // Il vecchio testo mandava la persona in una pagina di impostazioni — cioè le chiedeva di
        // fare da sé la cosa che il tool accanto sa fare in chat. Un risultato di tool che dice il
        // contrario del prompt vince sul prompt: è arrivato dopo, ed è concreto.
        message: `${listedForToolkit(toolkit).displayName} is not connected for this brand. Call propose_app_connection({ toolkit: "${toolkit}", reason }) so the connect card lands in the chat — do NOT send the user to a settings page, and do not tell them you cannot do this.`
      }
    };
  }
  if (row.status !== 'active') {
    // `pending` is an unfinished Connect Link, `error` a connection that stopped working. Either
    // way the agent must not act as if the app were usable.
    return {
      ok: false,
      result: {
        error: row.status === 'pending' ? 'not_connected' : 'connection_error',
        integration: toolkit,
        message:
          row.status === 'pending'
            ? `${listedForToolkit(toolkit).displayName} was never finished connecting. Call propose_app_connection({ toolkit: "${toolkit}", reason }) to hand them a fresh authorization link.`
            : row.last_error ||
              `${listedForToolkit(toolkit).displayName} needs a reconnect: propose_app_connection({ toolkit: "${toolkit}", reason }) re-authorizes it in the chat.`
      }
    };
  }
  return {
    ok: true,
    conn: {
      toolkit,
      connectedAccountId: row.connected_account_id,
      status: row.status,
      displayName: row.display_name || listedForToolkit(toolkit).displayName
    }
  };
}

export async function listBrandComposioTools(
  supabase: SupabaseClient,
  brandId: string,
  integration?: string | null,
  query?: string | null
): Promise<Record<string, unknown>> {
  if (!integration?.trim()) {
    const connected = await loadAgentConnections(supabase, brandId);
    const agent = connected.filter((c) => isAgentToolkit(c.toolkit));
    return {
      connected: agent,
      hint:
        agent.length === 0
          ? 'Nothing connected yet. This list is what already exists, not what is possible: if the user needs an app, call propose_app_connection({ toolkit, reason }) and the connect card lands in the chat.'
          : 'Call list_integrations_tools again with integration set to one toolkit slug, then call_integrations_tools. An app missing from this list is not out of reach — propose_app_connection connects it.'
    };
  }

  const resolved = await resolveConnection(supabase, brandId, integration);
  if (!resolved.ok) return resolved.result;

  let tools: AgentTool[] = [];
  try {
    const raw = await listComposioTools(resolved.conn.toolkit, { query: query ?? undefined });
    tools = toAgentTools(raw);
  } catch (e) {
    return {
      error: 'list_failed',
      integration: resolved.conn.toolkit,
      message: composioErrorMessage(e)
    };
  }
  if (!tools.length) {
    return {
      integration: resolved.conn.toolkit,
      display_name: resolved.conn.displayName,
      tools: [],
      error: 'no_tools',
      message: 'This toolkit exposes no tools. Try another integration, or search with a query.'
    };
  }
  return {
    integration: resolved.conn.toolkit,
    display_name: resolved.conn.displayName,
    tools
  };
}

export async function callBrandComposioTool(
  supabase: SupabaseClient,
  brandId: string,
  opts: { integration: string; name: string; arguments?: Record<string, unknown> | null }
): Promise<Record<string, unknown>> {
  const name = opts.name.trim();
  if (!name) {
    return { error: 'missing_name', message: 'Pass the tool slug from list_integrations_tools.' };
  }
  const resolved = await resolveConnection(supabase, brandId, opts.integration);
  if (!resolved.ok) return resolved.result;
  const args = opts.arguments && typeof opts.arguments === 'object' ? opts.arguments : {};

  try {
    const result = await executeComposioTool({
      toolSlug: name,
      connectedAccountId: resolved.conn.connectedAccountId,
      userId: composioUserId(brandId),
      arguments: args
    });
    if (!result.successful) {
      // The connection resolved and Composio accepted the call: this is the provider answering.
      // Without saying so, an agent reads any failure as "the integration is broken" and tells
      // the user to reconnect a connection that is perfectly fine.
      return {
        error: 'tool_failed',
        integration: resolved.conn.toolkit,
        name,
        message: (result.error || 'The provider rejected this call').slice(0, 400),
        details: truncateJson(result.data, 2000),
        hint: 'The connection is active — this is the provider’s own error (wrong arguments, missing permission, or the resource does not exist). Do not tell the user to reconnect unless the message says the authorization failed.'
      };
    }
    return {
      integration: resolved.conn.toolkit,
      name,
      result: truncateJson(result.data)
    };
  } catch (e) {
    return {
      error: 'call_failed',
      integration: resolved.conn.toolkit,
      name,
      message: composioErrorMessage(e).slice(0, 400)
    };
  }
}
