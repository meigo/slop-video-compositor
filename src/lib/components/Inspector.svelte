<script lang="ts">
  import Film from "@lucide/svelte/icons/film";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Link2 from "@lucide/svelte/icons/link-2";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { clipColorSolid } from "$lib/clipColor";
  import { formatTimestamp, roundTo } from "$lib/time";
  import type { Clip, SourceMeta } from "$lib/types";

  interface Props {
    clip: Clip | null;
    meta: SourceMeta | null;
    basename: (path: string) => string;
    truncateMiddle: (name: string, maxLen?: number) => string;
    onUpdate: (patch: {
      sourceIn?: number;
      sourceOut?: number;
      timelineStart?: number;
      transform?: { scale?: number; x?: number; y?: number };
    }) => void;
    onResetTransform: () => void;
    onRelink: () => void;
    onReveal: () => void;
  }

  let {
    clip,
    meta,
    basename,
    truncateMiddle,
    onUpdate,
    onResetTransform,
    onRelink,
    onReveal,
  }: Props = $props();

  const ICON = 16;

  function num(e: Event, places = 2): number {
    return roundTo(Number((e.target as HTMLInputElement).value), places);
  }
</script>

<aside class="inspector" aria-label="Inspector">
  <h2>Inspector</h2>

  {#if !clip}
    <p class="empty">Select a clip to edit</p>
  {:else}
    <div class="field path">
      <span class="label">Source</span>
      <span class="value mono source-row" title={clip.sourcePath}>
        <span
          class="color-swatch"
          style:background={clipColorSolid(clip.sourcePath)}
          title="Timeline color for this source file"
          aria-hidden="true"
        ></span>
        <Film size={14} strokeWidth={2} class="source-icon" aria-hidden="true" />
        <span class="source-name">{truncateMiddle(basename(clip.sourcePath), 40)}</span>
      </span>
      {#if !meta}
        <span class="warn">
          <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
          Missing media — relink to restore
        </span>
      {:else}
        <span class="meta muted">
          {meta.width}×{meta.height}
          · {formatTimestamp(meta.duration)}
          ·
          {#if meta.hasAudio}
            <Volume2 size={13} strokeWidth={2} class="inline-icon" aria-hidden="true" />
            audio
          {:else}
            <VolumeX size={13} strokeWidth={2} class="inline-icon" aria-hidden="true" />
            no audio
          {/if}
        </span>
      {/if}
      <div class="btn-row">
        <button
          type="button"
          class="ghost"
          onclick={onRelink}
          title="Choose a new file for this clip’s source path"
        >
          <Link2 size={ICON} strokeWidth={2} aria-hidden="true" />
          <span>Relink…</span>
        </button>
        <button type="button" class="ghost" onclick={onReveal} title="Reveal source in Finder">
          <FolderOpen size={ICON} strokeWidth={2} aria-hidden="true" />
          <span>Reveal</span>
        </button>
      </div>
    </div>

    <div class="grid">
      <label>
        <span class="label">Source in</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={roundTo(clip.sourceIn, 2)}
          onchange={(e) => onUpdate({ sourceIn: num(e, 2) })}
        />
      </label>
      <label>
        <span class="label">Source out</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={roundTo(clip.sourceOut, 2)}
          onchange={(e) => onUpdate({ sourceOut: num(e, 2) })}
        />
      </label>
      <label>
        <span class="label">Timeline start</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={roundTo(clip.timelineStart, 2)}
          onchange={(e) => onUpdate({ timelineStart: num(e, 2) })}
        />
      </label>
      <div class="ro">
        <span class="label">Duration</span>
        <span class="value mono duration-value" title="Clip duration (read-only)">
          {formatTimestamp(clip.sourceOut - clip.sourceIn)}
          <span class="secs">({roundTo(clip.sourceOut - clip.sourceIn, 2)}s)</span>
        </span>
      </div>
    </div>

    <h3>Transform</h3>
    <div class="grid">
      <label>
        <span class="label">Scale</span>
        <input
          type="number"
          step="0.05"
          min="0.05"
          max="8"
          value={roundTo(clip.transform.scale, 2)}
          onchange={(e) => onUpdate({ transform: { scale: num(e, 2) } })}
        />
      </label>
      <label>
        <span class="label">X</span>
        <input
          type="number"
          step="1"
          value={roundTo(clip.transform.x, 0)}
          onchange={(e) => onUpdate({ transform: { x: num(e, 0) } })}
        />
      </label>
      <label>
        <span class="label">Y</span>
        <input
          type="number"
          step="1"
          value={roundTo(clip.transform.y, 0)}
          onchange={(e) => onUpdate({ transform: { y: num(e, 0) } })}
        />
      </label>
    </div>
    <button
      type="button"
      class="ghost reset"
      onclick={onResetTransform}
      title="Reset scale and position to default"
    >
      <RotateCcw size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Reset transform</span>
    </button>
  {/if}
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.75rem 0.85rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    min-height: 0;
    overflow: auto;
  }

  .inspector :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .source-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    max-width: 100%;
  }

  .source-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .color-swatch {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.25);
  }

  .source-row :global(.source-icon) {
    flex-shrink: 0;
    opacity: 0.75;
  }

  h3 {
    margin: 0.35rem 0 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .empty {
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .btn-row :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  label,
  .ro {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .label {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .value {
    font-size: 0.9rem;
    color: var(--text);
    word-break: break-all;
  }

  /* Match adjacent number inputs (height + type size) */
  .duration-value {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.1rem;
    padding: 0.4em 0.55em;
    box-sizing: border-box;
    font-size: 1em;
    line-height: 1.25;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    word-break: normal;
  }

  .duration-value .secs {
    color: var(--muted);
    font-size: inherit;
    font-weight: 400;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .muted {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .warn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--warn);
    font-size: 0.8rem;
  }

  .meta {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.25rem;
    line-height: 1.3;
  }

  .meta :global(.inline-icon) {
    flex-shrink: 0;
    opacity: 0.85;
  }

  input {
    width: 100%;
  }

  .reset {
    align-self: flex-start;
    margin-top: 0.15rem;
  }
</style>
