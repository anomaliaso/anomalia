<script lang="ts">
  import { _ } from 'svelte-i18n';
  import LangToggle from '$lib/components/LangToggle.svelte';
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.languageSection')}</div></div>
  <div class="field">
    <div class="ftxt"><div class="fh">{$_('app.settings.language')}</div><div class="fs">{$_('app.settings.languageDesc')}</div></div>
    <LangToggle />
  </div>
</section>
