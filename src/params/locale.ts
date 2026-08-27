import type { ParamMatcher } from '@sveltejs/kit';
import { isLocale } from '$lib/i18n/locale';

// Restricts the optional [[lang=locale]] segment to known locales, so /pricing, /app, /login
// etc. don't get swallowed as a "language" — only en|it|es|fr match.
export const match: ParamMatcher = (param) => isLocale(param);
