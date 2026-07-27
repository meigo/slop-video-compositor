<script lang="ts">
  import type { DepsStatus } from "$lib/types";

  interface Props {
    deps: DepsStatus;
    onRecheck: () => void;
  }

  let { deps, onRecheck }: Props = $props();
</script>

<div class="banner" role="alert">
  <div class="msg">
    <strong>ffmpeg not found</strong>
    <span class="muted">
      Install with <code>brew install ffmpeg</code>
      {#if deps.ffmpeg_path}
        · path: {deps.ffmpeg_path}
      {/if}
    </span>
  </div>
  <button type="button" class="ghost" onclick={onRecheck}>Recheck</button>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.85rem;
    background: rgba(240, 113, 120, 0.12);
    border: 1px solid rgba(240, 113, 120, 0.35);
    border-radius: 8px;
    color: var(--text);
  }

  .msg {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 0.75rem;
    min-width: 0;
  }

  .msg strong {
    color: var(--danger);
  }

  .muted {
    color: var(--muted);
    font-size: 0.9rem;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    background: var(--bg);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
</style>
