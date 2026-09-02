// Chi è "l'altro capo" di un thread di chat — UNA risoluzione per tutte le superfici (sidebar,
// topbar, composer). Con una regola per superficie i thread degli agenti del roster ricadevano
// sull'avatar neutro.
import {
  BUILTIN_AGENT_AVATARS,
  DEFAULT_CHAT_AGENT_AVATAR,
  fallbackAvatarColor,
  fallbackAvatarFace,
  normalizeAvatarColor,
  normalizeAvatarFace,
  type AgentAvatarFace
} from '$lib/agent-avatars';
import { JOB_OWNERS } from '$lib/agent-owners';
import { dmAgents, dmMemberAvatar, dmNames } from '$lib/chat-dm';

/** Il minimo di un thread che serve per dargli un volto e un nome. */
export type ThreadIdentitySource = {
  title?: string | null;
  agent?: string | null;
  custom_agent_id?: string | null;
  agents?: Array<{ id: string; name: string; face: string; color: string }> | null;
  /** Chat di gruppo: le chiavi dei membri (array, 0209). Un DM porta qui un oggetto, non un array. */
  room_agents?: unknown;
};

export type ThreadIdentity = {
  name: string;
  face: AgentAvatarFace;
  color: string;
  /** true = il volto è un'identità fissa (job/custom), non una faccia derivata dal thread. */
  fixed: boolean;
};

/** Prefisso LEGACY dei thread per-job creati prima dell'unificazione (team-ignition scriveva
 * un thread per lavoro; oggi scrive nel diario dell'agente proprietario, agent='<agentId>'). */
const JOB_PREFIX = 'job:';

/**
 * Le chiavi membro di una chat di gruppo. `room_agents` è un ARRAY solo per le stanze: un DM fra
 * agenti mette lì un oggetto e da qui esce vuoto — che è quello che si vuole.
 */
export function roomMemberKeys(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((k) => String(k ?? '').trim()).filter(Boolean) : [];
}

/**
 * Il nome visibile di un membro della stanza. `agents` arriva dal server già risolto (copre anche
 * i custom); senza, si ripiega sull'etichetta i18n dello specialista e infine sulla chiave nuda.
 */
export function roomMemberName(
  key: string,
  agents: Array<{ id: string; name: string }> | null | undefined,
  t: (key: string) => string
): string {
  const hit = agents?.find((a) => a.id === key);
  if (hit?.name) return hit.name;
  const i18nKey = `chat.agents.${key}.label`;
  const label = t(i18nKey);
  return typeof label === 'string' && label !== i18nKey ? label : key;
}

/**
 * Volto e colore di un membro della stanza — il gemello di `roomMemberName`, per le superfici che
 * mostrano CHI parla adesso invece dell'identità del thread. Stessi ripieghi: avatar fisso dello
 * specialista, poi quello neutro — mai un volto rotto, mai un buco al primo paint.
 */
export function roomMemberAvatar(
  key: string | null | undefined,
  agents: Array<{ id: string; face?: string; color?: string }> | null | undefined
): { face: AgentAvatarFace; color: string } {
  if (!key) return DEFAULT_CHAT_AGENT_AVATAR;
  const hit = agents?.find((a) => a.id === key);
  if (hit) {
    return {
      face: normalizeAvatarFace(hit.face),
      color: normalizeAvatarColor(hit.color, DEFAULT_CHAT_AGENT_AVATAR.color)
    };
  }
  return BUILTIN_AGENT_AVATARS[key] ?? DEFAULT_CHAT_AGENT_AVATAR;
}

/**
 * Risolve nome + avatar di un thread. Il nome è SEMPRE l'agente, mai il titolo/riassunto: come in
 * una lista di messaggi l'identità è il contatto.
 * - DM fra agenti (`room_agents` OGGETTO) → i due membri, con la faccia del primo. Non ha un
 *   agente né una riga in lista: tutto quello che serve sta nel marcatore.
 * - `agent = 'job:<key>'` (LEGACY) → nome della routine con la faccia dell'agente PROPRIETARIO.
 * - thread con custom agent → il suo nome e il suo avatar salvati; finché non è risolto resta
 *   "Anomalia", mai l'etichetta dello specialista che gli sta sotto.
 * - specialista builtin → la sua etichetta i18n e il suo avatar fisso.
 * - thread semplice → "Anomalia" con l'avatar neutro a tema. Il nome è un letterale, non una
 *   chiave i18n: non si traduce.
 *
 * `t` è la funzione di traduzione: passarla invece di importarla tiene il modulo puro e testabile.
 * Una chiave senza traduzione torna com'è, e si ripiega sul titolo del thread o su "Anomalia".
 */
