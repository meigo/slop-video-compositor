<script lang="ts">
  /**
   * Contact sheet on a clip bar: full-media sheet, trim mapped in CSS.
   * Each frame keeps full tile aspect; zoom filters tiles; trim does not re-ffmpeg.
   */
  import { onMount } from "svelte";
  import {
    filmstripDisplayTileWidth,
    filmstripIndicesForTrim,
    filmstripTileAspect,
    filmstripVisibleCount,
  } from "$lib/filmstrip";

  interface Props {
    url: string;
    count: number;
    /** Native sheet width (px). */
    width: number;
    /** Native sheet height (px). */
    height: number;
    /** Clip source in (s) within full media. */
    sourceIn: number;
    /** Clip source out (s) within full media. */
    sourceOut: number;
    /** Full media duration the sheet spans (s). */
    mediaDuration: number;
  }

  let {
    url,
    count,
    width,
    height,
    sourceIn,
    sourceOut,
    mediaDuration,
  }: Props = $props();

  const n = $derived(Math.max(1, Math.round(count)));
  const sheetAr = $derived(
    Math.max(1, Math.round(width)) / Math.max(1, Math.round(height)),
  );
  const tileAr = $derived(filmstripTileAspect(width, height, n));

  let stripEl: HTMLDivElement | undefined = $state();
  let clipW = $state(0);
  let clipH = $state(0);

  onMount(() => {
    if (!stripEl) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      clipW = r.width;
      clipH = r.height;
    });
    ro.observe(stripEl);
    const rect = stripEl.getBoundingClientRect();
    clipW = rect.width;
    clipH = rect.height;
    return () => ro.disconnect();
  });

  const tileW = $derived(filmstripDisplayTileWidth(clipH, tileAr));
  const visible = $derived(filmstripVisibleCount(clipW, tileW, n));
  const indices = $derived(
    filmstripIndicesForTrim(visible, n, sourceIn, sourceOut, mediaDuration),
  );
</script>

<div class="strip" bind:this={stripEl} aria-hidden="true">
  {#each indices as ti, slot (slot)}
    <div class="cell">
      <div class="tile" style="width: {tileW}px">
        <img
          src={url}
          alt=""
          draggable="false"
          width={Math.round(width)}
          height={Math.round(height)}
          style="aspect-ratio: {sheetAr}; transform: translateX(-{(ti / n) * 100}%);"
        />
      </div>
    </div>
  {/each}
</div>

<style>
  .strip {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    overflow: hidden;
    pointer-events: none;
    opacity: 0.82;
  }

  .cell {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: stretch;
    overflow: hidden;
  }

  .tile {
    flex: 0 0 auto;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .tile img {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: auto;
    max-width: none;
    display: block;
  }
</style>
