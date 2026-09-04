<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { distributionNote, platformsOf, stateOf, whenLabel } from './post-state';
  import type { PostRow } from './post-state';

  type Outcome = {
    id: string | null;
    message: string | null;
    saved: boolean;
    approved: boolean;
    status: string | null;
  };

  let {
    post,
    timezone,
    form,
    onclose
  }: {
    post: PostRow;
    timezone: string;
    form: Outcome | null;
    onclose: () => void;
  } = $props();

  const postState = $derived(stateOf(post.status));
  const outcome = $derived(form?.id === post.id ? form : null);

  let caption = $state(post.caption ?? '');
  let confirming = $state(false);
  let saving = $state(false);
  let approving = $state(false);
</script>

<Sheet.Root open onOpenChange={(open) => !open && onclose()}>
  <Sheet.Content side="right" class="gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg">
    <Sheet.Header class="gap-2">
      <Sheet.Title class="flex flex-wrap items-center gap-2 text-base">
        {platformsOf(post).join(' · ') || 'Post'}
        <Badge variant={postState.tone}>{postState.label}</Badge>
      </Sheet.Title>
      <Sheet.Description>{whenLabel(post, timezone)}</Sheet.Description>
    </Sheet.Header>

    <div class="flex flex-col gap-5 px-4 pb-6">
      {#if post.media_url}
        <img
          src={post.media_url}
          alt="Visual attached to this post"
          loading="lazy"
          class="border-border max-h-72 w-full rounded-lg border object-contain"
        />
      {/if}

      {#if outcome?.message}
        <p
          role={outcome.approved ? 'status' : 'alert'}
          class="rounded-lg border px-3 py-2 text-sm {outcome.approved
            ? 'border-border'
            : 'border-destructive/40 text-destructive'}"
        >
          {outcome.message}
        </p>
      {:else if outcome?.saved}
        <p role="status" class="border-border rounded-lg border px-3 py-2 text-sm">Copy saved.</p>
      {:else if outcome?.approved}
        <p role="status" class="border-border rounded-lg border px-3 py-2 text-sm">
          Approved and sent for distribution — the post is now {outcome.status}.
        </p>
      {/if}

      <form
        method="POST"
        action="?/edit"
        class="flex flex-col gap-2"
        use:enhance={() => {
          saving = true;
          return async ({ update }) => {
            await update({ reset: false });
            saving = false;
          };
        }}
      >
        <input type="hidden" name="id" value={post.id} />
        <Label for="caption">Copy</Label>
        <textarea
          id="caption"
          name="caption"
          bind:value={caption}
          rows={10}
          readonly={!postState.canEdit}
          aria-describedby={postState.canEdit ? undefined : 'copy-locked'}
          class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 field-sizing-content w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:ring-3 read-only:opacity-70 md:text-sm"
        ></textarea>
        {#if postState.canEdit}
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save copy'}
            </Button>
          </div>
        {:else}
          <p id="copy-locked" class="text-muted-foreground text-xs">
            A published post is read-only here.
          </p>
        {/if}
      </form>

      {#if post.published_url}
        <a
          href={post.published_url}
          target="_blank"
          rel="noreferrer"
          class="text-sm underline underline-offset-4">See it live</a
        >
      {/if}

      {#if postState.canApprove}
        <div class="border-border flex flex-col gap-3 rounded-lg border p-4">
          <h3 class="text-sm font-semibold">Approve</h3>
          <p class="text-muted-foreground text-sm">
            Approving authorises distribution and hands the post to the connected accounts straight
            away. There is no separate publish step and no state between here and live.
          </p>
          <p class="text-sm">{distributionNote(post, timezone)}</p>

          {#if !confirming}
            <div>
              <Button type="button" size="sm" onclick={() => (confirming = true)}>
                Approve and distribute
              </Button>
            </div>
          {:else}
            <form
              method="POST"
              action="?/approve"
              class="flex flex-col gap-3"
              use:enhance={() => {
                approving = true;
                return async ({ update }) => {
                  await update({ reset: false });
                  approving = false;
                  confirming = false;
                };
              }}
            >
              <input type="hidden" name="id" value={post.id} />
              <p role="alert" class="text-sm">
                Anomalia sends it to the connected {platformsOf(post).join(' and ') || 'social'} account.
                If no account is connected yet, the post stays approved and waits for one.
              </p>
              <div class="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={approving}>
                  {approving ? 'Sending…' : 'Yes, distribute it'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onclick={() => (confirming = false)}>Keep it pending</Button
                >
              </div>
            </form>
          {/if}
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
