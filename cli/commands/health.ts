import chalk from 'chalk';
import { section, c, info } from '../lib/display.ts';
import { appUrl } from '../lib/config.ts';

interface ServiceCheck {
  name: string;
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

interface StatusResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: ServiceCheck[];
}

export async function cmdHealth() {
  const base = appUrl();
  const url = `${base}/api/status`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const data: StatusResponse = await res.json();

    section('Anomalia API Status');

    const overall = data.status === 'ok'
      ? chalk.green.bold('● All systems operational')
      : chalk.red.bold('● Degraded');
    console.log(`  ${overall}  ${info(`(${new Date(data.timestamp).toLocaleTimeString('it-IT')})`)}`);
    console.log();

    for (const svc of data.services) {
      const icon = svc.status === 'ok'
        ? chalk.green('✓')
        : chalk.red('✗');
      const latency = chalk.dim(`${svc.latencyMs}ms`);
      const name = c.bold(svc.name.padEnd(10));
      const detail = svc.status === 'ok'
        ? chalk.green('operational')
        : chalk.red(svc.error ?? 'error');
      console.log(`  ${icon} ${name} ${detail}  ${latency}`);
    }

    console.log();
    if (data.status !== 'ok') process.exit(1);
  } catch (e) {
    console.error(chalk.red('✗'), `Impossibile contattare ${url}`);
    if (e instanceof Error) console.error(chalk.dim(`  ${e.message}`));
    process.exit(1);
  }
}
