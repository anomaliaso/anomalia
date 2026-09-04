import { env } from '$env/dynamic/private';
import type { BillingProvider } from '$lib/billing/contract';
import { openBillingProvider } from '$lib/billing/open-provider';
import { swallow } from '$lib/server/swallow';

// Once per process: billingProvider() answers all 29 credit gates, and a provider that is absent
// stays absent for the life of the process. One report is the whole story; 29 per request would
// bury it.
let fallbackReported = false;

function fallBackToOpen(reason: string, err?: unknown): BillingProvider {
  if (!fallbackReported) {
    fallbackReported = true;
    swallow(`billing: paid provider unavailable, quotas are now unmetered (${reason})`, err);
  }
  return openBillingProvider;
}

// The one place that decides which billing provider answers gate()/quota()/upgradeUrl().
// Default: anomalia (today's product, unchanged). BILLING_PROVIDER=open forces the permissive
// default — and so does anomalia-provider.ts not being there, which is what a self-hosted fork
// looks like once it's extracted into its own (absent, private) npm package. "Not there" has two
// shapes, and both fall back: the module throws on load, or it hands back no provider at all.
//
// Asking for `open` is a choice, and stays quiet. FALLING BACK to it is the shape of the incident
// that left AI ungated in production for a week without a single log line, so it says so.
export async function billingProvider(): Promise<BillingProvider> {
  if (env.BILLING_PROVIDER === 'open') return openBillingProvider;
  try {
    const { anomaliaBillingProvider } = await import('./anomalia-provider');
    return anomaliaBillingProvider ?? fallBackToOpen('module exported no provider');
  } catch (e) {
    return fallBackToOpen('module failed to load', e);
  }
}
