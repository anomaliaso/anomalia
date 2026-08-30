import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const REAL_E2E = process.env.REAL_E2E === '1';
const BRAND = 'demo';
const EMAIL = process.env.E2E_EMAIL ?? 'test@anomalia.so';
const PASSWORD = process.env.E2E_PASSWORD ?? '123456';
const AUTH_TIMEOUT = 2 * 60_000;
const REALTIME_TIMEOUT = 30_000;
const RESPONSE_TIMEOUT = 4 * 60_000;
const TEST_TIMEOUT = 15 * 60_000;

type BrowserTrace = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  realtimeConnections: number;
  realtimeJoins: number;
  realtimePrivateJoins: number;
  realtimeJoinStatuses: string[];
};

test.describe('real chat reply notifications', () => {
  test.skip(!REAL_E2E, 'Set REAL_E2E=1 against the local seeded app');
  test.describe.configure({ timeout: TEST_TIMEOUT });

  async function signIn(page: Page) {
    await page.goto('/login');
    const form = page.locator('form[action="?/login"]');
    await form.locator('input[name="email"]').fill(EMAIL);
    await form.locator('input[name="password"]').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: AUTH_TIMEOUT }),
      form.locator('button[type="submit"]').click()
    ]);
  }

  async function markExistingThreadsRead(page: Page) {
    await page.evaluate(async (brand) => {
      const response = await fetch(`/app/${brand}/chat/threads`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Cannot load threads: ${response.status}`);
      const body = (await response.json()) as { threads?: Array<{ id: string; unread?: boolean }> };
      await Promise.all(
        (body.threads ?? [])
          .filter((thread) => thread.unread)
          .map((thread) =>
            fetch(`/app/${brand}/chat/threads`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ thread_id: thread.id, read: true })
            })
          )
      );
    }, BRAND);
  }

  async function createThread(page: Page, title: string): Promise<string> {
    return page.evaluate(async ({ brand, threadTitle }) => {
      const response = await fetch(`/app/${brand}/chat/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: threadTitle })
      });
      if (!response.ok) throw new Error(`Cannot create thread: ${response.status}`);
      const body = (await response.json()) as { thread?: { id?: string } };
      if (!body.thread?.id) throw new Error('Thread creation returned no id');
      return body.thread.id;
    }, { brand: BRAND, threadTitle: title });
  }

  async function deleteThreads(page: Page, threadIds: string[]) {
    await page.evaluate(async ({ brand, ids }) => {
      for (const threadId of ids) {
        const response = await fetch(`/app/${brand}/chat/threads`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thread_id: threadId })
        });
        if (!response.ok) throw new Error(`Cannot delete thread: ${response.status}`);
      }
    }, { brand: BRAND, ids: threadIds });
  }

  async function persistedAssistantCount(page: Page, threadId: string): Promise<number> {
    return page.evaluate(async ({ brand, thread }) => {
      const response = await fetch(`/app/${brand}/chat?thread=${thread}`, { cache: 'no-store' });
      if (!response.ok) return -1;
      const body = (await response.json()) as { messages?: Array<{ role?: string; superseded?: boolean }> };
      return (body.messages ?? []).filter((message) => message.role === 'assistant' && !message.superseded).length;
    }, { brand: BRAND, thread: threadId });
  }

  async function sendRealReply(page: Page, threadId: string, marker: string) {
    const repliesBefore = await persistedAssistantCount(page, threadId);
    const userMessage = `Reply with a concise sentence containing ${marker}.`;

    await expect(page.locator('textarea.ch-input')).toBeVisible({ timeout: 30_000 });
    await page.locator('textarea.ch-input').fill(userMessage);
    await page.locator('button.ch-send[type="submit"]').click();
    await expect(page.locator('.chat-msg-cell-user').last()).toContainText(marker);
    await expect
      .poll(() => persistedAssistantCount(page, threadId), {
        timeout: RESPONSE_TIMEOUT,
        message: 'The real agent did not persist an assistant reply'
      })
      .toBeGreaterThan(repliesBefore);
  }

  async function saveScreenshot(page: Page, name: string) {
    await page.screenshot({ path: test.info().outputPath(name), fullPage: false });
  }

  async function traceBrowser(page: Page): Promise<BrowserTrace> {
    const trace: BrowserTrace = {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      realtimeConnections: 0,
      realtimeJoins: 0,
      realtimePrivateJoins: 0,
      realtimeJoinStatuses: []
    };

    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      const frames: Array<{ direction: 'in' | 'out'; data: string }> = [];
      const stateKey = '__task59RealtimeState';
      const state = JSON.parse(sessionStorage.getItem(stateKey) ?? '{}') as {
        privateJoins?: number;
        successfulJoins?: number;
      };

      const record = (direction: 'in' | 'out', data: string) => {
        frames.push({ direction, data });
        try {
          const message = JSON.parse(data) as unknown[];
          if (direction === 'out' && message[3] === 'phx_join') {
            const payload = message[4] as { config?: { private?: unknown } } | undefined;
            if (payload?.config?.private === true) state.privateJoins = (state.privateJoins ?? 0) + 1;
          }
          if (direction === 'in' && message[3] === 'phx_reply') {
            const payload = message[4] as { status?: unknown } | undefined;
            if (payload?.status === 'ok') state.successfulJoins = (state.successfulJoins ?? 0) + 1;
          }
          sessionStorage.setItem(stateKey, JSON.stringify(state));
        } catch {
          return;
        }
      };

      Object.defineProperty(window, '__task59RealtimeFrames', { value: frames });

      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget);
          const url = String(args[0]);
          if (!url.includes('/realtime/v1/websocket')) return socket;

          const send = socket.send.bind(socket);
          socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
            record('out', typeof data === 'string' ? data : '');
            return send(data);
          };
          socket.addEventListener('message', (event: MessageEvent) => {
            record('in', typeof event.data === 'string' ? event.data : '');
          });
          return socket;
        }
      });
    });

    page.on('console', (message) => {
      if (message.type() === 'error') trace.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => trace.pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      trace.failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/realtime/v1/websocket')) return;
      trace.realtimeConnections += 1;
    });

    return trace;
  }

  async function readRealtimeState(
    page: Page
  ): Promise<{ statuses: string[]; privateJoins: number; successfulJoins: number }> {
    return page.evaluate(() => {
      const frames = (
        window as unknown as { __task59RealtimeFrames?: Array<{ data?: unknown }> }
      ).__task59RealtimeFrames;
      const state = JSON.parse(sessionStorage.getItem('__task59RealtimeState') ?? '{}') as {
        privateJoins?: number;
        successfulJoins?: number;
      };
      const statuses: string[] = [];

      for (const frame of frames ?? []) {
        if (typeof frame.data !== 'string') continue;
        try {
          const message = JSON.parse(frame.data) as unknown[];
          if (message[3] !== 'phx_reply') continue;
          const payload = message[4] as { status?: unknown } | undefined;
          if (typeof payload?.status === 'string') statuses.push(payload.status);
        } catch {
          continue;
        }
      }

      return {
        statuses,
        privateJoins: state.privateJoins ?? 0,
        successfulJoins: state.successfulJoins ?? 0
      };
    });
  }

  async function waitForRealtime(page: Page, trace: BrowserTrace, connections: number, joins: number) {
    await expect
      .poll(() => trace.realtimeConnections, {
        timeout: REALTIME_TIMEOUT,
        message: 'The browser did not open the local Realtime WebSocket'
      })
      .toBeGreaterThanOrEqual(connections);
    await expect
      .poll(async () => {
        const state = await readRealtimeState(page);
        trace.realtimeJoinStatuses = state.statuses;
        trace.realtimePrivateJoins = state.privateJoins;
        trace.realtimeJoins = state.successfulJoins;
        return trace.realtimeJoins;
      }, {
        timeout: REALTIME_TIMEOUT,
        message: `The browser did not receive a successful Realtime channel join (statuses: ${trace.realtimeJoinStatuses.join(', ') || 'none'})`
      })
      .toBeGreaterThanOrEqual(joins);
    expect(trace.realtimePrivateJoins).toBeGreaterThanOrEqual(joins);
  }

  test('shows, persists, deduplicates, and opens real replies on desktop and mobile', async ({
    browser,
    page
  }) => {
    test.setTimeout(TEST_TIMEOUT);
    const observerTrace = await traceBrowser(page);
    const createdThreadIds: string[] = [];
    let writer: Page | null = null;
    let reconnectContext: BrowserContext | null = null;
    let reconnectWriter: Page | null = null;
    let testError: unknown = null;

    try {
      await signIn(page);
      await page.goto(`/app/${BRAND}`);
      await markExistingThreadsRead(page);
      await page.reload();
      const observerId = await createThread(page, `E2E observer ${Date.now()}`);
      createdThreadIds.push(observerId);
      const targetId = await createThread(page, `E2E target ${Date.now()}`);
      createdThreadIds.push(targetId);
      const observerHref = `/app/${BRAND}/chat/${observerId}`;
      const targetHref = `/app/${BRAND}/chat/${targetId}`;

      await page.goto(observerHref);
      await waitForRealtime(page, observerTrace, 1, 1);
      writer = await page.context().newPage();
      await writer.goto(targetHref);
      await expect(writer.locator('textarea.ch-input')).toBeVisible({ timeout: 30_000 });

      const notice = () => page.locator(`[data-testid="chat-reply-notification-${targetId}"]`);
      const region = () => page.locator('[data-testid="chat-reply-notifications"]');

      await page.setViewportSize({ width: 1440, height: 900 });
      await sendRealReply(writer, targetId, `REAL-E2E-DESKTOP-${Date.now()}`);
      await expect(notice()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid^="chat-reply-notification-"]')).toHaveCount(1);

      const desktopBox = await region().boundingBox();
      expect(desktopBox).not.toBeNull();
      expect((desktopBox?.x ?? 0) + (desktopBox?.width ?? 0)).toBeGreaterThan(1400);
      await saveScreenshot(page, 'chat-reply-notification-desktop.png');

      await notice().click();
      await expect(page).toHaveURL(new RegExp(`/app/${BRAND}/chat/${targetId}$`));
      await expect(notice()).toHaveCount(0);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(observerHref);
      await sendRealReply(writer, targetId, `REAL-E2E-MOBILE-${Date.now()}`);
      await expect(notice()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid^="chat-reply-notification-"]')).toHaveCount(1);

      const mobileBox = await region().boundingBox();
      expect(mobileBox).not.toBeNull();
      expect(mobileBox?.x ?? 99).toBeLessThan(16);
      expect(mobileBox?.width ?? 0).toBeGreaterThan(358);
      await saveScreenshot(page, 'chat-reply-notification-mobile.png');

      await page.reload();
      await expect(notice()).toBeVisible({ timeout: 30_000 });
      await notice().click();
      await expect(page).toHaveURL(new RegExp(`/app/${BRAND}/chat/${targetId}$`));
      await expect(notice()).toHaveCount(0);
      await page.reload();
      await expect(notice()).toHaveCount(0);

      await writer.close();
      writer = null;
      reconnectContext = await browser.newContext();
      reconnectWriter = await reconnectContext.newPage();
      await signIn(reconnectWriter);
      await reconnectWriter.goto(targetHref);
      await expect(reconnectWriter.locator('textarea.ch-input')).toBeVisible({ timeout: 30_000 });

      await page.goto(observerHref);
      await page.context().setOffline(true);
      await sendRealReply(reconnectWriter, targetId, `REAL-E2E-RECONNECT-${Date.now()}`);
      await expect(notice()).toHaveCount(0);
      const connectionsBeforeReconnect = observerTrace.realtimeConnections;
      const joinsBeforeReconnect = observerTrace.realtimeJoins;
      await page.context().setOffline(false);
      await waitForRealtime(page, observerTrace, connectionsBeforeReconnect + 1, joinsBeforeReconnect);
      await expect(notice()).toBeVisible({ timeout: 60_000 });
      await notice().click();
      await expect(page).toHaveURL(new RegExp(`/app/${BRAND}/chat/${targetId}$`));

      expect(observerTrace.consoleErrors).toEqual([]);
      expect(observerTrace.pageErrors).toEqual([]);
      expect(observerTrace.failedRequests).toEqual([]);
      await test.info().attach('browser-trace.json', {
        body: JSON.stringify(observerTrace, null, 2),
        contentType: 'application/json'
      });
    } catch (error) {
      testError = error;
      throw error;
    } finally {
      await page.context().setOffline(false);
      await writer?.close();
      await reconnectContext?.close();
      if (createdThreadIds.length) {
        try {
          await page.goto(`/app/${BRAND}`, { waitUntil: 'domcontentloaded' });
          await deleteThreads(page, createdThreadIds);
        } catch (error) {
          if (!testError) throw error;
          console.error(`E2E cleanup failed: ${String(error)}`);
        }
      }
    }
  });
});
