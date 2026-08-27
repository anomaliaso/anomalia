import type { Actions } from './$types';
import { sync, disconnect } from '$lib/server/settings-actions';

export const actions: Actions = { sync, disconnect };
