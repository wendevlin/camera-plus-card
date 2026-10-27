/** Named stream variants a vendor profile can expose for the quality switch. */
export type CameraStream = "main" | "sub" | "ext";
export type PtzDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "left_up"
  | "left_down"
  | "right_up"
  | "right_down";
export type PtzZoomDirection = "zoom_in" | "zoom_out";

export const PTZ_DIRECTIONS: PtzDirection[] = [
  "left",
  "right",
  "up",
  "down",
  "left_up",
  "left_down",
  "right_up",
  "right_down",
];

export interface CameraPtz {
  directions: Partial<Record<PtzDirection, string>>;
  zoom: Partial<Record<PtzZoomDirection, string>>;
  /** Button that ends a continuous move. */
  stop?: string;
  /** Vendor service that moves a PTZ button with a speed, e.g. `reolink.ptz_move`. */
  speedService?: { domain: string; service: string; featureBit: number };
}

export interface CameraDevice {
  deviceId: string;
  name: string;
  /** Every camera entity of the device, preferred first. */
  cameras: string[];
  /** Named variants for the quality switch, only when a vendor profile knows them. */
  streams: Partial<Record<CameraStream, string>>;
  ptz: CameraPtz;
  /** `number` entity for optical zoom, stepped while held when there are no zoom buttons. */
  zoomNumber?: string;
  presetSelect?: string;
}
