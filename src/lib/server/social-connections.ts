import type { SupabaseClient } from '@supabase/supabase-js';
import { accountLimit, canConnectSocials } from '$lib/server/plans';

/**
 * Lo stato del collegamento social di un brand, letto una volta sola.
 *
 * Esiste perché la stessa domanda — "su quali piattaforme questo brand pubblica davvero?" — la
 * fanno due tool (`get_brand_settings` e `list_social_accounts`) e la rotta che conia il link. Con
 * tre letture separate le tre risposte divergono al primo cambiamento, e un agente che ne sente
 * due diverse non sa più a quale credere.
 *
 * `active` è l'unico stato che pubblica. Gli altri valori che il sync deposita (`disconnected`, e
 * quelli che una piattaforma può restituire scaduti o revocati) non vengono enumerati qui: la
 * riga c'è ma nessuna è attiva, e questo basta a dire che la piattaforma va riautorizzata.
 */

const ACTIVE = 'active';

export type SocialAccount = {
  platform: string;
  username: string | null;
  display_name: string | null;
  profile_url: string | null;
  status: string;
  connected_at: string | null;
};

export type SocialConnections = {
  accounts: SocialAccount[];
  connected: string[];
  broken: string[];
  canConnect: boolean;
  slots: { used: number; limit: number };
};

type BrandRef = { id: string; plan: string | null; status: string | null };

const norm = (value: unknown): string => String(value ?? '').toLowerCase().trim();

const unique = (platforms: string[]): string[] => [...new Set(platforms)].filter(Boolean);

export async function socialConnections(
  supabase: SupabaseClient,
  brand: BrandRef
): Promise<SocialConnections> {
  const { data } = await supabase
    .from('social_accounts')
    .select('platform, username, display_name, profile_url, status, connected_at')
    .eq('brand_id', brand.id)
    .order('connected_at', { ascending: true });

  const accounts: SocialAccount[] = (data ?? []).map((row) => ({
    platform: norm(row.platform),
    username: row.username ?? null,
    display_name: row.display_name ?? null,
    profile_url: row.profile_url ?? null,
    status: norm(row.status) || ACTIVE,
    connected_at: row.connected_at ?? null
  }));

  const connected = unique(accounts.filter((a) => a.status === ACTIVE).map((a) => a.platform));
  const broken = unique(accounts.map((a) => a.platform)).filter((p) => !connected.includes(p));

  return {
    accounts,
    connected,
    broken,
    canConnect: canConnectSocials(brand.plan, brand.status),
    slots: {
      used: accounts.filter((a) => a.status === ACTIVE).length,
      limit: accountLimit(brand.plan)
    }
  };
}

/** Dove una persona collega una piattaforma. Non è un OAuth: è una pagina dietro la sua login. */
export const connectPath = (slug: string, platform: string): string =>
  `/app/${encodeURIComponent(slug)}/settings/connect/${encodeURIComponent(platform)}`;

/** Dove una persona sincronizza o scollega. Nessun tool scollega: si attraversa, non si esegue. */
export const managePath = (slug: string): string =>
  `/app/${encodeURIComponent(slug)}/settings/connected-accounts`;
