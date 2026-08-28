import { startBrowserLogin, loadSession } from '../lib/auth.ts';
import { c, ok } from '../lib/display.ts';

export async function cmdLogin() {
  console.log(c.bold('\nLogin a Anomalia\n'));

  // Check if already logged in
  const existing = await loadSession();
  if (existing) {
    console.log(`  Già autenticato come: ${c.bold(existing.user.email)}`);
    console.log(`  Sessione valida fino a: ${new Date(existing.expires_at * 1000).toLocaleDateString('it-IT')}`);
    console.log(`\n  Per forzare il re-login, esegui: anomalia logout && anomalia login`);
    return;
  }

  console.log('  Il browser si aprirà automaticamente…');
  console.log('  Accedi e premi "Autorizza" per completare.\n');

  try {
    const session = await startBrowserLogin((msg) => {
      console.log(`  ${msg}`);
    });
    console.log('');
    ok(`Autenticato come ${c.bold(session.user.email)}`);
  } catch (e) {
    console.error(`\n  ${c.red('✗')} Login fallito: ${String(e)}`);
    process.exit(1);
  }
}
