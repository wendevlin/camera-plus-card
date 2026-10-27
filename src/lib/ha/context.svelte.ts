import type { HassContexts } from "./types";

type ContextKey = keyof HassContexts;

const CONTEXT_KEYS: ContextKey[] = [
  "states",
  "entities",
  "devices",
  "hassApi",
  "hassConnection",
  "hassInternationalization",
  "hassUi",
  "narrowViewport",
  "reducedMotion",
];

/**
 * Dispatches a W3C community-protocol `context-request` event, which is what
 * `@lit/context` providers on `<home-assistant>` listen for. Returns a
 * function that drops the subscription.
 */
export function requestContext<K extends ContextKey>(
  target: HTMLElement,
  context: K,
  callback: (value: HassContexts[K]) => void,
): () => void {
  let unsubscribe: (() => void) | undefined;
  const event = new Event("context-request", { bubbles: true, composed: true });
  Object.assign(event, {
    context,
    contextTarget: target,
    subscribe: true,
    callback: (value: HassContexts[K], unsub?: () => void) => {
      // Providers may call back again with a new unsubscribe after reconnects.
      if (unsub && unsub !== unsubscribe) {
        unsubscribe?.();
        unsubscribe = unsub;
      }
      callback(value);
    },
  });
  target.dispatchEvent(event);
  return () => unsubscribe?.();
}

/** Reactive bag of all HA contexts this card consumes. */
export class HassContext {
  states = $state.raw<HassContexts["states"]>();
  entities = $state.raw<HassContexts["entities"]>();
  devices = $state.raw<HassContexts["devices"]>();
  hassApi = $state.raw<HassContexts["hassApi"]>();
  hassConnection = $state.raw<HassContexts["hassConnection"]>();
  hassInternationalization = $state.raw<HassContexts["hassInternationalization"]>();
  hassUi = $state.raw<HassContexts["hassUi"]>();
  narrowViewport = $state.raw<boolean>(false);
  reducedMotion = $state.raw<boolean>(false);

  #unsubscribers: (() => void)[] = [];

  get ready(): boolean {
    return Boolean(this.states && this.entities && this.devices && this.hassApi && this.hassConnection);
  }

  get language(): string {
    return this.hassInternationalization?.language ?? navigator.language ?? "en";
  }

  get darkMode(): boolean {
    return this.hassUi?.themes?.darkMode ?? false;
  }

  connect(target: HTMLElement): void {
    this.disconnect();
    for (const key of CONTEXT_KEYS) {
      this.#unsubscribers.push(
        requestContext(target, key, (value) => {
          // Raw state: HA replaces these objects wholesale, so no deep proxy needed.
          (this as unknown as Record<ContextKey, unknown>)[key] = value;
        }),
      );
    }
  }

  disconnect(): void {
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];
  }
}
