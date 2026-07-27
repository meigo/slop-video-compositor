<script lang="ts">
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
      <span class="value mono" title={clip.sourcePath}>{basename(clip.sourcePath)}</span>
      {#if !meta}
        <span class="warn">Missing media — relink to restore</span>
      {:else}
        <span class="meta muted">
          {meta.width}×{meta.height}
          · {formatTimestamp(meta.duration)}
          · {meta.hasAudio ? "audio" : "no audio"}
        </span>
      {/if}
      <button type="button" class="ghost" onclick={onRelink}>Relink…</button>
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
    <button type="button" class="ghost reset" onclick={onResetTransform}>Reset transform</button>
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

  h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
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
    color: var(--warn);
    font-size: 0.8rem;
  }

  .meta {
    line-height: 1.3;
  }

  input {
    width: 100%;
  }

  .reset {
    align-self: flex-start;
    margin-top: 0.15rem;
  }
</style>
