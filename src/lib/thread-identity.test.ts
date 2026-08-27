import { describe, expect, it } from 'vitest';
import { composerIdentity, roomMemberAvatar, threadIdentity } from './thread-identity';
import {
  BUILTIN_AGENT_AVATARS,
  DEFAULT_CHAT_AGENT_AVATAR,
  chatFaceForPhase,
  fallbackAvatarColor,
  fallbackAvatarFace
} from './agent-avatars';

// t finto: traduce solo le chiavi note, le altre tornano com'è (come svelte-i18n).
const t = (k: string) =>
  ({
    'app.roster.job.seo.name': 'Revisione SEO',
    'chat.agents.content.label': 'Content Creator'
  })[k] ?? k;

describe('threadIdentity', () => {
  it('job:<key> (legacy) → nome della ROUTINE con la faccia del suo agente PROPRIETARIO', () => {
    // I vecchi thread per-job restano leggibili dopo l'unificazione: 'job:seo' porta il volto
    // del Web Specialist (l'owner) e il nome della routine — mai una chiave grezza a schermo.
    const who = threadIdentity({ title: 'Riassunto rumoroso', agent: 'job:seo' }, t);
    expect(who.name).toBe('Revisione SEO');
    expect(who.face).toBe(BUILTIN_AGENT_AVATARS.web.face);
    expect(who.color).toBe(BUILTIN_AGENT_AVATARS.web.color);
    expect(who.fixed).toBe(true);
  });

  it('job sconosciuto senza traduzione → titolo del thread e faccia derivata (mai un volto rotto)', () => {
    const who = threadIdentity({ title: 'Nuovo lavoro', agent: 'job:boh' }, t);
    expect(who.name).toBe('Nuovo lavoro');
    expect(who.face).toBe(fallbackAvatarFace('boh'));
    expect(who.color).toBe(fallbackAvatarColor('boh'));
  });

  it('custom agent → il SUO nome e avatar, preferendo quello legato a custom_agent_id', () => {
    const who = threadIdentity(
      {
        title: 'Titolo che non deve vincere',
        custom_agent_id: 'b',
        agents: [
          { id: 'a', name: 'Primo', face: 'dot', color: '#ef4444' },
          { id: 'b', name: 'Legato', face: 'wink', color: '#2563eb' }
        ]
      },
      t
    );
    expect(who.name).toBe('Legato');
    expect(who.face).toBe('wink');
    expect(who.color).toBe('#2563eb');
  });

  it('specialista builtin → etichetta e avatar dell’hub, mai il titolo', () => {
    const who = threadIdentity({ title: 'Riassunto', agent: 'content' }, t);
    expect(who.name).toBe('Content Creator');
    expect(who.color).not.toBe('theme');
  });

  it('thread semplice → è Anomalia (avatar neutro a tema), non il riassunto auto-generato', () => {
    const who = threadIdentity({ title: 'Piano editoriale di marzo', agent: null }, t);
    expect(who.name).toBe('Anomalia');
    expect(who.fixed).toBe(false);
  });
});

// L'agente SCELTO nel composer: è quello che veste l'avatar a riposo in overview e in chat.
describe('composerIdentity', () => {
  const mine = [
    { id: 'a', name: 'Primo', face: 'dot', color: '#ef4444' },
    { id: 'b', name: 'Il mio', face: 'curious', color: '#2563eb' }
  ];

  it('specialista builtin → la SUA faccia, non la neutra di Anomalia', () => {
    const who = composerIdentity('content', null, mine, t);
    expect(who.face).toBe(BUILTIN_AGENT_AVATARS.content.face);
    expect(who.color).toBe(BUILTIN_AGENT_AVATARS.content.color);
  });

  it('custom agent selezionato → faccia e colore suoi', () => {
    const who = composerIdentity('auto', 'b', mine, t);
    expect(who.name).toBe('Il mio');
    expect(who.face).toBe('curious');
    expect(who.color).toBe('#2563eb');
  });

  it('nessun agente (auto) → Anomalia neutro, NON il primo agente della lista', () => {
    const who = composerIdentity('auto', null, mine, t);
    expect(who.name).toBe('Anomalia');
    expect(who.face).toBe(DEFAULT_CHAT_AGENT_AVATAR.face);
    expect(who.color).toBe(DEFAULT_CHAT_AGENT_AVATAR.color);
  });

  it('id sconosciuto → ricade su Anomalia, mai sulla chiave i18n nuda', () => {
    const who = composerIdentity('reparto-che-non-esiste', null, [], t);
    expect(who.name).toBe('Anomalia');
    expect(who.face).toBe(DEFAULT_CHAT_AGENT_AVATAR.face);
  });
});

