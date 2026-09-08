<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import Repeat from "@lucide/svelte/icons/repeat";
  import SkipBack from "@lucide/svelte/icons/skip-back";
  import SkipForward from "@lucide/svelte/icons/skip-forward";
  import Square from "@lucide/svelte/icons/square";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { formatTimestamp } from "$lib/time";
  import { BTN, toggleIconClass } from "$lib/ui";

  interface Props {
    playhead: number;
    duration: number;
    playing: boolean;
    muted: boolean;
    loop: boolean;
    onTogglePlay: () => void;
    onStop: () => void;
    onToggleLoop: () => void;
    onToggleMute: () => void;
    onHome?: () => void;
    onEnd?: () => void;
    onPrevCut?: () => void;
    onNextCut?: () => void;
  }

  let {
    playhead,
    duration,
    playing,
    muted,
    loop,
    onTogglePlay,
    onStop,
    onToggleLoop,
    onToggleMute,
    onHome,
    onEnd,
    onPrevCut,
    onNextCut,
  }: Props = $props();

  const ICON = 16;
</script>

<!-- Hand-typed near-copy of STRIP: deliberately drops STRIP's `text-[11px] text-muted`, or the
     `text-sm` time readout inside this bar would inherit muted grey. -->
<div class="flex h-7 shrink-0 items-center gap-1 border-t border-line bg-panel px-2">
  {#if onHome}
    <button
      type="button"
      class={BTN}
      onclick={onHome}
      title="Go to start (Home)"
      aria-label="Go to start"
    >
      <SkipBack size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  {#if onPrevCut}
    <button
      type="button"
      class={BTN}
      onclick={onPrevCut}
      title="Previous cut or marker ([)"
      aria-label="Previous cut or marker"
    >
      <ChevronLeft size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  <button
    type="button"
    class={BTN}
    onclick={onTogglePlay}
    title={playing ? "Pause (Space)" : "Play (Space)"}
    aria-label={playing ? "Pause" : "Play"}
  >
    {#if playing}
      <Pause size={ICON} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Play size={ICON} strokeWidth={2} aria-hidden="true" />
    {/if}
  </button>
  <button
    type="button"
    class={BTN}
    onclick={onStop}
    title="Stop and return to start"
    aria-label="Stop"
  >
    <Square size={ICON} strokeWidth={2} aria-hidden="true" />
  </button>
  {#if onNextCut}
    <button
      type="button"
      class={BTN}
      onclick={onNextCut}
      title="Next cut or marker (])"
      aria-label="Next cut or marker"
    >
      <ChevronRight size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  {#if onEnd}
    <button
      type="button"
      class={BTN}
      onclick={onEnd}
      title="Go to end (End)"
      aria-label="Go to end"
    >
      <SkipForward size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  <button
    type="button"
    class={toggleIconClass(loop)}
    onclick={onToggleLoop}
    title={loop ? "Loop playback: on (L)" : "Loop playback: off (L)"}
    aria-label="Loop playback"
    aria-pressed={loop}
  >
    <Repeat size={ICON} strokeWidth={2} aria-hidden="true" />
  </button>
  <!-- warn, not accent: preview mute is session-only and never reaches the export. -->
  <button
    type="button"
    class={toggleIconClass(muted, "bg-warn text-ground")}
    onclick={onToggleMute}
    title={muted ? "Unmute preview" : "Mute preview (preview only)"}
    aria-label={muted ? "Unmute" : "Mute"}
    aria-pressed={muted}
  >
    {#if muted}
      <VolumeX size={ICON} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Volume2 size={ICON} strokeWidth={2} aria-hidden="true" />
    {/if}
  </button>
  <span class="ml-2 w-28 text-sm tabular-nums" aria-label="Playhead time">
    {formatTimestamp(playhead)}<span class="text-muted"> / {formatTimestamp(duration)}</span>
  </span>
</div>
