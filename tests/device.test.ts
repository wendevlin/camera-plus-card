import { describe, expect, test } from "bun:test";
import {
  findFirstCameraDevice,
  hasPtzControls,
  limitControls,
  pickCamera,
  resolveCameraDevice,
} from "../src/lib/camera/device";
import { isDoorEntity, openDoor } from "../src/lib/door";
import type { DeviceRegistryEntry, EntityRegistryDisplayEntry, HassApi } from "../src/lib/ha/types";

const entity = (
  entity_id: string,
  translation_key: string | undefined,
  device_id = "dev1",
  platform = "reolink",
): EntityRegistryDisplayEntry => ({ entity_id, translation_key, device_id, platform });

const device = (id: string, extra: Partial<DeviceRegistryEntry> = {}): DeviceRegistryEntry => ({
  id,
  name: `Device ${id}`,
  name_by_user: null,
  manufacturer: null,
  model: null,
  via_device_id: null,
  config_entries: [],
  ...extra,
});

const toRecord = (entries: EntityRegistryDisplayEntry[]) =>
  Object.fromEntries(entries.map((entry) => [entry.entity_id, entry]));

describe("resolveCameraDevice with the Reolink profile", () => {
  test("maps streams and PTZ controls by translation_key", () => {
    const entities = toRecord([
      entity("camera.garden_fluent", "sub"),
      entity("camera.garden_clear", "main"),
      entity("button.garden_ptz_left", "ptz_left"),
      entity("button.garden_ptz_right", "ptz_right"),
      entity("button.garden_ptz_up", "ptz_up"),
      entity("button.garden_ptz_down", "ptz_down"),
      entity("button.garden_ptz_stop", "ptz_stop"),
      entity("button.garden_ptz_zoom_in", "ptz_zoom_in"),
      entity("button.garden_ptz_calibrate", "ptz_calibrate"),
      entity("number.garden_zoom", "zoom"),
      entity("select.garden_ptz_preset", "ptz_preset"),
      entity("camera.other", "sub", "dev2"),
    ]);
    const result = resolveCameraDevice("dev1", entities, { dev1: device("dev1") });

    expect(result.name).toBe("Device dev1");
    expect(result.streams).toEqual({ sub: "camera.garden_fluent", main: "camera.garden_clear" });
    expect(result.cameras).toEqual(["camera.garden_fluent", "camera.garden_clear"]);
    expect(result.ptz.directions).toEqual({
      left: "button.garden_ptz_left",
      right: "button.garden_ptz_right",
      up: "button.garden_ptz_up",
      down: "button.garden_ptz_down",
    });
    expect(result.ptz.stop).toBe("button.garden_ptz_stop");
    expect(result.ptz.zoom).toEqual({ zoom_in: "button.garden_ptz_zoom_in" });
    expect(result.ptz.speedService).toEqual({ domain: "reolink", service: "ptz_move", featureBit: 2 });
    expect(result.zoomNumber).toBe("number.garden_zoom");
    expect(result.presetSelect).toBe("select.garden_ptz_preset");
    expect(hasPtzControls(result)).toBe(true);
  });

  test("prefers the primary lens on dual-lens models", () => {
    const entities = toRecord([
      entity("camera.duo_lens_1", "sub_lens_1"),
      entity("camera.duo_lens_0", "sub_lens_0"),
      entity("camera.duo_tele", "telephoto_sub"),
    ]);
    const result = resolveCameraDevice("dev1", entities, { dev1: device("dev1") });
    expect(result.streams.sub).toBe("camera.duo_lens_0");
    expect(result.cameras[0]).toBe("camera.duo_lens_0");
    expect(result.cameras).toContain("camera.duo_tele");
  });

  test("falls back to child devices when the device itself has no camera", () => {
    const entities = toRecord([
      entity("button.nvr_reboot", "reboot", "parent"),
      entity("camera.lens", "main", "child"),
    ]);
    const devices = { parent: device("parent"), child: device("child", { parent_device_id: "parent" }) };
    expect(resolveCameraDevice("parent", entities, devices).streams.main).toBe("camera.lens");
  });
});

