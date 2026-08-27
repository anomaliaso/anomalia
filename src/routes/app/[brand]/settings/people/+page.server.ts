// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

import type { Actions } from './$types';
import { studioActions } from '$lib/server/studio-actions';

export const actions: Actions = {
  addPersonReal: studioActions.addPersonReal,
  generatePersonAI: studioActions.generatePersonAI,
  deletePerson: studioActions.deletePerson,
  attestPersonConsent: studioActions.attestPersonConsent,
};
