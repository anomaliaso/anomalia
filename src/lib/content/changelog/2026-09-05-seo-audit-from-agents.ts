import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Agents can run the SEO audit again',
  items: [
    'Connected agents can now start the technical SEO audit. The action they were offered was not the one the server accepted, so every attempt came back as an error — the other SEO actions were unaffected, and the audit always worked from the command line.'
  ]
} satisfies ChangelogEntry;
