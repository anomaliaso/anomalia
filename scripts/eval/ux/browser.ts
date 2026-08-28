import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const CALL_TIMEOUT_MS = 90_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export class Browser {
  private readonly transcript: string[];

  constructor(
    private readonly evidenceDir: string,
    private readonly onCommand: (line: string) => void
  ) {
    this.transcript = [];
  }

  async run(...args: string[]): Promise<string> {
    const started = Date.now();
    let stdout = '';
    let error: string | null = null;
    try {
      const res = await exec('npx', ['-y', 'agent-browser', ...args], {
        timeout: CALL_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES
      });
      stdout = res.stdout;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const line = `agent-browser ${args.join(' ')} (${Date.now() - started}ms)${error ? ` → ERROR: ${error}` : ' → ok'}`;
    this.transcript.push(line);
    this.onCommand(line);
    if (error) throw new Error(`agent-browser ${args.join(' ')} failed: ${error}`);
    return stdout;
  }

  async open(url: string): Promise<void> {
    const headed = process.env.EVAL_UX_HEADED === '1';
    if (!headed) {
      await this.run('open', url);
      return;
    }
    try {
      await this.run('open', url, '--headed');
    } catch {
      await this.run('open', url);
    }
  }

  async snapshot(): Promise<string> {
    return this.run('snapshot', '-i');
  }

  async screenshot(name: string): Promise<string> {
    const path = `${this.evidenceDir}/${name}.png`;
    await this.run('screenshot', path);
    return path;
  }

  async captureEvidence(name: string): Promise<{ snapshot: string; screenshot: string }> {
    const snapshot = await this.snapshot();
    const screenshot = await this.screenshot(name);
    const snapshotPath = `${this.evidenceDir}/${name}.a11y.txt`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(snapshotPath, snapshot);
    return { snapshot, screenshot };
  }

  async close(): Promise<void> {
    await this.run('close').catch(() => {});
  }
}
