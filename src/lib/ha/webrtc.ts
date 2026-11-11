import { limitIceServers } from "./ice-servers";
import type { HassApi, HassConnection } from "./types";

interface WebRtcClientConfig {
  configuration: RTCConfiguration;
  dataChannel?: string;
}

type WebRtcOfferEvent =
  | { type: "session"; session_id: string }
  | { type: "answer"; answer: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "error"; code: string; message: string };

export interface WebRtcSessionOptions {
  api: HassApi;
  connection: HassConnection;
  entityId: string;
  /**
   * Use every ICE server URL HA returns instead of the reduced set. Slower,
   * but covers a network where only one of the removed URLs works.
   */
  allIceServers?: boolean;
  onStream: (stream: MediaStream) => void;
  /** ICE and DTLS are up; media can flow. */
  onConnected?: () => void;
  onError: (error: Error) => void;
  /** Injectable for tests. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

/**
 * One WebRTC viewing session against HA's `camera/webrtc/*` API.
 * Follows the same flow as `ha-web-rtc-player.ts`.
 */
export class WebRtcSession {
  #opts: WebRtcSessionOptions;
  #pc?: RTCPeerConnection;
  #unsub?: () => Promise<void>;
  #sessionId?: string;
  #pendingCandidates: RTCIceCandidate[] = [];
  #stream = new MediaStream();
  #closed = false;
  #startedAt = 0;
  #logged = new Set<string>();

  constructor(opts: WebRtcSessionOptions) {
    this.#opts = opts;
  }

  /**
   * Timing of each negotiation step, to see where a slow start spends its time.
   * Shown in the browser console with the "Verbose" level enabled.
   */
  #log(step: string, once = true): void {
    if (once && this.#logged.has(step)) return;
    this.#logged.add(step);
    const ms = Math.round(performance.now() - this.#startedAt);
    console.debug(`[camera-plus-card] ${this.#opts.entityId} WebRTC +${ms}ms ${step}`);
  }

  async start(): Promise<void> {
    const { api, entityId } = this.#opts;
    this.#startedAt = performance.now();
    this.#log("start");
    const clientConfig = await api.callWS<WebRtcClientConfig>({
      type: "camera/webrtc/get_client_config",
      entity_id: entityId,
    });
    if (this.#closed) return;
    this.#log("client config");

    const { configuration } = clientConfig;
    const pc = (this.#opts.createPeerConnection ?? ((c) => new RTCPeerConnection(c)))(
      this.#opts.allIceServers
        ? configuration
        : { ...configuration, iceServers: limitIceServers(configuration.iceServers) },
    );
    this.#pc = pc;

    if (clientConfig.dataChannel) {
      pc.createDataChannel(clientConfig.dataChannel);
    }
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addTransceiver("video", { direction: "recvonly" });

    pc.onicecandidate = (event) => {
      if (!event.candidate?.candidate) {
        this.#log("local ICE gathering complete");
        return;
      }
      this.#log("first local ICE candidate");
      if (this.#sessionId) {
        this.#sendCandidate(event.candidate);
      } else {
        this.#pendingCandidates.push(event.candidate);
      }
    };
    // No ICE restart: it needs a renegotiation HA's offer API doesn't offer.
    // A failure ends the session and the caller starts a fresh one.
    pc.oniceconnectionstatechange = () => {
      if (this.#closed) return;
      this.#log(`ICE ${pc.iceConnectionState}`, false);
      if (pc.iceConnectionState === "failed") {
        this.#opts.onError(new Error("WebRTC ICE connection failed"));
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.#closed) return;
      this.#log(`connection ${pc.connectionState}`, false);
      if (pc.connectionState === "connected") {
        this.#opts.onConnected?.();
      } else if (pc.connectionState === "failed") {
        this.#opts.onError(new Error("WebRTC connection failed"));
      }
    };
    pc.ontrack = (event) => {
      this.#log(`${event.track.kind} track`);
      this.#stream.addTrack(event.track);
      this.#opts.onStream(this.#stream);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.#closed) return;

    this.#log("offer sent");
    this.#unsub = await this.#opts.connection.subscribeMessage<WebRtcOfferEvent>(
      (event) => this.#handleOfferEvent(event),
      { type: "camera/webrtc/offer", entity_id: entityId, offer: offer.sdp },
      // After a reconnect the stale offer would open an orphaned backend session;
      // the player restarts the stream itself when the connection comes back.
      { resubscribe: false },
    );
    if (this.#closed) {
      void this.#unsub();
    }
  }

  async #handleOfferEvent(event: WebRtcOfferEvent): Promise<void> {
    const pc = this.#pc;
    if (!pc || this.#closed) return;
    switch (event.type) {
      case "session":
        this.#log("session id");
        this.#sessionId = event.session_id;
        for (const candidate of this.#pendingCandidates.splice(0)) {
          this.#sendCandidate(candidate);
        }
        break;
      case "answer":
        this.#log("answer");
        if (pc.signalingState === "stable" || pc.signalingState === "closed") return;
        await pc.setRemoteDescription({ type: "answer", sdp: event.answer });
        break;
      case "candidate": {
        this.#log("first remote ICE candidate");
        const candidate =
          event.candidate.sdpMid == null && event.candidate.sdpMLineIndex == null
            ? { candidate: event.candidate.candidate, sdpMid: "0" }
            : event.candidate;
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.warn("[camera-plus-card] Failed to add ICE candidate", err);
        }
        break;
      }
      case "error":
        this.#opts.onError(new Error(`${event.code}: ${event.message}`));
        break;
    }
  }

  #sendCandidate(candidate: RTCIceCandidate): void {
    void this.#opts.api
      .callWS({
        type: "camera/webrtc/candidate",
        entity_id: this.#opts.entityId,
        session_id: this.#sessionId,
        candidate: candidate.toJSON(),
      })
      .catch((err) => console.warn("[camera-plus-card] Failed to send ICE candidate", err));
  }

  close(): void {
    this.#closed = true;
    void this.#unsub?.().catch(() => undefined);
    this.#unsub = undefined;
    if (this.#pc) {
      this.#pc.onicecandidate = null;
      this.#pc.ontrack = null;
      this.#pc.close();
      this.#pc = undefined;
    }
    for (const track of this.#stream.getTracks()) {
      track.stop();
    }
  }
}
