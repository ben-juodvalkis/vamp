<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { Popover as PopoverPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = "center",
		portalProps,
		...restProps
	}: PopoverPrimitive.ContentProps & {
		portalProps?: PopoverPrimitive.PortalProps;
	} = $props();
</script>

<PopoverPrimitive.Portal {...portalProps}>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		{sideOffset}
		{align}
		class={cn(
			"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--bits-popover-content-transform-origin) outline-hidden z-50 w-72 rounded-md border p-4 shadow-md",
			className
		)}
		{...restProps}
	/>
</PopoverPrimitive.Portal>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): a popover is
	   a DetailViewBackground panel in a 1px dark frame, 2px corners, no
	   drop shadow. bits-ui renders + portals the element, so the selector
	   is fully global. */
	:global(html[data-grammar="flat"] [data-slot="popover-content"]) {
		background: var(--popover);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		box-shadow: none;
	}
</style>