export function threadIdentity(
  thread: ThreadIdentitySource,
  t: (key: string) => string
): ThreadIdentity {
  const title = (thread.title ?? '').trim();
  const agent = thread.agent ?? null;

  if (agent && agent.startsWith(JOB_PREFIX)) {
    // Alias legacy: nome della ROUTINE, faccia del suo agente PROPRIETARIO. Una chiave non più nel
    // roster ricade sulla vecchia derivazione: mai un volto rotto.
    const key = agent.slice(JOB_PREFIX.length);
    const i18nKey = `app.roster.job.${key}.name`;
    const translated = t(i18nKey);
    const owner = (JOB_OWNERS as Record<string, string>)[key];
    const ownerAvatar = owner ? BUILTIN_AGENT_AVATARS[owner] : undefined;
    return {
      name: translated === i18nKey ? title || 'Anomalia' : translated,
      face: ownerAvatar?.face ?? fallbackAvatarFace(key),
      color: ownerAvatar?.color ?? fallbackAvatarColor(key),
      fixed: true
    };
  }

  // DM fra agenti: l'identità sono i DUE, e stanno nel marcatore. Un DM non ha `agent` né
  // `custom_agent_id` e non compare nella lista dei thread, quindi senza questo ramo cadeva
  // nell'ultimo ripiego e si presentava come Anomalia — il generalista, che lì dentro non c'è.
  const pair = dmAgents(thread.room_agents);
  if (pair) {
    const names = dmNames(thread.room_agents);
    const memberName = (key: string) => names[key] || roomMemberName(key, thread.agents, t);
    return {
      name: pair.map(memberName).join(' ⇄ '),
      ...dmMemberAvatar(pair[0]),
      fixed: true
    };
  }

  // Chat di gruppo: l'identità è LA STANZA, non un agente. Nome = i membri, volto = il primo (la
  // sidebar disegna la pila intera, perché `agents` ha più di una voce).
  const roomKeys = roomMemberKeys(thread.room_agents);
  if (roomKeys.length >= 2) {
    const first = thread.agents?.[0];
    return {
      name: roomKeys.map((k) => roomMemberName(k, thread.agents, t)).join(', '),
      face: first ? normalizeAvatarFace(first.face) : DEFAULT_CHAT_AGENT_AVATAR.face,
      color: first
        ? normalizeAvatarColor(first.color, DEFAULT_CHAT_AGENT_AVATAR.color)
        : DEFAULT_CHAT_AGENT_AVATAR.color,
      fixed: true
    };
  }

  const custom = thread.custom_agent_id
    ? (thread.agents?.find((a) => a.id === thread.custom_agent_id) ?? null)
    : (thread.agents?.[0] ?? null);
  if (custom) {
    return {
      name: custom.name || title || 'Anomalia',
      face: normalizeAvatarFace(custom.face),
      color: normalizeAvatarColor(custom.color, DEFAULT_CHAT_AGENT_AVATAR.color),
      fixed: true
    };
  }

  if (!thread.custom_agent_id && agent && agent !== 'auto' && BUILTIN_AGENT_AVATARS[agent]) {
    const builtin = BUILTIN_AGENT_AVATARS[agent];
    // `.label`, non la chiave nuda: `chat.agents.<id>` è un OGGETTO {label, desc}, e svelte-i18n su
    // una chiave-oggetto restituisce l'oggetto → "[object Object]" in sidebar.
    const label = t(`chat.agents.${agent}.label`);
    return {
      name: typeof label !== 'string' || label === `chat.agents.${agent}.label` ? 'Anomalia' : label,
      face: builtin.face,
      color: builtin.color,
      fixed: true
    };
  }

  return {
    name: 'Anomalia',
    face: DEFAULT_CHAT_AGENT_AVATAR.face,
    color: DEFAULT_CHAT_AGENT_AVATAR.color,
    fixed: false
  };
}

/**
 * L'identità dell'agente SCELTO nel composer: la stessa risoluzione di un thread, applicata alla
 * selezione viva del picker.
 *
 * Dal picker si passa una lista di UNO. `threadIdentity` ricade su `agents[0]` quando l'id non
 * lega, e la lista del composer sono TUTTI gli agenti dell'utente: passarla intera vestirebbe
 * Anomalia col primo agente custom in ordine alfabetico.
 */
export function composerIdentity(
  agent: string | null | undefined,
  customAgentId: string | null | undefined,
  customAgents: Array<{ id: string; name: string; face: string; color: string }>,
  t: (key: string) => string
): ThreadIdentity {
  const custom = (customAgentId ? customAgents.find((a) => a.id === customAgentId) : null) ?? null;
  return threadIdentity(
    { agent, custom_agent_id: custom?.id ?? null, agents: custom ? [custom] : null },
    t
  );
}
