import { createSubscriber } from "svelte/reactivity";

const subscribe = createSubscriber((update) => {
  document.addEventListener("visibilitychange", update);
  return () => document.removeEventListener("visibilitychange", update);
});

/**
 * Reactive `document.visibilityState`. Used to pause snapshot polling and
 * streams in background tabs (and when the companion app is backgrounded).
 */
export const pageVisibility = {
  get visible(): boolean {
    subscribe();
    return document.visibilityState !== "hidden";
  },
};
