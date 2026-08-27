import { env } from '$env/dynamic/private';
import type { BillingProvider } from '$lib/billing/contract';
import { openBillingProvider } from '$lib/billing/open-provider';

// The one place that decides which billing provider answers gate()/quota()/upgradeUrl().
// Default: anomalia (today's product, unchanged). BILLING_PROVIDER=open forces the permissive
// default — and so does anomalia-provider.ts simply not existing, which is what a self-hosted
// fork looks like once it's extracted into its own (absent, private) npm package.
export async function billingProvider(): Promise<BillingProvider> {
  if (env.BILLING_PROVIDER === 'open') return openBillingProvider;
  try {
    const { anomaliaBillingProvider } = await import('./anomalia-provider');
    return anomaliaBillingProvider;
  } catch {
    return openBillingProvider;
  }
}
