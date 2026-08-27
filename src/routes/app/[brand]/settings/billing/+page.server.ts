import type { Actions } from './$types';
import { billingPortal, upgrade, applyRetention, cancelPlan } from '$lib/server/settings-actions';

export const actions: Actions = { billingPortal, upgrade, applyRetention, cancelPlan };
