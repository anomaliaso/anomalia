import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: '2026-08-29',
  title: 'Clearer OAuth recovery',
  items: ['Failed OAuth sign-ins now return to login with the same error signal used by authentication links.']
};

export default entry;
