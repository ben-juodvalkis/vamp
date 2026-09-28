<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		orientation = "horizontal",
		class: className,
		...restProps
	}: WithoutChildrenOrChild<SliderPrimitive.RootProps> = $props();
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<SliderPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="slider"
	{orientation}
	class={cn(
		"relative flex w-full touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50",
		className
	)}
	{...restProps}
>
	{#snippet children({ thumbs })}
		<span
			data-orientation={orientation}
			data-slot="slider-track"
			class={cn(
				"bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-1.5"
			)}
		>
			<SliderPrimitive.Range
				data-slot="slider-range"
				class={cn(
					"bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
				)}
			/>
		</span>
		{#each thumbs as thumb (thumb)}
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				index={thumb}
				class="border-primary bg-background ring-ring/50 focus-visible:outline-hidden block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50"
			/>
		{/each}
	{/snippet}
</SliderPrimitive.Root>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): the lane is
	   a square ControlBackground well, the value fill is RangeDefault, the
	   thumb is a square ControlFillHandle grip with no shadow / hover ring
	   (focus keeps a SelectionBackground hairline); disabled = disabled-fg
	   fills on the same lane, never opacity. bits-ui renders Root / Range /
	   Thumb, so every selector is fully global. */
	:global(html[data-grammar="flat"] [data-slot="slider-track"]) {
		background: var(--surface-well);
		border-radius: 0;
	}
	:global(html[data-grammar="flat"] [data-slot="slider-range"]) {
		background: var(--act-monitor);
	}
	:global(html[data-grammar="flat"] [data-slot="slider-thumb"]) {
		background: var(--flat-handle);
		border-color: var(--line-strong);
		border-radius: 0;
		box-shadow: none;
	}
	:global(html[data-grammar="flat"] [data-slot="slider-thumb"]:focus-visible) {
		box-shadow: 0 0 0 1px var(--flat-selection);
	}
	:global(html[data-grammar="flat"] [data-slot="slider"][data-disabled]) {
		opacity: 1;
	}
	:global(html[data-grammar="flat"] [data-slot="slider"][data-disabled] [data-slot="slider-range"]),
	:global(html[data-grammar="flat"] [data-slot="slider"][data-disabled] [data-slot="slider-thumb"]) {
		background: var(--flat-disabled-fg);
	}
</style>
