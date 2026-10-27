<script lang="ts">
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import * as Popover from "$lib/components/ui/popover";
  import { Slider } from "$lib/components/ui/slider";
  import { MAX_SCALE, MIN_SCALE } from "$lib/gestures/pan-zoom";
  import type { PanZoom } from "$lib/gestures/pan-zoom.svelte";
  import type { Translate } from "$lib/i18n";
  import { OVERLAY_SURFACE } from "$lib/styles";
  import { cn } from "$lib/utils";

  interface Props {
    zoom: PanZoom;
    t: Translate;
    onopenchange?: (open: boolean) => void;
  }

  let { zoom, t, onopenchange }: Props = $props();
</script>

<Popover.Root onOpenChange={onopenchange}>
  <Popover.Trigger
    aria-label={t("player.zoom")}
    title={t("player.zoom")}
    class={cn(
      OVERLAY_SURFACE,
      "flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none data-[state=open]:bg-white! data-[state=open]:text-black! [&_svg]:size-5",
    )}
  >
    <ZoomIn />
  </Popover.Trigger>
  <Popover.Content
    side="top"
    align="end"
    class="w-64 border-0 bg-black/75 text-white ring-white/15 backdrop-blur-md"
  >
    <div class="flex items-center gap-3">
      <Slider
        type="single"
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={0.1}
        value={zoom.transform.scale}
        onValueChange={(value) => zoom.setScale(value)}
        aria-label={t("player.zoom")}
        class="flex-1 [&_[data-slot=slider-track]]:bg-white/25"
      />
      <span class="w-10 text-right text-sm tabular-nums">{zoom.transform.scale.toFixed(1)}×</span>
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/35 disabled:opacity-40 [&_svg]:size-4"
        aria-label={t("player.zoom_reset")}
        title={t("player.zoom_reset")}
        disabled={!zoom.zoomed}
        onclick={() => zoom.reset()}
      >
        <RotateCcw />
      </button>
    </div>
  </Popover.Content>
</Popover.Root>
