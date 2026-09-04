import { describe, it, expect } from 'vitest';
import { blogConfigPatch, customizationPatchFromFormData, parseBlogConfig } from './blog-settings';

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

describe('blogConfigPatch — una regola per campo, due chiamanti', () => {
  it('tocca solo i campi nominati', () => {
    expect(blogConfigPatch({ title: 'Il blog' })).toEqual({ title: 'Il blog' });
    expect(blogConfigPatch({})).toEqual({});
  });

  it('rifiuta un colore che non è un esadecimale, ripiegando sul default', () => {
    expect(blogConfigPatch({ accent: 'rosso' }).accent).toBe('#111111');
    expect(blogConfigPatch({ accent: '#7C5CFF' }).accent).toBe('#7C5CFF');
  });

  it('un font che il sito non sa rendere torna a sans', () => {
    expect(blogConfigPatch({ font: 'comic-sans' }).font).toBe('sans');
    expect(blogConfigPatch({ font: 'serif' }).font).toBe('serif');
  });

  it('riduce la cadenza al tetto del piano invece di rifiutarla', () => {
    // Un salvataggio che fallisce per un numero troppo alto è peggio di uno che salva il massimo
    // consentito: è la stessa scelta che il form fa già.
    const go = blogConfigPatch({ articlesPerWeek: 999 }, 'go').articlesPerWeek as number;
    const pro = blogConfigPatch({ articlesPerWeek: 999 }, 'pro').articlesPerWeek as number;
    expect(go).toBeLessThan(pro);
    expect(blogConfigPatch({ articlesPerWeek: null }, 'go').articlesPerWeek).toBeNull();
  });

  it('scarta una lingua che il blog non serve', () => {
    expect(blogConfigPatch({ locales: ['it', 'klingon', 'it'] }).locales).toEqual(['it']);
    expect(blogConfigPatch({ defaultLocale: 'klingon' }).defaultLocale).toBeNull();
  });

  it('le lingue in più non contengono quella di default, nemmeno quella già salvata', () => {
    // La regola è incrociata: senza `current`, cambiare solo `locales` lascerebbe la lingua di
    // default dentro l'elenco delle traduzioni, e il blog si tradurrebbe verso se stesso.
    expect(blogConfigPatch({ defaultLocale: 'it', locales: ['it', 'en'] }).locales).toEqual(['en']);
    expect(blogConfigPatch({ locales: ['it', 'en'] }, null, { defaultLocale: 'it' }).locales).toEqual(['en']);
  });

  it('tiene al massimo sei link di navigazione, e solo quelli completi', () => {
    const links = blogConfigPatch({
      navbarLinks: [
        { label: 'Home', url: 'https://x.test' },
        { label: '', url: 'https://y.test' },
        { label: 'Solo etichetta', url: '' }
      ]
    }).navbarLinks as unknown[];
    expect(links).toEqual([{ label: 'Home', url: 'https://x.test' }]);
  });
});
