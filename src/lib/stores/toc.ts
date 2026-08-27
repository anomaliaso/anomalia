import { writable } from 'svelte/store';

export const toc = writable<{ title: string; href: string }[]>([]);
