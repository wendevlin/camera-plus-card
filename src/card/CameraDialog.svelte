<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { BitsConfig } from "bits-ui";
  import { onMount } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { type CameraDevice, type CameraStream, pickCamera } from "$lib/camera/device";
  import type { HassContext } from "$lib/ha/context.svelte";
  import type { Translate } from "$lib/i18n";
  import CameraPlayer from "../player/CameraPlayer.svelte";

  /** Narrow portrait screens get the PTZ D-pad below the video; it doesn't fit in landscape. */
  const PTZ_PANEL_MEDIA_QUERY = "(max-width: 870px) and (orientation: portrait)";

  interface Props {
    ctx: HassContext;
    device: CameraDevice;
    name: string;
    initialStream: CameraStream;
    ptzSpeed?: number;
    doorEntity?: string;
    t: Translate;
    onclose: () => void;
  }

  let { ctx, device, name, initialStream, ptzSpeed, doorEntity, t, onclose }: Props = $props();

  let ptzMode = $state(false);
  let aspectRatio = $state<number>();

  // Esc first leaves PTZ mode; only a second Esc closes the dialog.
  const oncancel = (event: Event) => {
    if (!ptzMode) return;
    event.preventDefault();
    ptzMode = false;
  };

  let dialog = $state<HTMLDialogElement>();
  let portalTarget = $state<HTMLDivElement>();
  let panel = $state<HTMLDivElement>();
  // Reactive, so rotating the phone switches between D-pad panel and overlay.
  const ptzPanelQuery = new MediaQuery(PTZ_PANEL_MEDIA_QUERY);
  const ptzLayout = $derived(ptzPanelQuery.current ? "panel" : "overlay");

  // svelte-ignore state_referenced_locally
  let stream = $state<CameraStream>(initialStream);
  const entityId = $derived(pickCamera(device, stream, ctx.states));

  const qualityOptions = $derived(
    (["main", "sub"] as const)
      .filter((value) => device.streams[value])
      .map((value) => ({ value, label: t(`player.quality.${value}`) })),
  );

  onMount(() => {
    dialog?.showModal();
    // showModal() focuses the close button and shows its focus ring; start on the panel instead.
    panel?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  });

  const close = () => dialog?.close();

  // Native <dialog> only reports backdrop clicks as clicks on the dialog itself.
  const onclick = (event: MouseEvent) => {
    if (event.target === dialog) close();
  };
</script>

<!-- biome-ignore lint/a11y/useKeyWithClickEvents: the click only detects backdrop hits; Esc is handled natively by <dialog>. -->
<dialog
  bind:this={dialog}
  class="rc-dialog"
  data-fit-ratio={aspectRatio && ptzLayout === "overlay" ? "" : undefined}
  style:--rc-ratio={aspectRatio}
  aria-label={name}
  {onclick}
  {onclose}
  {oncancel}
>
  <div
    bind:this={panel}
    tabindex="-1"
    class="rc-panel relative flex max-h-(--rc-available-height) flex-col overflow-hidden rounded-(--radius-xl) bg-background text-foreground shadow-2xl outline-none"
  >
    <header class="flex shrink-0 items-center gap-2 px-4 py-3">
      <h2 class="min-w-0 flex-1 truncate text-lg font-medium">{name}</h2>
      <button
        type="button"
        class="flex size-9 items-center justify-center rounded-full bg-muted text-foreground transition hover:bg-muted-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-5"
        aria-label={t("player.close")}
        title={t("player.close")}
        onclick={close}
      >
        <X />
      </button>
    </header>

    <!-- Scrolls when the PTZ panel doesn't fit below the video on short screens. -->
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {#if portalTarget}
        <BitsConfig defaultPortalTo={portalTarget}>
          {#if entityId}
            <CameraPlayer
              {ctx}
              {entityId}
              {t}
              {device}
              {ptzSpeed}
              {doorEntity}
              {name}
              controls
              bind:ptzMode
              bind:aspectRatio
              {ptzLayout}
              quality={{
                value: stream,
                options: qualityOptions,
                onchange: (value) => (stream = value as CameraStream),
              }}
              class="aspect-video max-h-(--rc-video-max-height) w-full shrink-0"
            />
          {/if}
        </BitsConfig>
      {/if}
    </div>
  </div>

  <!--
    Popovers/selects portal here: inside the dialog's top layer and our shadow
    root, but outside the panel so its overflow clipping doesn't cut them off.
  -->
  <div bind:this={portalTarget}></div>
</dialog>
