import type { ClipTransform } from "./types";

export type DrawRect = { x: number; y: number; w: number; h: number };

/** Draw rect of source on canvas given transform (spec formulas). */
export function drawRect(
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  transform: ClipTransform,
): DrawRect {
  if (srcW === 0 || srcH === 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  // Contain-fit, then uniform scale about the framed center (pan is center offset).
  const fitScale = Math.min(canvasW / srcW, canvasH / srcH);
  const drawW = srcW * fitScale * transform.scale;
  const drawH = srcH * fitScale * transform.scale;
  const drawX = (canvasW - drawW) / 2 + transform.x;
  const drawY = (canvasH - drawH) / 2 + transform.y;

  return { x: drawX, y: drawY, w: drawW, h: drawH };
}
