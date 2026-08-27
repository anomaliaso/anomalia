import type { ParamMatcher } from '@sveltejs/kit';
import { BLOG_LOCALES } from '$lib/blog-locales';

// Restricts the [[lang=bloglang]] segment on the public blog to known blog locales, so /category,
// /search, /tag and article slugs are never swallowed as a language. Matchers run before any DB
// access, which is exactly why BLOG_LOCALES is a fixed list rather than "any 2-letter string" —
// whether the brand actually publishes this locale is checked in the load, which can query.
export const match: ParamMatcher = (param) => (BLOG_LOCALES as readonly string[]).includes(param);
