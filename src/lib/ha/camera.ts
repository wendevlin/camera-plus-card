import type { HassApi, HassConnectionContext, HassEntity } from "./types";

/** `CameraEntityFeature.STREAM` */
export const CAMERA_SUPPORT_STREAM = 2;

export const supportsStream = (stateObj: HassEntity | undefined): boolean =>
  ((stateObj?.attributes.supported_features ?? 0) & CAMERA_SUPPORT_STREAM) !== 0;

/** Signed, absolute snapshot URL for `<img>` (mirrors `fetchThumbnailUrlWithCache`). */
export const fetchSnapshotUrl = async (
  api: HassApi,
  connection: HassConnectionContext,
  entityId: string,
  width?: number,
  height?: number,
): Promise<string> => {
  const { path } = await api.callWS<{ path: string }>({
    type: "auth/sign_path",
    path: `/api/camera_proxy/${entityId}`,
  });
  const url = new URL(connection.hassUrl(path), location.href);
  if (width) url.searchParams.set("width", String(Math.round(width)));
  if (height) url.searchParams.set("height", String(Math.round(height)));
  return url.toString();
};

/** Downloads a full resolution snapshot via the authenticated camera proxy. */
export const downloadSnapshot = async (api: HassApi, entityId: string, fileName: string) => {
  const response = await api.callApiRaw("GET", `camera_proxy/${entityId}`);
  if (!response.ok) throw new Error(`Snapshot request failed: HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
