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

<div class="transport">
  {#if onHome}
    <button
      type="button"
      class="ghost"
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
      class="ghost"
      onclick={onPrevCut}
      title="Previous cut or marker ([)"
      aria-label="Previous cut or marker"
    >
      <ChevronLeft size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  <button
    type="button"
    class="ghost"
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
  <button type="button" class="ghost" onclick={onStop} title="Stop and return to start" aria-label="Stop">
    <Square size={15} strokeWidth={2.25} aria-hidden="true" />
  </button>
  {#if onNextCut}
    <button
      type="button"
      class="ghost"
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
      class="ghost"
      onclick={onEnd}
      title="Go to end (End)"
      aria-label="Go to end"
    >
      <SkipForward size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  <button
    type="button"
    class="ghost"
    class:on={loop}
    onclick={onToggleLoop}
    title={loop ? "Loop playback: on (L)" : "Loop playback: off (L)"}
    aria-label="Loop playback"
    aria-pressed={loop}
  >
    <Repeat size={ICON} strokeWidth={2} aria-hidden="true" />
  </button>
  <button
    type="button"
    class="ghost"
    onclick={onToggleMute}
    title={muted ? "Unmute preview" : "Mute preview"}
    aria-label={muted ? "Unmute" : "Mute"}
    aria-pressed={muted}
  >
    {#if muted}
      <VolumeX size={ICON} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Volume2 size={ICON} strokeWidth={2} aria-hidden="true" />
    {/if}
  </button>
  <span class="time" aria-label="Playhead time">
    {formatTimestamp(playhead)}
    <span class="sep">/</span>
    {formatTimestamp(duration)}
  </span>
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.15rem;
  }

  .transport :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.1rem;
    padding: 0.4em 0.55em;
  }

  /* Ghost buttons are already --text; an active toggle reads as accent. */
  .transport :global(button.on) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .time {
    margin-left: 0.5rem;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9rem;
    color: var(--muted);
  }

  .sep {
    opacity: 0.5;
    margin: 0 0.2rem;
  }
</style>
