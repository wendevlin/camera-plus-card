import { expect, test } from "bun:test";
import { type StartStreamOptions, type StreamMode, startCameraStream } from "../src/lib/ha/stream";
import type { HassApi, HassConnectionContext, HassEntity } from "../src/lib/ha/types";
import type { WebRtcSession } from "../src/lib/ha/webrtc";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SessionOpts = Parameters<NonNullable<StartStreamOptions["createWebRtcSession"]>>[0];

/** Fake sessions whose `start()` is controlled by the test; one entry per session created. */
const fakeSessions = (start: () => Promise<void>) => {
  const sessions: { opts: SessionOpts; closed: number }[] = [];
  const create = (opts: SessionOpts) => {
    const entry = { opts, closed: 0 };
    sessions.push(entry);
    return { start, close: () => entry.closed++ } as unknown as WebRtcSession;
  };
  return { sessions, create };
};

const setup = (create: StartStreamOptions["createWebRtcSession"], supportedFeatures = 2) => {
  const modes: StreamMode[] = [];
  const api = { callWS: async () => undefined } as unknown as HassApi;
  const connection = { connection: {}, connected: true, hassUrl: (p = "") => p } as HassConnectionContext;
  const stateObj = {
    entity_id: "camera.x",
    state: "idle",
    attributes: { supported_features: supportedFeatures },
  } as HassEntity;
  const video = { srcObject: null } as unknown as HTMLVideoElement;
  const stop = startCameraStream({
    api,
    connection,
    stateObj,
    video,
    onMode: (mode) => modes.push(mode),
    connectTimeoutMs: 20,
    createWebRtcSession: create,
  });
  return { modes, video, stop };
};

const videoStream = (video: boolean) =>
  ({ getVideoTracks: () => (video ? [{}] : []) }) as unknown as MediaStream;

test("a camera without stream support shows an error without trying WebRTC", () => {
  const { sessions, create } = fakeSessions(async () => {});
  const { modes } = setup(create, 0);
  expect(sessions).toHaveLength(0);
  expect(modes).toEqual(["error"]);
});

test("a session that doesn't connect is replaced once, then the mode is error", async () => {
  const { sessions, create } = fakeSessions(() => new Promise<void>(() => {}));
  const { modes, video } = setup(create);
  await sleep(80);
  expect(sessions).toHaveLength(2);
  expect(sessions.map((s) => s.closed)).toEqual([1, 1]);
  expect(modes).toEqual(["connecting", "connecting", "error"]);

  // A session that was replaced must not take over the video again.
  sessions[0]?.opts.onStream(videoStream(true));
  sessions[0]?.opts.onError(new Error("late"));
  await sleep(10);
  expect(video.srcObject).toBeNull();
  expect(modes.at(-1)).toBe("error");
  expect(sessions).toHaveLength(2);
});

test("an audio-only track doesn't count as live", async () => {
  const { sessions, create } = fakeSessions(async () => {});
  const { modes, video } = setup(create);
  await sleep(5);
  sessions[0]?.opts.onStream(videoStream(false));
  expect(modes).not.toContain("live");
  expect(video.srcObject).toBeNull();
});

test("a connected session stays, and disposal closes it", async () => {
  const { sessions, create } = fakeSessions(async () => {});
  const { modes, video, stop } = setup(create);
  await sleep(5);
  const stream = videoStream(true);
  sessions[0]?.opts.onStream(stream);
  sessions[0]?.opts.onConnected?.();
  expect(modes.at(-1)).toBe("live");
  expect(video.srcObject).toBe(stream);
  await sleep(40); // past the timeout: it must have been cleared
  expect(modes.at(-1)).toBe("live");
  expect(sessions).toHaveLength(1);
  stop();
  expect(sessions[0]?.closed).toBe(1);
  expect(video.srcObject).toBeNull();
});

test("a drop right after connecting counts as a failed attempt", async () => {
  const { sessions, create } = fakeSessions(async () => {});
  const { modes } = setup(create);
  await sleep(5);
  for (const index of [0, 1]) {
    sessions[index]?.opts.onConnected?.();
    sessions[index]?.opts.onError(new Error("dropped"));
  }
  expect(sessions).toHaveLength(2);
  expect(modes.at(-1)).toBe("error");
});

test("a drop after running for a while reconnects with a fresh set of attempts", async () => {
  const { sessions, create } = fakeSessions(async () => {});
  const { modes } = setup(create);
  await sleep(5);
  sessions[0]?.opts.onStream(videoStream(true));
  sessions[0]?.opts.onConnected?.();
  await sleep(30); // longer than the connect timeout
  sessions[0]?.opts.onError(new Error("dropped"));
  expect(sessions).toHaveLength(2);
  expect(modes.at(-1)).toBe("connecting");
  // The new session gets two tries again before giving up.
  await sleep(80);
  expect(sessions).toHaveLength(3);
  expect(modes.at(-1)).toBe("error");
});
