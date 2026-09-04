import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Tell your AI which model draws and which one films',
  items: [
    'Claude, Cursor and any connected AI client can now read and change the models your brand uses — image generation, image refinement, video from text, animating a still, video refinement, motion transfer — without opening Anomalia.',
    'Your AI sees the models each job actually accepts before it picks one, so it never proposes a model that job cannot run.',
    'A model that cannot do the job is refused with the list that would have worked, instead of being saved and failing at the next render.',
    'Clearing a choice hands the job back to the platform default.',
    'Changing the video model now keeps your clip length inside what that model supports, so a saved length never becomes unusable.'
  ]
} satisfies ChangelogEntry;
