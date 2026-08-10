<script lang="ts">
  /**
   * Full-media waveform on an audio clip bar.
   * Trim maps via width + translate (no re-ffmpeg); zoom only CSS-scales.
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
    opacity: 0.9;
  }

  .wave img {
    display: block;
    height: 100%;
    max-width: none;
    /* Light waveform on dark clip; screen keeps stroke visible */
    mix-blend-mode: screen;
    object-fit: fill;
    object-position: left center;
  }
</style>
