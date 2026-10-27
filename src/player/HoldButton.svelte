<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HoldAction, HoldController } from "$lib/ptz/hold";
  import { OVERLAY_SURFACE } from "$lib/styles";
  import { cn } from "$lib/utils";

  interface Props {
    id: string;
    action: HoldAction;
    hold: HoldController;
    active: boolean;
    label: string;
    class?: string;
    style?: string;
    children: Snippet;
  }

  let { id, action, hold, active, label, class: className, style, children }: Props = $props();

  const onpointerdown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    // Capture so we still get pointerup when the finger slides off the button.
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    hold.press(id, action);
  };

  const release = () => void hold.release(id);

  const onkeydown = (event: KeyboardEvent) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      hold.press(id, action);
    }
  };

  const onkeyup = (event: KeyboardEvent) => {
    if (event.key === " " || event.key === "Enter") release();
  };
</script>

<button
  type="button"
  aria-label={label}
  title={label}
  {style}
  aria-pressed={active}
  data-active={active || undefined}
  class={cn(
    OVERLAY_SURFACE,
    "pointer-events-auto flex touch-none items-center justify-center rounded-full shadow-lg select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none data-active:scale-95 data-active:bg-primary! data-active:ring-primary! data-active:text-primary-foreground!",
    className,
  )}
  {onpointerdown}
  onpointerup={release}
  onpointercancel={release}
  onlostpointercapture={release}
  onblur={release}
  {onkeydown}
  {onkeyup}
  oncontextmenu={(event) => event.preventDefault()}
>
  {@render children()}
</button>
