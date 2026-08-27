// I due guard degli analytics sono logica pura: qui si fissano, così nessuno li allenta per sbaglio.
// `dev` è forzato a false apposta — altrimenti sotto vitest sarebbe true e ogni asserzione passerebbe
// per il motivo sbagliato, nascondendo un buco nel controllo dell'host.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false, dev: false }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$env/dynamic/private', () => ({ env: { INTERNAL_EMAILS: 'interno-a@example.com, Interno-B@Example.com' } }));

import { isProdHost, trackingAllowed, dropIfInternal, setInternalViewer } from './analytics';
import { isInternalEmail } from './server/internal-users';

describe('isProdHost', () => {
  it('accetta solo la produzione vera', () => {
    for (const h of ['anomalia.so', 'www.anomalia.so', 'blog.cliente.it', 'localhost.com']) {
      expect(isProdHost(h), h).toBe(true);
    }
  });

  it('scarta dev, LAN e preview', () => {
    const nope = [
      'localhost',
      'app.localhost',
      'LOCALHOST',
      '127.0.0.1',
      '0.0.0.0',
      '[::1]',
      '::1',
      'macbook.local',
      '192.168.1.42',
      '10.0.0.7',
      '172.16.0.1',
      '172.31.255.1',
      '021-app-git-fix.vercel.app',
      '',
      null,
      undefined
    ];
    for (const h of nope) expect(isProdHost(h), String(h)).toBe(false);
  });

  it('non scarta IP pubblici che assomigliano alla LAN', () => {
    // 172.15/172.32 sono fuori dal blocco privato 172.16–172.31: non vanno zittiti.
    expect(isProdHost('172.15.0.1')).toBe(true);
    expect(isProdHost('172.32.0.1')).toBe(true);
    expect(isProdHost('11.0.0.1')).toBe(true);
  });
});

describe('trackingAllowed', () => {
  it('è il guard ambiente completo (host + dev)', () => {
    expect(trackingAllowed('anomalia.so')).toBe(true);
    expect(trackingAllowed('localhost')).toBe(false);
    expect(trackingAllowed('deploy.vercel.app')).toBe(false);
  });
});

describe('isInternalEmail', () => {
  it('riconosce domini e account del team', () => {
    for (const e of [
      'andrea@anomalia.so',
      'ANDREA@ANOMALIA.SO',
      'a@mail.anomalia.so',
      'interno-a@example.com',
      'INTERNO-B@EXAMPLE.COM'
    ]) {
      expect(isInternalEmail(e), e).toBe(true);
    }
  });

  it('non tocca i clienti', () => {
    for (const e of [
      'cliente@gmail.com',
      'chi@anomalia.so.evil.com',
      'chi@notanomalia.so',
      'anomalia.so',
      '',
      null,
      undefined
    ]) {
      expect(isInternalEmail(e), String(e)).toBe(false);
    }
  });
});

// Il filtro che Sentry chiama a ogni invio. Un ramo solo, ma è quello che decide se le sessioni di
// prova del founder in produzione finiscono nei dati veri.
describe('dropIfInternal', () => {
  it('di default lascia passare tutto', () => {
    setInternalViewer(false);
    const event = { message: 'boom' };
    expect(dropIfInternal(event)).toBe(event);
  });

  it('scarta quando chi guarda è dei nostri', () => {
    setInternalViewer(true);
    expect(dropIfInternal({ message: 'boom' })).toBeNull();
    setInternalViewer(false); // non lasciare lo stato sporco agli altri test
  });
});
