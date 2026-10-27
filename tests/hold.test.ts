import { describe, expect, mock, test } from "bun:test";
import type { CameraDevice } from "../src/lib/camera/device";
import { directionAction, zoomAction } from "../src/lib/ptz/actions";
import { HoldController } from "../src/lib/ptz/hold";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("HoldController", () => {
  test("starts on press and stops on release", async () => {
    const calls: string[] = [];
    const hold = new HoldController();
    hold.press("left", {
      start: async () => calls.push("start"),
      stop: async () => calls.push("stop"),
    });
    expect(hold.activeId).toBe("left");
    await hold.release("left");
    expect(calls).toEqual(["start", "stop"]);
    expect(hold.activeId).toBeUndefined();
  });

  test("sends stop only after a slow start resolved", async () => {
    const calls: string[] = [];
    let resolveStart!: () => void;
    const hold = new HoldController();
    hold.press("up", {
      start: () =>
        new Promise<void>((resolve) => {
          resolveStart = () => {
            calls.push("start");
            resolve();
          };
        }),
      stop: async () => calls.push("stop"),
    });
    const released = hold.release();
    await tick();
    expect(calls).toEqual([]);
    resolveStart();
    await released;
    expect(calls).toEqual(["start", "stop"]);
  });

  test("ignores releases for other ids and stops the previous hold on a new press", async () => {
    const stopLeft = mock(async () => undefined);
    const hold = new HoldController();
    hold.press("left", { start: async () => undefined, stop: stopLeft });
    await hold.release("right");
    expect(stopLeft).not.toHaveBeenCalled();
    hold.press("right", { start: async () => undefined, stop: async () => undefined });
    await tick();
    expect(stopLeft).toHaveBeenCalledTimes(1);
    expect(hold.activeId).toBe("right");
  });

  test("switching holds sends the previous stop before the next start", async () => {
    const calls: string[] = [];
    const hold = new HoldController();
    const action = (name: string) => ({
      start: async () => {
        await tick();
        calls.push(`start${name}`);
      },
      stop: async () => {
        await tick();
        calls.push(`stop${name}`);
      },
    });
    hold.press("up", action("A"));
    hold.press("left", action("B"));
    await sleep(20);
    await hold.release();
    expect(calls).toEqual(["startA", "stopA", "startB", "stopB"]);
  });

  test("safety timeout stops a stuck hold", async () => {
    const stop = mock(async () => undefined);
    const hold = new HoldController({ safetyTimeoutMs: 10 });
    hold.press("down", { start: async () => undefined, stop });
    await sleep(30);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(hold.activeId).toBeUndefined();
  });

  test("repeats step actions while held", async () => {
    const start = mock(async () => undefined);
    const hold = new HoldController();
    hold.press("zoom_in", { start, repeatMs: 5 });
    await sleep(30);
    await hold.release();
    const count = start.mock.calls.length;
    expect(count).toBeGreaterThan(2);
    await sleep(20);
    expect(start.mock.calls.length).toBe(count);
  });
});

describe("PTZ actions", () => {
  const device: CameraDevice = {
    deviceId: "dev1",
    name: "Cam",
    cameras: [],
    streams: {},
    ptz: {
      directions: { left: "button.left" },
      zoom: {},
      stop: "button.stop",
      speedService: { domain: "reolink", service: "ptz_move", featureBit: 2 },
    },
    zoomNumber: "number.zoom",
  };

  const createApi = () => {
    const calls: unknown[][] = [];
    return {
      calls,
      api: {
        callWS: async () => undefined as never,
        callApiRaw: async () => new Response(),
        callService: async (...args: unknown[]) => {
          calls.push(args);
        },
      },
    };
  };

  test("direction presses the button and stop presses ptz_stop", async () => {
    const { api, calls } = createApi();
    const action = directionAction({ api, getStates: () => ({}), device }, "left")!;
    await action.start();
    await action.stop?.();
    expect(calls).toEqual([
      ["button", "press", undefined, { entity_id: "button.left" }],
      ["button", "press", undefined, { entity_id: "button.stop" }],
    ]);
  });

  test("uses reolink.ptz_move when a speed is set and supported", async () => {
    const { api, calls } = createApi();
    const states = {
      "button.left": { entity_id: "button.left", state: "unknown", attributes: { supported_features: 2 } },
    } as never;
    const action = directionAction({ api, getStates: () => states, device, speed: 20 }, "left")!;
    await action.start();
    expect(calls[0]).toEqual(["reolink", "ptz_move", { speed: 20 }, { entity_id: "button.left" }]);
  });

  test("zoom falls back to stepping the zoom number within its range", async () => {
    const { api, calls } = createApi();
    const states = {
      "number.zoom": {
        entity_id: "number.zoom",
        state: "9",
        attributes: { min: 0, max: 10, step: 1 },
      },
    } as never;
    const action = zoomAction({ api, getStates: () => states, device }, "zoom_in")!;
    expect(action.repeatMs).toBeGreaterThan(0);
    expect(action.stop).toBeUndefined();
    await action.start();
    await action.start();
    expect(calls).toEqual([["number", "set_value", { value: 10 }, { entity_id: "number.zoom" }]]);
  });
});
