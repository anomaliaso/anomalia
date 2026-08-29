import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('la cancellazione dal post editor non passa dal 404 del post eliminato', () => {
  it('chiude il post prima di aggiornare la pagina eliminata', () => {
    const source = read('./PostEditor.svelte');
    const action = source.slice(source.indexOf('const runAction'), source.indexOf('const repostEnhance'));

    const reject = action.indexOf("name === 'reject'");
    const close = action.indexOf('close();', reject);
    const update = action.indexOf('await update();');

    expect(reject).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(close).toBeLessThan(update);
  });

  it.each([
    '../../routes/app/[brand]/posts/[id]/edit/+page.svelte',
    '../../routes/app/[brand]/posts/[id]/chat/+page.svelte'
  ])('naviga al calendario senza invalidare il dettaglio eliminato: %s', (path) => {
    const source = read(path);
    const leave = source.slice(source.indexOf('async function onLeave'), source.indexOf('</script>'));

    expect(leave).toContain('await goto(`/app/${brand.slug}/calendar`)');
    expect(leave).not.toContain('invalidateAll');
  });
});
