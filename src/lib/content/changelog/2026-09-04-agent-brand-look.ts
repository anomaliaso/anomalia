import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your AI can change how your brand looks',
  items: [
    'Claude, Cursor and any connected AI client can now set your logo and favicon, choose the two Google Fonts your graphics are composed with, and write the visual brief every image follows — without opening Anomalia.',
    'A logo is given as a link and copied into your own storage, so the image in your graphics cannot change or disappear later because someone else moved it.',
    'A font Google Fonts does not serve is now refused, and says which one — instead of quietly rendering everything in Inter.',
    'Your blog can now carry your own analytics: Google Analytics 4, Meta Pixel, Plausible or Hotjar, added by measurement id. They run on your own domain, only after a visitor accepts cookies, and sending an empty list takes them off a live site immediately.',
    'There is deliberately no field for pasting arbitrary JavaScript: on the shared anomalia.so blog address that would run alongside your Anomalia session. Connect your own domain and the analytics above cover it safely.'
  ]
} satisfies ChangelogEntry;
