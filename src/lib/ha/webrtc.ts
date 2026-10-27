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
  onStream: (stream: MediaStream) => void;
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

  constructor(opts: WebRtcSessionOptions) {
    this.#opts = opts;
  }

  async start(): Promise<void> {
    const { api, entityId } = this.#opts;
    const clientConfig = await api.callWS<WebRtcClientConfig>({
      type: "camera/webrtc/get_client_config",
      entity_id: entityId,
    });
    if (this.#closed) return;

    const pc = (this.#opts.createPeerConnection ?? ((c) => new RTCPeerConnection(c)))(
      clientConfig.configuration,
    );
    this.#pc = pc;

    if (clientConfig.dataChannel) {
      pc.createDataChannel(clientConfig.dataChannel);
    }
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addTransceiver("video", { direction: "recvonly" });

    pc.onicecandidate = (event) => {
      if (!event.candidate?.candidate) return;
      if (this.#sessionId) {
        this.#sendCandidate(event.candidate);
      } else {
        this.#pendingCandidates.push(event.candidate);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        pc.restartIce();
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && !this.#closed) {
        this.#opts.onError(new Error("WebRTC connection failed"));
      }
    };
    pc.ontrack = (event) => {
      this.#stream.addTrack(event.track);
      this.#opts.onStream(this.#stream);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.#closed) return;

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
        this.#sessionId = event.session_id;
        for (const candidate of this.#pendingCandidates.splice(0)) {
          this.#sendCandidate(candidate);
        }
        break;
      case "answer":
        if (pc.signalingState === "stable" || pc.signalingState === "closed") return;
        await pc.setRemoteDescription({ type: "answer", sdp: event.answer });
        break;
      case "candidate": {
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
