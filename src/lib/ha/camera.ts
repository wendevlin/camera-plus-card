import type { HassApi, HassConnectionContext, HassEntity } from "./types";

/** `CameraEntityFeature.STREAM` */
export const CAMERA_SUPPORT_STREAM = 2;

export type StreamType = "web_rtc" | "hls";

export interface CameraCapabilities {
  frontend_stream_types: StreamType[];
  two_way_audio?: boolean;
}

export const supportsStream = (stateObj: HassEntity | undefined): boolean =>
  ((stateObj?.attributes.supported_features ?? 0) & CAMERA_SUPPORT_STREAM) !== 0;

export const fetchCameraCapabilities = async (
  api: HassApi,
  stateObj: HassEntity,
): Promise<CameraCapabilities> => {
  if (!supportsStream(stateObj)) {
    return { frontend_stream_types: [] };
  }
  return api.callWS<CameraCapabilities>({
    type: "camera/capabilities",
    entity_id: stateObj.entity_id,
  });
};

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

export const mjpegUrl = (connection: HassConnectionContext, stateObj: HassEntity): string =>
  connection.hassUrl(
    `/api/camera_proxy_stream/${stateObj.entity_id}?token=${stateObj.attributes.access_token ?? ""}`,
  );

export const fetchHlsUrl = async (
  api: HassApi,
  connection: HassConnectionContext,
  entityId: string,
): Promise<string> => {
  const { url } = await api.callWS<{ url: string }>({
    type: "camera/stream",
    entity_id: entityId,
    format: "hls",
  });
  return connection.hassUrl(url);
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
