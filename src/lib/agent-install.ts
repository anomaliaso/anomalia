/**
 * The "I clicked Use this agent while logged out" cookie.
 *
 * Login always lands on /app, so the slug cannot travel in the URL. It is parked here by
 * /app/install-agent/[slug] and consumed by Automations › Custom Agents the first time the
 * user opens that page, which then opens the editor on the template they picked.
 */
export const PENDING_AGENT_INSTALL_COOKIE = 'anomalia_install_agent';
export const PENDING_AGENT_INSTALL_MAX_AGE = 60 * 60 * 24; // 24h — survives a signup detour
