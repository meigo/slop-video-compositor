<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import type { DepsStatus } from "$lib/types";
  import { BORDERED_BTN } from "$lib/ui";

  interface Props {
    deps: DepsStatus;
    onRecheck: () => void;
  }

  let { deps, onRecheck }: Props = $props();
</script>

<div
  class="flex shrink-0 items-center gap-2 border-b border-line bg-danger/25 px-3 py-1 text-xs"
  role="alert"
>
  <TriangleAlert size={16} strokeWidth={2} class="shrink-0 text-danger" aria-hidden="true" />
  <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
    <strong class="font-medium text-text">ffmpeg not found</strong>
    <span class="text-muted">
      Install with
      <code class="inline-flex items-center gap-1 rounded bg-ground px-1 tabular-nums">
        <Terminal size={12} strokeWidth={2} class="opacity-80" aria-hidden="true" />
        brew install ffmpeg
      </code>
      {#if deps.ffmpeg_path}
        · path: {deps.ffmpeg_path}
      {/if}
    </span>
    <span class="inline-flex items-center gap-1 {deps.ffmpeg ? 'text-ok' : 'text-danger'}">
      {#if deps.ffmpeg}
        <Check size={14} strokeWidth={2.25} aria-hidden="true" />
      {:else}
        <X size={14} strokeWidth={2.25} aria-hidden="true" />
      {/if}
      <span>ffmpeg</span>
    </span>
  </div>
  <button
    type="button"
    class={BORDERED_BTN}
    onclick={onRecheck}
    title="Check PATH for ffmpeg again"
  >
    <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
    <span>Recheck</span>
  </button>
</div>
