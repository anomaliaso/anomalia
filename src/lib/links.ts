// Single source of truth for outbound links shared across the marketing site
// and the app, so a CTA and the floating widget can't drift apart.

/** Marco's "book a call" Calendly — used by MarcoWidget and the landing CTAs. */
export const BOOKING_URL = 'https://calendly.com/marco-anomalia/call-conoscitiva-anomalia';

/**
 * Where an author writes to have their post taken off the public wall.
 *
 * A named constant rather than a string in a template because it appears on three pages and in the
 * structured data, and a takedown address that is wrong on one of them is worse than none at all.
 */
export const WALL_REMOVAL_EMAIL = 'hello@anomalia.so';
