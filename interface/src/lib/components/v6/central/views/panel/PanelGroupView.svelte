<script lang="ts">
	/**
	 * A named group of an instrument panel (ADR-487): Live's section name as
	 * the eyebrow, its controls side by side under it, each the group's full
	 * height. An eyebrow that leads to the section's detail page is a button
	 * ("Hammer ›"); one with no name still takes its line, so every group in a
	 * row starts its boxes on the same pixel.
	 */
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import PanelControlView from './PanelControlView.svelte';
	import PanelEyebrow from './PanelEyebrow.svelte';
	import { controlKnobSize, controlUnits, groupFace, groupUnits, isKnobGroup, knobGridFit, type PanelFace, type PanelGroup } from './panelTypes';
	import type { PanelParams } from './usePanelParams.svelte';

	interface Props {
		group: PanelGroup;
		params: PanelParams;
		color: DeviceColorScheme;
		/** Opens the page the eyebrow names. */
		onOpen?: (page: string) => void;
		/** Draw no eyebrow line (a tab strip above already names the group). */
		bare?: boolean;
		/** Rows on the page the group stands in: a two-row page's choices spread wider. */
		pageRows?: number;
		/** The panel's face for value boxes; the group's own `face` wins. */
		boxFace?: PanelFace;
	}

	let { group, params, color, onOpen, bare = false, pageRows = 1, boxFace }: Props = $props();
	let face = $derived(groupFace(group, boxFace));

	// A group of knobs wraps into the grid that gives each knob the most
	// room, measured off the row's own box: three knobs in a tall, narrow
	// group stack, in a wide one they stand side by side.
	let knobGrid = $derived(isKnobGroup(group, boxFace));
	let row = $state<HTMLDivElement>();
	let size = $state({ w: 0, h: 0 });
	$effect(() => {
		if (!row || !knobGrid || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(([entry]) => {
			size = { w: entry.contentRect.width, h: entry.contentRect.height };
		});
		observer.observe(row);
		return () => observer.disconnect();
	});
	let gap = $derived(row ? parseFloat(getComputedStyle(row).columnGap) || 16 : 16);
	// The rows whose cells hold the knobs at full size (`knobGridFit`, ADR-509
	// addendum); the size the rows give is each knob's ceiling, and a knob
	// draws the largest size its own cell holds (PanelControlView's `knobFit`).
	let fit = $derived(knobGrid && size.w > 0 ? knobGridFit(group.controls.length, size.w, size.h, gap, group.knobSize) : undefined);
	let rows = $derived(fit?.rows ?? 1);
	let cols = $derived(Math.ceil(group.controls.length / rows));
</script>

<div class="panel-group" style="flex: {groupUnits(group, pageRows, boxFace)} 1 0;" data-group={group.title ?? ''}>
	{#if !bare}
		<PanelEyebrow title={group.title} page={group.page} {onOpen} color={color.primary} />
	{/if}
	<div
		class="panel-row"
		class:knob-grid={knobGrid}
		bind:this={row}
		data-knob-rows={knobGrid ? rows : undefined}
		style={knobGrid ? `grid-template-columns: repeat(${cols}, minmax(0, 1fr)); grid-template-rows: repeat(${rows}, minmax(0, 1fr));` : undefined}
	>
		{#each group.controls as control (control.param)}
			<div class="panel-cell" style="flex: {controlUnits(control, pageRows)} 1 0;">
				<PanelControlView {control} {params} {color} switchParam={group.switchParam} {pageRows} {face} knobSize={controlKnobSize(control, fit ? { ...group, knobSize: fit.size } : group, 1)} />
			</div>
		{/each}
	</div>
</div>

<style>
	.panel-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
		min-height: 0;
	}
	.panel-row {
		flex: 1 1 0;
		display: flex;
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.panel-row.knob-grid {
		display: grid;
	}
	.panel-cell {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.panel-cell > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
</style>
