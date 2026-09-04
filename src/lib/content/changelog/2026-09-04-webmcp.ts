import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'An AI agent running in your browser can now drive Anomalia',
  items: [
    'Anomalia now offers its tools to AI agents that run inside your browser, through the emerging WebMCP standard — the same actions our MCP server and CLI expose, on the brand you have open.',
    'No API key and no setup: the agent works as you, with the session you are already signed in with, and only on the brand you are looking at.',
    'Support is browser-side and still early — today it needs Chrome with the WebMCP trial enabled, or a compatible extension. Where it is unavailable, nothing changes and nothing is loaded.'
  ]
} satisfies ChangelogEntry;
