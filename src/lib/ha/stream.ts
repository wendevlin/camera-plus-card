import { supportsStream } from "./camera";
import type { HassApi, HassConnectionContext, HassEntity } from "./types";
import { WebRtcSession } from "./webrtc";

export type StreamMode = "connecting" | "live" | "error";

/** How long one WebRTC session gets to connect (ICE and DTLS up) before it's replaced. */
const CONNECT_TIMEOUT_MS = 10_000;
/** Sessions tried before giving up; a stuck negotiation often succeeds on a fresh one. */
const MAX_ATTEMPTS = 2;

export interface StartStreamOptions {
  api: HassApi;
  connection: HassConnectionContext;
  stateObj: HassEntity;
  video: HTMLVideoElement;
  onMode: (mode: StreamMode) => void;
  /** Injectable for tests. */
  connectTimeoutMs?: number;
  /** Injectable for tests. */
  createWebRtcSession?: (opts: ConstructorParameters<typeof WebRtcSession>[0]) => WebRtcSession;
}

/**
 * Streams the camera over WebRTC. A session that fails or doesn't connect in
 * time is replaced once; after that the mode is `error` and the caller offers
 * a retry. A session that drops after running for longer than the connect
 * timeout gets a fresh set of attempts; one that drops right after connecting
 * counts as a failed attempt, so a flapping camera can't reconnect forever.
 * Returns a cleanup function.
 */
export function startCameraStream(opts: StartStreamOptions): () => void {
  let disposed = false;
  let attemptId = 0;
  let cleanup: (() => void) | undefined;
  const timeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;

  const teardown = () => {
    const run = cleanup;
    cleanup = undefined;
    run?.();
  };

  const attempt = (number: number): void => {
    if (disposed) return;
    const id = ++attemptId;
    teardown();
    opts.onMode("connecting");
    const current = () => !disposed && attemptId === id;
    let connectedAt: number | undefined;
    let stream: MediaStream | undefined;

    const fail = (err: Error) => {
      if (!current()) return;
      // Invalidate this attempt right away, so its late callbacks are ignored.
      attemptId++;
      teardown();
      const stable = connectedAt !== undefined && performance.now() - connectedAt >= timeoutMs;
      const retry = stable || number < MAX_ATTEMPTS;
      console.warn(`[camera-plus-card] WebRTC failed${retry ? ", retrying" : ""}`, err);
      if (retry) {
        attempt(stable ? 1 : number + 1);
      } else {
        opts.onMode("error");
      }
    };

    const create = opts.createWebRtcSession ?? ((sessionOpts) => new WebRtcSession(sessionOpts));
    const session = create({
      api: opts.api,
      connection: opts.connection.connection,
      entityId: opts.stateObj.entity_id,
      onStream: (next) => {
        // Audio can arrive first; only a video track counts.
        if (!current() || next.getVideoTracks().length === 0) return;
        stream = next;
        // Reassign even when it's the same stream, like HA's own player: a track
        // added after the first assignment (usually audio) is otherwise not always played.
        opts.video.srcObject = next;
        opts.onMode("live");
      },
      onConnected: () => {
        if (!current()) return;
        connectedAt = performance.now();
        clearTimeout(timeout);
      },
      onError: fail,
    });
    const timeout = setTimeout(() => fail(new Error("WebRTC didn't connect in time")), timeoutMs);
    // Set before awaiting, so a timeout or disposal mid-negotiation closes the session.
    cleanup = () => {
      clearTimeout(timeout);
      session.close();
      if (stream && opts.video.srcObject === stream) opts.video.srcObject = null;
    };
    session.start().catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
  };

  if (supportsStream(opts.stateObj)) {
    attempt(1);
  } else {
    console.warn(`[camera-plus-card] ${opts.stateObj.entity_id} doesn't support streaming`);
    opts.onMode("error");
  }

  return () => {
    disposed = true;
    attemptId++;
    teardown();
  };
}
