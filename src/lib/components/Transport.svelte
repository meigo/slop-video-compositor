<script lang="ts">
  import { formatTimestamp } from "$lib/time";

  interface Props {
    playhead: number;
    duration: number;
    playing: boolean;
    onTogglePlay: () => void;
    onStop: () => void;
  }

  let { playhead, duration, playing, onTogglePlay, onStop }: Props = $props();
</script>

<div class="transport">
  <button type="button" class="ghost" onclick={onTogglePlay}>
    {playing ? "Pause" : "Play"}
  </button>
  <button type="button" class="ghost" onclick={onStop}>Stop</button>
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
