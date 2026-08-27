import { writable } from 'svelte/store';

export type CreditState = {
  used: number;
  quota: number;
  remaining: number;
  percent: number;
  periodEnd: string;
  bonus?: number;
} | null;

const { subscribe, set } = writable<CreditState>(null);

export const credits = { subscribe };

/** Seed from layout deferred data. */
export function setCredits(c: CreditState): void {
  set(c);
}

/** Lightweight fetch from the credits endpoint (1 SUM query). */
export async function refreshCredits(slug: string): Promise<void> {
  try {
    const res = await fetch(`/app/${slug}/credits`);
    if (res.ok) set(await res.json());
  } catch {
    /* offline / navigation — silently ignore */
  }
}
