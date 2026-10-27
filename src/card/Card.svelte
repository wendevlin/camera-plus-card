<script lang="ts">
  import Cctv from "@lucide/svelte/icons/cctv";
  import Move from "@lucide/svelte/icons/move";
  import VideoOff from "@lucide/svelte/icons/video-off";
  import {
    type CameraStream,
    hasPtzControls,
    limitControls,
    pickCamera,
    resolveCameraDevice,
  } from "$lib/camera/device";
  import type { HassContext } from "$lib/ha/context.svelte";
  import { createTranslate } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import CameraDialog from "./CameraDialog.svelte";
  import type { ResolvedConfig } from "./config";
  import Snapshot from "./Snapshot.svelte";

  interface Props {
    ctx: HassContext;
    config: ResolvedConfig;
    preview: boolean;
  }

  let { ctx, config, preview }: Props = $props();

  let open = $state(false);

  const t = $derived(createTranslate(ctx.language));

  const device = $derived(
    config.device_id && ctx.entities && ctx.devices
      ? limitControls(resolveCameraDevice(config.device_id, ctx.entities, ctx.devices), {
          ptz: config.show_ptz,
          opticalZoom: config.show_optical_zoom,
        })
      : undefined,
  );
  const deviceExists = $derived(Boolean(config.device_id && ctx.devices?.[config.device_id]));

  // `auto` keeps the card on the light stream and gives the dialog the best one (when a profile knows them).
  const cardStream = $derived<CameraStream>(config.stream === "auto" ? "sub" : config.stream);
  const dialogStream = $derived<CameraStream>(config.stream === "auto" ? "main" : config.stream);
  const cardEntityId = $derived(device ? pickCamera(device, cardStream, ctx.states) : undefined);
  const name = $derived(config.name || device?.name || "");
  const unavailable = $derived(cardEntityId ? ctx.states?.[cardEntityId]?.state === "unavailable" : false);

  const error = $derived.by(() => {
    if (!config.device_id) return t("card.no_device");
    if (ctx.devices && !deviceExists) return t("card.device_not_found");
    if (device && !cardEntityId) return t("card.no_camera");
    return undefined;
  });

  const openDialog = () => {
    if (!preview && device && cardEntityId) open = true;
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDialog();
    }
  };
</script>

<div
  class={cn(
    "relative h-full overflow-hidden",
    "rounded-(--ha-card-border-radius,12px) border-(length:--ha-card-border-width,1px) border-(--ha-card-border-color,var(--divider-color,#e0e0e0))",
    "bg-(--ha-card-background,var(--card-background-color,#fff)) text-(--primary-text-color) shadow-(--ha-card-box-shadow,none)",
    ctx.darkMode && "dark",
  )}
>
  {#if error}
    <div class="flex h-full min-h-24 items-center gap-3 p-4 text-sm text-muted-foreground">
      <Cctv class="size-6 shrink-0" />
      <span>{error}</span>
    </div>
  {:else if cardEntityId && device}
    <!-- biome-ignore lint/a11y/useSemanticElements: the tile wraps block content, which a <button> must not contain. -->
    <div
      class={cn(
        "group relative aspect-video w-full cursor-pointer bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
      role="button"
      tabindex="0"
      aria-label={t("card.open", { name })}
      onclick={openDialog}
      {onkeydown}
    >
      {#if unavailable}
        <div class="flex size-full items-center justify-center gap-2 text-sm text-white/70">
          <VideoOff class="size-5" />
          {t("card.unavailable")}
        </div>
      {:else}
        <Snapshot {ctx} entityId={cardEntityId} alt={name} paused={open} class="size-full" />
      {/if}

      {#if config.show_name && name}
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-4 pt-10 pb-3 text-base text-white"
        >
          <span class="min-w-0 flex-1 truncate font-medium">{name}</span>
          {#if hasPtzControls(device)}
            <Move class="size-4 shrink-0 opacity-80" aria-hidden="true" />
          {/if}
        </div>
      {/if}
    </div>

    {#if open}
      <CameraDialog
        {ctx}
        {device}
        {name}
        {t}
        initialStream={dialogStream}
        ptzSpeed={config.ptz_speed}
        doorEntity={config.door_entity}
        onclose={() => (open = false)}
      />
    {/if}
  {:else}
    <div class="aspect-video w-full animate-pulse bg-muted"></div>
  {/if}
</div>
