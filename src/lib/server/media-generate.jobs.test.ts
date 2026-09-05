import { describe, it, expect } from 'vitest';
import { listMediaJobs, CLIP_NOT_IN_LIBRARY } from './media-generate';

/**
 * LA SESSIONE DI ANDREA. generate_media({ kind: 'video' }) torna un job_id, e check_media_job
 * risponde `status: 'done', media_id: null`. Il contratto di check_media_job dice l'opposto:
 * «done once it is in the library — and then media_id is the id create_post accepts». Un agente
 * esterno che riceve done senza media_id non ha niente su cui agire, e si e' fermato li'.
 *
 * La riga d616dcda esiste davvero: done, post_id nullo, attempts 0, media_url valorizzato, e
 * nessuna riga brand_media che la reclami. L'mp4 risponde 200, 2.098.026 byte: il clip e' stato
 * pagato. A scriverla e' stato il cron di produzione, ferma a `main`, che per un render senza
 * post non aveva ancora il ramo del deposito.
 *
 * Il lettore non deve ripetere la contraddizione, chiunque abbia scritto `done`.
 */

const BRAND = 'brand-1';
const JOB = 'd616dcda-8a2f-4017-b9e6-74542f77a8cd';

type Row = Record<string, unknown>;

const db = (renders: Row[], assets: Row[]) =>
  ({
    from: (table: string) => {
      const data = table === 'video_renders' ? renders : assets;
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve({ data, error: null })
      };
      for (const step of ['select', 'eq', 'is', 'order', 'limit', 'in']) {
        builder[step] = () => builder;
      }
      return builder;
    }
  }) as never;

const settledJob = (over: Row = {}): Row => ({
  id: JOB,
  status: 'done',
  error: null,
  submitted_at: '2026-09-05T05:40:59.761+00:00',
  ...over
});

const claimedBy = (jobId: string) => ({ id: 'media-1', source_ref: jobId });

describe('check_media_job', () => {
  it('un lavoro done con il suo asset e done, e porta il media_id', async () => {
    const jobs = await listMediaJobs(db([settledJob()], [claimedBy(JOB)]), BRAND);

    expect(jobs[0]).toMatchObject({ status: 'done', media_id: 'media-1' });
  });

  it('non dice done a un lavoro che nessun asset reclama', async () => {
    const jobs = await listMediaJobs(db([settledJob()], []), BRAND);

    expect(jobs[0].media_id).toBeNull();
    expect(jobs[0].status).not.toBe('done');
  });

  it('non lo dice nemmeno failed: il clip esiste ed e gia pagato', async () => {
    const jobs = await listMediaJobs(db([settledJob()], []), BRAND);

    expect(jobs[0].status).toBe(CLIP_NOT_IN_LIBRARY);
    expect(jobs[0].status).not.toBe('failed');
  });

  it('dice perche, invece di lasciare un agente senza niente su cui agire', async () => {
    const jobs = await listMediaJobs(db([settledJob()], []), BRAND);

    expect(jobs[0].error).toBeTruthy();
  });

  it('lascia in pace un lavoro ancora in corso, che un asset non puo avere', async () => {
    const jobs = await listMediaJobs(db([settledJob({ status: 'rendering' })], []), BRAND);

    expect(jobs[0]).toMatchObject({ status: 'rendering', media_id: null, error: null });
  });

  it('non tocca l errore di un lavoro fallito davvero', async () => {
    const jobs = await listMediaJobs(
      db([settledJob({ status: 'failed', error: 'kie refused the job' })], []),
      BRAND
    );

    expect(jobs[0]).toMatchObject({ status: 'failed', error: 'kie refused the job' });
  });
});
