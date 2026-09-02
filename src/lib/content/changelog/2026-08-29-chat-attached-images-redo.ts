// Il formato lo definisce ./index.ts (PR changelog-entry-files): qui solo i dati.
const entry = {
  date: '2026-08-29',
  title: 'Attached images now reach the agent on every turn',
  items: [
    'Regenerating or continuing a conversation no longer makes the agent blind to images you attached earlier — it sees them again, exactly like on the first message.',
    'Chat turns that got cut off mid-answer now end with an honest error instead of a crash about the conversation itself.',
  ],
};

export default entry;
