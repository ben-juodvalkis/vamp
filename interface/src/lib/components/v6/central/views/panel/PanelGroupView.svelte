<script lang="ts">
	/**
	 * A named group of an instrument panel (ADR-487): Live's section name as
	 * the eyebrow, its controls side by side under it, each the group's full
	 * height. An eyebrow that leads to the section's detail page is a button
	 * ("Hammer ›"); one with no name still takes its line, so every group in a
	 * row starts its boxes on the same pixel.
	 *
	 * On a frame's face grid (ADR-510, `columns` set) the group is a subgrid
	 * of that many face columns under its section's header line, which draws
	 * the eyebrow: a control a column (a tab as many as it wants), and a
	 * group of knobs in whole columns of knobs, each spanning as many face
	 * columns as holds its knobs at their size (`faceKnobFit`).
	 */
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import PanelControlView from './PanelControlView.svelte';
	import PanelEyebrow from './PanelEyebrow.svelte';
	import { controlKnobSize, controlUnits, faceKnobFit, frameColumns, groupFace, groupUnits, isKnobGroup, knobGridFit, pageCells, pageGroupGrid, pagePicks, type PanelControl, type PanelFace, type PanelGroup } from './panelTypes';
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
		/** On a face grid (ADR-510): the face columns it spans. Its section draws the eyebrow. */
		columns?: number;
		/** On a face grid, under a tab strip: its controls start below the strip. */
		underTabs?: boolean;
		/** On a face grid, the `data-group` it carries where its section does not. */
		dataGroup?: string;
		/**
		 * On a section page's face grid (ADR-510): its cells two high, column
		 * after column, every knob medium; an envelope's stages a column each.
		 */
		onPage?: boolean;
		/** On a one-row page: a cell a column, the page's height, knobs as large as the column holds. */
		oneRow?: boolean;
		/**
		 * On a full-screen board's face grid (ADR-512): its cells this many
		 * high, column after column over `columns`, each knob as large as its
		 * cell holds; an envelope's stages a column each, full height.
		 */
		stack?: number;
		/** On a board: a pick of this many values or fewer is a tab, more a `ChoicePicker`. */
		tabMax?: number;
	}

	let { group, params, color, onOpen, bare = false, pageRows = 1, boxFace, columns, underTabs = false, dataGroup, onPage = false, oneRow = false, stack, tabMax = 2 }: Props = $props();
	// On a board: a pick too long for a tab its cell can hold opens over the view.
	const boardPick = (c: PanelControl) => (c.kind === 'choice' ? c.options.length > tabMax : c.kind === 'step' && !!c.labels && c.labels.length > tabMax);
	let pageGrid = $derived(onPage ? pageGroupGrid(group, oneRow) : undefined);
	// A page's stages draw on their own equal columns where they take fewer face columns than stages.
	let pageOwnGrid = $derived(!!pageGrid && pageGrid.rows === 1 && pageGrid.columns < pageGrid.cells);
	// A frame's envelope over fewer face columns than stages, likewise.
	let frameOwnGrid = $derived(!!columns && !onPage && group.face === 'slider' && columns < group.controls.length);
	// A row of knobs whose count does not divide its columns (Collision's
	// five MIDI amounts over six): spread over equal cells of their own,
	// so no column is left empty at the seam.
	// A mixed group on fewer columns than controls pairs its knobs (`frameColumns`).
	let framePlan = $derived(columns && !onPage && !frameOwnGrid ? frameColumns(group, columns) : undefined);
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
	// On the face grid a subgrid's gaps are the face's: its gutter across,
	// the same between rows of knobs.
	let faceGap = $derived(row ? parseFloat(getComputedStyle(row.closest('.face-grid') ?? row).columnGap) || 8 : 8);
	let faceFit = $derived(
		columns && knobGrid
			? size.w > 0
				? faceKnobFit(group.controls.length, columns, (size.w - faceGap * (columns - 1)) / columns, size.h, faceGap, group.knobSize)
				: faceKnobFit(group.controls.length, columns, 0, 0, faceGap, group.knobSize)
			: undefined
	);
	// (See above: a row of knobs that does not divide its columns.)
	let knobOwnGrid = $derived(!!columns && !!faceFit && columns % faceFit.knobCols !== 0);
	// The rows whose cells hold the knobs at full size (`knobGridFit`, ADR-509
	// addendum); the size the rows give is each knob's ceiling, and a knob
	// draws the largest size its own cell holds (PanelControlView's `knobFit`).
	let fit = $derived(!columns && knobGrid && size.w > 0 ? knobGridFit(group.controls.length, size.w, size.h, gap, group.knobSize) : undefined);
	let rows = $derived(fit?.rows ?? 1);
	let cols = $derived(Math.ceil(group.controls.length / rows));
</script>

