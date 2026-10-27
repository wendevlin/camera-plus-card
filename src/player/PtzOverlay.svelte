<script lang="ts">
  import ArrowDownLeft from "@lucide/svelte/icons/arrow-down-left";
  import ArrowDownRight from "@lucide/svelte/icons/arrow-down-right";
  import ArrowUpLeft from "@lucide/svelte/icons/arrow-up-left";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import type { Component } from "svelte";
  import type { CameraDevice, PtzDirection, PtzZoomDirection } from "$lib/camera/device";
  import * as Select from "$lib/components/ui/select";
  import type { HassContext } from "$lib/ha/context.svelte";
  import type { Translate } from "$lib/i18n";
  import { directionAction, selectPreset, zoomAction } from "$lib/ptz/actions";
  import { type HoldAction, HoldController } from "$lib/ptz/hold";
  import { OVERLAY_SURFACE } from "$lib/styles";
  import { cn } from "$lib/utils";
  import HoldButton from "./HoldButton.svelte";

  interface Props {
    ctx: HassContext;
    device: CameraDevice;
    speed?: number;
    t: Translate;
    /** `overlay` sits on the video (desktop, fullscreen); `panel` renders a D-pad below it (mobile sheet). */
    layout?: "overlay" | "panel";
    onexit: () => void;
  }

  let { ctx, device, speed, t, layout = "overlay", onexit }: Props = $props();

  let activeId = $state<string>();
  const hold = new HoldController({ onChange: (id) => (activeId = id) });

  const actionContext = $derived({
    api: ctx.hassApi!,
    getStates: () => ctx.states ?? {},
    device,
    speed,
  });

  interface DirectionButton {
    direction: PtzDirection;
    icon: Component;
    /** Position on the video edge in overlay layout. */
    class: string;
    /** `grid-area` in the 3×3 D-pad of the panel layout. */
    area: string;
  }

  const EDGE = "size-14 sm:size-16 [&_svg]:size-8";
  const CORNER = "size-11 sm:size-12 [&_svg]:size-6";

  const DIRECTION_BUTTONS: DirectionButton[] = [
    { direction: "up", icon: ChevronUp, class: `${EDGE} top-3 left-1/2 -translate-x-1/2`, area: "1 / 2" },
    {
      direction: "down",
      icon: ChevronDown,
      class: `${EDGE} bottom-3 left-1/2 -translate-x-1/2`,
      area: "3 / 2",
    },
    { direction: "left", icon: ChevronLeft, class: `${EDGE} left-3 top-1/2 -translate-y-1/2`, area: "2 / 1" },
    {
      direction: "right",
      icon: ChevronRight,
      class: `${EDGE} right-3 top-1/2 -translate-y-1/2`,
      area: "2 / 3",
    },
    { direction: "left_up", icon: ArrowUpLeft, class: `${CORNER} top-16 left-16`, area: "1 / 1" },
    { direction: "right_up", icon: ArrowUpRight, class: `${CORNER} top-16 right-16`, area: "1 / 3" },
    { direction: "left_down", icon: ArrowDownLeft, class: `${CORNER} bottom-16 left-16`, area: "3 / 1" },
    { direction: "right_down", icon: ArrowDownRight, class: `${CORNER} bottom-16 right-16`, area: "3 / 3" },
  ];

  const directionButtons = $derived(
    DIRECTION_BUTTONS.flatMap((button) => {
      const action = directionAction(actionContext, button.direction);
      return action ? [{ ...button, action }] : [];
    }),
  );

  const zoomButtons = $derived(
    (["zoom_in", "zoom_out"] as PtzZoomDirection[]).flatMap((direction) => {
      const action = zoomAction(actionContext, direction);
      return action ? [{ direction, action }] : [];
    }),
  );

  const presetOptions = $derived(
    device.presetSelect ? (ctx.states?.[device.presetSelect]?.attributes.options ?? []) : [],
  );

  const missingStop = $derived(directionButtons.length > 0 && !device.ptz.stop);
  const missingZoomButtons = $derived(
    !device.ptz.zoom.zoom_in && !device.ptz.zoom.zoom_out && device.zoomNumber !== undefined,
  );

  /** Solid buttons for the panel, which sits on the sheet background instead of the video. */
  const PANEL_BUTTON =
    "size-16 bg-muted text-foreground shadow-none ring-border backdrop-blur-none hover:bg-muted-foreground/25 hover:ring-border focus-visible:ring-ring [&_svg]:size-7";

  const KEY_ACTIONS: Record<string, () => [string, HoldAction | undefined]> = {
    ArrowUp: () => ["up", directionAction(actionContext, "up")],
    ArrowDown: () => ["down", directionAction(actionContext, "down")],
    ArrowLeft: () => ["left", directionAction(actionContext, "left")],
    ArrowRight: () => ["right", directionAction(actionContext, "right")],
    "+": () => ["zoom_in", zoomAction(actionContext, "zoom_in")],
    "=": () => ["zoom_in", zoomAction(actionContext, "zoom_in")],
    "-": () => ["zoom_out", zoomAction(actionContext, "zoom_out")],
  };

  // Listeners sit on window, so use the composed path to skip keys meant for open menus.
  const isFromMenu = (event: KeyboardEvent) =>
    event
      .composedPath()
      .some((node) => node instanceof HTMLElement && /^(listbox|option|combobox)$/.test(node.role ?? ""));

  const onkeydown = (event: KeyboardEvent) => {
    if (isFromMenu(event)) return;
    const entry = KEY_ACTIONS[event.key]?.();
    if (!entry) return;
    event.preventDefault();
    const [id, action] = entry;
    if (!event.repeat && action) hold.press(id, action);
  };

  const onkeyup = (event: KeyboardEvent) => {
    const entry = KEY_ACTIONS[event.key]?.();
    if (entry) void hold.release(entry[0]);
  };

  // Never leave the camera moving: stop when the page loses focus or the overlay goes away.
  $effect(() => {
    const stop = () => void hold.release();
    const onVisibility = () => document.visibilityState === "hidden" && stop();
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", onkeydown);
    window.addEventListener("keyup", onkeyup);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", onkeydown);
      window.removeEventListener("keyup", onkeyup);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  });
