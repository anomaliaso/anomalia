import { describe, expect, it } from 'vitest';
import { AUTOMATION_JOBS, SET_AUTOMATION } from './automations';
import { BRAND_ENDPOINTS, statusForFailure } from './index';

describe('i lavori ricorrenti come contratto', () => {
  it('sta nel registry, o nessun agente lo vede', () => {
    expect(BRAND_ENDPOINTS).toContain(SET_AUTOMATION);
  });

  it('accetta solo i lavori che esistono', () => {
    expect(SET_AUTOMATION.input.safeParse({ job: 'seo', enabled: true }).success).toBe(true);
    expect(SET_AUTOMATION.input.safeParse({ job: 'chat', enabled: true }).success).toBe(false);
    expect(AUTOMATION_JOBS).toContain('autopilot');
  });

  it('accendere e spegnere sono lo stesso tool: `enabled` è obbligatorio, non implicito', () => {
    expect(SET_AUTOMATION.input.safeParse({ job: 'seo' }).success).toBe(false);
  });

  /**
   * QUESTO è il test che conta. Accendere un lavoro impegna crediti del cliente a ogni giro
   * futuro, senza che nessuno lo riguardi — ed è meno visibile di un pagamento, perché non c'è
   * nessuna schermata a fare da testimone. La descrizione è l'unica cosa che un agente legge
   * prima di chiamare: se la frase sparisce, sparisce l'avvertimento.
   */
  it('dice che accendere spende, e che spegnere no', () => {
    expect(SET_AUTOMATION.description).toMatch(/spending decision/);
    expect(SET_AUTOMATION.description).toMatch(/every run calls AI models and spends/);
    expect(SET_AUTOMATION.description).toMatch(/Turning one OFF spends nothing/);
  });

  it('la risposta di chi accende riscrive cosa è stato impegnato', () => {
    const parsed = SET_AUTOMATION.output.safeParse({
      ok: true,
      job: 'seo',
      enabled: true,
      cadence: 'weekly',
      spends_on_every_run: true,
      scheduled_work_allowed: true
    });
    expect(parsed.success).toBe(true);
  });

  it('un interruttore che non si scrive è un guasto nostro, non di chi chiama', () => {
    expect(statusForFailure(SET_AUTOMATION, 'toggle_failed')).toBe(500);
  });

  it('non finge di raggiungere il mondo fuori: cambia una riga, non chiama un provider', () => {
    // `openWorld` in questo registry vuol dire "esce su internet" (radar/diagnose, la ricerca
    // competitor, sync_history). Usarlo per dire "costa" sarebbe un'annotazione che mente.
    expect(SET_AUTOMATION.openWorld).toBeUndefined();
    expect(SET_AUTOMATION.destructive).toBe(false);
  });
});
