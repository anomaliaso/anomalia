import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'A safer CLI installer',
  items: [
    'The install script now verifies the checksum of every binary it downloads, and refuses to install one that does not match.',
    'Installing with `curl … | bash` no longer drops skill files into whatever folder you happened to be in.',
    '`--version` installs the release you asked for instead of failing on a version that never existed.',
    'Homebrew now points at the right release, so `brew install anomalia` finds the binary.',
  ],
} satisfies ChangelogEntry;
