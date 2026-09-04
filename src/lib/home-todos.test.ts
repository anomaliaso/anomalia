import { describe, expect, it } from 'vitest';
import { homeTodos, type TodoSource } from './home-todos';

const nothing: TodoSource = {
  queue: { pending: 0 },
  blog: { pending: 0 },
  automations: { radarEnabled: true, radarReview: 0, leadsPending: 0 },
  setup: { socialAccounts: 1 }
};

const src = (patch: Partial<TodoSource>): TodoSource => ({ ...nothing, ...patch });

describe('le cose da fare in cima alla home', () => {
  it('non inventa righe quando non c’è niente da fare', () => {
    expect(homeTodos(nothing)).toEqual([]);
  });

  /**
   * L'ordine è la gerarchia del mockup: prima ciò che ha una scadenza vera — un post approvato
   * in ritardo è un post che non esce — poi ciò che aspetta senza scadere, poi il setup, che
   * non scade mai.
   */
  it('mette per prime le approvazioni, che sono le uniche con una scadenza', () => {
    const todos = homeTodos({
      queue: { pending: 4 },
      blog: { pending: 2 },
      automations: { radarEnabled: true, radarReview: 7, leadsPending: 3 },
      setup: { socialAccounts: 0 }
    });

    expect(todos.map((t) => t.key)).toEqual(['posts', 'articles', 'radar', 'leads', 'social']);
  });

  it('porta il conteggio, perché «4 da approvare» dice più di «da approvare»', () => {
    const [posts] = homeTodos(src({ queue: { pending: 4 } }));

    expect(posts.count).toBe(4);
    expect(posts.path).toBe('/calendar?status=pending_user');
  });

  it('non offre il radar da rivedere se il radar è spento', () => {
    const todos = homeTodos(
      src({ automations: { radarEnabled: false, radarReview: 9, leadsPending: 0 } })
    );

    expect(todos).toEqual([]);
  });

  /**
   * Zero account collegati è l'unica riga che non nasce da un conteggio ma da un'assenza: senza
   * un account l'AI produce e non pubblica, e il brand se ne accorge quando è tardi.
   */
  it('dice che manca un account collegato, che è la riga senza numero', () => {
    const [social] = homeTodos(src({ setup: { socialAccounts: 0 } }));

    expect(social.key).toBe('social');
    expect(social.count).toBe(0);
    expect(social.path).toBe('/settings/connected-accounts');
  });

  it('ogni riga sa dove porta e come si chiama, senza testo scritto dentro', () => {
    const todos = homeTodos({
      queue: { pending: 1 },
      blog: { pending: 1 },
      automations: { radarEnabled: true, radarReview: 1, leadsPending: 1 },
      setup: { socialAccounts: 0 }
    });

    for (const todo of todos) {
      expect(todo.labelKey, todo.key).toMatch(/^app\./);
      expect(todo.hintKey, todo.key).toMatch(/^app\./);
      expect(todo.path.startsWith('/'), todo.key).toBe(true);
    }
  });
});
