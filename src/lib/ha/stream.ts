import { fetchCameraCapabilities, fetchHlsUrl, type StreamType } from "./camera";
import { attachHls } from "./hls";
import type { HassApi, HassConnectionContext, HassEntity } from "./types";
import { WebRtcSession } from "./webrtc";

export type StreamMode = "connecting" | StreamType | "mjpeg";

/** How long WebRTC gets to deliver a video track before we fall back. */
const WEBRTC_TIMEOUT_MS = 12_000;

export interface StartStreamOptions {
  api: HassApi;
  connection: HassConnectionContext;
  stateObj: HassEntity;
  video: HTMLVideoElement;
  onMode: (mode: StreamMode) => void;
  /** Injectable for tests. */
  webRtcTimeoutMs?: number;
  /** Injectable for tests. */
  createWebRtcSession?: (opts: ConstructorParameters<typeof WebRtcSession>[0]) => WebRtcSession;
}

/** One attempt at one stream type. Callbacks of stale attempts are ignored. */
interface Attempt {
  /** True while this attempt is the one that should drive the video. */
  current: () => boolean;
  /** Moves on to the next stream type; only the first call per attempt counts. */
  fail: (err: Error) => void;
  /** Hands over teardown; runs it right away if the attempt is already over. */
  own: (cleanup: () => void) => void;
}

/**
 * Always tries WebRTC first, then HLS, then MJPEG (rendered by the caller as
 * an `<img>` once mode is `mjpeg`). Late failures fall through to the next
 * option too. Returns a cleanup function.
 */
export function startCameraStream(opts: StartStreamOptions): () => void {
  let disposed = false;
  let attemptId = 0;
  let cleanup: (() => void) | undefined;

  const teardown = () => {
    const run = cleanup;
    cleanup = undefined;
    run?.();
  };

  const tryNext = (order: readonly StreamType[]): void => {
    if (disposed) return;
    const id = ++attemptId;
    teardown();
    const [type, ...rest] = order;
    if (!type) {
      opts.onMode("mjpeg");
      return;
    }

    let over = false;
    const attempt: Attempt = {
      current: () => !disposed && !over && attemptId === id,
      fail: (err) => {
        if (!attempt.current()) return;
        over = true;
        console.warn(`[camera-plus-card] ${type} failed, falling back`, err);
        tryNext(rest);
      },
      own: (stop) => {
        if (attempt.current()) cleanup = stop;
        else stop();
      },
    };
    const start = type === "web_rtc" ? startWebRtc(attempt) : startHls(attempt);
    start.catch((err) => attempt.fail(err instanceof Error ? err : new Error(String(err))));
  };

  const startWebRtc = async (attempt: Attempt) => {
    const create = opts.createWebRtcSession ?? ((sessionOpts) => new WebRtcSession(sessionOpts));
    let stream: MediaStream | undefined;
    const session = create({
      api: opts.api,
      connection: opts.connection.connection,
      entityId: opts.stateObj.entity_id,
      onStream: (next) => {
        // Audio can arrive first; only a video track counts as "playing".
        if (!attempt.current() || next.getVideoTracks().length === 0) return;
        clearTimeout(timeout);
        stream = next;
        if (opts.video.srcObject !== next) opts.video.srcObject = next;
        opts.onMode("web_rtc");
      },
      onError: attempt.fail,
    });
    const timeout = setTimeout(
      () => attempt.fail(new Error("WebRTC timed out")),
      opts.webRtcTimeoutMs ?? WEBRTC_TIMEOUT_MS,
    );
    // Own the session before awaiting, so a timeout or disposal mid-negotiation closes it.
    attempt.own(() => {
      clearTimeout(timeout);
      session.close();
      if (stream && opts.video.srcObject === stream) opts.video.srcObject = null;
    });
    await session.start();
  };

  const startHls = async (attempt: Attempt) => {
    const url = await fetchHlsUrl(opts.api, opts.connection, opts.stateObj.entity_id);
    if (!attempt.current()) return;
    const detach = await attachHls(opts.video, url, attempt.fail);
    attempt.own(detach);
    if (attempt.current()) opts.onMode("hls");
  };

  const run = async () => {
    opts.onMode("connecting");
    let types: StreamType[] = [];
    try {
      types = (await fetchCameraCapabilities(opts.api, opts.stateObj)).frontend_stream_types;
    } catch (err) {
      console.warn("[camera-plus-card] camera/capabilities failed", err);
    }
    tryNext((["web_rtc", "hls"] as const).filter((type) => types.includes(type)));
  };

  void run();
  return () => {
    disposed = true;
    teardown();
  };
}
