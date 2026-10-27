import type { DeviceRegistryEntry, EntityRegistryDisplayEntry, HassEntities } from "../ha/types";
import { PROFILES } from "./profiles";
import type { CameraDevice, CameraStream } from "./types";

export type { CameraDevice, CameraPtz, CameraStream, PtzDirection, PtzZoomDirection } from "./types";
export { PTZ_DIRECTIONS } from "./types";

export const deviceName = (device: DeviceRegistryEntry | undefined): string =>
  device?.name_by_user || device?.name || "";

const isCamera = (entry: EntityRegistryDisplayEntry) => entry.entity_id.startsWith("camera.");

/**
 * Entities of a device. Falls back to child devices when the device itself
 * has no camera (e.g. dual-lens cameras that put each lens on its own device).
 */
const deviceEntities = (
  deviceId: string,
  entities: Record<string, EntityRegistryDisplayEntry>,
  devices: Record<string, DeviceRegistryEntry>,
): EntityRegistryDisplayEntry[] => {
  const all = Object.values(entities);
  const own = all.filter((entry) => entry.device_id === deviceId);
  if (own.some(isCamera)) return own;

  const childIds = new Set(
    Object.values(devices)
      .filter((device) => device.parent_device_id === deviceId || device.via_device_id === deviceId)
      .map((device) => device.id),
  );
  return [...own, ...all.filter((entry) => entry.device_id !== undefined && childIds.has(entry.device_id))];
};

/**
 * Collects a device's cameras for any integration, then lets the vendor
 * profile of each integration present add stream variants and PTZ controls.
 * Disabled entities aren't in the registry display list, so they're missing.
 */
export function resolveCameraDevice(
  deviceId: string,
  entities: Record<string, EntityRegistryDisplayEntry>,
  devices: Record<string, DeviceRegistryEntry>,
): CameraDevice {
  // Hidden entities are kept on purpose: people hide PTZ buttons from dashboards but still want them here.
  const entries = deviceEntities(deviceId, entities, devices);
  const device: CameraDevice = {
    deviceId,
    name: deviceName(devices[deviceId]),
    cameras: entries.filter(isCamera).map((entry) => entry.entity_id),
    streams: {},
    ptz: { directions: {}, zoom: {} },
  };

  const platforms = new Set(entries.map((entry) => entry.platform).filter(Boolean) as string[]);
  for (const platform of platforms) {
    PROFILES[platform]?.resolve(
      entries.filter((entry) => entry.platform === platform),
      device,
    );
  }
  return device;
}

export const hasPtzDirections = (device: CameraDevice): boolean =>
  Object.keys(device.ptz.directions).length > 0;

export const hasOpticalZoom = (device: CameraDevice): boolean =>
  Object.keys(device.ptz.zoom).length > 0 || device.zoomNumber !== undefined;

/** Applies the card's `show_ptz` / `show_optical_zoom` options. */
export function limitControls(
  device: CameraDevice,
  options: { ptz: boolean; opticalZoom: boolean },
): CameraDevice {
  return {
    ...device,
    ptz: {
      ...device.ptz,
      directions: options.ptz ? device.ptz.directions : {},
      zoom: options.opticalZoom ? device.ptz.zoom : {},
    },
    zoomNumber: options.opticalZoom ? device.zoomNumber : undefined,
    presetSelect: options.ptz ? device.presetSelect : undefined,
  };
}

export const hasPtzControls = (device: CameraDevice): boolean =>
  hasPtzDirections(device) || hasOpticalZoom(device);

const FALLBACK_ORDER: Record<CameraStream, CameraStream[]> = {
  main: ["main", "sub", "ext"],
  sub: ["sub", "ext", "main"],
  ext: ["ext", "sub", "main"],
};

/**
 * Picks the camera to show: the requested stream variant when the profile
 * knows one, otherwise the first available camera of the device.
 */
export function pickCamera(
  device: CameraDevice,
  preferred: CameraStream,
  states?: HassEntities,
): string | undefined {
  const available = (entityId: string | undefined): entityId is string =>
    entityId !== undefined &&
    (!states || (states[entityId] !== undefined && states[entityId].state !== "unavailable"));

  const candidates = [
    ...FALLBACK_ORDER[preferred].map((stream) => device.streams[stream]),
    ...device.cameras,
  ];
  return candidates.find(available) ?? candidates.find((entityId) => entityId !== undefined);
}

/** First device with a camera entity, for `getStubConfig`. */
export function findFirstCameraDevice(
  entities: Record<string, EntityRegistryDisplayEntry>,
): string | undefined {
  return Object.values(entities).find((entry) => isCamera(entry) && entry.device_id)?.device_id;
}
