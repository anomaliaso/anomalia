import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: '2026-09-02',
  title: 'One model to start on, instead of Auto, Fast and Pro',
  items: [
    'The chat model picker now lists real models. Auto, Fast and Pro are gone: they were three names for two settings, and Auto and Fast were the same model.',
    'New chats start on a default model. You can change it for a workspace in Settings, and switch model inside any chat from the picker in the message box.',
    'Picking "Default" in a chat hands it back to the workspace default, so it follows along when that changes.'
  ]
};

export default entry;
