<script lang="ts">
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import Square from "@lucide/svelte/icons/square";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { formatTimestamp } from "$lib/time";

  interface Props {
    playhead: number;
    duration: number;
    playing: boolean;
    muted: boolean;
    onTogglePlay: () => void;
    onStop: () => void;
    onToggleMute: () => void;
  }

  let {
    playhead,
    duration,
    playing,
    muted,
    onTogglePlay,
    onStop,
    onToggleMute,
  }: Props = $props();

  const ICON = 16;
</script>

<div class="transport">
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
  <button type="button" class="ghost" onclick={onStop} title="Stop" aria-label="Stop">
    <Square size={15} strokeWidth={2.25} aria-hidden="true" />
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
