import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Usage reporting tells apart "free" from "not measured"',
  items: [
    'Some AI work was being recorded without a price, and anything without a price counted as free — so a share of real usage never showed up in your credits or your usage page.',
    'Unpriced work is now distinguishable from genuinely free activity, which means we can find it and fix it instead of it passing unnoticed.',
    'Credit totals are unchanged on the same activity, and failed requests still cost you nothing.'
  ]
} satisfies ChangelogEntry;
