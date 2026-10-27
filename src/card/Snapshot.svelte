<script lang="ts">
  import { fetchSnapshotUrl } from "$lib/ha/camera";
  import type { HassContext } from "$lib/ha/context.svelte";
  import { pageVisibility } from "$lib/page-visibility.svelte";
  import { cn } from "$lib/utils";

  const REFRESH_MS = 10_000;
  /** Spreads the first request of cards that mount together. */
  const MAX_START_JITTER_MS = 750;

  interface Props {
    ctx: HassContext;
    entityId: string;
    alt: string;
    /** Stops polling, e.g. while the live dialog is open on top. */
    paused?: boolean;
    class?: string;
  }

  let { ctx, entityId, alt, paused = false, class: className }: Props = $props();

  let element = $state<HTMLDivElement>();
  let src = $state<string>();
  let intersecting = $state(false);
  let width = $state(0);
  let lastLoaded = 0;

  $effect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  $effect(() => {
    const api = ctx.hassApi;
    const connection = ctx.hassConnection;
    // Bucket the width so resizes don't refetch on every pixel.
    const requestWidth = Math.ceil((width * devicePixelRatio) / 160) * 160;
    const active = intersecting && pageVisibility.visible && !paused;
    if (!active || !api || !connection || !requestWidth) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const url = await fetchSnapshotUrl(api, connection, entityId, requestWidth);
        // Preload so the visible image never flashes empty between refreshes.
        const image = new Image();
        image.src = url;
        await image.decode();
        if (!cancelled) {
          src = url;
          lastLoaded = Date.now();
        }
      } catch {
        // Keep the last frame; the next tick retries.
      }
      // Chain instead of setInterval, so a slow camera proxy never stacks requests.
      if (!cancelled) timer = setTimeout(load, REFRESH_MS);
    };
    // Coming back into view refreshes right away only if the frame is stale.
    const stale = Date.now() - lastLoaded >= REFRESH_MS;
    timer = setTimeout(
      load,
      stale ? (src ? 0 : Math.random() * MAX_START_JITTER_MS) : REFRESH_MS - (Date.now() - lastLoaded),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<div bind:this={element} bind:clientWidth={width} class={cn("relative overflow-hidden bg-black", className)}>
  {#if src}
    <img {src} {alt} class="size-full object-cover" draggable="false">
  {:else}
    <div class="size-full animate-pulse bg-white/5"></div>
  {/if}
</div>
