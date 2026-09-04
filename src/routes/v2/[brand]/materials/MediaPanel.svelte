<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { addedOn, labelOf, shapeOf } from './media-kind';
  import type { MediaRow } from './media-kind';

  let {
    item,
    timezone,
    onclose
  }: {
    item: MediaRow;
    timezone: string;
    onclose: () => void;
  } = $props();

  const shape = $derived(shapeOf(item));
</script>

<Sheet.Root open onOpenChange={(open) => !open && onclose()}>
  <Sheet.Content side="right" class="gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg">
    <Sheet.Header class="gap-2">
      <Sheet.Title class="flex flex-wrap items-center gap-2 text-base">
        {labelOf(item)}
        <Badge variant="outline">{item.kind}</Badge>
      </Sheet.Title>
      <Sheet.Description>Added {addedOn(item, timezone)}</Sheet.Description>
    </Sheet.Header>

    <div class="flex flex-col gap-5 px-4 pb-6">
      {#if !item.signed_url}
        <p class="text-muted-foreground text-sm">
          No preview available — the file is in the library but Anomalia could not sign a link for
          it right now.
        </p>
      {:else if item.kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={item.signed_url}
          controls
          preload="metadata"
          class="border-border max-h-96 w-full rounded-lg border"
        ></video>
      {:else}
        <img
          src={item.signed_url}
          alt={labelOf(item)}
          loading="lazy"
          class="border-border max-h-96 w-full rounded-lg border object-contain"
        />
      {/if}

      {#if item.description}
        <p class="text-sm">{item.description}</p>
      {/if}

      {#if item.tags?.length}
        <ul class="flex flex-wrap gap-1.5">
          {#each item.tags as tag (tag)}
            <li><Badge variant="secondary">{tag}</Badge></li>
          {/each}
        </ul>
      {/if}

      <dl class="text-muted-foreground flex flex-col gap-1 text-xs">
        {#if item.mime}
          <div class="flex gap-2"><dt class="w-20">Format</dt>
            <dd class="text-foreground">{item.mime}</dd></div>
        {/if}
        {#if shape}
          <div class="flex gap-2"><dt class="w-20">Size</dt>
            <dd class="text-foreground">{shape}</dd></div>
        {/if}
        <div class="flex gap-2"><dt class="w-20">Id</dt>
          <dd class="text-foreground font-mono break-all">{item.id}</dd></div>
      </dl>

      <p class="text-muted-foreground text-xs">
        An agent reuses this asset by passing its id to create_post, instead of paying for a new
        render.
      </p>
    </div>
  </Sheet.Content>
</Sheet.Root>
