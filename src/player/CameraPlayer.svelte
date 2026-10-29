<script lang="ts" module>
  const knownAspectRatios = new Map<string, number>();
</script>

<script lang="ts">
  import Camera from "@lucide/svelte/icons/camera";
  import Check from "@lucide/svelte/icons/check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import DoorOpen from "@lucide/svelte/icons/door-open";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Maximize from "@lucide/svelte/icons/maximize";
  import Minimize from "@lucide/svelte/icons/minimize";
  import Move from "@lucide/svelte/icons/move";
  import PictureInPicture from "@lucide/svelte/icons/picture-in-picture-2";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Volume from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { untrack } from "svelte";
  import { type CameraDevice, hasPtzControls } from "$lib/camera/device";
  import { isDoorEntity, openDoor } from "$lib/door";
  import { visibleRegion } from "$lib/gestures/pan-zoom";
  import { PanZoom } from "$lib/gestures/pan-zoom.svelte";
  import { downloadSnapshot, fetchSnapshotUrl, mjpegUrl } from "$lib/ha/camera";
  import type { HassContext } from "$lib/ha/context.svelte";
  import { type StreamMode, startCameraStream } from "$lib/ha/stream";
  import type { Translate } from "$lib/i18n";
  import { pageVisibility } from "$lib/page-visibility.svelte";
  import { OVERLAY_SURFACE } from "$lib/styles";
  import { cn } from "$lib/utils";
  import ControlButton from "./ControlButton.svelte";
  import PtzOverlay from "./PtzOverlay.svelte";
  import ZoomPopover from "./ZoomPopover.svelte";

  const HIDE_CONTROLS_MS = 3000;
  /**
   * Transparent poster: without one, Android WebView (HA companion app) draws
   * a large grey play icon over the video until the first frame arrives.
   */
  const EMPTY_POSTER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  interface QualityOption {
    value: string;
    label: string;
  }

  interface Props {
    ctx: HassContext;
    entityId: string;
    t: Translate;
    /** Without controls the player is a passive live view (card `camera_view: live`). */
    controls?: boolean;
    device?: CameraDevice;
    ptzSpeed?: number;
    /** Lock, button or switch that opens a door; adds a confirmed door button. */
    doorEntity?: string;
    name?: string;
    quality?: { value: string; options: QualityOption[]; onchange: (value: string) => void };
    /** Fit the frame into the box (dialog) or fill it (card). */
    fit?: "contain" | "cover";
    /** Where PTZ controls go; `panel` renders them below the video (narrow portrait screens). */
    ptzLayout?: "overlay" | "panel";
    /** Bindable so the dialog can leave PTZ mode on Esc instead of closing. */
    ptzMode?: boolean;
    /** Bindable: width / height of the camera image, once known from the stream or a snapshot. */
    aspectRatio?: number;
    class?: string;
  }

  let {
    ctx,
    entityId,
    t,
    controls = false,
    device,
    ptzSpeed,
    doorEntity,
    name = "",
    quality,
    fit = "contain",
    ptzLayout = "overlay",
    ptzMode = $bindable(false),
    aspectRatio = $bindable(),
    class: className,
  }: Props = $props();

  let container = $state<HTMLDivElement>();
  let video = $state<HTMLVideoElement>();
  let mode = $state<StreamMode>("connecting");
  /** True once the video renders frames; until then the snapshot placeholder shows. */
  let playing = $state(false);
  let placeholder = $state<string>();

  // Remember ratios per camera so reopening the dialog doesn't start at 16:9 and jump.
  $effect.pre(() => {
    aspectRatio = knownAspectRatios.get(entityId);
  });

  const updateAspect = (width: number, height: number) => {
    if (!width || !height) return;
    const ratio = width / height;
    knownAspectRatios.set(entityId, ratio);
    if (aspectRatio === undefined || Math.abs(aspectRatio - ratio) > 0.01) aspectRatio = ratio;
  };
  const onImageLoad = (event: Event) => {
    const image = event.currentTarget as HTMLImageElement;
    updateAspect(image.naturalWidth, image.naturalHeight);
  };
  const onVideoSize = () => {
    if (video) updateAspect(video.videoWidth, video.videoHeight);
  };
  // Sound is on by default with controls; the passive live view has no mute button.
  // svelte-ignore state_referenced_locally
  let muted = $state(!controls);
  let fullscreen = $state(false);
  let controlsVisible = $state(true);
  let popoverOpen = $state(false);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);

  const isTouch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  type WebkitVideo = HTMLVideoElement & {
    webkitSupportsPresentationMode?: (mode: string) => boolean;
    webkitSetPresentationMode?: (mode: string) => void;
    webkitPresentationMode?: string;
  };
  // Standard API (Chrome, Edge, Android Chrome) or Safari's presentation mode (iOS).
  // Android WebView, used by the HA companion app, supports neither.
  const pipSupported = $derived(
    Boolean(
      video &&
        (document.pictureInPictureEnabled ||
          (video as WebkitVideo).webkitSupportsPresentationMode?.("picture-in-picture")),
    ),
  );

  const zoom = new PanZoom({ onTap: () => toggleControls() });
  const stateObj = $derived(ctx.states?.[entityId]);
  const unavailable = $derived(stateObj?.state === "unavailable");
  const ptzAvailable = $derived(controls && device !== undefined && hasPtzControls(device));
  const region = $derived(visibleRegion(zoom.transform, zoom.viewport));

  const connected = $derived(ctx.hassConnection?.connected !== false);
  // Track only identity changes of the camera, not every state update. Dropping
  // to undefined stops the stream: on disconnect (it restarts from WebRTC when
  // HA is back) and while the page is hidden (background tab, backgrounded app).
  const streamKey = $derived(
    stateObj && !unavailable && connected && pageVisibility.visible ? entityId : undefined,
  );
  let mjpegSrc = $state<string>();

  $effect(() => {
    zoom.resize({ width: viewportWidth, height: viewportHeight });
  });

  $effect(() => {
    const key = streamKey;
    const element = video;
    if (!key || !element) return;
    // Restart only when the camera or element changes, not on every state push.
    return untrack(() => {
      const api = ctx.hassApi;
      const connection = ctx.hassConnection;
      const camera = ctx.states?.[key];
      if (!api || !connection || !camera) return;
      return startCameraStream({
        api,
        connection,
        stateObj: camera,
        video: element,
        onMode: (next) => {
          if (next === "connecting") playing = false;
          // Capture the MJPEG URL once: its token rotates every 5 minutes, and a
          // reactive src would reconnect the stream each time.
          mjpegSrc =
            next === "mjpeg" && ctx.states?.[key] ? mjpegUrl(connection, ctx.states[key]) : undefined;
          if (mode === "connecting" && next !== "connecting" && controls) scheduleHide();
          mode = next;
        },
      });
    });
  });

  // Wait for the first layout so the placeholder isn't fetched at full camera resolution.
  const hasViewport = $derived(viewportWidth > 0);

  // Latest snapshot as a placeholder while the stream connects.
  $effect(() => {
    const key = streamKey;
    if (!key || !hasViewport) return;
    let cancelled = false;
    untrack(() => {
      const api = ctx.hassApi;
      const connection = ctx.hassConnection;
      if (!api || !connection) return;
      const width = Math.ceil((viewportWidth * devicePixelRatio) / 320) * 320;
      fetchSnapshotUrl(api, connection, key, width)
        .then((url) => {
          if (!cancelled) placeholder = url;
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      placeholder = undefined;
    };
  });

  // --- control bar auto-hide -------------------------------------------------
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!popoverOpen && mode !== "connecting") controlsVisible = false;
    }, HIDE_CONTROLS_MS);
  };

  const showControls = () => {
    controlsVisible = true;
    scheduleHide();
  };

  const toggleControls = () => {
    if (controlsVisible && !popoverOpen) {
      clearTimeout(hideTimer);
      controlsVisible = false;
    } else {
      showControls();
    }
  };

  $effect(() => {
    if (controls) scheduleHide();
    return () => clearTimeout(hideTimer);
  });

  // --- actions -------------------------------------------------------------
  const toggleFullscreen = async () => {
    if (!container || !video) return;
    const root = container.getRootNode() as ShadowRoot | Document;
    if (root.fullscreenElement) {
      await document.exitFullscreen();
    } else if (container.requestFullscreen) {
      await container.requestFullscreen();
    } else {
      // iPhone Safari only supports native video fullscreen.
      (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
    }
  };

  $effect(() => {
    const onChange = () => {
      const root = container?.getRootNode() as ShadowRoot | Document | undefined;
      fullscreen = root?.fullscreenElement === container;
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  });

  const togglePip = async () => {
    if (!video) return;
    const webkit = video as WebkitVideo;
    if (!document.pictureInPictureEnabled && webkit.webkitSetPresentationMode) {
      webkit.webkitSetPresentationMode(
        webkit.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture",
      );
    } else if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  };

  // Sets the element directly inside the click, so browsers that require a user
  // gesture to unmute (iOS, Android WebView) still count it as one.
  const toggleMute = () => {
    muted = !muted;
    if (!video) return;
    video.muted = muted;
    // Unmuting can pause an autoplaying video; resume it while the gesture is still active.
    if (!muted && video.paused) video.play().catch(() => (muted = true));
  };

  // Browsers only autoplay with sound after enough user interaction (iOS never).
  // When they refuse, play muted instead of staying black; the button turns sound on.
  const onCanPlay = () => {
    if (!video?.paused || video.muted) return;
    video.play().catch((err: unknown) => {
      if (!video || (err as DOMException).name !== "NotAllowedError") return;
      muted = true;
      video.muted = true;
      video.play().catch(() => undefined);
    });
  };

  const snapshot = () => {
    if (!ctx.hassApi) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = (name || entityId).replace(/[^\w-]+/g, "_");
    downloadSnapshot(ctx.hassApi, entityId, `${base}_${stamp}.jpg`).catch((err) =>
      console.warn("[camera-plus-card] Snapshot download failed", err),
    );
  };

  // Fullscreen always uses the overlay; there's no room below the video.
  const panelPtz = $derived(ptzMode && ptzLayout === "panel" && !fullscreen);

  // --- door ----------------------------------------------------------------
  const doorAvailable = $derived(
    controls && isDoorEntity(doorEntity) && ctx.states?.[doorEntity] !== undefined,
  );
  const doorName = $derived(
    (doorEntity && ctx.states?.[doorEntity]?.attributes.friendly_name) || t("player.door"),
  );
  let doorConfirm = $state(false);
  let doorStatus = $state<"idle" | "busy" | "done" | "error">("idle");
  let doorStatusTimer: ReturnType<typeof setTimeout> | undefined;

  const confirmDoor = async () => {
    if (!ctx.hassApi || !doorEntity) return;
    doorStatus = "busy";
    try {
      await openDoor(ctx.hassApi, doorEntity);
      doorStatus = "done";
    } catch (err) {
      console.warn("[camera-plus-card] Opening the door failed", err);
      doorStatus = "error";
    }
    doorConfirm = false;
    clearTimeout(doorStatusTimer);
    doorStatusTimer = setTimeout(() => (doorStatus = "idle"), 2500);
  };

  $effect(() => () => clearTimeout(doorStatusTimer));

  const enterPtz = () => {
    zoom.reset();
    ptzMode = true;
  };
</script>

<div
  bind:this={container}
  class={cn("group/player relative isolate overflow-hidden bg-black text-white select-none", className)}
  style:aspect-ratio={aspectRatio}
  onpointermove={controls && !isTouch ? showControls : undefined}
  role="presentation"
>
  <!-- Gesture layer: the transformed box keeps the viewport's size. -->
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: pointer gestures for zoom/pan; keyboard users get the zoom popover. -->
  <div
    class="absolute inset-0"
    style:touch-action={controls ? "none" : undefined}
    style:cursor={controls && zoom.zoomed && !ptzMode ? "grab" : undefined}
    bind:clientWidth={viewportWidth}
    bind:clientHeight={viewportHeight}
    onpointerdown={controls && !ptzMode ? zoom.onpointerdown : undefined}
    onpointermove={controls && !ptzMode ? zoom.onpointermove : undefined}
    onpointerup={controls && !ptzMode ? zoom.onpointerup : undefined}
    onpointercancel={controls && !ptzMode ? zoom.onpointercancel : undefined}
    ondblclick={controls && !ptzMode ? zoom.ondblclick : undefined}
    onwheel={controls && !ptzMode ? zoom.onwheel : undefined}
    role="presentation"
  >
    <div
      class={cn(
        "size-full will-change-transform",
        !ctx.reducedMotion && !zoom.zoomed && "transition-transform",
      )}
      style={zoom.style}
    >
      {#if placeholder && !playing && mode !== "mjpeg"}
        <img
          src={placeholder}
          onload={onImageLoad}
          alt=""
          class={cn("absolute inset-0 size-full", fit === "cover" ? "object-cover" : "object-contain")}
          draggable="false"
        >
      {/if}
      <!-- The video stays mounted so the stream effect isn't torn down on MJPEG fallback. -->
      <!-- biome-ignore lint/a11y/useMediaCaption: live camera feeds have no caption track. -->
      <video
        bind:this={video}
        bind:muted
        class={cn(
          "size-full",
          fit === "cover" ? "object-cover" : "object-contain",
          mode === "mjpeg" && "hidden",
          // Keep the element invisible until real frames arrive (no native loading UI).
          !playing && "opacity-0",
        )}
        poster={EMPTY_POSTER}
        onplaying={() => (playing = true)}
        oncanplay={onCanPlay}
        onloadedmetadata={onVideoSize}
        onresize={onVideoSize}
        onemptied={() => (playing = false)}
        autoplay
        playsinline
        disablepictureinpicture={!controls}
      ></video>
      {#if mode === "mjpeg" && mjpegSrc}
        <img
          src={mjpegSrc}
          onload={onImageLoad}
          alt={name}
          class={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")}
          draggable="false"
        >
      {/if}
    </div>
  </div>

  {#if unavailable}
    <div class="absolute inset-0 flex items-center justify-center bg-black/70 text-sm">
      {t("card.unavailable")}
    </div>
  {:else if mode === "connecting" || (!playing && mode !== "mjpeg")}
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <LoaderCircle class="size-8 animate-spin text-white/80" aria-label={t("player.connecting")} />
    </div>
  {/if}

  {#if controls}
    <!-- Status badge -->
    <div
      class={cn(
        "pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium backdrop-blur-md transition-opacity",
        !controlsVisible && !ptzMode && "opacity-0",
      )}
    >
      {#if mode === "connecting"}
        {t("player.connecting")}
      {:else}
        <span class="size-2 rounded-full bg-red-500"></span>
        {t("player.live")}
        <span class="text-white/60">· {t(`player.mode.${mode}`)}</span>
      {/if}
    </div>

    {#if zoom.zoomed && !ptzMode}
      <!-- Position hint while digitally zoomed; fades out with the control bar. -->
      <div
        class={cn(
          "absolute top-3 right-3 z-10 flex items-center gap-2 transition-opacity",
          !controlsVisible && "pointer-events-none opacity-0",
        )}
      >
        <div
          class="relative h-9 w-16 overflow-hidden rounded-md bg-black/45 ring-1 ring-white/20 backdrop-blur-md"
        >
          <div
            class="absolute rounded-[2px] border border-white bg-white/20"
            style:left={`${region.left * 100}%`}
            style:top={`${region.top * 100}%`}
            style:width={`${region.width * 100}%`}
            style:height={`${region.height * 100}%`}
          ></div>
        </div>
        <button
          type="button"
          class={cn(OVERLAY_SURFACE, "flex h-9 items-center gap-1 rounded-full px-3 text-xs [&_svg]:size-4")}
          onclick={() => zoom.reset()}
        >
          <RotateCcw />
          {zoom.transform.scale.toFixed(1)}×
        </button>
      </div>
    {/if}

    {#if doorConfirm}
      <!-- Confirmation so the door can't be opened by accident. -->
      <div class="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
        <div
          class="w-full max-w-72 rounded-(--radius-xl) bg-background p-4 text-foreground shadow-2xl"
          role="alertdialog"
          aria-labelledby="door-confirm-title"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-5"
            >
              <DoorOpen />
            </div>
            <h3 id="door-confirm-title" class="min-w-0 text-base font-medium">
              {t("door.confirm_title", { name: doorName })}
            </h3>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="h-9 rounded-full bg-muted px-4 text-sm font-medium transition hover:bg-muted-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onclick={() => (doorConfirm = false)}
            >
              {t("door.cancel")}
            </button>
            <button
              type="button"
              class="h-9 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
              disabled={doorStatus === "busy"}
              onclick={confirmDoor}
            >
              {t("door.confirm")}
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if doorStatus === "done" || doorStatus === "error"}
      <div
        class={cn(
          "pointer-events-none absolute top-14 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-lg [&_svg]:size-4",
          doorStatus === "done" ? "bg-primary text-primary-foreground" : "bg-destructive text-white",
        )}
        role="status"
      >
        {#if doorStatus === "done"}
          <Check />
        {:else}
          <CircleAlert />
        {/if}
        {doorStatus === "done" ? t("door.opened") : t("door.failed")}
      </div>
    {/if}

    {#if ptzMode && device}
      {#if !panelPtz}
        <PtzOverlay {ctx} {device} speed={ptzSpeed} {t} onexit={() => (ptzMode = false)} />
      {/if}
    {:else}
      <!-- Control bar -->
      <div
        class={cn(
          // The gradient strip itself lets touches through so pinch/pan work over it; only buttons catch them.
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pt-10 pb-2 transition-opacity",
          controlsVisible ? "[&_button]:pointer-events-auto" : "opacity-0",
        )}
        onfocusin={showControls}
      >
        {#if mode === "web_rtc" || mode === "hls"}
          <ControlButton label={muted ? t("player.unmute") : t("player.mute")} onclick={toggleMute}>
            {#if muted}
              <VolumeX />
            {:else}
              <Volume />
            {/if}
          </ControlButton>
        {/if}

        {#if quality && quality.options.length > 1}
          <div
            class="flex rounded-full bg-black/50 p-0.5 ring-1 ring-white/20 backdrop-blur-md"
            role="radiogroup"
            aria-label={t("player.quality")}
          >
            {#each quality.options as option (option.value)}
              <!-- biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons, with radio semantics. -->
              <button
                type="button"
                role="radio"
                aria-checked={quality.value === option.value}
                class="h-8 rounded-full px-3 text-xs font-semibold transition hover:bg-neutral-600/80 aria-checked:bg-white! aria-checked:text-black!"
                onclick={() => quality.onchange(option.value)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        {/if}

        <div class="flex-1"></div>

        {#if doorAvailable}
          <ControlButton label={t("player.door")} onclick={() => (doorConfirm = true)}>
            <DoorOpen />
          </ControlButton>
        {/if}

        <ControlButton label={t("player.snapshot")} onclick={snapshot}>
          <Camera />
        </ControlButton>

        {#if !isTouch}
          <ZoomPopover
            {zoom}
            {t}
            onopenchange={(open) => {
              popoverOpen = open;
              if (!open) scheduleHide();
            }}
          />
        {/if}

        {#if ptzAvailable}
          <ControlButton label={t("player.ptz")} onclick={enterPtz}>
            <Move />
          </ControlButton>
        {/if}

        {#if pipSupported && mode !== "mjpeg"}
          <ControlButton label={t("player.pip")} onclick={togglePip}>
            <PictureInPicture />
          </ControlButton>
        {/if}

        <ControlButton
          label={fullscreen ? t("player.exit_fullscreen") : t("player.fullscreen")}
          onclick={toggleFullscreen}
        >
          {#if fullscreen}
            <Minimize />
          {:else}
            <Maximize />
          {/if}
        </ControlButton>
      </div>
    {/if}
  {/if}
</div>

{#if panelPtz && device}
  <PtzOverlay {ctx} {device} speed={ptzSpeed} {t} layout="panel" onexit={() => (ptzMode = false)} />
{/if}
