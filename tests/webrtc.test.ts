import { afterAll, beforeAll, expect, test } from "bun:test";
import type { HassApi, HassConnection } from "../src/lib/ha/types";
import { WebRtcSession } from "../src/lib/ha/webrtc";

// Minimal browser shims; bun has no WebRTC.
class FakeMediaStream {
  tracks: unknown[] = [];
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  getTracks() {
    return [];
  }
}

const originalMediaStream = globalThis.MediaStream;
beforeAll(() => {
  globalThis.MediaStream = FakeMediaStream as never;
});
afterAll(() => {
  globalThis.MediaStream = originalMediaStream;
});

class FakePeerConnection {
  signalingState = "have-local-offer";
  iceConnectionState = "new";
  connectionState = "new";
  remote?: RTCSessionDescriptionInit;
  candidates: RTCIceCandidateInit[] = [];
  closed = false;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  ontrack: ((event: { track: unknown }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTransceiver() {}
  createDataChannel() {}
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remote = desc;
    this.signalingState = "stable";
  }
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.candidates.push(candidate);
  }
  restartIce() {}
  close() {
    this.closed = true;
  }
}

test("negotiates through camera/webrtc/* and queues ICE until the session id", async () => {
  const wsCalls: Record<string, unknown>[] = [];
  const api = {
    callWS: async (msg: Record<string, unknown>) => {
      wsCalls.push(msg);
      if (msg.type === "camera/webrtc/get_client_config") return { configuration: {} };
      return undefined;
    },
    callService: async () => undefined,
    callApiRaw: async () => new Response(),
  } as unknown as HassApi;

  let emit!: (event: unknown) => void;
  let subscribeMessage: Record<string, unknown> | undefined;
  let unsubscribed = false;
  const connection: HassConnection = {
    subscribeMessage: async (callback, message) => {
      emit = callback as (event: unknown) => void;
      subscribeMessage = message;
      return async () => {
        unsubscribed = true;
      };
    },
  };

  const pc = new FakePeerConnection();
  const streams: unknown[] = [];
  const session = new WebRtcSession({
    api,
    connection,
    entityId: "camera.garden",
    onStream: (stream) => streams.push(stream),
    onError: (err) => {
      throw err;
    },
    createPeerConnection: () => pc as unknown as RTCPeerConnection,
  });
  await session.start();

  expect(subscribeMessage).toEqual({
    type: "camera/webrtc/offer",
    entity_id: "camera.garden",
    offer: "v=0 offer",
  });

  // A local candidate before the session id is queued.
  pc.onicecandidate?.({ candidate: { candidate: "a", toJSON: () => ({ candidate: "a" }) } });
  expect(wsCalls.filter((m) => m.type === "camera/webrtc/candidate")).toHaveLength(0);

  emit({ type: "session", session_id: "s1" });
  await Promise.resolve();
  expect(wsCalls.filter((m) => m.type === "camera/webrtc/candidate")).toEqual([
    {
      type: "camera/webrtc/candidate",
      entity_id: "camera.garden",
      session_id: "s1",
      candidate: { candidate: "a" },
    },
  ]);

  emit({ type: "answer", answer: "v=0 answer" });
  await Promise.resolve();
  expect(pc.remote).toEqual({ type: "answer", sdp: "v=0 answer" });

  emit({ type: "candidate", candidate: { candidate: "b" } });
  await Promise.resolve();
  expect(pc.candidates).toEqual([{ candidate: "b", sdpMid: "0" }]);

  pc.ontrack?.({ track: {} });
  expect(streams).toHaveLength(1);

  session.close();
  expect(pc.closed).toBe(true);
  expect(unsubscribed).toBe(true);
});
