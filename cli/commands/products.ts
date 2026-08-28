import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, c, table, info, ok } from '../lib/display.ts';

export async function cmdProducts(slug: string, opts: { action?: string }) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const action = opts.action ?? 'list';
  switch (action) {
    case 'list':
      return listProducts(session.access_token, slug);
    case 'sync':
      return syncProducts(session.access_token, slug);
    default:
      console.error(`Azione sconosciuta: ${action}`);
      console.log(`\n  ${c.green('list')}  Elenca i prodotti (default)\n  ${c.green('sync')}  Reimporta tutti i prodotti dal sito e-commerce\n`);
      process.exit(1);
  }
}

async function listProducts(token: string, slug: string) {
  const { products } = await api.listProducts(token, slug);
  section(`Prodotti (${products.length})`);
  if (!products.length) {
    info('Nessun prodotto. Usa `anomalia products ' + slug + ' sync` per importarli dal sito.');
    return;
  }
  // Group by category for a readable overview.
  const byKind = new Map<string, typeof products>();
  for (const p of products) {
    const k = p.kind || 'product';
    (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(p);
  }
  table(
    ['Categoria', 'Prezzo', 'Img', 'Prodotto'],
    products.map(p => [
      p.kind || '—',
      p.pricing ? `${p.pricing}` : '—',
      p.imageCount > 0 ? String(p.imageCount) : c.red('0'),
      p.title.slice(0, 60),
    ])
  );
  const withImg = products.filter(p => p.imageCount > 0).length;
  console.log(`\n  ${c.dim(`${withImg}/${products.length} con immagini · ${byKind.size} categorie`)}`);
  console.log();
}

async function syncProducts(token: string, slug: string) {
  console.log(c.yellow('Reimportazione prodotti dal sito…'));
  const result = await api.syncProducts(token, slug);
  ok(`${result.synced} prodotti importati da ${result.platform}.`);
}
