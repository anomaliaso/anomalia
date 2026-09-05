import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'The remote MCP server is current again',
  items: [
    'Connecting Claude, ChatGPT or Cursor to mcp.anomalia.so now gives you every tool the CLI has — 125 instead of the 63 the remote server had been stuck on since August.',
    'Newly reachable from a remote MCP client: query, generate_image, refine_image, generate_video, create_post, list_media and diagnose_brand, among others.'
  ]
} satisfies ChangelogEntry;
