<script lang="ts">
  /**
   * Full-media waveform on an audio clip bar.
   * Trim maps via width + translate (no re-ffmpeg); zoom only CSS-scales.
   * Recolored from clip --clip-h/s/l (inherits from .clip).
   */
  import { waveformTrimLayout } from "$lib/waveform";

  interface Props {
    url: string;
    sourceIn: number;
    sourceOut: number;
    mediaDuration: number;
  }

  let { url, sourceIn, sourceOut, mediaDuration }: Props = $props();

  const layout = $derived(
    waveformTrimLayout(sourceIn, sourceOut, mediaDuration),
  );
</script>

<div class="wave" aria-hidden="true">
  <img
    src={url}
    alt=""
    draggable="false"
    style="width: {layout.widthPercent}%; transform: translateX({layout.translatePercent}%);"
  />
</div>

<style>
  .wave {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    opacity: 0.92;
  }

  .wave img {
    display: block;
    height: 100%;
    max-width: none;
    object-fit: fill;
    object-position: left center;
    /*
     * Base generation color is ~hue 210 (#9ec5ff). Rotate toward the clip
     * palette hue and screen-blend onto the dark clip fill.
     */
    filter: hue-rotate(calc((var(--clip-h, 210) - 210) * 1deg))
      saturate(1.25) brightness(1.08);
    mix-blend-mode: screen;
  }
</style>
