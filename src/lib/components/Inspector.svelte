<script lang="ts">
  import Film from "@lucide/svelte/icons/film";
  import Link2 from "@lucide/svelte/icons/link-2";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { clipColorSolid } from "$lib/clipColor";
  import { formatTimestamp } from "$lib/time";
  import type { Clip, SourceMeta } from "$lib/types";

  interface Props {
    clip: Clip | null;
    meta: SourceMeta | null;
    basename: (path: string) => string;
    onUpdate: (patch: {
      sourceIn?: number;
      sourceOut?: number;
      timelineStart?: number;
      transform?: { scale?: number; x?: number; y?: number };
    }) => void;
    onResetTransform: () => void;
    onRelink: () => void;
  }

  let { clip, meta, basename, onUpdate, onResetTransform, onRelink }: Props = $props();

  const ICON = 16;

  function num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
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
        <span>{basename(clip.sourcePath)}</span>
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
      <button type="button" class="ghost" onclick={onRelink}>
        <Link2 size={ICON} strokeWidth={2} aria-hidden="true" />
        <span>Relink…</span>
      </button>
    </div>

    <div class="grid">
      <label>
        <span class="label">Source in</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={clip.sourceIn}
          onchange={(e) => onUpdate({ sourceIn: num(e) })}
        />
      </label>
      <label>
        <span class="label">Source out</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={clip.sourceOut}
          onchange={(e) => onUpdate({ sourceOut: num(e) })}
        />
      </label>
      <label>
        <span class="label">Timeline start</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={clip.timelineStart}
          onchange={(e) => onUpdate({ timelineStart: num(e) })}
        />
      </label>
      <div class="ro">
        <span class="label">Duration</span>
        <span class="value mono">{formatTimestamp(clip.sourceOut - clip.sourceIn)}</span>
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
          value={clip.transform.scale}
          onchange={(e) => onUpdate({ transform: { scale: num(e) } })}
        />
      </label>
      <label>
        <span class="label">X</span>
        <input
          type="number"
          step="1"
          value={clip.transform.x}
          onchange={(e) => onUpdate({ transform: { x: num(e) } })}
        />
      </label>
      <label>
        <span class="label">Y</span>
        <input
          type="number"
          step="1"
          value={clip.transform.y}
          onchange={(e) => onUpdate({ transform: { y: num(e) } })}
        />
      </label>
    </div>
    <button type="button" class="ghost reset" onclick={onResetTransform}>
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
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
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

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
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
