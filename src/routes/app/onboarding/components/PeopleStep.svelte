<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { jpegIfHeicFile } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT, isRasterImageSource } from '$lib/raster-image';
  import {
    MAX_PERSON_PHOTOS,
    displayShots,
    findPersonIndex,
    missingShots,
    namesMatch,
    personKey,
    personPaths,
    personShots,
    personUrls,
    type DetectedPerson
  } from './people';

  let {
    detectedPeople = $bindable([]),
    personName = $bindable(''),
    personRole = $bindable(''),
    personImages = $bindable([]),
    showManualPerson = $bindable(false),
    scanAlreadyDone = false,
    oncontinue,
    onskip,
    isContinueMode = false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile = null,
    handles = [],
    onmarkdone,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onerror
  }: {
    detectedPeople?: DetectedPerson[];
    personName?: string;
    personRole?: string;
    personImages?: { path: string; url: string }[];
    showManualPerson?: boolean;
    scanAlreadyDone?: boolean;
    oncontinue: () => void;
    onskip: () => void;
    isContinueMode?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: any;
    handles?: { platform: string; username: string | null; profileUrl: string | null }[];
    onmarkdone?: () => void;
    onerror?: (step: string, message: unknown, context?: Record<string, unknown>) => void;
  } = $props();

  let peopleScanning = $state(false);
  let scanAttempted = $state(false);
  const peopleScanned = $derived(scanAttempted || scanAlreadyDone);
  let importingTeam = $state(false);
  let personUploading = $state(false);
  let personError = $state('');

  // Identità sfumata: sito e social devono arricchire la STESSA persona, non due schede da una foto.
  // Un nome già noto viene ARRICCHITO, non saltato: più angolazioni della stessa faccia sono
  // molto meglio di uno scatto solo per i generatori.
  function mergePeople(found: { name: string; role?: string; image?: string; thumbs?: string[]; images?: string[] }[]) {
    if (!found.length) return;
    const next = [...detectedPeople];
    let changed = false;
    for (const p of found) {
      const name = String(p.name ?? '').trim();
      if (!personKey(name)) continue;
      const shots = [
        ...new Set(
          [p.image, ...(p.thumbs ?? []), ...(p.images ?? [])]
            .map((u) => String(u ?? '').trim())
            .filter(Boolean)
        )
      ];
      if (!shots.length) continue;
      const idx = findPersonIndex(next, name);
      if (idx < 0) {
        next.push({
          name,
          role: String(p.role ?? '').trim(),
          image: shots[0],
          images: shots.slice(0, MAX_PERSON_PHOTOS),
          selected: true
        });
        changed = true;
        continue;
      }
      // Gli scatti esistenti restano primi, così path/url non cambiano sotto ai piedi.
      const cur = next[idx];
      const existing = personShots(cur);
      const merged = [...new Set([...existing, ...shots])].slice(0, MAX_PERSON_PHOTOS);
      const role = cur.role || String(p.role ?? '').trim();
      const betterName = name.length > cur.name.length ? name : cur.name;
      if (merged.length === existing.length && role === cur.role && betterName === cur.name) continue;
      next[idx] = { ...cur, name: betterName, role, image: merged[0], images: merged };
      changed = true;
    }
    if (changed) detectedPeople = next;
  }

  export async function discover() {
    if (peopleScanned) {
      if (detectedPeople.some((p) => p.selected && missingShots(p).length)) await importDetected();
      return;
    }
    scanAttempted = true;
    onmarkdone?.();
    peopleScanning = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mergePeople((Array.isArray(profile?.people) ? profile.people : []) as any[]);
      if (handles.length) {
        try {
          const res = await fetch('/app/onboarding/people/from-socials', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ handles })
          });
          if (res.ok) {
            const d = (await res.json()) as {
              people?: { name: string; role?: string; image?: string; thumbs?: string[] }[];
            };
            mergePeople(d.people ?? []);
          } else {
            onerror?.('people_from_socials', `HTTP ${res.status}`);
          }
        } catch (e) {
          onerror?.('people_from_socials', e instanceof Error ? e.message : 'request failed');
        }
      }
      await importDetected();
    } finally {
      peopleScanning = false;
    }
  }

  // Incrementale: importa solo gli scatti senza controparte nel bucket, così arricchire una
  // persona non ricarica quello che c'è già.
  async function importDetected() {
    const pending = detectedPeople
      .map((p) => ({ p, shots: p.selected ? missingShots(p) : [] }))
      .filter(({ shots }) => shots.length);
    if (!pending.length) return;
    importingTeam = true;
    try {
      const imported = new Map<string, { path: string; url: string; src: string }[]>();
      await Promise.all(
        pending.map(async ({ p, shots }) => {
          const done = await Promise.all(
            shots.map(async (src) => {
              try {
                const res = await fetch('/app/onboarding/people/import', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ url: src })
                });
                if (!res.ok) {
                  onerror?.('people_import', `HTTP ${res.status}`);
                  return null;
                }
                const d = await res.json();
                return d?.path && d?.url ? { path: d.path as string, url: d.url as string, src } : null;
              } catch (e) {
                onerror?.('people_import', e instanceof Error ? e.message : 'import failed');
                return null;
              }
            })
          );
          const ok = done.filter((s): s is { path: string; url: string; src: string } => !!s);
          if (ok.length) imported.set(personKey(p.name), ok);
        })
      );
      if (imported.size) {
        detectedPeople = detectedPeople.map((x) => {
          const got = imported.get(personKey(x.name)) ?? [...imported.entries()].find(([k]) => namesMatch(k, x.name))?.[1];
          if (!got) return x;
          const paths = [...personPaths(x), ...got.map((s) => s.path)].slice(0, MAX_PERSON_PHOTOS);
          const urls = [...personUrls(x), ...got.map((s) => s.url)].slice(0, MAX_PERSON_PHOTOS);
          const sourced = [...new Set([...(x.sourced ?? []), ...got.map((s) => s.src)])];
          return { ...x, paths, urls, sourced, path: paths[0], url: urls[0] };
        });
      }
    } finally {
      importingTeam = false;
    }
  }

  async function toggleDetected(i: number) {
    detectedPeople = detectedPeople.map((p, idx) => (idx === i ? { ...p, selected: !p.selected } : p));
    const p = detectedPeople[i];
    if (p?.selected && missingShots(p).length) await importDetected();
  }

  async function onPersonPhotos(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? [])
      .filter((f) => isRasterImageSource({ mime: f.type, filename: f.name }))
      .slice(0, 6);
    if (!files.length) return;
    personUploading = true;
    personError = '';
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', await jpegIfHeicFile(file));
        const res = await fetch('/app/onboarding/people/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          onerror?.('people_upload', `HTTP ${res.status}`);
          personError = $_('onboarding.people.uploadFailed');
          continue;
        }
        const d = await res.json();
        if (d?.path && d?.url) personImages = [...personImages, { path: d.path, url: d.url }];
      }
    } catch (e) {
      onerror?.('people_upload', e instanceof Error ? e.message : 'upload failed');
      personError = $_('onboarding.people.uploadFailed');
    } finally {
      personUploading = false;
      input.value = '';
    }
  }
  function removePersonPhoto(path: string) {
    personImages = personImages.filter((i) => i.path !== path);
  }
