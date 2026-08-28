import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: 'August 28, 2026',
  title: 'Fewer silent chat failures',
  items: [
    'Fixed a bug that made every Content Creator turn fail before generating anything — a malformed tool description that the model provider rejected as a whole.'
  ]
};

export default entry;
