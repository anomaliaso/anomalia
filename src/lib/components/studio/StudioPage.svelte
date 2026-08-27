<script lang="ts">
  import { enhance, applyAction, deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';
  import { jpegIfHeicFile, jpegIfHeicFormFiles } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT, isRasterImageSource } from '$lib/raster-image';
  import { studioCompleteness } from '$lib/studio-completeness';
  import { PLATFORM_META, PLATFORM_KEYS, getPlatform } from '$lib/components/platform-meta';
  import SocialThumbPicker from '$lib/components/SocialThumbPicker.svelte';
  import type { ActionResult } from '@sveltejs/kit';
  import { _ } from 'svelte-i18n';
  import { isPaidPlan } from '$lib/plans';
  import BrandMemoryPanel from '$lib/components/studio/BrandMemoryPanel.svelte';
  import { untrack } from 'svelte';
  import FontPicker from '$lib/components/studio/FontPicker.svelte';

  let {
    data,
    form,
    section
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form: any;
    section: import('./sections').StudioSection;
  } = $props();

  // Studio content (brand kit, products, docs, history, people, competitors, and their signed
  // thumbnail URLs) streams in behind `data.deferred` (see +page.server.ts) — this used to block
  // the whole page on 9 queries + ~60 signed URLs. We keep the PREVIOUS resolved value while a new
  // navigation's promise is pending so the page doesn't flash empty on every click.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Extras = {
    kit: any;
    products: any[];
    documents: any[];
    history: any[];
    moodImages: { id: string; title: string | null; url: string | null }[];
    language: string;
    platformInstructions: Record<string, string>;
    platformHashtags: Record<string, string[]>;
    voiceExamples: string[];
    targetPlatforms: string[];
    connectedPlatforms: string[];
    people: any[];
    competitors: any[];
  };
  let extras = $state<Extras | null>(null);
  $effect(() => {
    // Guard against out-of-order resolution: only the promise of the CURRENT navigation may write,
    // or a slow older navigation could overwrite fresh content. Supabase's {data,error} pattern
    // doesn't throw and signPaths already has its own .catch, but guard against an unhandled
    // rejection here too, same as the layout.
    const p = data.deferred;
    p.then((v: Extras) => { if (p === data.deferred) extras = v; }).catch(() => {});
  });

  const kit = $derived(extras?.kit ?? null);
  const products = $derived(extras?.products ?? []);
  const documents = $derived(extras?.documents ?? []);
  const history = $derived(extras?.history ?? []);
  const people = $derived(extras?.people ?? []);
  const competitors = $derived(extras?.competitors ?? []);
  const moodImages = $derived(extras?.moodImages ?? []);
  const voiceExamples = $derived(extras?.voiceExamples ?? []);
  const targetPlatforms = $derived(extras?.targetPlatforms ?? []);
  const platformHashtags = $derived(extras?.platformHashtags ?? {});
  const connectedPlatforms = $derived(extras?.connectedPlatforms ?? []);
  const language = $derived(extras?.language ?? '');

  // Preferred-hashtags editor: one row per target platform (fallback to the full set when the brand
  // hasn't declared targets). Prefill each input with the saved tags.
  const platLabel = (k: string) => getPlatform(k).label;
  const hashtagPlatforms = $derived(
    ((targetPlatforms.length ? targetPlatforms : PLATFORM_KEYS) as string[])
      .map((p) => { const k = p.toLowerCase().trim(); return k === 'twitter' ? 'x' : k; })
      .filter((p, i, a) => p && a.indexOf(p) === i)
  );
  // Chip editor: hashtags are held as arrays so a user can't paste one long attached blob and end up
  // with a single junk tag — each tag is committed on Enter / comma / space and shown as a removable
  // chip. On submit a hidden `ph_${p}` field carries the space-joined list, so the server action
  // (normalizeHashtags) is unchanged. Seeded from the saved set.
  let hashtagEdit = $state<Record<string, string[]>>({});
  let hashtagDraft = $state<Record<string, string>>({});
  $effect(() => {
    const next: Record<string, string[]> = {};
    for (const p of hashtagPlatforms) next[p] = [...((platformHashtags?.[p] as string[] | undefined) ?? [])];
    hashtagEdit = next;
  });
  // Mirror of the server's per-token cleaning: strip leading #'s and anything but unicode letters,
  // digits and underscore, then re-add a single '#'. Empty once cleaned → dropped.
  function cleanTag(raw: string): string {
    const body = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    return body ? '#' + body : '';
  }
  function addHashtags(p: string, raw: string) {
    const existing = hashtagEdit[p] ?? [];
    const seen = new Set(existing.map((t) => t.toLowerCase()));
    const add: string[] = [];
    for (const tok of raw.split(/[\s,]+/)) {
      const tag = cleanTag(tok);
      if (!tag || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      add.push(tag);
    }
    if (add.length) hashtagEdit[p] = [...existing, ...add].slice(0, 30);
    hashtagDraft[p] = '';
  }
  function removeHashtag(p: string, i: number) {
    hashtagEdit[p] = (hashtagEdit[p] ?? []).filter((_, idx) => idx !== i);
  }
  function onHashtagKey(e: KeyboardEvent, p: string) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addHashtags(p, hashtagDraft[p] ?? '');
    } else if (e.key === 'Backspace' && !(hashtagDraft[p] ?? '') && (hashtagEdit[p]?.length ?? 0) > 0) {
      // Backspace on an empty input pops the last chip — standard tag-field behaviour.
      hashtagEdit[p] = (hashtagEdit[p] ?? []).slice(0, -1);
    }
  }

  // Target-platform selector: the socials the AI operates on. Seeded from the saved set; toggling is
  // local until saved. Warn about any selected platform without a live connection in Settings.
  const savedTargets = $derived(
    (targetPlatforms as string[]).map((p) => { const k = p.toLowerCase().trim(); return k === 'twitter' ? 'x' : k; }).filter(Boolean)
  );
  let selectedPlatforms = $state<string[]>([]);
  $effect(() => { selectedPlatforms = [...savedTargets]; });
  function togglePlatform(k: string) {
    selectedPlatforms = selectedPlatforms.includes(k) ? selectedPlatforms.filter((p) => p !== k) : [...selectedPlatforms, k];
  }
  const unconnectedSelected = $derived(selectedPlatforms.filter((p) => !connectedPlatforms.includes(p)));
  const connectHref = $derived(
    isPaidPlan(data.brand?.plan)
      ? `/app/${$page.params.brand}/settings/connected-accounts`
      : `/app/${$page.params.brand}/activate`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const character = $derived((kit?.ai_character ?? {}) as any);

  // Colours are edited in place (local copy, saved via ?/updateColors) — every render reads them.
  let colorsEdit = $state<string[]>([]);
  $effect(() => {
    colorsEdit = [...((kit?.brand_colors ?? []) as string[])];
  });
  // The logo the renderer actually uses: the first non-og-image entry (og images are site
  // screenshots, not the mark). One slot — upload replaces, remove empties.
  const currentLogo = $derived(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (((kit?.logos ?? []) as any[]).find((l) => l?.url && l?.type !== 'og-image')?.url as string | undefined) ?? null
  );

  // Studio completeness: score what the brand has loaded and nudge for what's still missing.
  // The banner shows the top 3 gaps and a hint for the first (highest-impact) one. The scoring
  // is shared with the strategy surfaces (GTM) so both report the same number.
  const completeness = $derived.by(() => {
    const c = studioCompleteness({
      products: products.length,
      history: history.length,
      documents: documents.length,
      voice: !!(character.tone || character.speaking_style || kit?.brand_style),
      about: !!kit?.about,
      audience: !!kit?.target_audience,
      logo: !!currentLogo,
      colors: ((kit?.brand_colors ?? []) as string[]).length > 0
    });
    return { ...c, missing: c.missing.slice(0, 3) };
  });

  const LANGUAGES = [
    'Italian', 'English', 'Spanish', 'French', 'German', 'Portuguese',
    'Dutch', 'Polish', 'Romanian', 'Swedish', 'Norwegian', 'Danish',
    'Finnish', 'Czech', 'Slovak', 'Hungarian', 'Croatian', 'Serbian',
    'Slovenian', 'Bulgarian', 'Ukrainian', 'Russian', 'Turkish', 'Greek',
    'Arabic', 'Hebrew', 'Persian', 'Hindi', 'Thai', 'Vietnamese',
    'Indonesian', 'Malay', 'Chinese', 'Japanese', 'Korean'
  ];
  let langEdit = $state('');
  // Seed the language picker from the loaded value each time the edit form opens.
  function toggleEdit() {
    if (!editing) langEdit = language;
    editing = !editing;
  }

  let peopleSub = $state<'real' | 'ai'>('real');
  // id of the competitor whose inline edit form is open (null = none).
  let editingComp = $state<string | null>(null);
  let editing = $state(false);
  let busy = $state(false);
  let imgName = $state('');
  let photoName = $state('');
  let uploadError = $state('');
  // Visual style editing state
  let vsEditing = $state(false);
  let vsText = $state('');
  let vsExpanded = $state(false);
  // Post-image reference block: whether the "pick from your posts" picker is open.
  let moodPicker = $state(false);
  // Post-image reference block: whether the "add from another account" picker is open, and the
  // thumbnail URLs currently picked in it (fed to SocialThumbPicker via bind:selected).
  let socialMoodPicker = $state(false);
  let pickedMoodThumbs = $state<string[]>([]);
  // Feedback for the "regenerate from AI" action (success / error message, auto-clears).
  let vsFeedback = $state<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Typography for composed graphics. Seeded from the kit and re-seeded whenever the AI proposes,
  // so the inputs always show what is actually in force.
  let gsFeedback = $state<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  let gsDisplay = $state('');
  let gsBody = $state('');
  let gsInstructions = $state('');
  let gsTouched = $state(false);

  const gs = $derived(
    (kit?.graphic_style ?? null) as { display_font?: string; body_font?: string; instructions?: string } | null
  );
  // Seed the inputs from what is saved, and re-seed after an AI proposal — but never overwrite
  // something the user is in the middle of typing.
  $effect(() => {
    const next = gs;
    if (untrack(() => gsTouched)) return;
    gsDisplay = next?.display_font ?? '';
    gsBody = next?.body_font ?? '';
    gsInstructions = next?.instructions ?? '';
  });

  // Products: search + pagination
  let productSearch = $state('');
  const PRODUCT_PAGE_SIZE = 12;
  let productPage = $state(1);
  const filteredProducts = $derived.by(() => {
    const q = productSearch.toLowerCase().trim();
    if (!q) return products;
    return products.filter((p: { title?: string }) => (p.title ?? '').toLowerCase().includes(q));
  });
  const visibleProducts = $derived(filteredProducts.slice(0, productPage * PRODUCT_PAGE_SIZE));
  const hasMoreProducts = $derived(visibleProducts.length < filteredProducts.length);

  // Files go straight from the browser to Supabase Storage, then we post only the path + metadata
  // to the action. This sidesteps Vercel's ~4.5MB request-body cap, which silently killed uploads
  // of normal-sized PDFs and images.
  const supabase = createSupabaseBrowserClient();
  const brandId = $derived(data.brand.id);
  const userId = $derived(data.session?.user?.id ?? '');
  const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Several image files can be picked at once. Each file goes straight to Storage (dodging
  // Vercel's request-body cap), then a single POST carries all the resulting paths so the
  // server inserts every image and rebuilds the AI context just once.
  async function handleImageUpload(event: SubmitEvent) {
    event.preventDefault();
    const formEl = event.currentTarget as HTMLFormElement;
    const input = formEl.querySelector('input[type="file"]') as HTMLInputElement | null;
    const files = input?.files ? Array.from(input.files).filter((f) => f.size > 0) : [];
    if (!files.length) return;
    uploadError = '';
    busy = true;
    try {
      const fd = new FormData();
      const title = (formEl.querySelector('input[name="title"]') as HTMLInputElement | null)?.value ?? '';
      if (title.trim()) fd.set('title', title.trim());
      for (const file of files) {
        if (!isRasterImageSource({ mime: file.type, filename: file.name })) continue;
        const ready = await jpegIfHeicFile(file);
        const path = `${userId}/${brandId}/${crypto.randomUUID()}-${safeName(ready.name)}`;
        const up = await supabase.storage
          .from('brand-knowledge')
          .upload(path, ready, { contentType: ready.type || 'application/octet-stream', upsert: false });
        if (up.error) throw new Error(up.error.message);
        fd.append('path', path);
        fd.append('file_name', ready.name);
        fd.append('mime_type', ready.type);
      }
      const res = await fetch(formEl.action, { method: 'POST', body: fd });
      const result: ActionResult = deserialize(await res.text());
      if (result.type === 'failure') {
        uploadError = (result.data?.error as string) ?? 'Unknown error';
      } else if (result.type === 'success') {
        imgName = '';
        formEl.reset();
        await invalidateAll();
      }
      applyAction(result);
    } catch (e) {
      uploadError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
      imgName = '';
      photoName = '';
    };
  };

  // Convert HEIC/HEIF in the multipart body before it hits the action (and Vercel's ~4.5 MB cap).
  const withHeicFiles = (field: string) => async ({ formData }: { formData: FormData }) => {
    await jpegIfHeicFormFiles(formData, field);
    return withBusy();
  };

  // Custom enhance for "regenerate visual style from AI": shows success/error feedback and
  // forces a data refresh even when the action returns fail() (SvelteKit's default update()
  // skips load re-run on failure, which is why the user saw "loading → nothing").
  const regenStyle = () => {
    busy = true;
    vsFeedback = null;
    return async ({ result, update }: { result: ActionResult; update: (opts?: { reset?: boolean }) => Promise<void> }) => {
      if (result.type === 'success' && result.data?.regenerated) {
        vsFeedback = { kind: 'ok', msg: $_('app.studio.visualStyle.regenerated') };
      } else if (result.type === 'failure') {
        vsFeedback = { kind: 'err', msg: (result.data?.error as string) ?? $_('app.studio.visualStyle.regenerateFailed') };
      }
      // Always invalidate so the kit data refreshes — even on failure the visual_style may
      // have been partially updated, and on success we MUST see the new brief.
      await invalidateAll();
      busy = false;
      setTimeout(() => { vsFeedback = null; }, 6000);
    };
  };

  // Same shape as regenStyle: an AI proposal must refresh the kit even when it fails, and the
  // inputs have to pick up what it wrote instead of keeping the user's stale text.
  const proposeGs = () => {
    busy = true;
    gsFeedback = null;
    return async ({ result, update }: { result: ActionResult; update: (opts?: { reset?: boolean }) => Promise<void> }) => {
      if (result.type === 'success' && result.data?.proposed) {
        gsFeedback = { kind: 'ok', msg: $_('app.studio.graphicStyle.proposed') };
        gsTouched = false;
      } else if (result.type === 'failure') {
        gsFeedback = { kind: 'err', msg: (result.data?.error as string) ?? $_('app.studio.graphicStyle.proposeFailed') };
      }
      await invalidateAll();
      busy = false;
      setTimeout(() => { gsFeedback = null; }, 6000);
    };
  };

  const saveGs = () => {
    busy = true;
    gsFeedback = null;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      if (result.type === 'failure') {
        gsFeedback = { kind: 'err', msg: (result.data?.error as string) ?? '' };
      } else {
        gsFeedback = { kind: 'ok', msg: $_('app.studio.graphicStyle.saved') };
        gsTouched = false;
      }
      await update();
      busy = false;
      setTimeout(() => { gsFeedback = null; }, 6000);
    };
  };

  const fileName = (e: Event) => (e.currentTarget as HTMLInputElement).files?.[0]?.name ?? '';
  const fileNames = (e: Event) => {
    const files = (e.currentTarget as HTMLInputElement).files;
    return files?.length ? Array.from(files).map((f) => f.name).join(', ') : '';
  };

  // Show a competitor's website as a bare host (strip scheme + www) for a tidy link label.
  const host = (url: string) => {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  // Save the thumbnails picked in the "add from another account" picker: same busy handling as
  // withBusy, but also clears the selection and closes the picker on success.
  const saveMoodThumbs = () => {
    busy = true;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      await update();
      busy = false;
      if (result.type === 'success') {
        pickedMoodThumbs = [];
        socialMoodPicker = false;
      }
    };
  };

  // Like withBusy, but also closes the inline edit form once the update succeeds.
  const saveComp = () => {
    busy = true;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      await update();
      busy = false;
      if (result.type === 'success') editingComp = null;
    };
  };