{#if stack && columns}
	<!-- On a board (ADR-512): cells `stack` high, column after column; an
	     envelope's stages a column each, the tile's full height. -->
	{@const stages = face === 'slider'}
	<!-- A lone control stands the full height; any more keep the row's
	     `stack` rows, so their knobs line up with the next section's. -->
	{@const rowsOf = stages || group.controls.length === 1 ? 1 : stack}
	<div
		class="panel-group-grid page-cells"
		class:own-grid={stages && columns !== group.controls.length}
		data-board-stack={rowsOf}
		style="grid-column: span {columns}; grid-template-rows: repeat({rowsOf}, minmax(0, 1fr));{stages && columns !== group.controls.length ? ` grid-template-columns: repeat(${group.controls.length}, minmax(0, 1fr));` : ''}"
	>
		{#each group.controls as control (control.param)}
			<div class="panel-cell">
				<PanelControlView {control} {params} {color} switchParam={group.switchParam} {face} knobSize={rowsOf === 1 ? 'l' : 'm'} pick={boardPick(control)} />
			</div>
		{/each}
	</div>
{:else if pageGrid}
	<!-- On a page's face grid: a cell a column on a one-row page, else two
	     high, column after column. -->
	{@const pageSize = oneRow ? 'l' : 'm'}
	<div
		class="panel-group-grid page-cells"
		class:own-grid={pageOwnGrid}
		style="grid-column: span {pageGrid.columns}; grid-template-rows: repeat({pageGrid.rows}, minmax(0, 1fr));{pageOwnGrid ? ` grid-template-columns: repeat(${pageGrid.cells}, minmax(0, 1fr));` : ''}"
	>
		{#each pageCells(group, oneRow) as cell (cell.control.param)}
			{#if cell.picker}
				<div class="panel-cell mod-cell">
					<div class="mod-knob">
						<PanelControlView control={cell.control} {params} {color} switchParam={group.switchParam} pageRows={oneRow ? 1 : 2} {face} knobSize={pageSize} mark={cell.mark} />
					</div>
					<PanelControlView control={cell.picker} {params} {color} switchParam={group.switchParam} pick bareCaption />
				</div>
			{:else}
				<div class="panel-cell">
					<PanelControlView control={cell.control} {params} {color} switchParam={group.switchParam} pageRows={oneRow ? 1 : 2} {face} knobSize={pageSize} pick={pagePicks(cell.control, oneRow)} />
				</div>
			{/if}
		{/each}
	</div>
{:else if columns}
	<!-- On the face grid: a subgrid of the face's columns, no eyebrow. -->
	{@const span = faceFit ? Math.floor(columns / faceFit.knobCols) : 1}
	<div
		class="panel-group-grid"
		class:under-tabs={underTabs}
		class:own-grid={frameOwnGrid || knobOwnGrid}
		bind:this={row}
		data-group={dataGroup}
		data-knob-rows={faceFit ? faceFit.rows : undefined}
		style="grid-column: span {columns}; grid-template-rows: repeat({faceFit ? faceFit.rows : 1}, minmax(0, 1fr));{frameOwnGrid ? ` grid-template-columns: repeat(${group.controls.length}, minmax(0, 1fr));` : knobOwnGrid && faceFit ? ` grid-template-columns: repeat(${faceFit.knobCols}, minmax(0, 1fr));` : ''}"
	>
		{#if faceFit || frameOwnGrid || !framePlan}
			{#each group.controls as control (control.param)}
				<div class="panel-cell" style="grid-column: span {faceFit && !knobOwnGrid ? span : 1};">
					<PanelControlView
						{control}
						{params}
						{color}
						switchParam={group.switchParam}
						{face}
						knobSize={controlKnobSize(control, faceFit ? { ...group, knobSize: faceFit.size } : group, 1)}
					/>
				</div>
			{/each}
		{:else}
			<!-- A mixed group: a control a column, its knobs paired where the
			     group has fewer columns than controls. -->
			{#each framePlan as col, c (c)}
				<div class="panel-cell" class:panel-stack={col.controls.length > 1} style="grid-column: span {col.span};">
					{#each col.controls as control (control.param)}
						<PanelControlView
							{control}
							{params}
							{color}
							switchParam={group.switchParam}
							{face}
							knobSize={controlKnobSize(control, group, framePlan.some((p) => p.controls.length > 1) ? 2 : 1)}
						/>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
{:else}
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
{/if}

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
	.panel-group-grid {
		display: grid;
		grid-template-columns: subgrid;
		row-gap: var(--face-gutter, var(--spacing-sm));
		min-width: 0;
		min-height: 0;
	}
	.page-cells {
		grid-auto-flow: column;
	}
	/* Stages on their own equal columns, the face's gutter between. */
	.panel-group-grid.own-grid {
		column-gap: var(--face-gutter, var(--spacing-sm));
	}
	/* Two knobs sharing a column, one over the other. */
	.panel-cell.panel-stack {
		flex-direction: column;
		gap: var(--face-gutter, var(--spacing-sm));
	}
	.panel-cell.panel-stack > :global(*) {
		min-height: 0;
	}
	/* An amount over the pick that names it. */
	.mod-cell {
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.mod-knob {
		flex: 1 1 0;
		display: flex;
		min-height: 0;
	}
	.mod-knob > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	.mod-cell > :global(.panel-pick) {
		flex: 0 0 auto;
		height: auto;
	}
	/* Under a tab strip, which lies over the top of the section (ADR-510). */
	.panel-group-grid.under-tabs {
		margin-top: calc(var(--height-touch) + var(--central-gap));
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
