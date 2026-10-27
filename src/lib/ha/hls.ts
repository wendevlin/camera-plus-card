/**
 * Attaches an HLS stream to a video element. Prefers hls.js wherever Media
 * Source Extensions exist (like HA's own `ha-hls-player`), because
 * `canPlayType` answers "maybe" in Chrome and Android WebView without being
 * reliable. Native HLS is only used where hls.js can't run (iPhone Safari).
 * hls.js is lazy-loaded into its own chunk. Returns a cleanup function.
 */
export async function attachHls(
  video: HTMLVideoElement,
  url: string,
  onError: (error: Error) => void,
): Promise<() => void> {
  const { default: Hls } = await import("hls.js/light");

  if (!Hls.isSupported()) {
    if (!video.canPlayType("application/vnd.apple.mpegurl")) {
      throw new Error("HLS is not supported in this browser");
    }
    const onNativeError = () =>
      onError(new Error(`Native HLS: ${video.error?.message ?? "playback failed"}`));
    video.addEventListener("error", onNativeError);
    video.src = url;
    return () => {
      video.removeEventListener("error", onNativeError);
      video.removeAttribute("src");
      video.load();
    };
  }

  const hls = new Hls({
    backBufferLength: 60,
    liveDurationInfinity: true,
    lowLatencyMode: true,
  });
  let recovered = false;
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    // One recovery attempt for transient network/decoder hiccups before falling back.
    if (!recovered && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      recovered = true;
      hls.recoverMediaError();
    } else if (!recovered && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      recovered = true;
      hls.startLoad();
    } else {
      onError(new Error(`HLS: ${data.details}`));
    }
  });
  hls.attachMedia(video);
  hls.loadSource(url);
  return () => hls.destroy();
}
