import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Post and article chats are gone — talk to your own agent instead',
  items: [
    'The Chat tab on a post and the chat panel in the article editor have been removed. Ask your own AI client — Claude, Cursor, ChatGPT — to rewrite a caption, restyle an image or revise an article, and it reaches your brand over MCP.',
    'The "Ask AI" buttons on the article cover, on body images and on selected text are gone with it: the same request now goes to your agent.',
    'Everything the editors do on their own stays: regenerating a post with your feedback and reference images, the revision counter, the brand library picker, the YouTube thumbnail picker, the graphic source editor, and generating an article cover.',
    'A post\'s Campaign tab still hands you the suggested brief — copy it into your agent instead of into a chat.'
  ]
} satisfies ChangelogEntry;
