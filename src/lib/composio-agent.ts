/**
 * Pure helpers for exposing a brand's connected toolkits to in-app AI agents.
 * No secrets — connected account ids stay on the server; this file only shapes payloads.
 */
import { listedForToolkit, type ConnectorKind } from '$lib/composio-catalog';

export const MAX_AGENT_RESULT_CHARS = 16_000;
export const MAX_AGENT_TOOLS_LISTED = 80;

export type AgentConnection = {
  toolkit: string;
  kind: ConnectorKind;
  status: string;
  displayName: string;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export function isAgentToolkit(toolkitSlug: string): boolean {
  return Boolean(toolkitSlug.trim());
}

/** A full JSON Schema can be thousands of tokens; past a point the agent only needs the shape. */
export function compactSchema(schema: unknown): unknown {
  if (schema == null) return undefined;
  const s = JSON.stringify(schema);
  if (s.length <= 2500) return schema;
  return { type: 'object', note: 'input schema truncated — pass a JSON object of arguments' };
}

export function toAgentTools(
  raw: { slug: string; name?: string; description?: string; inputSchema?: unknown }[]
): AgentTool[] {
  const out: AgentTool[] = [];
  for (const tool of raw) {
    const name = String(tool.slug ?? '').trim();
    if (!name) continue;
    out.push({
      name,
      description: String(tool.description ?? tool.name ?? '').slice(0, 500),
      inputSchema: compactSchema(tool.inputSchema)
    });
    if (out.length >= MAX_AGENT_TOOLS_LISTED) break;
  }
  return out;
}

export function truncateJson(value: unknown, max = MAX_AGENT_RESULT_CHARS): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length <= max) return value;
    return { truncated: true, preview: s.slice(0, max) };
  } catch {
    return { error: 'unserializable_result' };
  }
}

/**
 * La regola che mancava, e il difetto che ha prodotto.
 *
 * Un agente in chat deduce cosa può fare dai tool che si vede montati. Alla domanda "puoi
 * accedere a Google Calendar?" non trovava nessun tool "calendario", e rispondeva di no — vero
 * sul suo set di tool, falso sul prodotto: `propose_app_connection` fa esattamente quello, e
 * fino a oggi era nominato solo nel brief dell'onboarding. Fuori di lì la porta esisteva e
 * nessuno gliel'aveva detta.
 *
 * Sta QUI, dentro buildConnectorsPrompt, e non in agents.ts o system-prompt.ts, per una ragione
 * sola: questo blocco viene spinto nella "shared identity" di OGNI prompt di chat — ogni
 * specialista, ogni consulto, ogni sotto-agente, ogni turno schedulato. Una regola scritta in un
 * prompt solo viene contraddetta dall'altro.
 *
 * Il difetto opposto (promettere collegamenti che non esistono) è già impedito a monte:
 * `loadConnectorCatalog` filtra con `connectableCatalog`, quindi propose_app_connection può
 * proporre solo toolkit che hanno davvero un'app OAuth dietro; tutto il resto torna
 * `unknown_toolkit` con i suggerimenti. Per questo il testo può dire "provaci" senza rischiare.
 */
const CONNECT_ON_DEMAND = [
  'NOT CONNECTED NEVER MEANS NOT POSSIBLE. Connecting an external app is something you can do right now, in this conversation — it is not a setup step that ended with onboarding. propose_app_connection opens onto the whole Composio catalogue: over a thousand apps (calendars, CRMs, docs and notes, email, project trackers, support desks, warehouses, ads). If the user names a tool, it can almost certainly be connected.',
  'So when you need an app that is not in the list above: (1) call propose_app_connection({ toolkit, reason }) — reason is ONE line, in the user\'s language, about what it changes for THIS brand right now; (2) introduce the card in one short line, then get on with the part of the work you can already do. Answering "I don\'t have access to <app>" and stopping there is a defect, not caution. Same when a tool returns not_connected: propose the connection instead of sending the user to a settings page.',
  'Unsure of the slug? Call it with the name as you would say it ("google calendar", HUBSPOT, "linear"): the tool either proposes it or hands you the closest connectable matches — pick one and call again. It only ever proposes apps that can really be connected, so if every spelling comes back unknown_toolkit, that app genuinely is not available, and THEN you say so.',
  'PROPOSE UNPROMPTED, BUT ONCE. You may propose an app the user never mentioned — only when you can point at the concrete piece of work in front of you that it would change. "I am picking slots for these four posts; with your calendar I would avoid the days you are away" is a reason; "a CRM could be useful" is not. At most ONE unprompted card per turn (more only if they ask what they could connect), and never the same app twice: once the card is in the thread, or they moved on, or they said no, that app is settled — raise it again only if the work actually stops without it. When the app IS what the user asked about, propose it immediately: that is not a suggestion, it is the answer.',
  'NEVER SAY AN APP IS CONNECTED, and never say you will connect it yourself. You propose, the person authorizes: the tool result and the card are the only truth. If propose_app_connection answers already_connected, skip the card and work through list_integrations_tools.',
  'SOCIAL ACCOUNTS ARE A DIFFERENT DOOR. Instagram, Facebook, LinkedIn, TikTok, X, YouTube, Threads, Pinterest are connected under Settings → connected accounts (/settings/connected-accounts) and need an active paid plan — never propose_app_connection for them, and never send someone to Connectors to publish a post.',
  'A connection that answers connection_error exists but broke: propose_app_connection re-authorizes it, or propose_open_tab /settings/connectors if they would rather manage it there.',
  'DELEGATES: propose_app_connection belongs to whoever is talking to the user. If you are a delegated sub-agent and a missing app blocks you, say so in your report — never conclude the task is impossible.'
].join('\n');

export function buildConnectorsPrompt(rows: AgentConnection[]): string {
  // `pending` is a Connect Link the user opened and never finished: telling the agent the app is
  // connected would have it plan around tools that answer 404. `error` stays listed so the agent
  // can explain what needs reconnecting.
  const agentRows = rows.filter(
    (r) => isAgentToolkit(r.toolkit) && (r.status === 'active' || r.status === 'error')
  );
  const lines: string[] = [
    '## APPS & INTEGRATIONS',
    'Live tools for this brand (Settings → Connectors). Call list_integrations_tools({ integration }) then call_integrations_tools({ integration, name, arguments }). `integration` is the toolkit slug below and `name` is a tool slug from the listing — never invent either. Credentials are injected by the server: never ask for or pass tokens. Max 8 integration calls per turn.'
  ];
  if (agentRows.length) {
    lines.push('Connected:');
    for (const r of agentRows) {
      const label = r.displayName || listedForToolkit(r.toolkit).displayName;
      const kind = r.kind === 'mcp' ? 'Tools' : 'App';
      const status = r.status === 'active' ? 'active' : r.status;
      lines.push(`- ${r.toolkit} (${kind} · ${label}) status=${status}`);
    }
  } else {
    lines.push(
      'No integrations connected yet. That is a starting point, not a limit — read the next paragraph before you tell anyone what you cannot reach.'
    );
  }
  lines.push(CONNECT_ON_DEMAND);
  return lines.join('\n');
}
