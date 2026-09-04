import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your AI can now correct the brand, not just read it',
  items: [
    'Claude, Cursor and any connected AI client can add a product, fix a price, correct a person’s role, repair a competitor’s website and set the link in bio — without opening Anomalia.',
    'An edit changes only the field you name: every other detail of that product, person or competitor keeps the value it had.',
    'Editing a person can never grant consent for their likeness. That stays yours to state, and until you do their face is withheld from every generator.',
    'An edit aimed at a row that is not yours now fails instead of quietly reporting success.'
  ]
} satisfies ChangelogEntry;
