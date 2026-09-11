import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-11',
  title: 'SEO metrics now say when they did not arrive',
  items: [
    'When the search data provider does not answer, the SEO analysis says so instead of reporting zero keywords and zero traffic as if the numbers were measured.',
    'A search-performance panel is no longer built from half an answer: if the traffic figures did not arrive, the panel is absent rather than empty.'
  ]
} satisfies ChangelogEntry;
