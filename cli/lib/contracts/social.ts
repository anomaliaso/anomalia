import { z } from 'zod';
import type { BrandEndpoint } from './index';
import { TARGET_PLATFORMS } from './brand-settings';

/**
 * Il collegamento SOCIAL, che non è `/connections` (quello è Composio: Drive, Notion, GitHub,
 * Gmail). Qui si parla degli account su cui il prodotto pubblica davvero.
 *
 * La forma è quella già scelta per il billing, e non cambia: **l'agente conia il link, l'umano lo
 * attraversa.** Nessun agente esegue un OAuth, tiene un token o scollega un account per conto di
 * qualcuno. Il consenso a una piattaforma terza lo dà una persona, sulla pagina di quella
 * piattaforma; all'agente serve sapere cosa manca e consegnare la porta giusta.
 *
 * A differenza del link di billing, questo URL NON è una credenziale: è una pagina della nostra
 * app, che chiede la sua login. Chi non è già dentro come proprietario del brand non ci fa niente.
 */

const platform = z.enum(TARGET_PLATFORMS);

const AccountSchema = z.object({
  platform: z.string(),
  username: z.string().nullable(),
  display_name: z.string().nullable(),
  profile_url: z.string().nullable(),
  status: z
    .string()
    .describe('`active` pubblica. Ogni altro valore no: la riga esiste ma il post resterebbe fermo'),
  connected_at: z.string().nullable()
});

const SlotsSchema = z.object({
  used: z.number().int(),
  limit: z.number().int().describe('Quanti account il piano di questo brand ammette. 0 = nessuno')
});

const ManageUrlSchema = z
  .string()
  .describe(
    'Pagina dove una persona sincronizza o SCOLLEGA un account. Non esiste un tool per scollegare: ' +
      'togliere un account ferma le pubblicazioni programmate senza che nessuno se ne accorga ' +
      'finché non manca un post, quindi è un passo che si attraversa, non si esegue'
  );

export const LIST_SOCIAL_ACCOUNTS = {
  tool: 'list_social_accounts',
  title: 'Connected social accounts',
  description:
    'The social accounts this brand can publish to, one row each: platform, the handle it actually ' +
    'posts as, and whether it still works. Read it before promising anything will go out — a ' +
    'target platform with no active account produces posts that sit forever. It also says whether ' +
    'the plan allows connecting at all and how many slots are left, which is what decides if ' +
    'create_social_connect_link can help. get_brand_settings carries the same connected_platforms ' +
    'summary for the platform vocabulary; this is the account-level truth behind it, and the only ' +
    'place a broken connection shows up. Calls no model and spends no credits.',
  method: 'GET',
  pathUnderBrand: '/social/accounts',
  input: z.object({}).strict(),
  output: z.object({
    brand: z.string(),
    accounts: z.array(AccountSchema),
    connected_platforms: z
      .array(z.string())
      .describe('Piattaforme con almeno un account attivo: le uniche su cui un post esce davvero'),
    broken_platforms: z
      .array(z.string())
      .describe('Ha un account ma nessuno attivo: scaduto, revocato o scollegato. Va riautorizzato'),
    platform_choices: z.array(z.string()),
    can_connect: z.boolean().describe('Falso su free/trial e sui piani che non collegano account'),
    slots: SlotsSchema,
    manage_url: ManageUrlSchema
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SOCIAL_CONNECT_LINK = {
  tool: 'create_social_connect_link',
  title: 'Social connect link',
  description:
    'Mint the link a HUMAN opens to authorise one social platform for this brand, and stop there. ' +
    'You never run the OAuth, never see a token and never connect anything: the person clicks, ' +
    'signs in on that platform, and the account appears. The URL is a page of our own app behind ' +
    'their login, not a credential — but it is useless to anyone who cannot already reach the ' +
    'brand, so hand it over and let them go. Call list_social_accounts first: this refuses when ' +
    'the plan connects no accounts (plan_cannot_connect) or every slot is taken (account_limit), ' +
    'and those are two different problems with two different remedies. Minting a link for a ' +
    'platform that is already connected is allowed and returns already_connected: it is how a ' +
    'expired account gets re-authorised, or a second account added. Calls no model and spends no ' +
    'credits: it works precisely when credits are gone.',
  method: 'POST',
  pathUnderBrand: '/social/connect',
  input: z
    .object({
      platform: platform.describe('The platform to authorise, from platform_choices')
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    platform: z.string(),
    url: z.string().describe('Give it to the person who owns the brand. Opening it yourself does nothing'),
    already_connected: z
      .boolean()
      .describe('Ha già un account attivo su questa piattaforma: il link riautorizza o ne aggiunge uno'),
    slots: SlotsSchema,
    manage_url: ManageUrlSchema
  }),
  failures: [
    { error: 'plan_cannot_connect', status: 409 },
    { error: 'account_limit', status: 409 }
  ],
  destructive: false
} satisfies BrandEndpoint;
