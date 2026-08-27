// Single source of truth for the legal pages (Privacy Policy, Terms).
// Edit these values once and both /privacy and /terms update.

export const legal = {
  /** Product / service name shown to users. */
  service: 'Anomalia',

  /** Data controller — a sole proprietorship (ditta individuale).
   *  Under the GDPR the controller is the natural person, so the name and
   *  VAT number are legally required and cannot be omitted. */
  owner: 'Marco Di Franco',
  vat: 'IT18500501004',

  // TODO: replace with the real address you want to reach you at for privacy/legal requests.
  contactEmail: 'privacy@anomalia.so',

  /** Date these documents were last revised — keep in sync when you edit them. */
  lastUpdated: '19 August 2026'
} as const;
