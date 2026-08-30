import { writable } from 'svelte/store';

export const pageModalOrigin = writable<string | null>(null);
