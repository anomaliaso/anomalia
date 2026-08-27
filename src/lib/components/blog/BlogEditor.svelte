<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { StarterKit } from '@tiptap/starter-kit';
  import { Image } from '@tiptap/extension-image';
  import { TableKit } from '@tiptap/extension-table';
  import { DOMSerializer } from '@tiptap/pm/model';
  import { marked } from 'marked';
  import TurndownService from 'turndown';
  // @ts-expect-error turndown-plugin-gfm ships no type declarations
  import { gfm } from 'turndown-plugin-gfm';

  // WYSIWYG article editor. Content is edited on the rendered text (TipTap). Markdown stays the
  // source of truth: we load md→HTML (marked) and serialize back HTML→md (turndown) on read.
  // Body images + text selections get a "Chiedi alle AI" affordance that opens an inline prompt
  // and hands the instruction to the parent (wired into ArticleChat).
  let { initialMarkdown = '', onChange, onImageUpload, onAskAiImage, onAskAiText }: {
    initialMarkdown?: string;
    onChange?: () => void;
    onImageUpload?: () => Promise<string | null>;
    onAskAiImage?: (src: string, prompt: string) => void;
    onAskAiText?: (selectedMd: string, prompt: string) => void;
  } = $props();

  let element: HTMLDivElement;
  let shellEl = $state<HTMLDivElement | null>(null);
  let editor = $state<Editor | null>(null);
  let sel = $state(0); // bumps on every transaction so toolbar active-states stay reactive

  // Floating Ask-AI overlay for text selections (mirrors the image panel UX).
  let textAskOpen = $state(false);
  let textAskPrompt = $state('');
  let textAskVisible = $state(false);
  let textAskPos = $state({ top: 0, left: 0, below: false });
  let textAskSelectedMd = $state('');
  let textAskPreview = $state('');

  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  td.use(gfm);
  td.keep(['u']); // markdown has no underline → preserve <u> verbatim

  const mdToHtml = (md: string) => marked.parse(md, { gfm: true, async: false }) as string;

  export function getMarkdown(): string {
    return editor ? td.turndown(editor.getHTML()) : initialMarkdown;
  }
  export function setMarkdown(md: string) {
    editor?.commands.setContent(mdToHtml(md));
  }

  /** Stop ProseMirror from treating Ask-AI chrome clicks as image node selection. */
  function stopPmSelect(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function selectionMarkdown(ed: Editor): string | null {
    const { from, to, empty } = ed.state.selection;
    if (empty || to <= from) return null;
    const plain = ed.state.doc.textBetween(from, to, '\n').trim();
    if (!plain) return null;
    const slice = ed.state.doc.slice(from, to);
    const div = document.createElement('div');
    div.appendChild(DOMSerializer.fromSchema(ed.schema).serializeFragment(slice.content));
    const md = td.turndown(div.innerHTML).trim();
    return md || plain;
  }

  function closeTextAsk() {
    textAskOpen = false;
    textAskPrompt = '';
  }

  function hideTextAsk() {
    textAskVisible = false;
    closeTextAsk();
    textAskSelectedMd = '';
    textAskPreview = '';
  }

  function positionTextAsk(ed: Editor) {
    const { from, to, empty } = ed.state.selection;
    if (empty) { hideTextAsk(); return; }
    // Node selections (e.g. images) use their own overlay — skip.
    if ((ed.state.selection as { node?: unknown }).node) { hideTextAsk(); return; }

    const md = selectionMarkdown(ed);
    if (!md) { hideTextAsk(); return; }

    const start = ed.view.coordsAtPos(from);
    const end = ed.view.coordsAtPos(to);
    const midX = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
    const selTop = Math.min(start.top, end.top);
    const selBottom = Math.max(start.bottom, end.bottom);
    // Prefer above the selection; flip below when near the viewport top (toolbar / clip).
    const placeBelow = selTop < 72;

    textAskSelectedMd = md;
    textAskPreview = ed.state.doc.textBetween(from, to, ' ').trim().slice(0, 120);
    textAskPos = {
      top: placeBelow ? selBottom + 8 : selTop - 8,
      left: Math.min(Math.max(80, midX), window.innerWidth - 80),
      below: placeBelow
    };
    textAskVisible = true;
  }

  function toggleTextAskPanel() {
    if (textAskOpen) {
      closeTextAsk();
      return;
    }
    textAskOpen = true;
    queueMicrotask(() => {
      const ta = shellEl?.querySelector('.blog-sel-ask-ta') as HTMLTextAreaElement | null;
      ta?.focus();
    });
  }

  function submitTextAsk() {
    const prompt = textAskPrompt.trim();
    const selected = textAskSelectedMd.trim();
    if (!prompt || !selected) return;
    onAskAiText?.(selected, prompt);
    hideTextAsk();
  }

  function onTextAskKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTextAsk(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeTextAsk(); }
  }

  function askAiImageExtension() {
    return Image.extend({
      name: 'image',
      addNodeView() {
        return ({ node }) => {
          let currentSrc = String(node.attrs.src ?? '');
          const wrap = document.createElement('div');
          wrap.className = 'blog-img-ask';
          wrap.setAttribute('data-drag-handle', '');

          const img = document.createElement('img');
          img.src = currentSrc;
          img.alt = String(node.attrs.alt ?? '');
          if (node.attrs.title) img.title = String(node.attrs.title);

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'blog-img-ask-btn';
          btn.textContent = 'Chiedi alle AI';
          btn.setAttribute('contenteditable', 'false');

          const panel = document.createElement('div');
          panel.className = 'blog-img-ask-panel';
          panel.hidden = true;
          panel.setAttribute('contenteditable', 'false');

          const ta = document.createElement('textarea');
          ta.rows = 2;
          ta.placeholder = 'Come vuoi modificare questa immagine?';
          ta.className = 'blog-img-ask-ta';

          const send = document.createElement('button');
          send.type = 'button';
          send.className = 'blog-img-ask-send';
          send.textContent = 'Invia alla chat';

          panel.append(ta, send);
          wrap.append(img, btn, panel);

          const closePanel = () => { panel.hidden = true; };
          const openPanel = () => {
            panel.hidden = false;
            queueMicrotask(() => ta.focus());
          };

          // Prevent TipTap NodeSelection when interacting with Ask-AI chrome
          // (without this, mousedown on the textarea bubbles to the image wrap).
          for (const el of [btn, panel, ta, send]) {
            el.addEventListener('mousedown', stopPmSelect);
            el.addEventListener('pointerdown', stopPmSelect);
          }
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (panel.hidden) openPanel(); else closePanel();
          });
          send.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const text = ta.value.trim();
            if (!text || !currentSrc) return;
            onAskAiImage?.(currentSrc, text);
            ta.value = '';
            closePanel();
          });
          panel.addEventListener('click', (e) => e.stopPropagation());
          ta.addEventListener('click', (e) => e.stopPropagation());
          ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send.click();
            } else if (e.key === 'Escape') {
              closePanel();
            }
          });

          return {
            dom: wrap,
            // TipTap selects the node via the outer wrap; ignore interactive chrome.
            ignoreMutation: (m) => m.type === 'selection' ? false : !wrap.contains(m.target as Node),
            selectNode: () => wrap.classList.add('ProseMirror-selectednode'),
            deselectNode: () => wrap.classList.remove('ProseMirror-selectednode'),
            update(updatedNode) {
              if (updatedNode.type.name !== 'image') return false;
              currentSrc = String(updatedNode.attrs.src ?? '');
              img.src = currentSrc;
              img.alt = String(updatedNode.attrs.alt ?? '');
              return true;
            },
            destroy() { /* no-op */ }
          };
        };
      }
    });
  }

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
        askAiImageExtension(),
        TableKit.configure({ table: { resizable: true } })
      ],
      content: mdToHtml(initialMarkdown),
      onUpdate: () => onChange?.(),
      onSelectionUpdate: ({ editor: ed }) => {
        sel++;
        // While the Ask-AI panel is open, keep it (focusing the textarea may clear the DOM selection).
        if (textAskOpen) return;
        positionTextAsk(ed);
      },
      onTransaction: () => { sel++; }
    });

    // Reposition after mouseup so coords settle after drag-select.
    const onUp = () => { if (editor && !textAskOpen) positionTextAsk(editor); };
    const onScroll = () => {
      if (!editor || !textAskVisible || textAskOpen) return;
      positionTextAsk(editor);
    };
    const onDocDown = (e: MouseEvent) => {
      if (!textAskVisible) return;
      const t = e.target as Node | null;
      if (t && shellEl?.querySelector('.blog-sel-ask')?.contains(t)) return;
      hideTextAsk();
    };
    element.addEventListener('mouseup', onUp);
    element.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mousedown', onDocDown, true);
    return () => {
      element.removeEventListener('mouseup', onUp);
      element.removeEventListener('scroll', onScroll);
      document.removeEventListener('mousedown', onDocDown, true);
    };
  });
  onDestroy(() => editor?.destroy());

  const isActive = (name: string, attrs?: Record<string, unknown>) => { void sel; return editor?.isActive(name, attrs) ?? false; };
  const can = (fn: 'undo' | 'redo') => { void sel; return editor?.can()[fn]() ?? false; };

  function addLink() {
    const prev = editor?.getAttributes('link').href ?? '';
    const url = window.prompt('URL del link:', prev);
    if (url === null) return;
    if (url === '') { editor?.chain().focus().unsetLink().run(); return; }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }
  async function addImage() {
    if (!onImageUpload) return;
    const url = await onImageUpload();
    if (url) editor?.chain().focus().setImage({ src: url }).run();
  }
