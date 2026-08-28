import { startBrowserLogin, passwordLogin, loadSession } from '../lib/auth.ts';
import { c, ok } from '../lib/display.ts';

export type LoginOptions = { email?: string; password?: string; passwordStdin?: boolean };

// La password via stdin non finisce né in shell history né in `ps aux`.
async function readStdinPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function fail(message: string): never {
  console.error(`  ${c.red('✗')} ${message}`);
  process.exit(1);
}

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

  if (options.password && options.passwordStdin) {
    fail('Usa --password o --password-stdin, non entrambi');
  }
  if (options.passwordStdin && !options.email) {
    fail('--password-stdin richiede --email');
  }
  if (options.email && !options.password && !options.passwordStdin) {
    fail('--email richiede --password o --password-stdin (o niente flag: login via browser)');
  }

  if (options.email) {
    const password = options.passwordStdin ? await readStdinPassword() : options.password;
    if (!password) {
      fail('Password vuota su stdin');
    }
    try {
      const session = await passwordLogin(options.email, password);
      ok(`Autenticato come ${c.bold(session.user.email)}`);
    } catch (e) {
      fail(`Login fallito: ${String(e)}`);
    }
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