describe('threadIdentity: chat di gruppo', () => {
  const room = {
    title: 'Riassunto qualunque',
    agent: 'content',
    room_agents: ['motion', 'custom:11111111-2222-3333-4444-555555555555'],
    agents: [
      { id: 'motion', name: 'Motion Specialist', face: 'visor', color: '#8b5cf6' },
      { id: 'custom:11111111-2222-3333-4444-555555555555', name: 'Il Copy', face: 'smile', color: '#f97316' }
    ]
  };

  it("l'identità è LA STANZA: i nomi dei membri, non l'agente della colonna", () => {
    const who = threadIdentity(room, t);
    expect(who.name).toBe('Motion Specialist, Il Copy');
    expect(who.face).toBe('visor');
    expect(who.fixed).toBe(true);
  });

  it('senza la lista risolta ripiega sulle etichette i18n degli specialisti', () => {
    const who = threadIdentity({ agent: null, room_agents: ['content', 'motion'] }, t);
    expect(who.name).toBe('Content Creator, motion');
  });

  it('un DM (oggetto, non array) non è una stanza: resta la risoluzione di prima', () => {
    const who = threadIdentity({ agent: 'content', room_agents: { dm: ['content', 'analyst'] } }, t);
    expect(who.name).toBe('Content Creator');
  });
});

describe('chatFaceForPhase con la faccia a riposo dell’agente', () => {
  it('idle → la faccia dell’agente; le altre fasi restano espressioni del turno', () => {
    expect(chatFaceForPhase('idle', 'visor')).toBe('visor');
    expect(chatFaceForPhase('thinking', 'visor')).toBe('wink');
    expect(chatFaceForPhase('error', 'visor')).toBe('sad');
  });

  it('senza agente (o con una faccia che non esiste) resta la neutra di prima', () => {
    expect(chatFaceForPhase('idle')).toBe('wide');
    expect(chatFaceForPhase('idle', 'boh')).toBe('wide');
  });
});

/**
 * Il volto di CHI parla adesso — quello che la riga di caricamento indossa durante una stanza.
 * Tre fonti, in ordine: la lista risolta dal server (copre i custom agent), l'avatar fisso dello
 * specialista, il neutro. Nessuna delle tre può mancare, o durante un turno appare un buco.
 */
describe('roomMemberAvatar', () => {
  const agents = [
    { id: 'custom:abc', name: 'Il mio agente', face: 'visor', color: '#123456' },
    { id: 'motion', name: 'Motion', face: 'wink', color: '#abcdef' }
  ];

  it('la lista del thread vince: è l’unica che conosce i custom agent', () => {
    expect(roomMemberAvatar('custom:abc', agents)).toEqual({ face: 'visor', color: '#123456' });
  });

  it('senza lista, lo specialista ha comunque il suo avatar fisso', () => {
    expect(roomMemberAvatar('content', null)).toEqual(BUILTIN_AGENT_AVATARS.content);
  });

  it('chiave sconosciuta o assente → il neutro, mai un volto rotto', () => {
    expect(roomMemberAvatar('boh', null)).toEqual(DEFAULT_CHAT_AGENT_AVATAR);
    expect(roomMemberAvatar(null, agents)).toEqual(DEFAULT_CHAT_AGENT_AVATAR);
  });
});
