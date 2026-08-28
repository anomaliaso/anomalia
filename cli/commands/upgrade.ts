import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { c, info } from '../lib/display.ts';

export async function cmdUpgrade(slug: string) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const detail = await api.getBrand(session.access_token, slug);
  const brand = detail.brand;

  console.log(c.bold(`\nUpgrade — ${brand.name}\n`));
  console.log(`  Piano attuale: ${c.bold(brand.plan ?? '—')}`);
  console.log(`  Status: ${brand.status ?? '—'}`);
  console.log();

  const url = `${process.env.PUBLIC_APP_URL}/app/${slug}/activate`;
  console.log(`  Apertura pagina di upgrade…`);
  console.log(`  ${c.dim(url)}`);

  const { default: open } = await import('open');
  await open(url);

  info('\n  Dopo il pagamento, la CLI aggiornerà automaticamente il piano.');
  console.log();
}
