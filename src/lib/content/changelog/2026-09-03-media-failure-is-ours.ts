import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: '2026-09-03',
  title: 'When an asset cannot be attached, we say so',
  items: [
    'If Anomalia cannot attach a photo or video your AI picked, it now says the fault is ours instead of implying the asset was wrong. Your AI stops and tells you, rather than burning turns trying other assets that could never have worked.',
    'An asset that really is not yours still comes back as a plain rejection, and the post is never created without it.'
  ]
};

export default entry;
