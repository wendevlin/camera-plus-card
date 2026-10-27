<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { OVERLAY_SURFACE } from "$lib/styles";
  import { cn } from "$lib/utils";

  interface Props extends HTMLButtonAttributes {
    label: string;
    pressed?: boolean;
    children: Snippet;
  }

  let { label, pressed, class: className, children, ...rest }: Props = $props();
</script>

<button
  type="button"
  aria-label={label}
  title={label}
  aria-pressed={pressed}
  class={cn(
    OVERLAY_SURFACE,
    "flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none aria-pressed:bg-white! aria-pressed:text-black! disabled:opacity-40 [&_svg]:size-5",
    className,
  )}
  {...rest}
>
  {@render children()}
</button>
