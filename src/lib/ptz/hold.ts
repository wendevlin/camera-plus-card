/**
 * Press-and-hold controller for continuous PTZ commands.
 *
 * Continuous PTZ buttons (e.g. Reolink) start a move that only ends with an explicit stop, so
 * we start on pointer down and always stop on release, cancel, blur or a
 * safety timeout. Only one hold is active at a time.
 */

export interface HoldAction {
  /** Starts the move. With `repeatMs`, it's called again on every tick. */
  start: () => Promise<unknown>;
  /** Ends the move. Omit for step-only actions. */
  stop?: () => Promise<unknown>;
  /** Repeats `start` while held (e.g. stepping a `number` entity). */
  repeatMs?: number;
}

interface ActiveHold {
  id: string;
  action: HoldAction;
  started: Promise<unknown>;
  repeatTimer?: ReturnType<typeof setInterval>;
  safetyTimer: ReturnType<typeof setTimeout>;
}

export const SAFETY_TIMEOUT_MS = 30_000;

export class HoldController {
  #active?: ActiveHold;
  #onChange?: (activeId: string | undefined) => void;
  #safetyTimeoutMs: number;

  constructor(options: { onChange?: (activeId: string | undefined) => void; safetyTimeoutMs?: number } = {}) {
    this.#onChange = options.onChange;
    this.#safetyTimeoutMs = options.safetyTimeoutMs ?? SAFETY_TIMEOUT_MS;
  }

  get activeId(): string | undefined {
    return this.#active?.id;
  }

  press(id: string, action: HoldAction): void {
    if (this.#active?.id === id) return;
    // Switching directly between holds: the previous stop must reach the camera
    // before the new start, or a device-wide stop would cancel the new move.
    const previous = this.#active ? this.release() : Promise.resolve();

    const started = previous
      .then(() => action.start())
      .catch((err) => {
        console.warn(`[camera-plus-card] PTZ ${id} failed`, err);
      });
    const hold: ActiveHold = {
      id,
      action,
      started,
      safetyTimer: setTimeout(() => this.release(id), this.#safetyTimeoutMs),
    };
    if (action.repeatMs) {
      const repeat = action.repeatMs;
      void started.then(() => {
        // Released before the first step went out.
        if (this.#active !== hold) return;
        hold.repeatTimer = setInterval(() => {
          void action.start().catch(() => undefined);
        }, repeat);
      });
    }
    this.#active = hold;
    this.#onChange?.(id);
  }

  /** Releases the given hold (or whatever is active). Resolves once stop was sent. */
  async release(id?: string): Promise<void> {
    const hold = this.#active;
    if (!hold || (id !== undefined && hold.id !== id)) return;
    this.#active = undefined;
    clearTimeout(hold.safetyTimer);
    if (hold.repeatTimer) clearInterval(hold.repeatTimer);
    this.#onChange?.(undefined);
    if (!hold.action.stop) return;
    // A quick tap may release before the start call resolved; stop must come after it.
    await hold.started;
    await hold.action.stop().catch((err) => {
      console.warn(`[camera-plus-card] PTZ stop failed`, err);
    });
  }
}
