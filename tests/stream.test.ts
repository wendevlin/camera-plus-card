import { expect, test } from "bun:test";
import { type StartStreamOptions, type StreamMode, startCameraStream } from "../src/lib/ha/stream";
import type { HassApi, HassConnectionContext, HassEntity } from "../src/lib/ha/types";
import type { WebRtcSession } from "../src/lib/ha/webrtc";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SessionOpts = Parameters<NonNullable<StartStreamOptions["createWebRtcSession"]>>[0];

/** Fake session whose `start()` is controlled by the test. */
const fakeSession = (start: () => Promise<void>) => {
  const state = { closed: 0, opts: undefined as SessionOpts | undefined };
  const create = (opts: SessionOpts) => {
    state.opts = opts;
    return { start, close: () => state.closed++ } as unknown as WebRtcSession;
  };
  return { state, create };
};

const setup = (create: StartStreamOptions["createWebRtcSession"], types: string[] = ["web_rtc", "hls"]) => {
  const modes: StreamMode[] = [];
  const ws: string[] = [];
  const api = {
    callWS: async (msg: { type: string }) => {
      ws.push(msg.type);
      if (msg.type === "camera/capabilities") return { frontend_stream_types: types };
      if (msg.type === "camera/stream") return { url: "/api/hls/x/master.m3u8" };
      return undefined;
    },
  } as unknown as HassApi;
  const connection = { connection: {}, connected: true, hassUrl: (p = "") => p } as HassConnectionContext;
  const stateObj = {
    entity_id: "camera.x",
    state: "idle",
    attributes: { supported_features: 2 },
  } as HassEntity;
  // No MSE and no native HLS here, so HLS fails and the chain ends in MJPEG.
  const video = { srcObject: null, canPlayType: () => "" } as unknown as HTMLVideoElement;
  const stop = startCameraStream({
    api,
    connection,
    stateObj,
    video,
    onMode: (mode) => modes.push(mode),
    webRtcTimeoutMs: 20,
    createWebRtcSession: create,
  });
  return { modes, ws, video, stop };
};

const videoStream = (video: boolean) =>
  ({ getVideoTracks: () => (video ? [{}] : []) }) as unknown as MediaStream;

test("a WebRTC timeout during negotiation closes the session and falls back once", async () => {
  let resolveStart!: () => void;
  const { state, create } = fakeSession(() => new Promise<void>((r) => (resolveStart = r)));
  const { modes, ws, video } = setup(create);
  await sleep(80);
  expect(state.closed).toBe(1);
  expect(modes.at(-1)).toBe("mjpeg");

  // Negotiation finishing late must not take over the video again.
  resolveStart();
  state.opts?.onStream(videoStream(true));
  await sleep(10);
  expect(video.srcObject).toBeNull();
  expect(modes.at(-1)).toBe("mjpeg");
  expect(ws.filter((type) => type === "camera/stream")).toHaveLength(1);
});

test("a late start() rejection after the timeout doesn't start a second fallback", async () => {
  let rejectStart!: (err: Error) => void;
  const { create } = fakeSession(() => new Promise<void>((_, reject) => (rejectStart = reject)));
  const { modes, ws } = setup(create);
  await sleep(80);
  rejectStart(new Error("late"));
  await sleep(20);
  expect(modes.filter((mode) => mode === "mjpeg")).toHaveLength(1);
  expect(ws.filter((type) => type === "camera/stream")).toHaveLength(1);
});

test("an audio-only track doesn't count as playing", async () => {
  const { state, create } = fakeSession(async () => {});
  const { modes, video } = setup(create, ["web_rtc"]);
  await sleep(5);
  state.opts?.onStream(videoStream(false));
  expect(modes).not.toContain("web_rtc");
  await sleep(60);
  expect(modes.at(-1)).toBe("mjpeg");
  expect(video.srcObject).toBeNull();
});

test("a video track switches to web_rtc and disposal closes the session", async () => {
  const { state, create } = fakeSession(async () => {});
  const { modes, video, stop } = setup(create);
  await sleep(5);
  const stream = videoStream(true);
  state.opts?.onStream(stream);
  expect(modes.at(-1)).toBe("web_rtc");
  expect(video.srcObject).toBe(stream);
  await sleep(40); // past the timeout: it must have been cleared
  expect(modes.at(-1)).toBe("web_rtc");
  stop();
  expect(state.closed).toBe(1);
  expect(video.srcObject).toBeNull();
});
