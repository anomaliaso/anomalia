import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: '2026-08-28',
  title: 'OpenRouter chat streams no longer fail silently',
  items: ['Chat turns now complete when OpenRouter omits a finish signal after delivering a response.']
};

export default entry;
