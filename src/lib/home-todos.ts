/**
 * LE COSE DA FARE, in cima alla home del brand.
 *
 * La regola del mockup: ciò che richiede attenzione sta sopra, con quante sono; il resto scende.
 * Qui c'è solo la SELEZIONE e l'ORDINE — nessun testo, come per la nav: le etichette sono chiavi
 * i18n, e la pagina le traduce. Così questo si può far fallire per la ragione giusta.
 *
 * Una riga esiste solo se ha qualcosa da dire: niente riquadri vuoti a riempire lo spazio.
 */

export type TodoSource = {
  queue: { pending: number };
  blog: { pending: number };
  automations: { radarEnabled: boolean; radarReview: number; leadsPending: number };
  setup: { socialAccounts: number };
};

export type TodoItem = {
  key: string;
  /** Frase col conteggio dentro (`{n, plural, …}`). */
  labelKey: string;
  count: number;
  /** Dove vive la cosa: la riga secondaria, la stessa parola della sidebar. */
  hintKey: string;
  /** Sotto `/app/<slug>`. */
  path: string;
};

export function homeTodos(overview: TodoSource): TodoItem[] {
  const todos: TodoItem[] = [];

  // Prima ciò che ha una scadenza vera: un post approvato in ritardo è un post che non esce.
  if (overview.queue.pending > 0) {
    todos.push({
      key: 'posts',
      labelKey: 'app.home.overview.postsToAccept',
      count: overview.queue.pending,
      hintKey: 'app.hub.publish.calendar',
      path: '/calendar?status=pending_user'
    });
  }

  if (overview.blog.pending > 0) {
    todos.push({
      key: 'articles',
      labelKey: 'app.home.overview.blogsToAccept',
      count: overview.blog.pending,
      hintKey: 'app.nav2.site',
      path: '/site'
    });
  }

  // Poi ciò che aspetta senza scadere.
  if (overview.automations.radarEnabled && overview.automations.radarReview > 0) {
    todos.push({
      key: 'radar',
      labelKey: 'app.home.overview.radarReview',
      count: overview.automations.radarReview,
      hintKey: 'app.nav2.newsRadar',
      path: '/radar'
    });
  }

  if (overview.automations.leadsPending > 0) {
    todos.push({
      key: 'leads',
      labelKey: 'app.home.overview.leadsPending',
      count: overview.automations.leadsPending,
      hintKey: 'app.hub.automations.leads',
      path: '/leads'
    });
  }

  // Infine il setup, che non scade mai — ma senza un account collegato l'AI produce e non
  // pubblica, e il brand se ne accorge quando è tardi.
  if (overview.setup.socialAccounts === 0) {
    todos.push({
      key: 'social',
      labelKey: 'app.home.todo.noSocial',
      count: 0,
      hintKey: 'app.settings.connectedAccounts',
      path: '/settings/connected-accounts'
    });
  }

  return todos;
}