</script>

<div class="editor-shell" bind:this={shellEl}>
  <div class="toolbar">
    <button type="button" class="tb" onclick={() => editor?.chain().focus().undo().run()} disabled={!can('undo')} title="Annulla (⌘Z)">↶</button>
    <button type="button" class="tb" onclick={() => editor?.chain().focus().redo().run()} disabled={!can('redo')} title="Ripeti (⌘⇧Z)">↷</button>
    <span class="sep"></span>
    <button type="button" class="tb" class:on={isActive('bold')} onclick={() => editor?.chain().focus().toggleBold().run()} title="Grassetto"><b>B</b></button>
    <button type="button" class="tb" class:on={isActive('italic')} onclick={() => editor?.chain().focus().toggleItalic().run()} title="Corsivo"><i>I</i></button>
    <button type="button" class="tb" class:on={isActive('underline')} onclick={() => editor?.chain().focus().toggleUnderline().run()} title="Sottolineato"><u>U</u></button>
    <span class="sep"></span>
    <button type="button" class="tb" class:on={isActive('heading', { level: 2 })} onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} title="Titolo">H2</button>
    <button type="button" class="tb" class:on={isActive('heading', { level: 3 })} onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} title="Sottotitolo">H3</button>
    <span class="sep"></span>
    <button type="button" class="tb" class:on={isActive('bulletList')} onclick={() => editor?.chain().focus().toggleBulletList().run()} title="Elenco puntato">• Lista</button>
    <button type="button" class="tb" class:on={isActive('orderedList')} onclick={() => editor?.chain().focus().toggleOrderedList().run()} title="Elenco numerato">1. Lista</button>
    <button type="button" class="tb" class:on={isActive('blockquote')} onclick={() => editor?.chain().focus().toggleBlockquote().run()} title="Citazione">❝</button>
    <span class="sep"></span>
    <button type="button" class="tb" class:on={isActive('code')} onclick={() => editor?.chain().focus().toggleCode().run()} title="Codice inline">‹›</button>
    <button type="button" class="tb" class:on={isActive('codeBlock')} onclick={() => editor?.chain().focus().toggleCodeBlock().run()} title="Blocco di codice">Code</button>
    <button type="button" class="tb" onclick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()} title="Tabella">▦</button>
    <button type="button" class="tb" class:on={isActive('link')} onclick={addLink} title="Link">🔗</button>
    <button type="button" class="tb" onclick={addImage} title="Immagine">🖼</button>
  </div>
  <div class="surface" bind:this={element}></div>

  {#if textAskVisible}
    <div
      class="blog-sel-ask"
      class:below={textAskPos.below}
      style="top: {textAskPos.top}px; left: {textAskPos.left}px;"
      onmousedown={stopPmSelect}
      onpointerdown={stopPmSelect}
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <button
        type="button"
        class="blog-sel-ask-btn"
        onmousedown={stopPmSelect}
        onpointerdown={stopPmSelect}
        onclick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTextAskPanel(); }}
      >Chiedi alle AI</button>
      {#if textAskOpen}
        <div
          class="blog-sel-ask-panel"
          onmousedown={stopPmSelect}
          onpointerdown={stopPmSelect}
          onclick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {#if textAskPreview}
            <p class="blog-sel-ask-preview">“{textAskPreview}{textAskPreview.length >= 120 ? '…' : ''}”</p>
          {/if}
          <textarea
            class="blog-sel-ask-ta"
            rows="2"
            placeholder="Come vuoi modificare questo testo?"
            bind:value={textAskPrompt}
            onmousedown={stopPmSelect}
            onpointerdown={stopPmSelect}
            onclick={(e) => e.stopPropagation()}
            onkeydown={onTextAskKey}
          ></textarea>
          <button
            type="button"
            class="blog-sel-ask-send"
            onmousedown={stopPmSelect}
            onpointerdown={stopPmSelect}
            onclick={(e) => { e.preventDefault(); e.stopPropagation(); submitTextAsk(); }}
            disabled={!textAskPrompt.trim()}
          >Invia alla chat</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editor-shell {
    position: relative;
    display: flex; flex-direction: column; min-height: 0; min-width: 0; width: 100%;
    border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--paper);
  }
  .toolbar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 3px; padding: 8px;
    border-bottom: 1px solid var(--line); background: var(--paper-2); flex-shrink: 0;
    position: sticky; top: 0; z-index: 3; max-width: 100%; box-sizing: border-box;
  }
  .tb {
    font-size: 13px; font-weight: 600; min-width: 30px; padding: 6px 9px; border-radius: 8px;
    border: 1px solid transparent; background: transparent; color: var(--ink-soft); cursor: pointer;
  }
  .tb:hover { background: var(--paper); border-color: var(--line); color: var(--ink); }
  .tb.on { background: var(--accent, #7c5cff); color: #fff; }
  .tb:disabled { opacity: 0.4; cursor: default; }
  .sep { width: 1px; height: 18px; background: var(--line); margin: 0 3px; }

  .surface {
    flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: auto;
    padding: 28px 34px; box-sizing: border-box; -webkit-overflow-scrolling: touch;
  }
  .surface :global(.ProseMirror) {
    outline: none; font-size: 18px; line-height: 1.8; color: var(--ink);
    max-width: 760px; width: 100%; margin: 0 auto; min-width: 0;
    word-wrap: break-word; overflow-wrap: anywhere;
  }
  .surface :global(.ProseMirror:focus) { outline: none; }
  .surface :global(h1) { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 14px; }
  .surface :global(h2) { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 36px 0 12px; }
  .surface :global(h3) { font-size: 21px; font-weight: 700; margin: 26px 0 10px; }
  .surface :global(p) { margin: 0 0 18px; }
  .surface :global(ul), .surface :global(ol) { margin: 0 0 18px; padding-left: 26px; }
  .surface :global(li) { margin: 0 0 6px; }
  .surface :global(blockquote) { margin: 0 0 18px; padding-left: 18px; border-left: 3px solid var(--line); color: var(--ink-soft); }
  .surface :global(a) { color: var(--accent, #7c5cff); text-decoration: underline; word-break: break-word; }
  .surface :global(code) { background: var(--paper-2); padding: 2px 6px; border-radius: 5px; font-size: 0.9em; word-break: break-word; }
  .surface :global(pre) { background: var(--paper-2); padding: 14px; border-radius: 10px; overflow-x: auto; margin: 0 0 18px; max-width: 100%; }
  .surface :global(pre code) { background: none; padding: 0; }
  .surface :global(img) { max-width: 100%; height: auto; border-radius: 10px; display: block; }
  .surface :global(.tableWrapper),
  .surface :global([data-type="table"]) {
    max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 0 18px;
  }
  .surface :global(table) { border-collapse: collapse; width: 100%; max-width: 100%; margin: 0 0 18px; }
  .surface :global(.tableWrapper table),
  .surface :global([data-type="table"] table) { margin: 0; }
  .surface :global(th), .surface :global(td) { border: 1px solid var(--line); padding: 8px 12px; text-align: left; vertical-align: top; }
  .surface :global(th) { background: var(--paper-2); font-weight: 600; }
  .surface :global(.ProseMirror-selectednode) { outline: 2px solid var(--accent, #7c5cff); }

  /* Ask-AI affordance on body images */
  .surface :global(.blog-img-ask) {
    position: relative; display: block; margin: 0 0 18px; max-width: 100%;
    border-radius: 10px; overflow: visible;
  }
  .surface :global(.blog-img-ask img) { margin: 0; width: 100%; }
  .surface :global(.blog-img-ask-btn) {
    position: absolute; right: 10px; bottom: 10px; z-index: 2;
    font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.35); cursor: pointer;
    background: rgba(18, 18, 18, 0.72); color: #fff; backdrop-filter: blur(6px);
    font-family: inherit; line-height: 1.2; opacity: 0; transition: opacity 0.15s ease;
  }
  .surface :global(.blog-img-ask:hover .blog-img-ask-btn),
  .surface :global(.blog-img-ask:focus-within .blog-img-ask-btn),
  .surface :global(.blog-img-ask-btn:focus) { opacity: 1; }
  .surface :global(.blog-img-ask-panel) {
    position: absolute; right: 10px; bottom: 44px; z-index: 3;
    width: min(280px, calc(100% - 20px));
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px; border-radius: 10px;
    background: var(--paper); border: 1px solid var(--line);
    box-shadow: 0 10px 28px rgba(0,0,0,0.14);
  }
  .surface :global(.blog-img-ask-panel[hidden]) { display: none !important; }
  .surface :global(.blog-img-ask-ta) {
    width: 100%; resize: none; box-sizing: border-box;
    font-size: 13px; line-height: 1.4; font-family: inherit;
    padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--paper-2); color: var(--ink); outline: none;
  }
  .surface :global(.blog-img-ask-send) {
    align-self: flex-end; font-size: 12px; font-weight: 600; font-family: inherit;
    padding: 7px 12px; border-radius: 8px; border: none; cursor: pointer;
    background: var(--accent, #7c5cff); color: #fff;
  }

  /* Ask-AI affordance on text selections — same look as image panel */
  .blog-sel-ask {
    position: fixed; z-index: 40;
    transform: translate(-50%, -100%);
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    pointer-events: auto;
  }
  .blog-sel-ask.below { transform: translate(-50%, 0); }
  .blog-sel-ask-btn {
    font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.35); cursor: pointer;
    background: rgba(18, 18, 18, 0.72); color: #fff; backdrop-filter: blur(6px);
    font-family: inherit; line-height: 1.2; white-space: nowrap;
  }
  .blog-sel-ask-btn:hover { background: rgba(18, 18, 18, 0.88); }
  .blog-sel-ask-panel {
    width: min(280px, 70vw);
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px; border-radius: 10px;
    background: var(--paper); border: 1px solid var(--line);
    box-shadow: 0 10px 28px rgba(0,0,0,0.14);
  }
  .blog-sel-ask-preview {
    margin: 0; font-size: 12px; line-height: 1.4; color: var(--ink-faint);
    max-height: 3.2em; overflow: hidden;
  }
  .blog-sel-ask-ta {
    width: 100%; resize: none; box-sizing: border-box;
    font-size: 13px; line-height: 1.4; font-family: inherit;
    padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--paper-2); color: var(--ink); outline: none;
  }
  .blog-sel-ask-send {
    align-self: flex-end; font-size: 12px; font-weight: 600; font-family: inherit;
    padding: 7px 12px; border-radius: 8px; border: none; cursor: pointer;
    background: var(--accent, #7c5cff); color: #fff;
  }
  .blog-sel-ask-send:disabled { opacity: 0.5; cursor: default; }

  @container workbench (max-width: 640px) {
    .surface { padding: 16px 14px; }
    .surface :global(.ProseMirror) { font-size: 16px; line-height: 1.7; }
    .surface :global(h1) { font-size: 26px; }
    .surface :global(h2) { font-size: 22px; margin: 28px 0 10px; }
    .surface :global(h3) { font-size: 18px; margin: 22px 0 8px; }
    .surface :global(ul), .surface :global(ol) { padding-left: 20px; }
    .tb { padding: 6px 7px; }
    .surface :global(.blog-img-ask-btn) { opacity: 1; }
  }
</style>
