<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import type { DepsStatus } from "$lib/types";

  interface Props {
    deps: DepsStatus;
    onRecheck: () => void;
  }

  let { deps, onRecheck }: Props = $props();
</script>

<div class="banner" role="alert">
  <div class="msg">
    <TriangleAlert size={18} strokeWidth={2} class="warn-icon" aria-hidden="true" />
    <div class="text">
      <strong>ffmpeg not found</strong>
      <span class="muted">
        Install with
        <code>
          <Terminal size={12} strokeWidth={2} class="inline-icon" aria-hidden="true" />
          brew install ffmpeg
        </code>
        {#if deps.ffmpeg_path}
          · path: {deps.ffmpeg_path}
        {/if}
      </span>
      <span class="tool" class:ok={deps.ffmpeg} class:bad={!deps.ffmpeg}>
        {#if deps.ffmpeg}
          <Check size={14} strokeWidth={2.25} aria-hidden="true" />
        {:else}
          <X size={14} strokeWidth={2.25} aria-hidden="true" />
        {/if}
        <span>ffmpeg</span>
      </span>
    </div>
  </div>
  <button type="button" class="ghost" onclick={onRecheck}>
    <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
    <span>Recheck</span>
  </button>
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
    align-items: flex-start;
    gap: 0.55rem;
    min-width: 0;
  }

  .msg :global(.warn-icon) {
    flex-shrink: 0;
    color: var(--danger);
    margin-top: 0.1rem;
  }

  .text {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.75rem;
    min-width: 0;
  }

  .text strong {
    color: var(--danger);
  }

  .muted {
    color: var(--muted);
    font-size: 0.9rem;
  }

  code {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    background: var(--bg);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }

  code :global(.inline-icon) {
    flex-shrink: 0;
    opacity: 0.8;
  }

  .tool {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.85rem;
  }

  .tool.ok {
    color: var(--ok);
  }

  .tool.bad {
    color: var(--danger);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
</style>
