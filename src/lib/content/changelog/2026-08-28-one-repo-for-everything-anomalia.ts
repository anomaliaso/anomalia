// Il formato lo definisce ./index.ts (PR changelog-entry-files): qui solo i dati.
// Finché il loader non è merged il file è inerte — nessun conflitto in arrivo.
const entry = {
  date: '2026-08-28',
  title: 'One repository for everything Anomalia',
  items: [
    'The CLI, the MCP server and the agent skills now live in this repository — releases, installs and updates all come from here.',
    'Logging in from scripts and CI no longer needs a browser: `anomalia login --email … --password …` stores the same session the browser flow does, with `--password-stdin` to keep the password out of shell history.',
  ],
};

export default entry;
