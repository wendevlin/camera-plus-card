/**
 * Pure digital zoom math. The content box has the viewport's size and is
 * transformed with `translate(x, y) scale(scale)` and `transform-origin: 0 0`.
 */

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;

export const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps the content covering the viewport; no empty borders while zoomed. */
export function clampTransform(t: Transform, viewport: Size): Transform {
  const scale = clampNumber(t.scale, MIN_SCALE, MAX_SCALE);
  const minX = viewport.width - viewport.width * scale;
  const minY = viewport.height - viewport.height * scale;
  return {
    scale,
    x: clampNumber(t.x, minX, 0),
    y: clampNumber(t.y, minY, 0),
  };
}

/** Zooms to `scale` while keeping the viewport point (px, py) fixed. */
export function zoomAt(t: Transform, scale: number, px: number, py: number, viewport: Size): Transform {
  const next = clampNumber(scale, MIN_SCALE, MAX_SCALE);
  const contentX = (px - t.x) / t.scale;
  const contentY = (py - t.y) / t.scale;
  return clampTransform({ scale: next, x: px - contentX * next, y: py - contentY * next }, viewport);
}

/** Zooms around the viewport center (slider / buttons). */
export const zoomCenter = (t: Transform, scale: number, viewport: Size): Transform =>
  zoomAt(t, scale, viewport.width / 2, viewport.height / 2, viewport);

export const pan = (t: Transform, dx: number, dy: number, viewport: Size): Transform =>
  clampTransform({ scale: t.scale, x: t.x + dx, y: t.y + dy }, viewport);

/**
 * Visible region in content coordinates as fractions (0..1), for the
 * position indicator shown while zoomed.
 */
export function visibleRegion(t: Transform, viewport: Size) {
  return {
    // `0 - x` rather than `-x` so an unpanned axis yields 0, not -0.
    left: (0 - t.x) / (viewport.width * t.scale),
    top: (0 - t.y) / (viewport.height * t.scale),
    width: 1 / t.scale,
    height: 1 / t.scale,
  };
}
