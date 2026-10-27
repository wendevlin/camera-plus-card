import type { HassApi } from "./ha/types";

/** Entity domains the door button can drive, and the service that "opens" each. */
const DOOR_SERVICES: Record<string, string> = {
  lock: "unlock",
  button: "press",
  switch: "turn_on",
};

export const DOOR_DOMAINS = Object.keys(DOOR_SERVICES);

export const isDoorEntity = (entityId: string | undefined): entityId is string =>
  entityId !== undefined && entityId.split(".")[0] in DOOR_SERVICES;

export function openDoor(api: HassApi, entityId: string): Promise<unknown> {
  const [domain] = entityId.split(".");
  return api.callService(domain, DOOR_SERVICES[domain], undefined, { entity_id: entityId });
}
