import { c } from '../lib/display.ts';
import { existsSync, writeFileSync, renameSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

function runningPath(): string {
  // Compiled Bun binary: execPath is the CLI itself.
  const exec = process.execPath.replace(/\\/g, '/');
  if (/(^|\/)anomalia(-|$)/.test(exec.split('/').pop() ?? '')) return exec;
  // Node/npm: argv[1] is the entry script under node_modules.
  if (process.argv[1]) return process.argv[1].replace(/\\/g, '/');
  return exec;
}

function detectInstallChannel(path: string): 'source' | 'homebrew' | 'npm' | 'binary' {
  if (path.includes('/Cellar/') || path.includes('/homebrew/')) return 'homebrew';
  if (path.includes('/node_modules/')) return 'npm';
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    if (existsSync(join(here, '..', '..', '.git'))) return 'source';
  } catch {
    // bundled entry may not expose a filesystem URL
  }
  return 'binary';
}

export async function cmdUpdate() {
  console.log(c.bold('\nAggiornamento Anomalia CLI…\n'));

  const platform = process.platform;
  const arch = process.arch;
  let platformName: string;

  if (platform === 'darwin') {
    platformName = arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  } else if (platform === 'linux') {
    platformName = arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  } else {
    console.error(`Piattaforma non supportata: ${platform}-${arch}`);
    process.exit(1);
  }

  console.log(`  Piattaforma: ${platformName}`);

  const selfPath = runningPath();
  const channel = detectInstallChannel(selfPath);

  if (channel === 'source') {
    console.log('  Installazione da sorgente rilevata');
    console.log(`\n  Per aggiornare:`);
    console.log(`  git pull && bun install\n`);
    return;
  }

  if (channel === 'homebrew') {
    console.log('  Installazione Homebrew rilevata');
    console.log(`\n  Per aggiornare:`);
    console.log(`  brew update && brew upgrade anomalia\n`);
    return;
  }

  if (channel === 'npm') {
    console.log('  Installazione npm rilevata');
    console.log(`\n  Per aggiornare:`);
    console.log(`  npm install -g anomalia-cli@latest\n`);
    return;
  }

  console.log('  Download in corso…');

  const url = `https://github.com/anomaliaso/anomalia/releases/latest/download/anomalia-${platformName}`;
  const binPath = selfPath;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        console.error(`  ✗ Release non trovata per ${platformName}`);
        console.log(`  Scarica manualmente da: https://github.com/anomaliaso/anomalia/releases`);
      } else {
        console.error(`  ✗ Errore download: ${res.status}`);
      }
      process.exit(1);
    }

    const tempPath = `${binPath}.tmp`;
    writeFileSync(tempPath, Buffer.from(await res.arrayBuffer()));
    chmodSync(tempPath, 0o755);
    renameSync(tempPath, binPath);

    console.log(`\n  ${c.green('✓')} Anomalia CLI aggiornato!`);
    console.log(`  Riavvia la CLI per usare la nuova versione.\n`);
  } catch (e) {
    console.error(`  ✗ Errore: ${String(e)}`);
    console.log(`\n  Aggiorna manualmente:`);
    console.log(`  curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash\n`);
    process.exit(1);
  }
}
