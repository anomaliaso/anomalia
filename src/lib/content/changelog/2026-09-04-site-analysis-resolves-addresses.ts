import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: '2026-09-04',
  title: 'Reading a website checks where each address really leads',
  items: [
    'When we read your site — its pages, its images, its product catalogue — every address is now checked against where it actually leads, not just how it is written, and a link that leads somewhere off the public internet is dropped instead of followed.',
    'The same check runs again each time a link forwards along, so a public address can no longer hand the crawler somewhere private on the way.'
  ]
};

export default entry;
