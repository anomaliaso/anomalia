import { startBrowserLogin, passwordLogin, loadSession } from '../lib/auth.ts';
import { c, ok } from '../lib/display.ts';

export type LoginOptions = { email?: string; password?: string };

export async function cmdLogin(options: LoginOptions = {}) {
  console.log(c.bold('\nLogin a Anomalia\n'));

  // Check if already logged in
  const existing = await loadSession();
  if (existing) {
    console.log(`  Già autenticato come: ${c.bold(existing.user.email)}`);
    console.log(`  Sessione valida fino a: ${new Date(existing.expires_at * 1000).toLocaleDateString('it-IT')}`);
    console.log(`\n  Per forzare il re-login, esegui: anomalia logout && anomalia login`);
    return;
  }

  if (options.email && options.password) {
    try {
      const session = await passwordLogin(options.email, options.password);
      ok(`Autenticato come ${c.bold(session.user.email)}`);
    } catch (e) {
      console.error(`\n  ${c.red('✗')} Login fallito: ${String(e)}`);
      process.exit(1);
    }
    return;
  }

  if (options.email || options.password) {
    console.error(`  ${c.red('✗')} --email e --password vanno passati insieme (o niente flag: login via browser)`);
    process.exit(1);
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
