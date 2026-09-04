import { describe, it, expect } from 'vitest';
import { momentInZone, nextOut, type ScheduledPost } from './overview';

const ROME = 'Europe/Rome';
const NOW = Date.parse('2026-09-04T10:00:00Z');

function post(id: string, scheduled_for: string | null): ScheduledPost {
  return { id, platform: 'instagram', caption: null, scheduled_for, status: 'scheduled' };
}

describe('il prossimo post in uscita', () => {
  it('e il piu vicino nel futuro, non il primo della lista', () => {
    const posts = [
      post('later', '2026-09-20T09:00:00Z'),
      post('soon', '2026-09-05T09:00:00Z'),
      post('middle', '2026-09-10T09:00:00Z')
    ];

    expect(nextOut(posts, NOW)?.id).toBe('soon');
  });

  it('ignora quelli gia passati', () => {
    const posts = [post('yesterday', '2026-09-03T09:00:00Z'), post('tomorrow', '2026-09-05T09:00:00Z')];

    expect(nextOut(posts, NOW)?.id).toBe('tomorrow');
  });

  it('ignora quelli senza data', () => {
    expect(nextOut([post('undated', null), post('dated', '2026-09-05T09:00:00Z')], NOW)?.id).toBe(
      'dated'
    );
  });

  it('non inventa un prossimo quando sono tutti passati', () => {
    expect(nextOut([post('old', '2026-08-01T09:00:00Z')], NOW)).toBeNull();
  });

  it('non inventa un prossimo su una lista vuota', () => {
    expect(nextOut([], NOW)).toBeNull();
  });
});

describe('quando esce, detto nel fuso del brand', () => {
  it('le 23:30 UTC del 31 agosto sono il 1 settembre a Roma', () => {
    const label = momentInZone('2026-08-31T23:30:00Z', ROME);

    expect(label).toContain('1 Sep');
    expect(label).not.toContain('31 Aug');
    expect(label).toContain(ROME);
  });
});
