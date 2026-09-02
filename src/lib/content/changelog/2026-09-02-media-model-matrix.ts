import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Pick a model for each kind of image and video',
  items: [
    'Settings → Images & video now has a model for each job: generating an image and editing one, generating a clip from text and animating a photo, rewriting a video and motion control.',
    'Each picker only offers models that can actually do that job.',
    'New in chat: ask for a finished video to be rewritten — same shot at night, same video with a different product — keeping the original motion.',
    'New in chat: apply the movement of any clip to the subject of your photo, with Kling 3.0 Motion Control.',
    'Kling 3.0, Kling V3 Turbo and Runway Aleph join the video models.'
  ]
} satisfies ChangelogEntry;
