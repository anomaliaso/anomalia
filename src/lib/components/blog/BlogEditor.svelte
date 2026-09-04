<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { StarterKit } from '@tiptap/starter-kit';
  import { Image } from '@tiptap/extension-image';
  import { TableKit } from '@tiptap/extension-table';
  import { marked } from 'marked';
  import TurndownService from 'turndown';
  // @ts-expect-error turndown-plugin-gfm ships no type declarations
  import { gfm } from 'turndown-plugin-gfm';

  // WYSIWYG article editor. Content is edited on the rendered text (TipTap). Markdown stays the
  // source of truth: we load md→HTML (marked) and serialize back HTML→md (turndown) on read.
  let { initialMarkdown = '', onChange, onImageUpload }: {
    initialMarkdown?: string;
    onChange?: () => void;
    onImageUpload?: () => Promise<string | null>;
  } = $props();

  let element: HTMLDivElement;
  let editor = $state<Editor | null>(null);
  let sel = $state(0); // bumps on every transaction so toolbar active-states stay reactive

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

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
        Image,
        TableKit.configure({ table: { resizable: true } })
      ],
      content: mdToHtml(initialMarkdown),
      onUpdate: () => onChange?.(),
      onSelectionUpdate: () => { sel++; },
      onTransaction: () => { sel++; }
    });
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

<div class="editor-shell">
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


  @container workbench (max-width: 640px) {
    .surface { padding: 16px 14px; }
    .surface :global(.ProseMirror) { font-size: 16px; line-height: 1.7; }
    .surface :global(h1) { font-size: 26px; }
    .surface :global(h2) { font-size: 22px; margin: 28px 0 10px; }
    .surface :global(h3) { font-size: 18px; margin: 22px 0 8px; }
    .surface :global(ul), .surface :global(ol) { padding-left: 20px; }
    .tb { padding: 6px 7px; }
  }
</style>
