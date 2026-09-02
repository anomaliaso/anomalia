import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Pick the model that renders your images',
  items: [
    'Settings → Images & video now has an Image model choice: Nano Banana 2 Lite, Nano Banana 2, Nano Banana Pro, Seedream 5 Pro, GPT Image 2 and Qwen3 Pro. Leave it on Platform default and each image keeps being rendered by whichever model fits it.',
    'The choice applies everywhere images are produced: the weekly batch, single posts, carousels, chat-generated visuals and the Media generator.',
    'Seedream and Qwen3 do not support the 4:5 Instagram frame — on those models portrait posts are rendered at 3:4.',
    'The + menu in chat now links straight to the image and video model settings.'
  ]
} satisfies ChangelogEntry;
