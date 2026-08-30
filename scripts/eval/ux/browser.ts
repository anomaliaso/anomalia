import { writeFileSync } from 'node:fs';
import { chromium, type Browser as PlaywrightBrowser, type Page } from 'playwright';

const CALL_TIMEOUT_MS = 90_000;
const HEADLESS = process.env.EVAL_UX_HEADED !== '1';
const SECRET_KEYS = new Set(['apikey', 'access_token', 'refresh_token', 'token']);

type NetworkIssue = { status: number; url: string };

export class Browser {
  private readonly transcript: string[] = [];
  private readonly consoleErrors: string[] = [];
  private readonly pageErrors: string[] = [];
  private readonly failedRequests: string[] = [];
  private readonly networkIssues: NetworkIssue[] = [];
  private browser: PlaywrightBrowser | null = null;
  private page: Page | null = null;

  constructor(
    private readonly evidenceDir: string,
    private readonly onCommand: (line: string) => void
  ) {}

  async run(...args: string[]): Promise<string> {
    const started = Date.now();
    let result = '';
    let error: string | null = null;
    try {
      result = await this.execute(args);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const line = `browser ${args.join(' ')} (${Date.now() - started}ms)${error ? ` → ERROR: ${error}` : ' → ok'}`;
    this.transcript.push(line);
    this.onCommand(line);
    if (error) throw new Error(`browser ${args.join(' ')} failed: ${error}`);
    return result;
  }

  async open(url: string): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: HEADLESS });
      const context = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
      this.page = await context.newPage();
      this.attachDiagnostics(this.page);
    }
    await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: CALL_TIMEOUT_MS });
  }

  async snapshot(): Promise<string> {
    return this.run('snapshot');
  }

  async screenshot(name: string): Promise<string> {
    const path = `${this.evidenceDir}/${name}.png`;
    await this.run('screenshot', path);
    return path;
  }

  async captureEvidence(name: string): Promise<{ snapshot: string; screenshot: string }> {
    const snapshot = await this.snapshot();
    const screenshot = await this.screenshot(name);
    writeFileSync(`${this.evidenceDir}/${name}.a11y.txt`, snapshot);
    return { snapshot, screenshot };
  }

  async assertHealthyNetwork(): Promise<void> {
    writeFileSync(`${this.evidenceDir}/browser-console.log`, this.consoleErrors.concat(this.pageErrors).join('\n'));
    writeFileSync(
      `${this.evidenceDir}/browser-network.log`,
      this.failedRequests.concat(this.networkIssues.map((issue) => `${issue.status} ${issue.url}`)).join('\n')
    );
    if (this.consoleErrors.length || this.pageErrors.length || this.failedRequests.length || this.networkIssues.length) {
      throw new Error(
        `browser diagnostics failed: console=${this.consoleErrors.length + this.pageErrors.length}, failedRequests=${this.failedRequests.length}, http=${this.networkIssues.length}`
      );
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
    writeFileSync(`${this.evidenceDir}/browser-transcript.log`, this.transcript.join('\n'));
  }

  private async execute(args: string[]): Promise<string> {
    if (args[0] === 'open') {
      await this.open(args[1] ?? '');
      return '';
    }

    if (args[0] === 'cookies' && args[1] === 'clear') {
      await this.context().clearCookies();
      return '';
    }

    if (args[0] === 'storage' && args[1] === 'local' && args[2] === 'clear') {
      await this.pageOrThrow().evaluate(() => localStorage.clear());
      return '';
    }

    if (args[0] === 'fill') {
      await this.pageOrThrow().locator(args[1] ?? '').fill(args.slice(2).join(' '));
      return '';
    }

    if (args[0] === 'click') {
      await this.pageOrThrow().locator(args[1] ?? '').first().click({ timeout: CALL_TIMEOUT_MS });
      return '';
    }

    if (args[0] === 'find' && args[1] === 'text') {
      await this.pageOrThrow().getByText(args[2] ?? '', { exact: true }).first().click({ timeout: CALL_TIMEOUT_MS });
      return '';
    }

    if (args[0] === 'count') {
      return String(await this.pageOrThrow().locator(args[1] ?? '').count());
    }

    if (args[0] === 'wait') {
      return this.waitFor(args.slice(1));
    }

    if (args[0] === 'get' && args[1] === 'url') {
      return this.pageOrThrow().url();
    }

    if (args[0] === 'get' && args[1] === 'value') {
      return this.pageOrThrow().locator(args[2] ?? '').first().inputValue();
    }

    if (args[0] === 'storage' && args[1] === 'local' && args[2] === 'get') {
      return (
        (await this.pageOrThrow().evaluate((key) => localStorage.getItem(key), args[3] ?? '')) ?? ''
      );
    }

    if (args[0] === 'snapshot') {
      return (await this.pageOrThrow().locator('body').ariaSnapshot()) ?? '';
    }

    if (args[0] === 'screenshot') {
      await this.pageOrThrow().screenshot({ path: args[1], fullPage: true });
      return args[1] ?? '';
    }

    if (args[0] === 'close') {
      await this.close();
      return '';
    }

    throw new Error(`unsupported browser command: ${args.join(' ')}`);
  }

  private async waitFor(args: string[]): Promise<string> {
    const page = this.pageOrThrow();
    const timeout = Number(args[args.indexOf('--timeout') + 1] ?? CALL_TIMEOUT_MS);

    if (args[0] === '--url') {
      const expected = args[1] ?? '';
      await page.waitForURL((url) => url.pathname.includes(expected), { timeout });
      return '';
    }

    if (args[0] === '--text') {
      await page.getByText(args[1] ?? '', { exact: false }).first().waitFor({ state: 'visible', timeout });
      return '';
    }

    if (args[0] === '--selector') {
      await page.locator(args[1] ?? '').first().waitFor({ state: 'visible', timeout });
      return '';
    }

    if (args[0] === '--assistant') {
      await page.locator('.bubble-assistant-wrap .chat-msg').first().waitFor({ state: 'visible', timeout });
      return '';
    }

    if (args[0] === '--assistant-count') {
      const expected = Number(args[1] ?? 1);
      await page.waitForFunction(
        (minimum) => document.querySelectorAll('.bubble-assistant-wrap .chat-msg').length >= minimum,
        expected,
        { timeout }
      );
      return '';
    }

    throw new Error(`unsupported wait command: ${args.join(' ')}`);
  }

  private attachDiagnostics(page: Page): void {
    page.on('console', (message) => {
      if (message.type() === 'error') this.consoleErrors.push(this.safe(message.text()));
    });
    page.on('pageerror', (error) => this.pageErrors.push(this.safe(error.message)));
    page.on('requestfailed', (request) => this.failedRequests.push(`${request.method()} ${this.safe(request.url())}`));
    page.on('response', (response) => {
      if (response.status() >= 400) this.networkIssues.push({ status: response.status(), url: this.safe(response.url()) });
    });
  }

  private pageOrThrow(): Page {
    if (!this.page) throw new Error('browser page is not open');
    return this.page;
  }

  private context() {
    return this.pageOrThrow().context();
  }

  private safe(value: string): string {
    try {
      const url = new URL(value);
      for (const key of SECRET_KEYS) {
        if (url.searchParams.has(key)) url.searchParams.set(key, '<REDACTED>');
      }
      return url.toString();
    } catch {
      return value.replace(/(Bearer\s+|apikey[=:])\S+/gi, '$1<REDACTED>');
    }
  }
}
