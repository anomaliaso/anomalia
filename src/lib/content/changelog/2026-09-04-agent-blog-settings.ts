import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your AI can set the blog up, categories and authors included',
  items: [
    'Claude, Cursor and any connected AI client can now change how your blog looks and writes — its name, colour, font, layout, nav links, style brief, how many articles a week, and which languages — without opening Anomalia.',
    'It can also create and remove your categories, tags and authors, so a new article can be filed under something that did not exist yet.',
    'Before removing one, your AI is told what it leaves behind: a category leaves its articles unfiled, a tag comes off every article that carried it, an author leaves their articles without a byline. No article is ever deleted.',
    'Asking for more articles a week than your plan allows no longer fails — it saves the most your plan permits and tells you what was saved.',
    'A language your blog does not support is now refused outright, instead of being quietly dropped while you think the translation is on.'
  ]
} satisfies ChangelogEntry;
