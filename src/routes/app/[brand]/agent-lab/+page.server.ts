import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { SPECIALISTS } from '$lib/agent/specs';

// Banco di prova del nuovo sistema agenti (src/lib/agent/) — SOLO dev. L'auth/brand è già
// risolta dal +layout.server.ts di questo segmento (redirect a /login se non loggato, 404 se
// il brand non esiste): qui basta riusare `parent()`, niente query duplicata.
export const load: PageServerLoad = async ({ parent }) => {
  if (!dev) throw error(404, 'Not found');
  const { brand } = await parent();

  return {
    brand: { id: brand.id as string, slug: brand.slug as string, name: brand.name as string },
    specialists: SPECIALISTS.map((s) => ({ id: s.id, name: s.name, title: s.title, color: s.color }))
  };
};