</script>

{#snippet zoomControls(buttonClass: string)}
  {#each zoomButtons as button (button.direction)}
    <HoldButton
      id={button.direction}
      action={button.action}
      {hold}
      active={activeId === button.direction}
      label={t(`ptz.${button.direction}`)}
      class={buttonClass}
    >
      {#if button.direction === "zoom_in"}
        <Plus />
      {:else}
        <Minus />
      {/if}
    </HoldButton>
  {/each}
{/snippet}

{#snippet exitButton(buttonClass: string)}
  <button
    type="button"
    class={cn("pointer-events-auto flex items-center justify-center rounded-full", buttonClass)}
    aria-label={t("ptz.exit")}
    title={t("ptz.exit")}
    onclick={onexit}
  >
    <X />
  </button>
{/snippet}

{#snippet presets(triggerClass: string)}
  {#if presetOptions.length && device.presetSelect}
    {@const presetEntity = device.presetSelect}
    <Select.Root
      type="single"
      value=""
      onValueChange={(option) => option && void selectPreset(ctx.hassApi!, presetEntity, option)}
    >
      <Select.Trigger class={triggerClass} aria-label={t("ptz.presets")}>
        {t("ptz.presets")}
      </Select.Trigger>
      <Select.Content>
        {#each presetOptions as option (option)}
          <Select.Item value={option} label={option} />
        {/each}
      </Select.Content>
    </Select.Root>
  {/if}
{/snippet}

{#snippet hint(hintClass: string)}
  {#if missingStop || missingZoomButtons}
    <div class={hintClass} role="status">
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{missingStop ? t("ptz.missing_stop") : t("ptz.missing_zoom")}</span>
    </div>
  {/if}
{/snippet}

{#if layout === "panel"}
  <div class="flex flex-col gap-4 px-4 pt-4 pb-2">
    <div class="flex items-center gap-2">
      {@render presets("pointer-events-auto h-9 min-w-36")}
      <div class="flex-1"></div>
      {@render exitButton(
        "size-10 bg-muted text-foreground transition hover:bg-muted-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-5",
      )}
    </div>
    <div class="flex items-center justify-center gap-8">
      <div class="grid grid-cols-[repeat(3,4rem)] grid-rows-[repeat(3,4rem)] gap-2">
        {#each directionButtons as button (button.direction)}
          <HoldButton
            id={button.direction}
            action={button.action}
            {hold}
            active={activeId === button.direction}
            label={t(`ptz.${button.direction}`)}
            class={PANEL_BUTTON}
            style={`grid-area: ${button.area}`}
          >
            <button.icon />
          </HoldButton>
        {/each}
      </div>
      {#if zoomButtons.length}
        <div class="flex flex-col gap-2">
          {@render zoomControls(PANEL_BUTTON)}
        </div>
      {/if}
    </div>
    {@render hint("flex items-start gap-2 text-xs text-muted-foreground")}
  </div>
{:else}
  <div class="pointer-events-none absolute inset-0 z-20">
    {#each directionButtons as button (button.direction)}
      <HoldButton
        id={button.direction}
        action={button.action}
        {hold}
        active={activeId === button.direction}
        label={t(`ptz.${button.direction}`)}
        class={`absolute ${button.class}`}
      >
        <button.icon />
      </HoldButton>
    {/each}

    {#if zoomButtons.length}
      <div class="absolute top-1/2 right-20 flex -translate-y-1/2 flex-col gap-3 sm:right-24">
        {@render zoomControls("size-14 sm:size-16 [&_svg]:size-8")}
      </div>
    {/if}

    <div class="absolute top-3 right-3">
      {@render exitButton(
        cn(
          OVERLAY_SURFACE,
          "size-10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none [&_svg]:size-5",
        ),
      )}
    </div>

    {#if presetOptions.length}
      <div class="absolute bottom-20 left-1/2 -translate-x-1/2 sm:bottom-24">
        {@render presets(
          cn(OVERLAY_SURFACE, "pointer-events-auto h-9 min-w-32 border-0 data-placeholder:text-white"),
        )}
      </div>
    {/if}

    {@render hint(
      "absolute top-20 left-1/2 flex max-w-[min(90%,28rem)] -translate-x-1/2 items-start gap-2 rounded-lg bg-black/60 px-3 py-2 text-xs text-white backdrop-blur-md sm:top-24",
    )}
  </div>
{/if}
