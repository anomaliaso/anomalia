import { describe, it, expect } from 'vitest';
import { customizationPatchFromFormData, parseBlogConfig } from './blog-settings';

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

describe('customizationPatchFromFormData', () => {
  it('keeps title, accent and description', () => {
    const patch = customizationPatchFromFormData(
      fd({
        title: 'My Blog',
        description: 'SEO text',
        accent: '#ff5500',
        font: 'serif',
        styleInstructions: 'Keep it short',
        articlesPerWeek: '3',
        layout: 'sidebar',
        showBlogLink: 'true',
        humanizerEnabled: 'true',
        backlinkNetwork: 'true'
      })
    );
    expect(patch).toMatchObject({
      title: 'My Blog',
      description: 'SEO text',
      accent: '#ff5500',
      font: 'serif',
      styleInstructions: 'Keep it short',
      articlesPerWeek: 3,
      layout: 'sidebar',
      showBlogLink: true,
      humanizerEnabled: true,
      backlinkNetwork: true
    });
  });

  it('treats missing checkboxes as false (unchecked HTML inputs)', () => {
    const patch = customizationPatchFromFormData(
      fd({
        title: 'X',
        accent: '#111111',
        font: 'sans',
        layout: 'navbar'
      })
    );
    expect(patch.showBlogLink).toBe(false);
    expect(patch.humanizerEnabled).toBe(false);
    expect(patch.backlinkNetwork).toBe(false);
  });

  it('falls back to default accent when invalid', () => {
    const patch = customizationPatchFromFormData(fd({ title: 'X', accent: 'red' }));
    expect(patch.accent).toBe('#111111');
  });

  it('clamps articlesPerWeek to the plan max', () => {
    const patch = customizationPatchFromFormData(fd({ articlesPerWeek: '99' }), 'go');
    expect(patch.articlesPerWeek).toBe(4); // Go monthly 15 → max 4/week
    const pro = customizationPatchFromFormData(fd({ articlesPerWeek: '99' }), 'pro');
    expect(pro.articlesPerWeek).toBe(23); // Pro monthly 90 → max 23/week
  });
});

describe('parseBlogConfig', () => {
  it('maps null title to empty string for the form', () => {
    const view = parseBlogConfig({ title: null, accent: '#ff0000' }, 'starter');
    expect(view.title).toBe('');
    expect(view.accent).toBe('#ff0000');
  });

  it('defaults backlinkNetwork to on', () => {
    expect(parseBlogConfig({}, 'starter').backlinkNetwork).toBe(true);
    expect(parseBlogConfig({ backlinkNetwork: false }, 'starter').backlinkNetwork).toBe(false);
  });
});
