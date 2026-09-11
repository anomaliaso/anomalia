import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-07',
  title: 'One tool changes what your brand is, how it sounds and how it looks',
  items: [
    'Agents connected over MCP now change your brand identity through `update_brand_identity`: the facts posts are written from, the voice, the colours, the logo, the fonts and the visual brief — one place instead of four.',
    'Asking an agent to change your brand colours now works the first time: the palette used to live apart from the logo and the fonts, so agents opened the tool named after appearance and found no colour field.',
    'Only the fields sent change, so correcting one detail of your identity can never blank the rest of it.',
    'Changing the voice now says out loud that it switches your brand off automatic voice, instead of doing it silently.',
    'Generating media has one door fewer: `generate_image` and `generate_video` say what they do, and the older `generate_media` that just forwarded to them is gone.'
  ]
} satisfies ChangelogEntry;
