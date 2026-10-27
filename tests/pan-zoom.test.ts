import { describe, expect, test } from "bun:test";
import {
  clampTransform,
  IDENTITY,
  pan,
  visibleRegion,
  zoomAt,
  zoomCenter,
} from "../src/lib/gestures/pan-zoom";

const viewport = { width: 400, height: 200 };

describe("pan-zoom", () => {
  test("zooming keeps the focal point fixed", () => {
    const t = zoomAt(IDENTITY, 2, 100, 50, viewport);
    expect(t).toEqual({ scale: 2, x: -100, y: -50 });
    // Content point under (100, 50) is still (100, 50).
    expect((100 - t.x) / t.scale).toBe(100);
  });

  test("scale is clamped to 1..5", () => {
    expect(zoomCenter(IDENTITY, 10, viewport).scale).toBe(5);
    expect(zoomCenter(IDENTITY, 0.2, viewport)).toEqual(IDENTITY);
  });

  test("pan never reveals empty space", () => {
    const zoomed = zoomCenter(IDENTITY, 2, viewport);
    expect(pan(zoomed, 1000, 1000, viewport)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(pan(zoomed, -1000, -1000, viewport)).toEqual({ scale: 2, x: -400, y: -200 });
  });

  test("unzoomed content can't move", () => {
    expect(clampTransform({ scale: 1, x: 30, y: -30 }, viewport)).toEqual(IDENTITY);
  });

  test("visible region reflects the viewport into the content", () => {
    const region = visibleRegion({ scale: 2, x: -400, y: 0 }, viewport);
    expect(region).toEqual({ left: 0.5, top: 0, width: 0.5, height: 0.5 });
  });
});
