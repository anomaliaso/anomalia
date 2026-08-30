import { describe, expect, it } from 'vitest';
import { backHref, ModalSurface, modalVisible, postPreviewHref } from './page-modal-navigation';

describe('page modal navigation', () => {
  it('restores the calendar modal after visiting a full-page post', () => {
    const origin = '/app/acme/chat/thread-1';
    const state = { route: 'calendar', origin };

    expect(modalVisible(state, origin, ModalSurface.Desktop)).toBe(true);
    expect(modalVisible(state, '/app/acme/posts/post-1/edit', ModalSurface.FullWidth)).toBe(false);
    expect(modalVisible(state, '/app/acme/analytics', ModalSurface.Desktop)).toBe(false);
    expect(modalVisible(state, origin, ModalSurface.Desktop)).toBe(true);
  });

  it('returns to the chat origin when a post page has one', () => {
    expect(backHref('/app/acme/chat/thread-1', '/app/acme/calendar')).toBe(
      '/app/acme/chat/thread-1'
    );
    expect(backHref(null, '/app/acme/calendar')).toBe('/app/acme/calendar');
  });

  it('builds a full-page post preview link', () => {
    expect(postPreviewHref('/app/acme', 'post-1')).toBe('/app/acme/posts/post-1/preview');
  });
});
