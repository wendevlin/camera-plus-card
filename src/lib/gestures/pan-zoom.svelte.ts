import { IDENTITY, pan, type Size, type Transform, zoomAt, zoomCenter } from "./pan-zoom";

const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 8;
const DOUBLE_TAP_SCALE = 2;

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/**
 * Reactive pan/zoom state plus pointer handling: pinch on touch, drag to
 * pan while zoomed, ctrl/⌘ + wheel, and double-tap to toggle 2×.
 */
export class PanZoom {
  transform = $state<Transform>({ ...IDENTITY });
  viewport: Size = { width: 0, height: 0 };

  #pointers = new Map<number, PointerInfo>();
  #pinch?: { distance: number; scale: number; midX: number; midY: number };
  #lastTap = 0;
  #moved = false;
  #lastPointerType = "mouse";
  #onTap?: () => void;

  constructor(options: { onTap?: () => void } = {}) {
    this.#onTap = options.onTap;
  }

  get zoomed(): boolean {
    return this.transform.scale > 1.001;
  }

  get style(): string {
    const { x, y, scale } = this.transform;
    return `transform: translate(${x}px, ${y}px) scale(${scale}); transform-origin: 0 0;`;
  }

  setScale(scale: number): void {
    this.transform = zoomCenter(this.transform, scale, this.viewport);
  }

  reset(): void {
    this.transform = { ...IDENTITY };
  }

  resize(size: Size): void {
    if (size.width === this.viewport.width && size.height === this.viewport.height) return;
    const ratio = this.viewport.width ? size.width / this.viewport.width : 1;
    this.viewport = size;
    const { scale, x, y } = this.transform;
    this.transform = zoomAt({ scale, x: x * ratio, y: y * ratio }, scale, 0, 0, size);
  }

  #local(event: PointerEvent | WheelEvent, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  onpointerdown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.#lastPointerType = event.pointerType;
    const element = event.currentTarget as HTMLElement;
    const point = this.#local(event, element);
    this.#pointers.set(event.pointerId, { ...point, startX: point.x, startY: point.y });
    if (this.#pointers.size === 1) this.#moved = false;
    if (this.#pointers.size === 2) this.#startPinch();
    // Mouse drags need capture to keep panning outside the element. Touch is
    // implicitly captured already, and explicitly capturing the first finger
    // keeps the second finger's pointerdown from reaching us (no pinch).
    if (event.pointerType === "mouse" && this.zoomed) {
      element.setPointerCapture(event.pointerId);
    }
  };

  onpointermove = (event: PointerEvent) => {
    const info = this.#pointers.get(event.pointerId);
    if (!info) return;
    const element = event.currentTarget as HTMLElement;
    const point = this.#local(event, element);
    const dx = point.x - info.x;
    const dy = point.y - info.y;
    info.x = point.x;
    info.y = point.y;
    if (Math.hypot(point.x - info.startX, point.y - info.startY) > TAP_SLOP_PX) {
      this.#moved = true;
    }

    if (this.#pointers.size >= 2 && this.#pinch) {
      const [a, b] = [...this.#pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const scale = this.#pinch.scale * (distance / this.#pinch.distance);
      const panned = pan(this.transform, midX - this.#pinch.midX, midY - this.#pinch.midY, this.viewport);
      this.transform = zoomAt(panned, scale, midX, midY, this.viewport);
      // Re-baseline so the next move scales relative to the current transform.
      this.#pinch = { distance, scale: this.transform.scale, midX, midY };
    } else if (this.zoomed) {
      this.transform = pan(this.transform, dx, dy, this.viewport);
    }
  };

  onpointerup = (event: PointerEvent) => {
    if (!this.#pointers.delete(event.pointerId)) return;
    if (this.#pointers.size < 2) this.#pinch = undefined;
    if (this.#pointers.size > 0 || this.#moved) return;

    const now = event.timeStamp;
    if (event.pointerType !== "mouse" && now - this.#lastTap < DOUBLE_TAP_MS) {
      this.#lastTap = 0;
      const point = this.#local(event, event.currentTarget as HTMLElement);
      this.transform = this.zoomed
        ? { ...IDENTITY }
        : zoomAt(this.transform, DOUBLE_TAP_SCALE, point.x, point.y, this.viewport);
      return;
    }
    this.#lastTap = now;
    this.#onTap?.();
  };

  onpointercancel = (event: PointerEvent) => {
    this.#pointers.delete(event.pointerId);
    if (this.#pointers.size < 2) this.#pinch = undefined;
  };

  ondblclick = (event: MouseEvent) => {
    // Touch double-taps are handled in `onpointerup`; browsers may also emit dblclick.
    if (this.#lastPointerType !== "mouse") return;
    const point = this.#local(event as PointerEvent, event.currentTarget as HTMLElement);
    this.transform = this.zoomed
      ? { ...IDENTITY }
      : zoomAt(this.transform, DOUBLE_TAP_SCALE, point.x, point.y, this.viewport);
  };

  onwheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const point = this.#local(event, event.currentTarget as HTMLElement);
    const factor = Math.exp(-event.deltaY * 0.01);
    this.transform = zoomAt(this.transform, this.transform.scale * factor, point.x, point.y, this.viewport);
  };

  #startPinch(): void {
    const [a, b] = [...this.#pointers.values()];
    this.#pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale: this.transform.scale,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
    this.#moved = true;
  }
}
