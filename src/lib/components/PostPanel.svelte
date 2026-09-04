<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import {
    captionFields,
    distributionNote,
    extrasOf,
    platformsOf,
    previewOf,
    stateOf,
    whenLabel
  } from '$lib/post-state';
  import type { PostDetail } from '$lib/post-state';

  type Outcome = {
    id: string | null;
    message: string | null;
    saved: boolean;
    approved: boolean;
    status: string | null;
  };

  let {
    id,
    detail,
    timezone,
    form,
    onclose
  }: {
    id: string;
    detail: PostDetail;
    timezone: string;
    form: Outcome | null;
    onclose: () => void;
  } = $props();

  const postState = $derived(stateOf(detail.status));
  const outcome = $derived(form?.id === id ? form : null);
  const preview = $derived(previewOf(detail));
  const captions = $derived(captionFields(detail));
  const extras = $derived(extrasOf(detail));

  let confirming = $state(false);
  let saving = $state(false);
  let approving = $state(false);
</script>

<Sheet.Root open onOpenChange={(open) => !open && onclose()}>
  <Sheet.Content side="right" class="gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg">
    <Sheet.Header class="gap-2">
      <Sheet.Title class="flex flex-wrap items-center gap-2 text-base">
        {platformsOf(detail).join(' · ') || 'Post'}
        <Badge variant={postState.tone}>{postState.label}</Badge>
      </Sheet.Title>
      <Sheet.Description>{whenLabel(detail, timezone)}</Sheet.Description>
    </Sheet.Header>

    <div class="flex flex-col gap-5 px-4 pb-6">
      {#if preview.kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={preview.urls[0]}
          poster={detail.video_thumbnail_url ?? undefined}
          controls
          playsinline
          preload="metadata"
          class="border-border max-h-96 w-full rounded-lg border bg-black"
        ></video>
      {:else if preview.kind === 'carousel'}
        <div class="flex snap-x gap-2 overflow-x-auto pb-1">
          {#each preview.urls as url, index (url)}
            <img
              src={url}
              alt="Slide {index + 1}"
              loading="lazy"
              class="border-border h-72 w-auto shrink-0 snap-start rounded-lg border object-contain"
            />
          {/each}
        </div>
      {:else if preview.kind === 'image'}
        <img
          src={preview.urls[0]}
          alt="Visual attached to this post"
          loading="lazy"
          class="border-border max-h-96 w-full rounded-lg border object-contain"
        />
      {/if}

      {#each extras as extra (extra.label)}
        <div class="flex flex-col gap-1">
          <p class="text-muted-foreground text-xs font-medium">{extra.label}</p>
          <p class="text-sm break-words whitespace-pre-wrap">{extra.value}</p>
        </div>
      {/each}

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
        class="flex flex-col gap-4"
        use:enhance={() => {
          saving = true;
          return async ({ update }) => {
            await update({ reset: false });
            saving = false;
          };
        }}
      >
        <input type="hidden" name="id" value={id} />

        {#each captions as field (field.name)}
          <div class="flex flex-col gap-2">
            <Label for={field.name}>{field.label}</Label>
            <Textarea
              id={field.name}
              name={field.name}
              value={field.value}
              rows={10}
              readonly={!postState.canEdit}
              aria-describedby={postState.canEdit ? undefined : 'copy-locked'}
            />
          </div>
        {/each}

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
          <p class="text-sm">{distributionNote(detail, timezone)}</p>

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
              <input type="hidden" name="id" value={id} />
              <p role="alert" class="text-sm">
                Anomalia sends it to the connected {platformsOf(detail).join(' and ') || 'social'} account.
                If no account is connected yet, the post stays approved and waits for one.
              </p>
              <div class="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={approving}>
                  {approving ? 'Sending…' : 'Yes, distribute it'}
                </Button>
                <Button type="button" variant="outline" size="sm" onclick={() => (confirming = false)}
                  >Keep it pending</Button
                >
              </div>
            </form>
          {/if}
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