</script>

{#if !extras}
  <div class="studio-loading" aria-busy="true"></div>
{:else}
  {#if section === 'brand'}
<section id="brand" class="studio-section">
        <h2 class="section-title">{$_('app.studio.tabs.brand')}</h2>
        {#if kit}
          <div class="section-head">
            <div class="busy-note">{busy ? $_('app.studio.updatingContext') : ''}</div>
            <button class="btn ghost" onclick={toggleEdit} disabled={busy}>
              {editing ? $_('app.studio.cancel') : $_('app.studio.edit')}
            </button>
          </div>

          {#if editing}
            <form class="kit-form" method="POST" action="?/updateBrandKit" use:enhance={withBusy}>
              <label class="field">
                <span>{$_('app.studio.fields.website')}</span>
                <input name="website" type="url" inputmode="url" value={data.brand?.website ?? ''} placeholder={$_('app.studio.placeholders.website')} />
              </label>
              <label class="field">
                <span>{$_('app.studio.fields.category')}</span>
                <input name="category" type="text" value={kit.category ?? ''} placeholder={$_('app.studio.placeholders.category')} />
              </label>
              <label class="field">
                <span>{$_('app.studio.fields.targetAudience')}</span>
                <input name="target_audience" type="text" value={kit.target_audience ?? ''} placeholder={$_('app.studio.placeholders.targetAudience')} />
              </label>
              <label class="field">
                <span>{$_('app.studio.fields.brandStyle')}</span>
                <input name="brand_style" type="text" value={kit.brand_style ?? ''} placeholder={$_('app.studio.placeholders.brandStyle')} />
              </label>
              <label class="field">
                <span>{$_('app.studio.fields.postLanguage')}</span>
                <select name="language" class="lang-select" bind:value={langEdit}>
                  <option value="">{$_('app.studio.autoDetect')}</option>
                  {#each LANGUAGES as l (l)}<option value={l}>{l}</option>{/each}
                </select>
              </label>
              <label class="field">
                <span>{$_('app.studio.fields.about')}</span>
                <textarea name="about" rows="5" placeholder={$_('app.studio.placeholders.about')}>{kit.about ?? ''}</textarea>
              </label>
              <div class="form-actions">
                <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.saving') : $_('app.studio.save')}</button>
              </div>
            </form>
          {:else}
            <div class="kit-grid">
              <div class="kit">
                <div class="kt">{$_('app.studio.colours')}</div>
                <form method="POST" action="?/updateColors" use:enhance={withBusy}>
                  <div class="swatches">
                    {#each colorsEdit as c, i (i)}
                      <span class="sw-edit">
                        <input type="color" value={c} oninput={(e) => (colorsEdit[i] = e.currentTarget.value)} title={c} />
                        <button type="button" class="sw-x" onclick={() => (colorsEdit = colorsEdit.filter((_, idx) => idx !== i))} aria-label={$_('app.studio.coloursRemove')}>×</button>
                      </span>
                    {/each}
                    <button type="button" class="sw-add" onclick={() => (colorsEdit = [...colorsEdit, '#7c5cff'])} aria-label={$_('app.studio.coloursAdd')}>+</button>
                  </div>
                  <input type="hidden" name="colors" value={JSON.stringify(colorsEdit)} />
                  <button class="btn ghost sw-save" type="submit" disabled={busy}>{$_('app.studio.save')}</button>
                </form>
              </div>
              <div class="kit">
                <div class="kt">{$_('app.studio.logo.title')}</div>
                <div class="logo-row">
                  <span class="logo-slot" class:empty={!currentLogo}>
                    {#if currentLogo}<img src={currentLogo} alt="logo" />{:else}—{/if}
                  </span>
                  <form method="POST" action="?/updateLogo" enctype="multipart/form-data" use:enhance={withHeicFiles('file')}>
                    <label class="logo-upload">
                      <input type="file" name="file" accept={RASTER_IMAGE_ACCEPT} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
                      {busy ? $_('app.studio.saving') : $_('app.studio.logo.upload')}
                    </label>
                  </form>
                  {#if currentLogo}
                    <form method="POST" action="?/updateLogo" use:enhance={withBusy}>
                      <input type="hidden" name="remove" value="1" />
                      <button class="logo-remove" type="submit" disabled={busy}>{$_('app.studio.logo.remove')}</button>
                    </form>
                  {/if}
                </div>
                <p class="muted" style="margin-top:10px;">{$_('app.studio.logo.hint')}</p>
              </div>
              <div class="kit span2">
                <div class="kt">{$_('app.studio.voice')}</div>
                <div class="chips">
                  {#if character.tone}<span class="chip2">{character.tone}</span>{/if}
                  {#if character.speaking_style}<span class="chip2">{character.speaking_style}</span>{/if}
                  {#if kit.category}<span class="chip2">{kit.category}</span>{/if}
                  {#if !character.tone && !kit.category}<span class="muted">{$_('app.studio.noVoice')}</span>{/if}
                </div>
                {#if kit.target_audience}<p class="muted" style="margin-top:12px;">{kit.target_audience}</p>{/if}
                <p class="muted" style="margin-top:8px;">{$_('app.studio.postLanguageLabel')} <b>{language || $_('app.studio.autoDetect')}</b></p>
              </div>
              <div class="kit span2">
                <div class="kt">{$_('app.studio.fields.website')}</div>
                <p>{data.brand?.website || '—'}</p>
              </div>
              <div class="kit span2">
                <div class="kt">{$_('app.studio.fields.about')}</div>
                <p>{kit.about ?? '—'}</p>
              </div>
              <div class="kit span2">
                <div class="kt">{$_('app.studio.graphicStyle.title')}</div>
                <p class="muted" style="margin-bottom:10px;font-size:13px;">{$_('app.studio.graphicStyle.desc')}</p>
                <form class="kit-form" method="POST" action="?/updateGraphicStyle" use:enhance={saveGs}>
                  <div class="gs-grid">
                    <div class="gs-field">
                      <span class="kt">{$_('app.studio.graphicStyle.displayFont')}</span>
                      <FontPicker
                        name="display_font"
                        bind:value={gsDisplay}
                        onchange={() => (gsTouched = true)}
                      />
                      <span class="muted">{$_('app.studio.graphicStyle.displayHint')}</span>
                    </div>
                    <div class="gs-field">
                      <span class="kt">{$_('app.studio.graphicStyle.bodyFont')}</span>
                      <FontPicker
                        name="body_font"
                        bind:value={gsBody}
                        onchange={() => (gsTouched = true)}
                      />
                      <span class="muted">{$_('app.studio.graphicStyle.bodyHint')}</span>
                    </div>
                  </div>
                  <label class="gs-field" style="margin-top:12px;">
                    <span class="kt">{$_('app.studio.graphicStyle.instructions')}</span>
                    <textarea
                      name="instructions"
                      rows="5"
                      maxlength="1200"
                      placeholder={$_('app.studio.graphicStyle.instructionsPlaceholder')}
                      bind:value={gsInstructions}
                      oninput={() => (gsTouched = true)}
                      style="width:100%;font-size:13px;"
                    ></textarea>
                    <span class="muted">{$_('app.studio.graphicStyle.instructionsHint')}</span>
                  </label>
                  <div class="form-actions">
                    <button class="btn primary" type="submit" disabled={busy}>
                      {busy ? $_('app.studio.saving') : $_('app.studio.graphicStyle.save')}
                    </button>
                  </div>
                </form>
                <div style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  {#if gs?.display_font}
                    <span class="chip2">{gs.display_font}{gs.body_font && gs.body_font !== gs.display_font ? ` + ${gs.body_font}` : ''}</span>
                  {:else}
                    <span class="muted">{$_('app.studio.graphicStyle.notSet')}</span>
                  {/if}
                  <form method="POST" action="?/proposeGraphicStyle" use:enhance={proposeGs} style="display:inline;">
                    <button class="btn ghost" type="submit" disabled={busy}>
                      {busy ? $_('app.studio.graphicStyle.proposing') : $_('app.studio.graphicStyle.propose')}
                    </button>
                  </form>
                </div>
                {#if gsFeedback}
                  <p class="muted" style="margin-top:8px;color:{gsFeedback.kind === 'ok' ? 'green' : '#b00'};font-size:13px;">{gsFeedback.msg}</p>
                {/if}
              </div>

              <div class="kit span2">
                <div class="kt">{$_('app.studio.visualStyle.title')}</div>
                {#if vsEditing}
                  <form class="kit-form" method="POST" action="?/updateVisualStyle" use:enhance={withBusy}>
                    <p class="muted" style="margin-bottom:8px;">{$_('app.studio.visualStyle.desc')}</p>
                    <textarea name="visual_style" rows="8" style="width:100%;font-size:13px;">{vsText}</textarea>
                    <div class="form-actions">
                      <button class="btn ghost" type="button" onclick={() => (vsEditing = false)} disabled={busy}>{$_('app.studio.cancel')}</button>
                      <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.saving') : $_('app.studio.visualStyle.save')}</button>
                    </div>
                  </form>
                {:else}
                  {#if kit.visual_style}
                    {@const brief = kit.visual_style as string}
                    {@const isLong = brief.length > 300}
                    {#if isLong && !vsExpanded}
                      <p style="white-space:pre-wrap;font-size:13px;line-height:1.5;">{brief.slice(0, 300)}…</p>
                      <button class="btn ghost" style="margin-top:4px;font-size:12px;" onclick={() => (vsExpanded = true)}>{$_('app.studio.visualStyle.expand')}</button>
                    {:else}
                      <p style="white-space:pre-wrap;font-size:13px;line-height:1.5;">{brief}</p>
                      {#if isLong}
                        <button class="btn ghost" style="margin-top:4px;font-size:12px;" onclick={() => (vsExpanded = false)}>{$_('app.studio.visualStyle.collapse')}</button>
                      {/if}
                    {/if}
                  {:else}
                    <p class="muted">—</p>
                  {/if}
                  <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
                    {#if kit.visual_style_locked}
                      <span class="chip2">{$_('app.studio.visualStyle.locked')}</span>
                    {:else}
                      <span class="muted">{$_('app.studio.visualStyle.unlocked')}</span>
                    {/if}
                    <button class="btn ghost" onclick={() => { vsText = (kit.visual_style ?? '') as string; vsEditing = true; }} disabled={busy}>
                      {kit.visual_style_locked ? $_('app.studio.visualStyle.unlock') : $_('app.studio.visualStyle.lock')}
                    </button>
                    <form method="POST" action="?/regenerateVisualStyle" use:enhance={regenStyle} style="display:inline;">
                      <button class="btn ghost" type="submit" disabled={busy}>{busy ? $_('app.studio.visualStyle.regenerating') : $_('app.studio.visualStyle.regenerate')}</button>
                    </form>
                  </div>
                  {#if vsFeedback}
                    <p class="muted" style="margin-top:8px;color:{vsFeedback.kind === 'ok' ? 'green' : '#b00'};font-size:13px;">{vsFeedback.msg}</p>
                  {/if}
                {/if}

                <div class="mood-refs">
                  <div class="kt" style="margin:18px 0 4px;">{$_('app.studio.visualStyle.references.title')}</div>
                  <p class="muted" style="margin-bottom:10px;font-size:13px;">{$_('app.studio.visualStyle.references.desc')}</p>
                  {#if moodImages.length}
                    <div class="mood-grid">
                      {#each moodImages as m (m.id)}
                        <div class="mood-item">
                          <div class="mood-img" style={m.url ? `background-image:url(${m.url})` : ''}></div>
                          <form method="POST" action="?/deleteSource" use:enhance={withBusy}>
                            <input type="hidden" name="id" value={m.id} />
                            <button class="mood-del" type="submit" disabled={busy} title={$_('app.studio.remove')} aria-label={$_('app.studio.remove')}>×</button>
                          </form>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if moodImages.length < 3}
                    <div class="mood-add">
                      <form method="POST" action="?/uploadImage" enctype="multipart/form-data" onsubmit={handleImageUpload}>
                        <label class="btn ghost mood-upload">
                          <input type="file" name="file" accept={RASTER_IMAGE_ACCEPT} onchange={(e) => (e.currentTarget as HTMLInputElement).form?.requestSubmit()} />
                          {$_('app.studio.visualStyle.references.upload')}
                        </label>
                      </form>
                      <button class="btn ghost" type="button" onclick={() => (moodPicker = !moodPicker)}>{$_('app.studio.visualStyle.references.fromSocials')}</button>
                      <button class="btn ghost" type="button" onclick={() => (socialMoodPicker = !socialMoodPicker)}>{$_('app.studio.visualStyle.references.fromOtherAccount', { default: 'Add from another account' })}</button>
                    </div>
                    {#if uploadError}<p class="sync-msg warn">{uploadError}</p>{/if}
                    {#if moodPicker}
                      {#if history.length}
                        <div class="mood-picker">
                          {#each history as h (h.id)}
                            {#if h.thumbnail_url}
                              <form method="POST" action="?/addMoodFromHistory" use:enhance={withBusy}>
                                <input type="hidden" name="history_id" value={h.id} />
                                <button class="mood-pick" type="submit" disabled={busy} style={`background-image:url(${h.thumbnail_url})`} title={$_('app.studio.visualStyle.references.pick')} aria-label={$_('app.studio.visualStyle.references.pick')}></button>
                              </form>
                            {/if}
                          {/each}
                        </div>
                      {:else}
                        <p class="muted" style="font-size:13px;">{$_('app.studio.visualStyle.references.noSocials')}</p>
                      {/if}
                    {/if}
                    {#if socialMoodPicker}
                      <div class="mood-social-picker" style="margin-top:10px;">
                        <SocialThumbPicker brandSlug={data.brand.slug} bind:selected={pickedMoodThumbs} max={3 - moodImages.length} />
                        {#if pickedMoodThumbs.length}
                          <form method="POST" action="?/addMoodFromUrls" use:enhance={saveMoodThumbs} style="margin-top:8px;">
                            <input type="hidden" name="urls" value={JSON.stringify(pickedMoodThumbs)} />
                            <button class="btn primary" type="submit" disabled={busy}>
                              {busy ? $_('app.studio.saving') : $_('app.studio.visualStyle.references.saveFromOtherAccount', { default: 'Save to references' })}
                            </button>
                          </form>
                        {/if}
                      </div>
                    {/if}
                  {:else}
                    <p class="muted" style="font-size:12px;">{$_('app.studio.visualStyle.references.max')}</p>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {:else}
          <div class="empty">{$_('app.studio.noKit')}</div>
        {/if}
      </section>
  {:else if section === 'platforms'}
<section id="platforms" class="studio-section">
        <h2 class="section-title">{$_('app.studio.tabs.platforms')}</h2>
        <div class="kit span2">
          <p class="muted" style="margin-bottom:14px;">{$_('app.studio.platforms.desc')}</p>
          <form method="POST" action="?/updateTargetPlatforms" use:enhance={withBusy}>
            <div class="plat-select">
              {#each PLATFORM_KEYS as k (k)}
                {@const on = selectedPlatforms.includes(k)}
                {@const connected = connectedPlatforms.includes(k)}
                {@const meta = PLATFORM_META[k]}
                <button type="button" class="plat-opt" class:on onclick={() => togglePlatform(k)}>
                  <span class="plat-glyph" style={`background:${meta?.bg ?? '#999'}`}>
                    {#if meta?.icon}<svg viewBox="0 0 24 24" fill="#fff"><path d={meta.icon.path} /></svg>{:else}{meta?.short ?? k.slice(0, 2)}{/if}
                  </span>
                  {getPlatform(k).label}
                  {#if on && !connected}<span class="plat-warn" title={$_('app.studio.platforms.notConnected')}>!</span>{/if}
                </button>
              {/each}
            </div>
            {#if unconnectedSelected.length}
              <p class="plat-warning">
                ⚠️ {$_('app.studio.platforms.warning', { values: { platforms: unconnectedSelected.map((p) => getPlatform(p).label).join(', ') } })}
                <a href={connectHref}>{$_('app.studio.platforms.connectLink')}</a>
              </p>
            {/if}
            <input type="hidden" name="platforms" value={JSON.stringify(selectedPlatforms)} />
            <div class="form-actions">
              <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.saving') : $_('app.studio.platforms.save')}</button>
            </div>
          </form>
        </div>
      </section>
  {:else if section === 'hashtags'}
<section id="hashtags" class="studio-section">
        <h2 class="section-title">{$_('app.studio.tabs.hashtags')}</h2>
        <div class="kit span2">
          <p class="muted" style="margin-bottom:14px;">{$_('app.studio.hashtags.desc')}</p>
          <form class="stack" method="POST" action="?/updatePlatformHashtags" use:enhance={withBusy}>
            {#each hashtagPlatforms as p (p)}
              <div class="ph-row">
                <span class="ph-plat">{platLabel(p)}</span>
                <div class="ph-field">
                  {#each hashtagEdit[p] ?? [] as tag, i (i)}
                    <span class="ph-tag">{tag}<button type="button" class="ph-tag-x" onclick={() => removeHashtag(p, i)} aria-label={$_('app.studio.coloursRemove')}>×</button></span>
                  {/each}
                  <input class="ph-tag-input" type="text" bind:value={hashtagDraft[p]}
                    onkeydown={(e) => onHashtagKey(e, p)} onblur={() => addHashtags(p, hashtagDraft[p] ?? '')}
                    placeholder={(hashtagEdit[p]?.length ?? 0) ? '' : $_('app.studio.hashtags.placeholder')}
                    autocomplete="off" spellcheck="false" />
                </div>
                <input type="hidden" name={`ph_${p}`} value={(hashtagEdit[p] ?? []).join(' ')} />
              </div>
            {/each}
            <div class="form-actions">
              <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.saving') : $_('app.studio.hashtags.save')}</button>
            </div>
          </form>
        </div>
      </section>
  {:else if section === 'voice-examples'}
<section id="voice-examples" class="studio-section">
        <h2 class="section-title">{$_('app.studio.tabs.voiceExamples', { default: 'Post di esempio' })}</h2>
        <div class="kit span2">
          <p class="muted" style="margin-bottom:14px;">{$_('app.studio.voiceExamples.desc', { default: 'Incolla alcuni post reali passati del vostro brand (una per riga). L\'IA imparerà il vostro ritmo, tono e struttura di frase per generare post che corrispondono alla vostra voce.' })}</p>
          <form class="stack" method="POST" action="?/updateVoiceExamples" use:enhance={withBusy}>
            <textarea name="voiceExamples" rows="8" placeholder={$_('app.studio.voiceExamples.placeholder', { default: 'Esempio 1...\nEsempio 2...\nEsempio 3...' })}>{voiceExamples.join('\n')}</textarea>
            <div class="form-actions">
              <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.saving') : $_('app.studio.voiceExamples.save', { default: 'Salva esempi' })}</button>
            </div>
          </form>
        </div>
      </section>
  {:else if section === 'products'}
<section id="products" class="studio-section">
        <h2 class="section-title">{$_('app.studio.tabs.products', { values: { count: products.length } })}</h2>
        {#if products.length}
          <div class="product-search">
            <input
              type="text"
              bind:value={productSearch}
              placeholder={$_('app.studio.productsSearch', { default: 'Cerca prodotti...' }) }
              oninput={() => (productPage = 1)}
            />
            {#if productSearch}
              <span class="product-search-count">{filteredProducts.length} {filteredProducts.length === 1 ? 'risultato' : 'risultati'}</span>
            {/if}
          </div>
          {#if visibleProducts.length}
            <div class="product-grid">
              {#each visibleProducts as p (p.id)}
                <div class="product">
                  <div class="pimg" style={p.images?.[0] ? `background-image:url(${p.images[0]})` : ''}>
                    {#if !p.images?.[0]}<span class="ph">{(p.title ?? '?').slice(0, 1)}</span>{/if}
                    <form method="POST" action="?/deleteProduct" use:enhance={withBusy}>
                      <input type="hidden" name="id" value={p.id} />
                      <button class="prod-del" type="submit" disabled={busy} aria-label={$_('app.studio.productsEdit.delete')} title={$_('app.studio.productsEdit.delete')}>×</button>
                    </form>
                  </div>
                  <form class="pinfo prod-form" method="POST" action="?/updateProduct" use:enhance={withBusy}>
                    <input type="hidden" name="id" value={p.id} />
                    <input class="prod-title" name="title" value={p.title ?? ''} />
                    <input class="prod-pricing" name="pricing" value={p.pricing ?? ''} placeholder={$_('app.studio.productsEdit.pricingPlaceholder')} />
                    <button class="btn ghost prod-save" type="submit" disabled={busy}>{$_('app.studio.save')}</button>
                  </form>
                </div>
              {/each}
            </div>
            {#if hasMoreProducts}
              <button class="btn ghost product-more" type="button" onclick={() => productPage++}>
                {$_('app.studio.seeMore', { default: 'Vedi altri' })} ({filteredProducts.length - visibleProducts.length})
              </button>
            {/if}
          {:else}
            <div class="empty">{$_('app.studio.noProductsSearch', { default: 'Nessun prodotto trovato.' })}</div>
          {/if}
        {:else}
          <div class="empty">{$_('app.studio.noProducts')}</div>
        {/if}
      </section>
  {:else if section === 'competitors'}
<section id="competitors" class="studio-section">
        <h2 class="section-title">{$_('app.studio.tabs.competitors', { values: { count: competitors.length } })}</h2>
        <div class="knowledge">
          <section class="card span2">
            <div class="section-head">
              <div class="kt" style="margin-bottom:0;">{$_('app.studio.competitors.add')}</div>
              <form method="POST" action="?/researchCompetitors" use:enhance={withBusy}>
                <button class="btn ghost" type="submit" disabled={busy}>{busy ? $_('app.studio.competitors.researching') : $_('app.studio.competitors.research')}</button>
              </form>
            </div>
            <p class="muted">{$_('app.studio.competitors.addDesc')}</p>

            {#if form?.researched}
              <p class="sync-msg ok">
                {form.added
                  ? $_('app.studio.competitors.researchAdded', { values: { count: form.added } })
                  : $_('app.studio.competitors.researchNone')}
              </p>
            {/if}

            <form class="stack" method="POST" action="?/addCompetitor" use:enhance={withBusy}>
              <input name="name" type="text" placeholder={$_('app.studio.competitors.namePlaceholder')} required />
              <div class="field-row">
                <input name="website" type="text" placeholder={$_('app.studio.competitors.websitePlaceholder')} />
                <select name="kind">
                  <option value="direct">{$_('app.studio.competitors.kind.direct')}</option>
                  <option value="indirect">{$_('app.studio.competitors.kind.indirect')}</option>
                </select>
              </div>
              <textarea name="rationale" rows="2" placeholder={$_('app.studio.competitors.rationalePlaceholder')}></textarea>
              <div class="form-actions">
                <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.saving') : $_('app.studio.competitors.addButton')}</button>
              </div>
            </form>

            {#if form?.error}
              <p class="sync-msg warn">{form.error}</p>
            {/if}
          </section>

          {#if competitors.length}
            <section class="card span2">
              <div class="kt">{$_('app.studio.competitors.yours', { values: { count: competitors.length } })}</div>
              <ul class="comp-list">
                {#each competitors as c (c.id)}
                  <li class="comp-row">
                    {#if editingComp === c.id}
                      <form class="stack comp-edit" method="POST" action="?/updateCompetitor" use:enhance={saveComp}>
                        <input type="hidden" name="id" value={c.id} />
                        <input name="name" type="text" value={c.name} placeholder={$_('app.studio.competitors.namePlaceholder')} required />
                        <div class="field-row">
                          <input name="website" type="text" value={c.website ?? ''} placeholder={$_('app.studio.competitors.websitePlaceholder')} />
                          <select name="kind" value={c.kind}>
                            <option value="direct">{$_('app.studio.competitors.kind.direct')}</option>
                            <option value="indirect">{$_('app.studio.competitors.kind.indirect')}</option>
                          </select>
                        </div>
                        <textarea name="rationale" rows="2" placeholder={$_('app.studio.competitors.rationalePlaceholder')}>{c.rationale ?? ''}</textarea>
                        <div class="form-actions">
                          <button class="btn ghost" type="button" onclick={() => (editingComp = null)} disabled={busy}>{$_('app.studio.cancel')}</button>
                          <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.saving') : $_('app.studio.save')}</button>
                        </div>
                      </form>
                    {:else}
                      <div class="comp-main">
                        <div class="comp-head">
                          <span class="comp-name">{c.name}</span>
                          <span class="comp-kind" class:indirect={c.kind === 'indirect'}>{c.kind === 'indirect' ? $_('app.studio.competitors.kind.indirect') : $_('app.studio.competitors.kind.direct')}</span>
                          {#if c.source === 'ai'}<span class="comp-src">{$_('app.studio.competitors.sourceAi')}</span>{/if}
                        </div>
                        {#if c.website}<a class="comp-site" href={c.website} target="_blank" rel="noopener noreferrer">{host(c.website)}</a>{/if}
                        {#if c.rationale}<p class="comp-rationale">{c.rationale}</p>{/if}
                      </div>
                      <div class="comp-actions">
                        <button class="btn link" type="button" onclick={() => (editingComp = c.id)} disabled={busy}>{$_('app.studio.competitors.edit')}</button>
                        <form method="POST" action="?/deleteCompetitor" use:enhance={withBusy}>
                          <input type="hidden" name="id" value={c.id} />
                          <button class="btn link" type="submit" disabled={busy}>{$_('app.studio.remove')}</button>
                        </form>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            </section>
          {:else}
            <div class="empty span2">{$_('app.studio.competitors.empty')}</div>
          {/if}
        </div>
      </section>
  {:else if section === 'people'}
<section id="people" class="studio-section">
        <h2 class="section-title">{$_('app.studio.tabs.people')}</h2>
        <div class="knowledge">
          <div class="consent-note span2">
            {@html $_('app.studio.consentNote')}
          </div>

          <section class="card span2">
            <div class="kt">{$_('app.studio.people.add')}</div>
            <p class="muted">{$_('app.studio.people.addDesc')}</p>

            <div class="subtabs" role="tablist">
              <button class="subtab" class:active={peopleSub === 'real'} role="tab" aria-selected={peopleSub === 'real'} onclick={() => (peopleSub = 'real')}>{$_('app.studio.people.real')}</button>
              <button class="subtab" class:active={peopleSub === 'ai'} role="tab" aria-selected={peopleSub === 'ai'} onclick={() => (peopleSub = 'ai')}>{$_('app.studio.people.ai')}</button>
            </div>

            {#if peopleSub === 'real'}
              <form class="stack" method="POST" action="?/addPersonReal" enctype="multipart/form-data" use:enhance={withHeicFiles('photos')}>
                <input name="name" type="text" placeholder={$_('app.studio.people.namePlaceholder')} required />
                <input name="role" type="text" placeholder={$_('app.studio.people.rolePlaceholder')} />
                <textarea name="description" rows="2" placeholder={$_('app.studio.people.descPlaceholder')}></textarea>
                <label class="dropzone" class:has-file={photoName}>
                  <input type="file" name="photos" accept={RASTER_IMAGE_ACCEPT} multiple required onchange={(e) => (photoName = fileNames(e))} />
                  <span class="dz-icon">↑</span>
                  <span class="dz-text">{photoName || $_('app.studio.people.choosePhotos')}</span>
                  <span class="dz-hint">{$_('app.studio.people.photosHint')}</span>
                </label>
                <label class="consent-check">
                  <input type="checkbox" name="consent" value="on" required />
                  <span>{$_('app.studio.people.consentConfirm')}</span>
                </label>
                <div class="form-actions">
                  <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.uploading') : $_('app.studio.people.addPerson')}</button>
                </div>
              </form>
            {:else}
              <form class="stack" method="POST" action="?/generatePersonAI" use:enhance={withBusy}>
                <input name="name" type="text" placeholder={$_('app.studio.people.namePlaceholder')} required />
                <input name="role" type="text" placeholder={$_('app.studio.people.rolePlaceholder')} />
                <div class="field-row">
                  <select name="gender">
                    <option value="">{$_('app.studio.people.gender.any')}</option>
                    <option value="female">{$_('app.studio.people.gender.female')}</option>
                    <option value="male">{$_('app.studio.people.gender.male')}</option>
                    <option value="non-binary">{$_('app.studio.people.gender.nonbinary')}</option>
                  </select>
                  <select name="ageRange">
                    <option value="">{$_('app.studio.people.age.any')}</option>
                    <option value="18-25">18–25</option>
                    <option value="26-35">26–35</option>
                    <option value="36-50">36–50</option>
                    <option value="50+">50+</option>
                  </select>
                </div>
                <div class="field-row">
                  <input name="ethnicity" type="text" placeholder={$_('app.studio.people.ethnicityPlaceholder')} />
                  <select name="vibe">
                    <option value="">{$_('app.studio.people.vibe.any')}</option>
                    <option value="professional">{$_('app.studio.people.vibe.professional')}</option>
                    <option value="casual">{$_('app.studio.people.vibe.casual')}</option>
                    <option value="luxury">{$_('app.studio.people.vibe.luxury')}</option>
                    <option value="sporty">{$_('app.studio.people.vibe.sporty')}</option>
                    <option value="creative">{$_('app.studio.people.vibe.creative')}</option>
                    <option value="natural">{$_('app.studio.people.vibe.natural')}</option>
                  </select>
                </div>
                <textarea name="description" rows="3" placeholder={$_('app.studio.people.aiDescPlaceholder')}></textarea>
                <div class="form-actions">
                  <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.people.generating') : $_('app.studio.people.generate')}</button>
                </div>
              </form>
            {/if}

            {#if form?.error}
              <p class="sync-msg warn">{form.error}</p>
            {/if}
          </section>

          {#if people.length}
            <section class="card span2">
              <div class="kt">{$_('app.studio.people.yourPeople', { values: { count: people.length } })}</div>
              <div class="people-grid">
                {#each people as p (p.id)}
                  <div class="person">
                    <div class="person-img" style={p.thumb ? `background-image:url(${p.thumb})` : ''}>
                      {#if !p.thumb}<span class="ph">{(p.name ?? '?').slice(0, 1)}</span>{/if}
                      <span class="person-kind" class:ai={p.kind === 'ai'}>{p.kind === 'ai' ? $_('app.studio.people.aiBadge') : $_('app.studio.people.realBadge')}</span>
                    </div>
                    <div class="person-info">
                      <div class="person-name">{p.name}</div>
                      {#if p.role}<div class="person-role">{p.role}</div>{/if}
                      <div class="person-meta">{$_('app.studio.people.photoCount', { values: { count: p.imageCount } })}</div>
                      {#if p.kind !== 'ai' && p.consent !== true}
                        <div class="person-blocked">
                          <div>{$_('app.studio.people.consentMissing')}</div>
                          <form method="POST" action="?/attestPersonConsent" use:enhance={withBusy}>
                            <input type="hidden" name="id" value={p.id} />
                            <button class="btn link" type="submit" disabled={busy}>{$_('app.studio.people.consentAttest')}</button>
                          </form>
                        </div>
                      {/if}
                    </div>
                    <form method="POST" action="?/deletePerson" use:enhance={withBusy}>
                      <input type="hidden" name="id" value={p.id} />
                      <button class="btn link" type="submit" disabled={busy}>{$_('app.studio.remove')}</button>
                    </form>
                  </div>
                {/each}
              </div>
            </section>
          {:else}
            <div class="empty span2">{$_('app.studio.people.empty')}</div>
          {/if}
        </div>
      </section>
  {/if}
{/if}

<style>
  /* ---- Completeness pill ---- */
  .page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .page-head-text { flex: 1; min-width: 0; }
  .cmp-pill { position: relative; flex: 0 0 auto; width: 56px; height: 56px; color: var(--accent, #7c5cff); }
  .cmp-pill.done { color: #1f8a4c; }
  .cmp-ring { width: 56px; height: 56px; display: block; }
  .cmp-pct { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; color: var(--ink); }
  .cmp-pill.done .cmp-pct { color: #1f8a4c; }

  /* Studio layout: sticky index left + scrollable content right */
  .studio-layout { display: flex; gap: 48px; margin-top: 32px; }
  .studio-index {
    position: sticky; top: 24px; align-self: flex-start; flex: 0 0 180px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .index-link {
    font-size: 14px; font-weight: 500; color: var(--ink-soft); text-decoration: none;
    padding: 8px 12px; border-radius: 10px; transition: background 0.15s, color 0.15s;
  }
  .index-link:hover { background: var(--paper-2); color: var(--ink); }
  .studio-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 48px; }
  .studio-section { scroll-margin-top: 24px; }
  .studio-loading { min-height: 120px; }
  .section-title {
    font-size: clamp(32px, 4vw, 40px); font-weight: 600; letter-spacing: -0.03em;
    margin: 0 0 24px; color: var(--ink);
  }

  .kit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .kit { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 20px 22px; }
  .kit.span2 { grid-column: 1 / -1; }
  .kit .kt { font-size: 13px; font-weight: 600; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 14px; }
  .kit p { font-size: 14px; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .swatches { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  /* Editable swatch: the swatch IS a native colour picker, with a remove dot on hover. */
  .sw-edit { position: relative; width: 44px; height: 44px; }
  .sw-edit input[type='color'] { width: 44px; height: 44px; padding: 0; border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 12px; cursor: pointer; background: none; }
  .sw-edit input[type='color']::-webkit-color-swatch-wrapper { padding: 2px; }
  .sw-edit input[type='color']::-webkit-color-swatch { border: none; border-radius: 10px; }
  .sw-x { position: absolute; top: -7px; right: -7px; width: 18px; height: 18px; padding: 0; border: none; border-radius: 50%;
    background: var(--invert-surface); color: #fff; font-size: 12px; line-height: 1; display: flex; align-items: center;
    justify-content: center; cursor: pointer; opacity: 0; transition: opacity 0.12s; }
  .sw-edit:hover .sw-x { opacity: 1; }
  .sw-add { width: 44px; height: 44px; border-radius: 12px; border: 1.5px dashed var(--line-2); background: none;
    color: var(--ink-faint); font-size: 19px; padding: 0; cursor: pointer; }
  .sw-add:hover { border-color: var(--accent); color: var(--accent); }
  .sw-save { margin-top: 12px; }

  /* Logo: a single replaceable slot. */
  .logo-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .logo-slot { width: 64px; height: 64px; border-radius: 14px; border: 1px solid var(--line);
    background: var(--paper-2); display: flex; align-items: center; justify-content: center; overflow: hidden; flex: none; }
  .logo-slot.empty { color: var(--ink-faint); }
  .logo-slot img { max-width: 80%; max-height: 80%; object-fit: contain; }
  .logo-upload { position: relative; font-size: 13px; font-weight: 600; color: var(--accent); cursor: pointer; }
  .logo-upload:hover { text-decoration: underline; }
  .logo-upload input[type='file'] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .logo-remove { background: none; border: none; padding: 0; font-size: 13px; color: var(--ink-faint); cursor: pointer; }
  .logo-remove:hover { color: #c0392b; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .muted { color: var(--ink-faint); font-size: 13px; }

  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .busy-note { font-size: 13px; color: var(--ink-faint); }

  .sync-msg { font-size: 13px; margin-top: 10px; line-height: 1.45; color: var(--ink-soft); }
  .sync-msg.ok { color: var(--accent, #7c5cff); font-weight: 600; }
  .sync-msg.warn { color: #b25000; }

  .btn { font-size: 13px; font-weight: 600; border-radius: 10px; padding: 9px 16px; cursor: pointer;
    border: 1px solid transparent; line-height: 1; }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .btn.ghost { background: transparent; color: var(--ink-soft); border-color: var(--line); }
  .btn.link { background: transparent; color: var(--ink-faint); border: none; padding: 4px 6px;
    text-decoration: underline; font-weight: 500; }

  .kit-form, .stack { display: flex; flex-direction: column; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-size: 12px; font-weight: 600; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.04em; }
  .kit-form input, .kit-form textarea, .stack input, .stack textarea {
    width: 100%; font-size: 14px; color: var(--ink-soft); background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; font-family: inherit; box-sizing: border-box; }
  .kit-form textarea, .stack textarea { resize: vertical; line-height: 1.5; }
  .lang-select { width: 100%; font-size: 14px; color: var(--ink-soft); background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; font-family: inherit;
    box-sizing: border-box; cursor: pointer; }
  .stack input[type='file'] { padding: 9px 12px; }
  .form-actions { display: flex; justify-content: flex-end; }

  .subtabs { display: inline-flex; gap: 2px; background: var(--paper-2); border: 1px solid var(--line);
    border-radius: 12px; padding: 3px; margin: 4px 0 16px; }
  .subtab { font-size: 13px; font-weight: 600; color: var(--ink-soft); background: transparent;
    border: none; border-radius: 9px; padding: 7px 16px; cursor: pointer; line-height: 1; }
  .subtab.active { background: var(--paper); color: var(--ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }

  .dropzone { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px;
    text-align: center; padding: 26px 18px; border: 1.5px dashed var(--line-2); border-radius: 14px;
    background: var(--paper-2); cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .dropzone:hover { border-color: var(--accent, #7c5cff); }
  .dropzone.has-file { border-style: solid; border-color: var(--accent, #7c5cff); background: rgba(var(--accent-rgb), 0.05); }
  .dropzone input[type='file'] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .dz-icon { font-size: 18px; font-weight: 700; color: var(--ink-faint); line-height: 1; }
  .dz-text { font-size: 14px; font-weight: 600; color: var(--ink-soft); word-break: break-all; }
  .dz-hint { font-size: 12px; color: var(--ink-faint); }

  .knowledge { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 20px 22px; }
  .card.span2 { grid-column: 1 / -1; }
  .card .kt { font-size: 13px; font-weight: 600; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px; }
  .card .muted { margin-bottom: 10px; }

  .source-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .source-item { border-top: 1px solid var(--line); }
  .source-item:first-child { border-top: none; }
  .source-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
  .source-kind { font-size: 11px; font-weight: 600; color: var(--ink-faint); text-transform: uppercase;
    letter-spacing: 0.04em; background: var(--paper-2); border-radius: 8px; padding: 3px 8px; flex: 0 0 auto; }
  .source-title { font-size: 14px; color: var(--ink-soft); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .source-content { margin: 0 0 12px; padding: 12px 14px; background: var(--paper-2); border-radius: 12px;
    font-size: 13px; line-height: 1.5; color: var(--ink-soft); white-space: pre-wrap; word-break: break-word;
    max-height: 320px; overflow: auto; font-family: inherit; }

  /* Target-platform selector */
  .plat-select { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .plat-opt { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: 999px;
    border: 1px solid var(--line-2, #d2d2d7); background: var(--paper); color: var(--ink-soft); font: inherit;
    font-size: 13.5px; font-weight: 600; cursor: pointer; transition: border-color 0.12s, background 0.12s, color 0.12s; }
  .plat-opt:hover { border-color: var(--ink-faint); }
  .plat-opt.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--paper)); color: var(--ink); }
  .plat-opt:not(.on) { opacity: 0.72; }
  .plat-opt:not(.on):hover { opacity: 1; }
  .plat-glyph { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
    border-radius: 999px; color: #fff; font-size: 10px; font-weight: 700; flex: 0 0 auto; }
  .plat-glyph svg { width: 12px; height: 12px; }
  .plat-warn { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;
    border-radius: 999px; background: #f0a020; color: #fff; font-size: 11px; font-weight: 700; }
  .plat-warning { font-size: 13px; color: #9a6700; background: #fff7e6; border: 1px solid #f2d38a;
    border-radius: 10px; padding: 10px 12px; margin: 0 0 12px; }
  .plat-warning a { color: var(--accent); font-weight: 600; margin-left: 4px; }

  /* Preferred hashtags per platform — a chip field so each tag is entered separately. */
  .ph-row { display: flex; align-items: flex-start; gap: 12px; }
  .ph-plat { flex: 0 0 96px; font-size: 13px; font-weight: 600; color: var(--ink-soft); padding-top: 10px; }
  .ph-field { flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 40px;
    padding: 5px 8px; border: 1px solid var(--line-2, #d2d2d7); border-radius: 10px; background: var(--paper); }
  .ph-field:focus-within { border-color: var(--accent); }
  .ph-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; white-space: nowrap;
    padding: 3px 5px 3px 9px; border-radius: 8px; background: var(--paper-2, #f4f4f6); color: var(--ink); }
  .ph-tag-x { border: none; background: none; padding: 0 2px; font-size: 15px; line-height: 1; color: var(--ink-faint); cursor: pointer; }
  .ph-tag-x:hover { color: var(--ink); }
  .ph-tag-input { flex: 1; min-width: 90px; border: none; outline: none; background: none;
    font: inherit; font-size: 13.5px; color: var(--ink); padding: 4px 2px; }
  .ph-tag-input::placeholder { color: var(--ink-faint); }
  @container workbench (max-width: 560px) { .ph-row { flex-direction: column; align-items: stretch; gap: 4px; } .ph-plat { flex: none; padding-top: 0; } }

  /* Post-image style references */
  .mood-refs { margin-top: 4px; }
  .mood-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
  .mood-item { position: relative; width: 96px; height: 96px; }
  .mood-img { width: 100%; height: 100%; border-radius: 12px; border: 1px solid var(--line);
    background-color: var(--paper-2); background-size: cover; background-position: center; }
  .mood-del { position: absolute; top: -8px; right: -8px; width: 22px; height: 22px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--paper); color: var(--ink); font-size: 14px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .mood-del:disabled { opacity: 0.5; cursor: default; }
  .mood-add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .mood-upload { position: relative; overflow: hidden; cursor: pointer; }
  .mood-upload input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .mood-picker { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; max-height: 220px; overflow-y: auto; }
  .mood-pick { width: 72px; height: 72px; border-radius: 10px; border: 1px solid var(--line); padding: 0;
    background-color: var(--paper-2); background-size: cover; background-position: center; cursor: pointer; }
  .mood-pick:hover { border-color: var(--ink); }
  .mood-pick:disabled { opacity: 0.5; cursor: default; }
  .history-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; margin-top: 6px; }
  .post { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--paper);
    text-decoration: none; color: inherit; display: flex; flex-direction: column; }
  .post-img { height: 120px; background-color: var(--paper-2); background-size: cover; background-position: center;
    display: flex; align-items: center; justify-content: center; }
  .post-img .ph { font-size: 26px; font-weight: 700; color: var(--ink-faint); }
  .post-info { padding: 12px 14px; }
  .post-platform { font-size: 11px; font-weight: 600; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.04em; }
  .post-text { font-size: 13px; color: var(--ink-soft); line-height: 1.4; margin-top: 5px; }

  .product-search { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
  .product-search input {
    flex: 1; font-size: 14px; color: var(--ink); background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px;
    font-family: inherit; outline: none; transition: border-color 0.15s;
  }
  .product-search input:focus { border-color: var(--accent); }
  .product-search input::placeholder { color: var(--ink-faint); }
  .product-search-count { font-size: 13px; color: var(--ink-faint); white-space: nowrap; }
  .product-more { margin-top: 16px; width: 100%; }

  .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr)); gap: 14px; }
  .product { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--paper); }
  .pimg { position: relative; height: 130px; background-color: var(--paper-2); background-size: cover; background-position: center;
    display: flex; align-items: center; justify-content: center; }
  .pimg .ph { font-size: 28px; font-weight: 700; color: var(--ink-faint); }
  .pinfo { padding: 12px 14px; }
  /* product cards: title/pricing edited in place, delete on the image corner */
  .prod-form { display: flex; flex-direction: column; gap: 7px; }
  .prod-title { font-size: 14px; font-weight: 600; line-height: 1.3; padding: 7px 9px; border: 1px solid transparent;
    border-radius: 9px; background: transparent; font-family: inherit; color: var(--ink); }
  .prod-pricing { font-size: 13px; color: var(--ink-soft); padding: 6px 9px; border: 1px solid transparent;
    border-radius: 9px; background: transparent; font-family: inherit; }
  .prod-title:hover, .prod-pricing:hover { border-color: var(--line-2); }
  .prod-title:focus, .prod-pricing:focus { outline: none; border-color: var(--accent); background: var(--paper); }
  .prod-save { align-self: flex-start; }
  .prod-del { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; padding: 0; border: none;
    border-radius: 50%; background: rgba(0, 0, 0, 0.45); color: #fff; font-size: 16px; line-height: 1; cursor: pointer; }
  .prod-del:hover { background: #c0392b; }

  .consent-check { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; line-height: 1.45;
    color: var(--ink-soft); }
  .consent-check input { margin-top: 2px; flex-shrink: 0; }
  .person-blocked { margin-top: 6px; padding: 7px 9px; border-radius: 9px; font-size: 12px; line-height: 1.4;
    background: rgba(192, 57, 43, 0.07); border: 1px solid rgba(192, 57, 43, 0.2); color: #a33227; }
  .person-blocked .btn.link { padding: 0; margin-top: 3px; font-size: 12px; }
  .consent-note { font-size: 12.5px; color: var(--ink-soft); background: rgba(var(--accent-rgb), 0.05);
    border: 1px solid rgba(var(--accent-rgb), 0.15); border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; line-height: 1.45; }
  .empty { padding: 40px 22px; text-align: center; color: var(--ink-faint); font-size: 14px;
    border: 1px dashed var(--line-2); border-radius: 18px; }
  .span2 { grid-column: 1 / -1; }

  /* ---- People ---- */
  .field-row { display: flex; gap: 10px; }
  .field-row > * { flex: 1; min-width: 0; }
  .stack select { font-size: 14px; color: var(--ink-soft); background: var(--paper);
    border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }

  .people-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr)); gap: 14px; }
  .person { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--paper); display: flex; flex-direction: column; }
  .person-img { position: relative; height: 160px; background-color: var(--paper-2);
    background-size: cover; background-position: center top; display: flex; align-items: center; justify-content: center; }
  .person-img .ph { font-size: 30px; font-weight: 700; color: var(--ink-faint); }
  .person-kind { position: absolute; top: 8px; left: 8px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 7px; border-radius: 980px;
    background: rgba(255, 255, 255, 0.9); color: var(--ink-soft); }
  .person-kind.ai { background: rgba(var(--accent-rgb), 0.92); color: #fff; }
  .person-info { padding: 11px 13px; flex: 1; }
  .person-name { font-size: 14px; font-weight: 600; line-height: 1.3; }
  .person-role { font-size: 13px; color: var(--ink-soft); margin-top: 2px; }
  .person-meta { font-size: 11.5px; color: var(--ink-faint); margin-top: 5px; }
  .person form { padding: 0 13px 11px; }

  /* ---- Competitors ---- */
  .comp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .comp-row { display: flex; align-items: flex-start; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); }
  .comp-row:first-child { border-top: none; }
  .comp-main { flex: 1 1 auto; min-width: 0; }
  .comp-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .comp-name { font-size: 14px; font-weight: 600; color: var(--ink); }
  .comp-kind { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 3px 7px; border-radius: 980px; background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); }
  .comp-kind.indirect { background: var(--paper-2); color: var(--ink-faint); }
  .comp-src { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 3px 7px; border-radius: 980px; background: var(--paper-2); color: var(--ink-faint); }
  .comp-site { display: inline-block; font-size: 13px; color: var(--accent, #7c5cff); text-decoration: none; margin-top: 5px; }
  .comp-site:hover { text-decoration: underline; }
  .comp-rationale { font-size: 13px; color: var(--ink-soft); line-height: 1.45; margin: 6px 0 0; }
  .comp-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
  .comp-edit { flex: 1 1 auto; min-width: 0; }
  .comp-edit .form-actions { gap: 8px; }

  @container workbench (max-width: 760px) {
    .kit-grid { grid-template-columns: 1fr; }
    .knowledge { grid-template-columns: 1fr; }
    .studio-layout { flex-direction: column; gap: 24px; }
    .studio-index {
      position: static; flex: none; flex-direction: row; flex-wrap: wrap; gap: 8px;
    }
    .index-link { font-size: 13px; padding: 6px 10px; }
    .section-title { font-size: clamp(24px, 5cqi, 32px); }
  }

  /* Typography card: two font fields side by side, stacking on narrow screens. */
  .gs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 640px) { .gs-grid { grid-template-columns: minmax(0, 1fr); } }
  .gs-field { display: flex; flex-direction: column; gap: 4px; }
  .gs-field .muted { font-size: 12px; }
</style>
