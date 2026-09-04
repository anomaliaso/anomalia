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

  it('naviga al calendario senza invalidare il dettaglio eliminato', () => {
    const source = read('../../routes/app/[brand]/posts/[id]/edit/+page.svelte');
    const leave = source.slice(source.indexOf('async function onLeave'), source.indexOf('</script>'));

    expect(source).toContain('const calendarHref = $derived(`/app/${brand.slug}/calendar`)');
    expect(source).toContain('const returnHref = $derived(backHref($pageModalOrigin, calendarHref))');
    expect(leave).toContain('await goto(returnHref)');
    expect(leave).not.toContain('invalidateAll');
  });
});
