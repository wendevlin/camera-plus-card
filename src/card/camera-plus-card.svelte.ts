import { mount, unmount } from "svelte";
import { findFirstCameraDevice } from "../lib/camera/device";
import { HassContext } from "../lib/ha/context.svelte";
import type { HomeAssistant, LovelaceConfigForm, LovelaceGridOptions } from "../lib/ha/types";
import { adoptStyles } from "../lib/shadow";
import Card from "./Card.svelte";
import {
  CARD_TYPE,
  type CameraPlusCardConfig,
  getConfigForm,
  type ResolvedConfig,
  resolveConfig,
} from "./config";

/**
 * Lovelace card element. A thin custom element shell around the Svelte app:
 * HA talks to this class (config, sizing, editor), Svelte renders into its
 * shadow root, and data comes from HA contexts instead of `hass`.
 */
export class CameraPlusCard extends HTMLElement {
  static getConfigForm(): LovelaceConfigForm {
    return getConfigForm();
  }

  static getStubConfig(hass?: HomeAssistant): CameraPlusCardConfig {
    // `hass` is the only data HA hands to this static hook.
    const deviceId = hass?.entities ? findFirstCameraDevice(hass.entities) : undefined;
    return { type: `custom:${CARD_TYPE}`, ...(deviceId ? { device_id: deviceId } : {}) };
  }

  #ctx = new HassContext();
  #props = $state<{ ctx: HassContext; config: ResolvedConfig; preview: boolean }>({
    ctx: this.#ctx,
    config: resolveConfig({ type: `custom:${CARD_TYPE}` }),
    preview: false,
  });
  #app?: ReturnType<typeof mount>;

  constructor() {
    super();
    adoptStyles(this.attachShadow({ mode: "open" }));
  }

  setConfig(config: CameraPlusCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.#props.config = resolveConfig(config);
  }

  /** HA still sets `hass`; we read everything from contexts instead. */
  set hass(_hass: unknown) {}

  set preview(value: boolean) {
    this.#props.preview = Boolean(value);
  }

  get preview(): boolean {
    return this.#props.preview;
  }

  getCardSize(): number {
    return 4;
  }

  getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  connectedCallback(): void {
    this.#ctx.connect(this);
    this.#app ??= mount(Card, { target: this.shadowRoot!, props: this.#props });
  }

  disconnectedCallback(): void {
    this.#ctx.disconnect();
    // Tear down so streams and timers stop when the view is left.
    if (this.#app) {
      void unmount(this.#app);
      this.#app = undefined;
    }
  }
}
