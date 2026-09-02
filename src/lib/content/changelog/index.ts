/** `YYYY-MM-DD`, come il nome del file. Una data in prosa e una ISO nello stesso giorno si
 *  ordinano al contrario: `Date.parse` legge la prima come mezzanotte locale e la seconda come
 *  mezzanotte UTC. */
export type ChangelogDate = `${number}-${number}-${number}`;

export type ChangelogEntry = {
  date: ChangelogDate;
  title: string;
  items: string[];
};

import legacyEntries from './legacy';

// Un file per entry, nome `YYYY-MM-DD-slug.ts`: due PR in parallelo toccano file
// diversi e i changelog non conflittano più. Il nome file decide l'ordine fra
// entry dello stesso giorno; il merge totale resta dal più recente al più vecchio.
const perEntry = import.meta.glob<{ default: ChangelogEntry }>('./2*.ts', { eager: true });

const fromFiles = Object.keys(perEntry)
  .sort((a, b) => b.localeCompare(a))
  .map((path) => perEntry[path].default);

export const changelogEntries: ChangelogEntry[] = [...fromFiles, ...legacyEntries];