</script>

{#if peopleScanning && !detectedPeople.length}
  <div class="preview-head"><span class="hsp"></span>{$_('onboarding.people.scanning')}</div>
{/if}

{#if detectedPeople.length}
  <div class="block">
    <div class="lbl">{$_('onboarding.people.detectedLabel')}</div>
    <p class="hint">{importingTeam ? $_('onboarding.people.importing') : $_('onboarding.people.detectedHint')}</p>
    <div class="team-list">
      {#each detectedPeople as p, i (p.name + i)}
        {@const shots = displayShots(p)}
        <button type="button" class="team-card" class:sel={p.selected} onclick={() => toggleDetected(i)}>
          {#if shots.length}
            <span class="tphotos">
              {#each shots as src, si (src + si)}
                <span class="tphoto" style={`background-image:url(${src})`}></span>
              {/each}
            </span>
          {/if}
          <span class="tinfo">
            <span class="tname">{p.name}</span>
            {#if p.role}<span class="trole">{p.role}</span>{/if}
          </span>
          {#if p.selected}<span class="tcheck">✓</span>{/if}
        </button>
      {/each}
    </div>
  </div>
{:else if !peopleScanning}
  <p class="hint">{$_('onboarding.people.noneFound')}</p>
{/if}

{#if !showManualPerson}
  <button type="button" class="disclosure manual-add" onclick={() => (showManualPerson = true)}>
    {$_('onboarding.people.orAddManually')}
  </button>
{:else}
  <div class="block">
    <div class="lbl">{$_('onboarding.people.nameLabel')} <small>{$_('onboarding.optional')}</small></div>
    <div class="people-compact">
      <input type="text" bind:value={personName} placeholder={$_('onboarding.people.namePlaceholder')} />
      <input type="text" bind:value={personRole} placeholder={$_('onboarding.people.rolePlaceholder')} />
    </div>
    {#if personImages.length}
      <div class="person-thumbs">
        {#each personImages as img (img.path)}
          <div class="person-thumb" style={`background-image:url(${img.url})`}>
            <button type="button" class="thumb-x" aria-label={$_('onboarding.people.removePhoto')} onclick={() => removePersonPhoto(img.path)}>×</button>
          </div>
        {/each}
      </div>
    {/if}
    <label class="ob-dropzone">
      <input type="file" accept={RASTER_IMAGE_ACCEPT} multiple onchange={onPersonPhotos} />
      <span>{personUploading ? $_('onboarding.people.uploading') : $_('onboarding.people.choosePhotos')}</span>
      <small>{$_('onboarding.people.photosHint')}</small>
    </label>
    {#if personError}<p class="err">{personError}</p>{/if}
  </div>
{/if}

<div class="cta-row cta-row-setup">
  {#if isContinueMode}
    <button type="button" class="ghost" onclick={onskip}>{$_('onboarding.finishLater')}</button>
  {/if}
  <button class="primary cta-press" onclick={oncontinue} disabled={personUploading || importingTeam || peopleScanning}>
    {$_('onboarding.continue')}
  </button>
</div>

<style>
  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  button:disabled { opacity: 0.4; cursor: default; }
  .primary { border-radius: 980px; padding: 13px 22px; margin-top: 24px; background: var(--accent, #7c5cff); color: #fff; }
  .primary:hover { background: #6b4dff; }
  .ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border-radius: 980px; padding: 13px 22px; }
  .cta-press { transition: transform 0.12s var(--ease, ease); }
  .cta-press:active:not(:disabled) { transform: scale(0.97); }
  .err { color: #c0392b; font-size: 14px; margin-top: 14px; }

  input { flex: 1; font-size: 16px; padding: 13px 16px; border-radius: 12px; border: 1px solid var(--line-2, #d2d2d7); outline: none; width: 100%; height: 44px; }
  input:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.12); }

  .block { margin-top: 18px; }
  .block .lbl { font-size: 16px; font-weight: 650; margin-bottom: 10px; letter-spacing: -0.01em; }
  .block small { color: var(--ink-faint, #86868b); font-weight: 400; }
  .hint { font-size: 13px; color: var(--ink-soft, #6e6e73); margin: 2px 0 8px; line-height: 1.4; }

  .cta-row .primary, .cta-row .ghost { margin-top: 0; }
  /* Azione primaria appiccicata in fondo negli step lunghi. I margini negativi pareggiano il
     padding orizzontale di .wrap: senza, la barra non arriva ai bordi. */
  .cta-row-setup {
    position: sticky;
    bottom: 0;
    z-index: 5;
    margin: 24px calc(-1 * clamp(24px, 5vw, 64px)) 0;
    padding: 14px clamp(24px, 5vw, 64px) calc(14px + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--paper, #fff) 92%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-top: 1px solid var(--line, #e3e3e6);
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .preview-head { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 9px; margin: 24px 0 14px; color: var(--ink-soft, #6e6e73); }
  .hsp { width: 15px; height: 15px; flex: 0 0 auto; border-radius: 50%; border: 2px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent, #7c5cff); animation: spin 0.8s linear infinite; }

  .team-list { display: flex; flex-direction: column; gap: 10px; }
  .team-card { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 10px;
    width: 100%; text-align: left; padding: 12px 40px 12px 12px; border-radius: 14px;
    border: 1.5px solid var(--line, #e3e3e6); background: var(--paper, #fff); color: var(--ink, #1d1d1f); cursor: pointer; }
  .team-card.sel { border-color: var(--accent, #7c5cff); background: color-mix(in srgb, var(--accent, #7c5cff) 12%, var(--paper, #fff)); }
  .tphotos { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
  .tphoto { width: 62px; height: 62px; border-radius: 10px; flex: none; background-color: var(--paper-2, #f5f5f7);
    background-size: cover; background-position: center; }
  .tinfo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .tname { font-weight: 600; color: var(--ink, #1d1d1f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .trole { font-size: 12px; color: var(--ink-soft, #6e6e73); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tcheck { position: absolute; top: 10px; right: 14px; color: var(--accent, #7c5cff); font-weight: 700; }
  .disclosure { background: none; border: none; padding: 0; font-size: 13.5px; font-weight: 600; color: var(--accent, #7c5cff); cursor: pointer; }
  .disclosure:hover { text-decoration: underline; }
  .manual-add { display: inline-block; margin-top: 18px; }
  .people-compact { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0 0 10px; }
  .person-thumbs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .person-thumb { position: relative; width: 64px; height: 64px; border-radius: 10px;
    background-color: var(--paper-2, #f5f5f7); background-size: cover; background-position: center top; }
  .thumb-x { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; padding: 0;
    border-radius: 50%; background: var(--ink, #1d1d1f); color: #fff; font-size: 14px; line-height: 1;
    display: flex; align-items: center; justify-content: center; }
  .ob-dropzone { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 18px; border: 1.5px dashed var(--line-2, #d2d2d7); border-radius: 12px; cursor: pointer;
    text-align: center; color: var(--ink-soft, #6e6e73); font-size: 14px; }
  .ob-dropzone:hover { border-color: var(--accent, #7c5cff); }
  .ob-dropzone input[type='file'] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .ob-dropzone small { color: var(--ink-faint, #86868b); font-size: 12px; }

  @media (max-width: 860px) {
    .people-compact { grid-template-columns: 1fr; }

    /* On phones the sticky bar goes full-width and its button spans it (thumb-sized target). */
    .cta-row-setup {
      justify-content: stretch;
      margin: 24px -22px 0;
      padding: 14px 22px calc(14px + env(safe-area-inset-bottom));
    }
    .cta-row-setup .primary { flex: 1; height: 48px; font-size: 16px; margin-top: 0; }
  }
</style>
