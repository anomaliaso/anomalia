import { clearSession, loadSession } from '../lib/auth.ts';
import { c, ok } from '../lib/display.ts';

export async function cmdLogout() {
  const session = await loadSession();
  if (session) {
    console.log(`  Disconnessione di ${c.bold(session.user.email)}…`);
  }

  clearSession();
  ok('Disconnesso. Esegui `anomalia` per riaccedere.');
}
