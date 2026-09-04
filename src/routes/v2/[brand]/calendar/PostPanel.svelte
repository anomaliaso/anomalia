<script lang="ts">
  import { enhance } from '$app/forms';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { distributionNote, momentInZone, stateOf } from './calendar-month';
  import type { CalendarPost } from './calendar-month';

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
    post: CalendarPost;
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
      <Sheet.Title class="flex items-center gap-2 text-base">
        {post.platform ?? 'Post'}
        <Badge variant={postState.tone}>{postState.label}</Badge>
      </Sheet.Title>
      <Sheet.Description>
        {post.scheduled_for ? momentInZone(post.scheduled_for, timezone) : 'No date yet'}
      </Sheet.Description>
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
        <Textarea
          id="caption"
          name="caption"
          bind:value={caption}
          rows={10}
          readonly={!postState.canEdit}
          aria-describedby={postState.canEdit ? undefined : 'copy-locked'}
        />
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

      {#if postState.canApprove}
        <div class="border-border flex flex-col gap-3 rounded-lg border p-4">
          <h3 class="text-sm font-semibold">Approve</h3>
          <p class="text-muted-foreground text-sm">
            Approving authorises distribution and hands the post to the connected accounts straight
            away. There is no separate publish step and no state between here and live.
          </p>
          <p class="text-sm">{distributionNote(post, timezone)}</p>

          <AlertDialog.Root bind:open={confirming}>
            <AlertDialog.Trigger class="{buttonVariants({ size: 'sm' })} w-fit">
              Approve and distribute
            </AlertDialog.Trigger>
            <AlertDialog.Content class="flex flex-col">
              <AlertDialog.Header class="flex flex-col place-items-start text-left">
                <AlertDialog.Title>Distribute this post?</AlertDialog.Title>
                <AlertDialog.Description>
                  {distributionNote(post, timezone)} Anomalia sends it to the connected {post.platform ??
                    'social'} account. If no account is connected yet, the post stays approved and waits
                  for one.
                </AlertDialog.Description>
              </AlertDialog.Header>
              <form
                method="POST"
                action="?/approve"
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
                <AlertDialog.Footer>
                  <AlertDialog.Cancel type="button">Keep it pending</AlertDialog.Cancel>
                  <Button type="submit" disabled={approving}>
                    {approving ? 'Sending…' : 'Approve and distribute'}
                  </Button>
                </AlertDialog.Footer>
              </form>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
