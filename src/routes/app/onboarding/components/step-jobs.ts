export type JobPoll = { cancelled: boolean; wake?: () => void };
export type PollOutcome = { status: 'done' | 'failed' | 'cancelled'; error?: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobResult = Record<string, any> | null | undefined;
export type JobSnapshot = {
  status?: string;
  progress?: { message?: string; step?: string; [k: string]: unknown };
  result?: JobResult;
  error?: string | null;
};

export type StepJobOpts = {
  onProgress?: (message: string, progress: Record<string, unknown>) => void;
  onResult?: (result: JobResult) => void;
  maxMs?: number;
};

export function cancelPoll(p: JobPoll | undefined) {
  if (!p) return;
  p.cancelled = true;
  p.wake?.();
}

async function peekStepJob(path: string, jobId: string): Promise<JobSnapshot | null> {
  const res = await fetch(`${path}?job=${encodeURIComponent(jobId)}`).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as JobSnapshot | null;
}

async function pollStepJob(
  path: string,
  jobId: string,
  poll: JobPoll,
  opts: StepJobOpts
): Promise<PollOutcome> {
  const started = Date.now();
  const MAX_MS = opts.maxMs ?? 10 * 60 * 1000;
  let delay = 1500;
  let lastResult = '';

  const sleep = () =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      poll.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  while (!poll.cancelled && Date.now() - started < MAX_MS) {
    try {
      const res = await fetch(`${path}?job=${encodeURIComponent(jobId)}`);
      if (res.status === 404) return { status: 'failed', error: 'job not found' };
      if (res.ok) {
        const body = (await res.json()) as JobSnapshot;
        if (body.progress) opts.onProgress?.(String(body.progress.message ?? ''), body.progress);
        if (body.result) {
          const sig = JSON.stringify(body.result);
          if (sig !== lastResult) {
            lastResult = sig;
            opts.onResult?.(body.result);
          }
        }
        if (body.status === 'done' || body.status === 'failed') {
          return { status: body.status, error: body.error };
        }
      }
    } catch {
      /* network blip — the job keeps running server-side */
    }
    if (poll.cancelled) break;
    await sleep();
    delay = Math.min(delay + 500, 4000);
  }
  if (poll.cancelled) return { status: 'cancelled' };
  return { status: 'failed', error: 'poll timeout' };
}

export async function peekJob(path: string, jobId: string) {
  return peekStepJob(path, jobId);
}

export async function runStepJob(opts: {
  path: string;
  jobId: string | null;
  force: boolean;
  body: Record<string, unknown>;
  poll: JobPoll;
  onProgress?: (message: string, progress: Record<string, unknown>) => void;
  onResult?: (result: JobResult) => void;
  maxMs?: number;
}): Promise<PollOutcome & { jobId: string | null }> {
  const { path, force, poll } = opts;
  const pollOpts: StepJobOpts = {
    onProgress: opts.onProgress,
    onResult: opts.onResult,
    maxMs: opts.maxMs
  };

  if (!force && opts.jobId) {
    const snap = await peekStepJob(path, opts.jobId);
    if (snap?.status === 'done') {
      if (snap.result) opts.onResult?.(snap.result);
      return { status: 'done', jobId: opts.jobId };
    }
    if (snap?.status === 'pending' || snap?.status === 'running') {
      if (snap.progress) opts.onProgress?.(String(snap.progress.message ?? ''), snap.progress);
      if (snap.result) opts.onResult?.(snap.result);
      return { ...(await pollStepJob(path, opts.jobId, poll, pollOpts)), jobId: opts.jobId };
    }
  }

  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...opts.body, force })
  });
  if (!res.ok) return { status: 'failed', error: `HTTP ${res.status}`, jobId: null };
  const { jobId } = (await res.json()) as { jobId?: string };
  if (!jobId) return { status: 'failed', error: 'missing jobId', jobId: null };
  return { ...(await pollStepJob(path, jobId, poll, pollOpts)), jobId };
}
