import type { Actions } from './$types';
import { createApiKey, revokeApiKey } from '$lib/server/settings-actions';

export const actions: Actions = { createApiKey, revokeApiKey };
