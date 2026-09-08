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
  import { BORDERED_BTN, FIELD, HEADING, STRIP, toggleClass } from "$lib/ui";

  /** label | field | unit — every field row in the panel sits in one grid container (the
   *  Transform heading and its divider are full-width children inside it), so the label and
   *  field columns line up across the whole panel, not just within a section. Written as a
   *  utility with underscores for the spaces; Tailwind 4 does generate arbitrary values that
   *  contain commas (verified in Task 2 for the shell grid). */
  const GRID = "grid-cols-[auto_minmax(0,1fr)_auto]";
  const LABEL = "text-right text-[11px] whitespace-nowrap text-muted";
  const UNIT = "w-4 text-[11px] text-muted";

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
      muted?: boolean;
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

  function num(e: Event, places = 2): number {
    return roundTo(Number((e.target as HTMLInputElement).value), places);
  }
</script>

<aside class="flex min-h-0 min-w-0 flex-col border-l border-line bg-panel" aria-label="Inspector">
  <div class="{STRIP} border-b">Inspector</div>

  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 text-xs">
    {#if !clip}
      <p class="text-xs text-muted">Select a clip to edit</p>
    {:else}
      <section class="flex flex-col gap-1.5">
        <h3 class={HEADING}>Source</h3>
        <div class="flex min-w-0 items-center gap-1.5" title={clip.sourcePath}>
          <span
            class="size-2.5 shrink-0 rounded-sm border border-line"
            style:background={clipColorSolid(clip.sourcePath)}
            title="Timeline color for this source file"
            aria-hidden="true"
          ></span>
          <Film size={14} strokeWidth={2} class="shrink-0 opacity-75" aria-hidden="true" />
          <span class="truncate text-text">{truncateMiddle(basename(clip.sourcePath), 40)}</span>
        </div>
        {#if !meta}
          <span class="inline-flex items-center gap-1 text-[11px] text-danger">
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
            Missing media — relink to restore
          </span>
        {:else}
          <span class="inline-flex items-center gap-1 text-[11px] text-muted tabular-nums">
            {#if meta.width > 0 && meta.height > 0}
              {meta.width}×{meta.height}
            {:else}
              audio only
            {/if}
            · {formatTimestamp(meta.duration)}
            ·
            {#if meta.hasAudio}
              <Volume2 size={13} strokeWidth={2} aria-hidden="true" />
              audio
            {:else}
              <VolumeX size={13} strokeWidth={2} aria-hidden="true" />
              no audio
            {/if}
          </span>
        {/if}
        <div class="flex flex-wrap gap-1">
          <button type="button" class={BORDERED_BTN} onclick={onRelink} title="Choose a new file for this clip’s source path">
            <Link2 size={14} strokeWidth={2} aria-hidden="true" />
            <span>Relink…</span>
          </button>
          <button type="button" class={BORDERED_BTN} onclick={onReveal} title="Reveal source in Finder">
            <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
            <span>Reveal</span>
          </button>
        </div>
      </section>

      <section class="grid items-center gap-2 border-t border-line pt-2 {GRID}">
        <label class="contents">
          <span class={LABEL}>Source in</span>
          <input
            class="{FIELD} w-full"
            type="number"
            step="0.01"
            min="0"
            value={roundTo(clip.sourceIn, 2)}
            onchange={(e) => onUpdate({ sourceIn: num(e, 2) })}
          />
          <span class={UNIT}>s</span>
        </label>
        <label class="contents">
          <span class={LABEL}>Source out</span>
          <input
            class="{FIELD} w-full"
            type="number"
            step="0.01"
            min="0"
            value={roundTo(clip.sourceOut, 2)}
            onchange={(e) => onUpdate({ sourceOut: num(e, 2) })}
          />
          <span class={UNIT}>s</span>
        </label>
        <label class="contents">
          <span class={LABEL}>Timeline start</span>
          <input
            class="{FIELD} w-full"
            type="number"
            step="0.01"
            min="0"
            value={roundTo(clip.timelineStart, 2)}
            onchange={(e) => onUpdate({ timelineStart: num(e, 2) })}
          />
          <span class={UNIT}>s</span>
        </label>
        <span class={LABEL}>Duration</span>
        <span
          class="flex h-6 w-full min-w-0 items-center justify-end gap-1 rounded bg-raised px-1 text-xs text-muted tabular-nums"
          title="Clip duration (read-only)"
        >
          {formatTimestamp(clip.sourceOut - clip.sourceIn)}
          <span>({roundTo(clip.sourceOut - clip.sourceIn, 2)}s)</span>
        </span>
        <span class={UNIT}></span>
        <span class={LABEL}>Audio</span>
        <button
          type="button"
          class="{toggleClass(clip.muted === true)} justify-self-start"
          aria-pressed={clip.muted === true}
          title={meta != null && !meta.hasAudio
            ? "Source has no audio (mute still silences if audio appears after relink)"
            : "Silence this clip in preview and export"}
          onclick={() => onUpdate({ muted: clip.muted !== true })}
        >
          {#if clip.muted}
            <VolumeX size={14} strokeWidth={2} aria-hidden="true" />
          {:else}
            <Volume2 size={14} strokeWidth={2} aria-hidden="true" />
          {/if}
          Mute
        </button>
        <span class={UNIT}></span>

        <div class="col-span-3 border-t border-line"></div>
        <h3 class="{HEADING} col-span-3">Transform</h3>
        <label class="contents">
          <span class={LABEL}>Scale</span>
          <input
            class="{FIELD} w-full"
            type="number"
            step="0.05"
            min="0.05"
            max="8"
            value={roundTo(clip.transform.scale, 2)}
            onchange={(e) => onUpdate({ transform: { scale: num(e, 2) } })}
          />
          <span class={UNIT}>×</span>
        </label>
        <label class="contents">
          <span class={LABEL}>X</span>
          <input
            class="{FIELD} w-full"
            type="number"
            step="1"
            value={roundTo(clip.transform.x, 0)}
            onchange={(e) => onUpdate({ transform: { x: num(e, 0) } })}
          />
          <span class={UNIT}>px</span>
        </label>
        <label class="contents">
          <span class={LABEL}>Y</span>
          <input
            class="{FIELD} w-full"
            type="number"
            step="1"
            value={roundTo(clip.transform.y, 0)}
            onchange={(e) => onUpdate({ transform: { y: num(e, 0) } })}
          />
          <span class={UNIT}>px</span>
        </label>
        <div class="col-span-3">
          <button type="button" class={BORDERED_BTN} onclick={onResetTransform} title="Reset scale and position to default">
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            <span>Reset transform</span>
          </button>
        </div>
      </section>
    {/if}
  </div>
</aside>
