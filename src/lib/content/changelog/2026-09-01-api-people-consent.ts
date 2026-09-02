import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-01',
  title: 'Adding a real person from the API or the CLI now asks for their consent',
  items: [
    'Creating a real person outside the browser required no consent confirmation, and the person was stored as if someone had given it. The API now refuses without an explicit attestation, and records who stated it and when — the same rule the Studio form has always applied. From the CLI, pass --consent.'
  ]
} satisfies ChangelogEntry;