describe("resolveCameraDevice for other integrations", () => {
  test("uses any camera entity and has no PTZ without a profile", () => {
    const entities = toRecord([
      entity("camera.front_door_live", "live", "door", "doorbird"),
      entity("button.front_door_relay_1", undefined, "door", "doorbird"),
    ]);
    const result = resolveCameraDevice("door", entities, { door: device("door") });
    expect(result.cameras).toEqual(["camera.front_door_live"]);
    expect(result.streams).toEqual({});
    expect(hasPtzControls(result)).toBe(false);
    expect(pickCamera(result, "main")).toBe("camera.front_door_live");
  });
});

describe("limitControls", () => {
  const full = resolveCameraDevice(
    "dev1",
    toRecord([
      entity("camera.cam", "sub"),
      entity("button.left", "ptz_left"),
      entity("button.zoom_in", "ptz_zoom_in"),
      entity("number.zoom", "zoom"),
      entity("select.preset", "ptz_preset"),
    ]),
    { dev1: device("dev1") },
  );

  test("hides pan & tilt but keeps optical zoom", () => {
    const result = limitControls(full, { ptz: false, opticalZoom: true });
    expect(result.ptz.directions).toEqual({});
    expect(result.presetSelect).toBeUndefined();
    expect(result.ptz.zoom).toEqual({ zoom_in: "button.zoom_in" });
    expect(hasPtzControls(result)).toBe(true);
  });

  test("hides everything when both are off", () => {
    expect(hasPtzControls(limitControls(full, { ptz: false, opticalZoom: false }))).toBe(false);
  });
});

describe("pickCamera", () => {
  const base = resolveCameraDevice(
    "dev1",
    toRecord([entity("camera.sub", "sub"), entity("camera.main", "main")]),
    { dev1: device("dev1") },
  );

  test("returns the preferred stream", () => {
    expect(pickCamera(base, "main")).toBe("camera.main");
    expect(pickCamera(base, "sub")).toBe("camera.sub");
  });

  test("skips unavailable streams", () => {
    const states = {
      "camera.main": { entity_id: "camera.main", state: "unavailable", attributes: {} },
      "camera.sub": { entity_id: "camera.sub", state: "idle", attributes: {} },
    } as never;
    expect(pickCamera(base, "main", states)).toBe("camera.sub");
  });

  test("falls back when the stream is disabled", () => {
    expect(pickCamera(base, "ext")).toBe("camera.sub");
  });
});

test("findFirstCameraDevice accepts any integration", () => {
  const entities = toRecord([
    entity("button.reolink", "ptz_left", "devY"),
    entity("camera.onvif", "profile_0", "devX", "onvif"),
  ]);
  expect(findFirstCameraDevice(entities)).toBe("devX");
});

describe("door", () => {
  test("accepts lock, button and switch entities", () => {
    expect(isDoorEntity("lock.front")).toBe(true);
    expect(isDoorEntity("button.relay_1")).toBe(true);
    expect(isDoorEntity("switch.gate")).toBe(true);
    expect(isDoorEntity("light.porch")).toBe(false);
    expect(isDoorEntity(undefined)).toBe(false);
  });

  test("calls the opening service of the entity's domain", async () => {
    const calls: unknown[][] = [];
    const api = {
      callService: async (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as HassApi;
    await openDoor(api, "lock.front");
    await openDoor(api, "button.relay_1");
    await openDoor(api, "switch.gate");
    expect(calls).toEqual([
      ["lock", "unlock", undefined, { entity_id: "lock.front" }],
      ["button", "press", undefined, { entity_id: "button.relay_1" }],
      ["switch", "turn_on", undefined, { entity_id: "switch.gate" }],
    ]);
  });
});
