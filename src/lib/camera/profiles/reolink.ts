import type { EntityRegistryDisplayEntry } from "../../ha/types";
import { type CameraStream, PTZ_DIRECTIONS, type PtzDirection } from "../types";
import type { CameraProfile } from ".";

/** Reolink appends `_lens_N` to translation keys of dual-lens cameras. */
const LENS_SUFFIX = /_lens_(\d+)$/;

const splitLens = (key: string): [string, number] => {
  const match = LENS_SUFFIX.exec(key);
  return match ? [key.slice(0, match.index), Number(match[1])] : [key, 0];
};

/** Reolink sets this feature bit on PTZ buttons that accept `reolink.ptz_move` with a speed. */
const SUPPORT_PTZ_SPEED = 2;

const STREAM_KEYS: Record<string, CameraStream> = { main: "main", sub: "sub", ext: "ext" };

/**
 * Reolink (`homeassistant/components/reolink`): `sub`/`main`/`ext` camera
 * streams, `ptz_*` buttons that move until `ptz_stop`, a `zoom` number and a
 * `ptz_preset` select, all matched by `translation_key`.
 */
export const reolink: CameraProfile = {
  resolve(entries: EntityRegistryDisplayEntry[], device) {
    // Lower lens index wins, so the primary lens is used on dual-lens models.
    const streamLens = new Map<CameraStream, number>();
    const telephoto: string[] = [];

    for (const entry of entries) {
      if (!entry.translation_key) continue;
      const [domain] = entry.entity_id.split(".");
      const [key, lens] = splitLens(entry.translation_key);

      switch (domain) {
        case "camera": {
          const stream = STREAM_KEYS[key];
          if (stream) {
            const current = streamLens.get(stream);
            if (current === undefined || lens < current) {
              streamLens.set(stream, lens);
              device.streams[stream] = entry.entity_id;
            }
          } else if (key.startsWith("telephoto_")) {
            telephoto.push(entry.entity_id);
          }
          break;
        }
        case "button": {
          if (!key.startsWith("ptz_")) break;
          const command = key.slice(4);
          if (command === "stop") {
            device.ptz.stop ??= entry.entity_id;
          } else if (command === "zoom_in" || command === "zoom_out") {
            device.ptz.zoom[command] ??= entry.entity_id;
          } else if ((PTZ_DIRECTIONS as string[]).includes(command)) {
            device.ptz.directions[command as PtzDirection] ??= entry.entity_id;
          }
          break;
        }
        case "number":
          if (key === "zoom") device.zoomNumber ??= entry.entity_id;
          break;
        case "select":
          if (key === "ptz_preset") device.presetSelect ??= entry.entity_id;
          break;
      }
    }

    device.ptz.speedService = { domain: "reolink", service: "ptz_move", featureBit: SUPPORT_PTZ_SPEED };

    // Wide-angle streams first, telephoto last, then anything else.
    const preferred = [device.streams.sub, device.streams.main, device.streams.ext, ...telephoto].filter(
      (entityId): entityId is string => entityId !== undefined,
    );
    device.cameras = [...preferred, ...device.cameras.filter((entityId) => !preferred.includes(entityId))];
  },
};
