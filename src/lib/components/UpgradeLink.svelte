<script lang="ts">
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';

  // Un messaggio "crediti finiti" senza uscita è peggio del silenzio: l'utente resta fermo e
  // non sa cosa fare. Punta a settings/billing perché è l'UNICA pagina che mostra i piani —
  // /app/{slug}/upgrade senza ?plan rimbalza su /settings, cioè su un altro vicolo cieco.
  let { slug = '' }: { slug?: string } = $props();
  const href = $derived(`/app/${slug || ($page.params.brand ?? '')}/settings/billing`);
</script>

<a class="upgrade-link" {href}>{$_('app.nav.upgrade')} →</a>

<style>
  .upgrade-link {
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
    color: inherit;
  }
</style>
