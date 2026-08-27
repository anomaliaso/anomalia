import type { BillingProvider } from './contract';

// The default for a self-hosted fork: everything is permitted, nothing is metered, nothing is
// for sale. Every method is a no-op / Infinity / undefined on purpose — the 29+11 gate call
// sites in src/lib/server never see a difference between "never denied" and "no billing at all".
export const openBillingProvider: BillingProvider = {
  kind: 'open',

  async gate() {
    // never throws
  },

  async quota() {
    return Infinity;
  },

  upgradeUrl() {
    return undefined;
  },

  plansAbove() {
    return [];
  },

  isTopPlan() {
    return true;
  }
};
