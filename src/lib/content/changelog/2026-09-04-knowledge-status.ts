import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your agent can tell "not known" from "not read yet"',
  items: [
    'Your agent can now check whether your knowledge is usable, not just uploaded: how many documents are indexed, how many are still queued, and which ones failed and why.',
    'Connected sources — Drive, Notion, GitHub, Gmail — report when they last synced and what went wrong.',
    'The studio listing now marks each document as searchable or not, so nothing looks available when it is not.'
  ]
} satisfies ChangelogEntry;
