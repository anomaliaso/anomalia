import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./DashboardSidebar.svelte', import.meta.url)), 'utf8');
const header = source.slice(source.indexOf('<Sidebar.Header'), source.indexOf('</Sidebar.Header>'));

/**
 * LE DUE IDENTITÀ DELLA BARRA, che sono due e non una.
 *
 * In cima il PRODOTTO (il marchio di Anomalia), in fondo il BRAND DEL CLIENTE (logo, nome, e il
 * menu che li cambia). Un'agenzia ne gestisce molti: la barra deve dire su quale si sta
 * lavorando, sempre, e quella risposta vive nel footer da prima di questo header.
 *
 * Il marchio è un link, quindi ha bisogno di un nome accessibile: `BrandMark` è `aria-hidden`
 * perché è decorativo, e col rail collassato a icone il testo accanto è `display: none`. Senza
 * `aria-label` resterebbe un link senza nome — il difetto che un logo "minimale" si porta dietro
 * più spesso.
 */
describe('la cima e il fondo della barra laterale', () => {
  it('in cima ha il marchio del prodotto, non quello del cliente', () => {
    expect(header).toContain('<BrandMark');
    expect(header).not.toContain('logoUrl');
    expect(header).not.toContain('brandName');
  });

  it('dà un nome accessibile al marchio, che da solo non ne ha uno', () => {
    expect(header).toContain('aria-label={PRODUCT_NAME}');
  });

  it('porta in un posto che esiste: l’elenco dei brand', () => {
    expect(header).toContain('href={brandHref}');
  });

  it('non perde il nome del brand del cliente, che resta in fondo', () => {
    const footer = source.slice(source.indexOf('<Sidebar.Footer'));
    expect(footer).toContain('{brandName}');
  });
});
