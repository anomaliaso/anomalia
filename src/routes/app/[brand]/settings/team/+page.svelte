<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.team.title')}</div></div>

  {#if !data.isOwner}
    <div class="field"><div class="bill-notice">{$_('app.settings.billing.membersNotice')}</div></div>
  {:else}
    <div class="field"><div class="ftxt"><div class="fs">{$_('app.settings.team.subtitle')}</div></div></div>
    <div class="field">
      <form method="POST" action="?/invite" use:enhance class="team-form">
        <input class="team-input" type="email" name="email" required placeholder={$_('app.settings.team.emailPlaceholder')} />
        <button class="mini connect" type="submit">{$_('app.settings.team.invite')}</button>
      </form>
    </div>
    {#if form?.teamError}<div class="field"><div class="fs" style="color:#c0392b;">{form.teamError}</div></div>{/if}
    {#if form?.teamInvited}<div class="field"><div class="fs" style="color:var(--accent);">{form.emailSent ? $_('app.settings.team.invited') : $_('app.settings.team.invitedNoEmail')}</div></div>{/if}
    {#if form?.teamRevoked}<div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.team.revoked')}</div></div>{/if}

    {#if data.invites.length}
      {#each data.invites as inv (inv.id)}
        <div class="acct">
          <div class="nm">
            <div class="h">{inv.email}</div>
            <div class="s">{inv.accepted_at ? $_('app.settings.team.member') : $_('app.settings.team.pending')}</div>
          </div>
          <form method="POST" action="?/revokeInvite" use:enhance>
            <input type="hidden" name="invite_id" value={inv.id} />
            <button class="disc-btn" type="submit">{$_('app.settings.team.revoke')}</button>
          </form>
        </div>
      {/each}
    {:else}
      <div class="field"><div class="fs">{$_('app.settings.team.empty')}</div></div>
    {/if}
  {/if}
</section>
