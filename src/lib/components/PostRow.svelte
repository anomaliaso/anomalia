<script lang="ts">
  import PlatformGlyph from './PlatformGlyph.svelte';
  import { getPlatform } from './platform-meta';

  let { post }: {
    post: { platform: string; caption: string; time: string; status: string; thumbnail?: string }
  } = $props();

  const STATUS_MAP: Record<string, { cls: string; label: string }> = {
    scheduled: { cls: 'ok', label: 'Scheduled' },
    published: { cls: 'ok', label: 'Published' },
    pending: { cls: 'warn', label: 'Pending' },
    pending_user: { cls: 'warn', label: 'Pending' },
    failed: { cls: 'bad', label: 'Failed' },
    draft: { cls: 'muted', label: 'Draft' },
    canceled: { cls: 'muted', label: 'Canceled' },
  };
  const st = $derived(STATUS_MAP[post.status] ?? { cls: 'muted', label: post.status });
</script>

<div class="post-row">
  <div class="thumb" style={post.thumbnail ? `background-image:url(${post.thumbnail})` : `background:${getPlatform(post.platform).bg};`}></div>
  <div class="body">
    <div class="plat">
      <PlatformGlyph platform={post.platform} />
      {getPlatform(post.platform).label.toUpperCase()}
    </div>
    <div class="cap">{post.caption}</div>
    <div class="time">{post.time}</div>
  </div>
  <span class="state" class:ok={st.cls === 'ok'} class:bad={st.cls === 'bad'} class:muted={st.cls === 'muted'}>
    <span class="d"></span>{st.label}
  </span>
</div>

<style>
  .post-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line, #ececef); }
  .post-row:first-of-type { border-top: none; }
  .thumb { width: 52px; height: 52px; border-radius: 12px; flex: 0 0 auto;
    background-size: cover; background-position: center; background-repeat: no-repeat; }
  .body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .plat { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: var(--ink-faint); letter-spacing: .03em; }
  .cap { font-size: 13.5px; color: var(--ink); line-height: 1.35;
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .time { font-size: 12px; color: var(--ink-faint); }
  .state { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; flex: 0 0 auto; }
  .state .d { width: 7px; height: 7px; border-radius: 50%; }
  .state.ok { color: var(--accent); } .state.ok .d { background: var(--accent); }
  .state.bad { color: #c0392b; } .state.bad .d { background: #c0392b; }
  .state.muted { color: var(--ink-faint, #86868b); text-transform: capitalize; } .state.muted .d { background: var(--ink-faint, #86868b); }
</style>
