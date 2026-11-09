import { createSubscriber } from "svelte/reactivity";

/**
 * How long the page may be hidden before streams stop. Entering fullscreen in
 * the HA Android app hides the page for a moment while it moves into a separate
 * view; this leaves some margin for slower devices.
 */
const STREAM_HIDDEN_GRACE_MS = 3_000;

const hidden = () => document.visibilityState === "hidden";

let hiddenLongEnough = false;

const subscribe = createSubscriber((update) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startGrace = () => {
    clearTimeout(timer);
    hiddenLongEnough = false;
    if (!hidden()) return;
    timer = setTimeout(() => {
      hiddenLongEnough = true;
      update();
    }, STREAM_HIDDEN_GRACE_MS);
  };
  const onChange = () => {
    startGrace();
    update();
  };
  // The page can already be hidden when the first reader subscribes.
  startGrace();
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
});

/**
 * Reactive page visibility (background tab, backgrounded companion app).
 */
export const pageVisibility = {
  /** Hidden right now; pauses cheap work like snapshot polling. */
  get visible(): boolean {
    subscribe();
    return !hidden();
  },
  /** False only once the page has been hidden for a while; stops streams. */
  get streamable(): boolean {
    subscribe();
    return !hidden() || !hiddenLongEnough;
  },
};
