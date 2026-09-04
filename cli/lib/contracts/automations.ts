import { z } from 'zod';
import type { BrandEndpoint } from './index';

/**
 * I lavori ricorrenti inclusi nel prodotto. L'elenco vero e' `ROSTER_JOBS`
 * (`$lib/server/job-roster`), che il contratto non puo' importare: un test dell'app tiene i due
 * allineati. Il testo di cosa fa ciascuno NON e' qui — arriva dalla rotta, da `jobBlurb`, che e'
 * la stessa fonte del prompt di onboarding.
 */
export const AUTOMATION_JOBS = [
  'autopilot',
  'analytics_review',
  'weekly_recap',
  'seo',
  'geo',
  'radar_recap',
  'market_refs',
  'strategy_review',
  'library'
] as const;

export type AutomationJob = (typeof AUTOMATION_JOBS)[number];

export const AUTOMATION_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export const AUTOMATION_STATES = ['off', 'ok', 'skipped', 'failed', 'never'] as const;

const job = z.enum(AUTOMATION_JOBS).describe('Which recurring job');

const Job = z.object({
  job: z.enum(AUTOMATION_JOBS),
  what: z.string(),
  cadence: z.enum(AUTOMATION_CADENCES),
  enabled: z.boolean(),
  state: z.enum(AUTOMATION_STATES),
  reason: z.string().nullable(),
  last_run_at: z.string().nullable(),
  behind: z.boolean(),
  /** Quante volte ha davvero girato negli ultimi 30 giorni: i giri fermati da un gate non contano. */
  runs_30d: z.number()
});

export const GET_AUTOMATIONS = {
  tool: 'get_automations',
  title: 'Recurring jobs',
  description:
    'The recurring jobs included with the product and whether this brand runs them: what each ' +
    'one does, how often, whether it is on, how it went last time, and how many times it ' +
    'actually ran in the last 30 days. Read it before set_automation — `runs_30d` with `cadence` ' +
    'is how you tell what turning one on commits the brand to. What it CANNOT tell you is the ' +
    'money: AI spend is recorded per call, with no column naming the job that made it, so no ' +
    'clean read attributes dollars to one automation. The brand-wide bill is on the usage page.',
  method: 'GET',
  pathUnderBrand: '/settings/automations',
  input: z.object({}).strict(),
  output: z.object({
    brand: z.string(),
    plan: z.string().nullable(),
    /** Senza un piano a pagamento nessuno di questi parte, per quanti se ne accendano. */
    scheduled_work_allowed: z.boolean(),
    jobs: z.array(Job)
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SET_AUTOMATION = {
  tool: 'set_automation',
  title: 'Turn a recurring job on or off',
  description:
    'Turn one recurring job on or off for this brand. ' +
    'Turning one ON is a spending decision, not a preference: from that moment the job runs BY ' +
    'ITSELF on its cadence, and every run calls AI models and spends the brand’s credits, with ' +
    'nobody looking. Say which job, how often it will run, and that it spends — before you turn ' +
    'it on, and to the person whose credits they are. Turning one OFF spends nothing and is the ' +
    'safe direction: it takes effect at the next tick and destroys nothing. ' +
    'A brand without a paid plan runs none of them, however many are on. The call itself calls ' +
    'no model and spends no credits.',
  method: 'PUT',
  pathUnderBrand: '/settings/automations',
  input: z.object({ job, enabled: z.boolean().describe('true starts it running by itself') }).strict(),
  output: z.object({
    ok: z.literal(true),
    job: z.enum(AUTOMATION_JOBS),
    enabled: z.boolean(),
    cadence: z.enum(AUTOMATION_CADENCES),
    /** Ripetuto nella risposta di chi ACCENDE: cosa e' stato impegnato resta scritto nel turno. */
    spends_on_every_run: z.boolean(),
    scheduled_work_allowed: z.boolean()
  }),
  failures: [{ error: 'toggle_failed', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;
