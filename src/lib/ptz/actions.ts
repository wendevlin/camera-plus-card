import type { CameraDevice, PtzDirection, PtzZoomDirection } from "../camera/types";
import type { HassApi, HassEntities } from "../ha/types";
import type { HoldAction } from "./hold";

const ZOOM_STEP_INTERVAL_MS = 150;

interface ActionContext {
  api: HassApi;
  /** Getter so long holds always see fresh state. */
  getStates: () => HassEntities;
  device: CameraDevice;
  speed?: number;
}

const pressButton = (api: HassApi, entityId: string) =>
  api.callService("button", "press", undefined, { entity_id: entityId });

const supportsFeature = (states: HassEntities, entityId: string, bit: number) =>
  ((states[entityId]?.attributes.supported_features ?? 0) & bit) !== 0;

const continuousMove = ({ api, getStates, device, speed }: ActionContext, entityId: string): HoldAction => {
  const stopId = device.ptz.stop;
  const speedService = device.ptz.speedService;
  return {
    start: () =>
      speed && speedService && supportsFeature(getStates(), entityId, speedService.featureBit)
        ? api.callService(speedService.domain, speedService.service, { speed }, { entity_id: entityId })
        : pressButton(api, entityId),
    stop: stopId ? () => pressButton(api, stopId) : undefined,
  };
};

export function directionAction(ctx: ActionContext, direction: PtzDirection): HoldAction | undefined {
  const entityId = ctx.device.ptz.directions[direction];
  return entityId ? continuousMove(ctx, entityId) : undefined;
}

/**
 * Optical zoom: prefer the continuous zoom buttons (disabled by default in
 * Reolink), otherwise step the `zoom` number entity while held.
 */
export function zoomAction(ctx: ActionContext, direction: PtzZoomDirection): HoldAction | undefined {
  const buttonId = ctx.device.ptz.zoom[direction];
  if (buttonId) return continuousMove(ctx, buttonId);

  const numberId = ctx.device.zoomNumber;
  if (!numberId) return undefined;
  const sign = direction === "zoom_in" ? 1 : -1;
  // State updates lag behind our steps, so track the target locally while
  // held and only resync from state when a new hold starts.
  let target: number | undefined;
  let lastTick = 0;
  return {
    repeatMs: ZOOM_STEP_INTERVAL_MS,
    start: () => {
      const stateObj = ctx.getStates()[numberId];
      if (!stateObj) return Promise.resolve();
      const now = Date.now();
      if (target === undefined || now - lastTick > ZOOM_STEP_INTERVAL_MS * 3) {
        target = Number(stateObj.state);
      }
      lastTick = now;
      if (Number.isNaN(target)) return Promise.resolve();
      const { min = 0, max = 100, step = 1 } = stateObj.attributes;
      const value = Math.min(max, Math.max(min, target + sign * step));
      if (value === target) return Promise.resolve();
      target = value;
      return ctx.api.callService("number", "set_value", { value }, { entity_id: numberId });
    },
  };
}

export const selectPreset = (api: HassApi, entityId: string, option: string) =>
  api.callService("select", "select_option", { option }, { entity_id: entityId });
