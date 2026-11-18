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
	 * columns as holds its knobs at their size (`faceKnobFit`). A last row
	 * short of its columns stands centred under the rows above (three knobs
	 * over two columns: two, and the third between them), never over an
	 * empty cell; a group with a `pickRow` draws its picks in one touch row
	 * across its top and its knobs in one row under them.
	 *
	 * On a board (`stack`) the group's knobs are ONE size (ADR-544): the
	 * largest a stacked cell holds (`boardKnobSize`), measured off the
	 * group's own box, for a lead or a lone knob too.
	 */
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import PanelControlView from './PanelControlView.svelte';
	import DeviceXY from '../../../device-panel/DeviceXY.svelte';
	import PanelEyebrow from './PanelEyebrow.svelte';
	import { boardGroupStacks, boardKnobSize, controlKnobSize, controlUnits, faceKnobFit, frameColumns, groupFace, groupUnits, isKnobGroup, knobGridFit, pageCells, pageGroupGrid, pagePicks, type KnobSize, type PanelControl, type PanelFace, type PanelGroup } from './panelTypes';
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
		/** On a board: its first `lead` controls a full-height column each (ADR-515). */
		lead?: number;
		/** On a board: a pick of this many values or fewer is a tab, more a `ChoicePicker`. */
		tabMax?: number;
		/** On a board: how many high its knobs stack, where fewer than `stack` (a short tile: 1). */
		knobStack?: number;
		/** On a board: the largest its knobs draw (the board's `knobSize`). */
		knobCeiling?: KnobSize;
	}

	let { group, params, color, onOpen, bare = false, pageRows = 1, boxFace, columns, underTabs = false, dataGroup, onPage = false, oneRow = false, stack, lead = 0, tabMax = 2, knobStack, knobCeiling }: Props = $props();
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
		if (!row || !(knobGrid || stack) || typeof ResizeObserver === 'undefined') return;
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
	// On a board: the group's knobs' one size, by the cell a stacked knob has.
	let boardSize = $derived(
		stack && columns && size.w > 0 ? boardKnobSize((size.w - faceGap * (columns - 1)) / columns, size.h, knobStack ?? stack, faceGap, knobCeiling) : knobCeiling === 's' ? 's' : 'm'
	);
	let rows = $derived(fit?.rows ?? 1);
	let cols = $derived(Math.ceil(group.controls.length / rows));
</script>

{#if stack && columns}
	<!-- On a board (ADR-512): cells `stack` high, column after column; an
	     envelope's stages a column each, the tile's full height. -->
	{@const stages = face === 'slider'}
	{#if stages}
		<div
			class="panel-group-grid page-cells"
			class:own-grid={columns !== group.controls.length}
			data-board-stack="1"
			style="grid-column: span {columns}; grid-template-rows: minmax(0, 1fr);{columns !== group.controls.length ? ` grid-template-columns: repeat(${group.controls.length}, minmax(0, 1fr));` : ''}"
		>
			{#each group.controls as control (control.param)}
				<div class="panel-cell">
					<PanelControlView {control} {params} {color} switchParam={group.switchParam} {face} pick={boardPick(control)} />
				</div>
			{/each}
		</div>
	{:else}
		<!-- A column a stack, `stack` high (knobs `knobStack`), every cell
		     one height; a column short of its stack (a lead, the last of an
		     odd run) centres what it holds. Every knob the group's one size. -->
		<div class="panel-group-grid" bind:this={row} data-board-stack={stack} data-board-lead={lead || undefined} data-board-knob={boardSize} style="grid-column: span {columns}; grid-template-rows: minmax(0, 1fr);">
			{#each boardGroupStacks(group.controls, stack, lead, knobStack) as col, c (c)}
				<div class="board-stack" style="--stack-high: {col.high};">
					{#each col.cells as control (control.param)}
						<div class="panel-cell">
							<PanelControlView {control} {params} {color} switchParam={group.switchParam} {face} knobSize={boardSize} pick={boardPick(control)} />
						</div>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
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
{:else if columns && group.time}
	<!-- On a frame: the envelope as one Time pad (ADR-546), Attack across and
	     Release (or Decay) up; its page and the board draw the stages. -->
	{@const time = group.time}
	<div class="panel-group-grid" class:under-tabs={underTabs} data-group={dataGroup} data-time-pad style="grid-column: span {columns}; grid-template-rows: minmax(0, 1fr);">
		<div class="panel-cell" style="grid-column: 1 / -1;">
			<DeviceXY
				xValue={params.unit(time.x) ?? 0}
				yValue={params.unit(time.y) ?? 0.5}
				title={group.title ?? 'Envelope'}
				icon="envelope"
				{color}
				isGhost={!params.has(time.x) || !params.isOn(group.switchParam)}
				onInteraction={(x, y) => {
					params.writeUnit(time.x, x, group.switchParam);
					params.writeUnit(time.y, y, group.switchParam);
				}}
			/>
		</div>
	</div>
{:else if columns && group.pickRow}
	<!-- A selector row over a knob row (ADR-516, at band size): the picks one
	     touch row across the group, its knobs one row under them, a column
	     each (their own equal cells where their count is not the columns'). -->
	{@const picks = group.controls.slice(0, group.pickRow)}
	{@const under = group.controls.slice(group.pickRow)}
	<div class="panel-group-grid pick-over" class:under-tabs={underTabs} data-group={dataGroup} style="grid-column: span {columns};">
		<div class="pick-row">
			{#each picks as control (control.param)}
				<div class="panel-cell">
					<PanelControlView {control} {params} {color} switchParam={group.switchParam} {face} />
				</div>
			{/each}
		</div>
		<div class="knob-row" class:own-grid={under.length !== columns} style="grid-template-columns: {under.length === columns ? 'subgrid' : `repeat(${under.length}, minmax(0, 1fr))`};">
			{#each under as control (control.param)}
				<div class="panel-cell">
					<PanelControlView {control} {params} {color} switchParam={group.switchParam} {face} knobSize={controlKnobSize(control, group, 1)} />
				</div>
			{/each}
		</div>
	</div>
{:else if columns}
	<!-- On the face grid: a subgrid of the face's columns, no eyebrow. -->
	{@const span = faceFit ? Math.floor(columns / faceFit.knobCols) : 1}
	<!-- A last row short of its columns: centred under the rows above. -->
	{@const tail = faceFit && faceFit.rows > 1 ? group.controls.length % faceFit.knobCols : 0}
	<div
		class="panel-group-grid"
		class:under-tabs={underTabs}
		class:second-row={underTabs && !!faceFit && faceFit.rows === 1}
		class:own-grid={frameOwnGrid || knobOwnGrid}
		bind:this={row}
		data-group={dataGroup}
		data-knob-rows={faceFit ? faceFit.rows : undefined}
		style="grid-column: span {columns}; grid-template-rows: repeat({faceFit ? faceFit.rows : 1}, minmax(0, 1fr));{frameOwnGrid ? ` grid-template-columns: repeat(${group.controls.length}, minmax(0, 1fr));` : knobOwnGrid && faceFit ? ` grid-template-columns: repeat(${faceFit.knobCols}, minmax(0, 1fr));` : ''}"
	>
		{#if faceFit || frameOwnGrid || !framePlan}
			{#each group.controls.slice(0, group.controls.length - tail) as control (control.param)}
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
			{#if tail && faceFit}
				<div class="knob-tail" style="--knob-cols: {faceFit.knobCols};">
					{#each group.controls.slice(group.controls.length - tail) as control (control.param)}
						<div class="panel-cell">
							<PanelControlView {control} {params} {color} switchParam={group.switchParam} {face} knobSize={controlKnobSize(control, { ...group, knobSize: faceFit.size }, 1)} />
						</div>
					{/each}
				</div>
			{/if}
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
	/* Two knobs sharing a column, one over the other; a pick of two values
	   over a knob takes its two touch rows and the knob the rest. */
	.panel-cell.panel-stack {
		flex-direction: column;
		gap: var(--face-gutter, var(--spacing-sm));
	}
	.panel-cell.panel-stack > :global(*) {
		min-height: 0;
	}
	.panel-cell.panel-stack > :global(.panel-choice) {
		flex: 0 0 auto;
		align-self: stretch;
	}
	/* A board's column: its controls one over another, sharing its height. */
	.board-stack {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--face-gutter, var(--spacing-sm));
		min-width: 0;
		min-height: 0;
	}
	.board-stack > .panel-cell {
		flex: 0 0 calc((100% - (var(--stack-high, 1) - 1) * var(--face-gutter, var(--spacing-sm))) / var(--stack-high, 1));
	}
	/* A selector row over a knob row. */
	.panel-group-grid.pick-over {
		grid-template-rows: auto minmax(0, 1fr);
	}
	.pick-row {
		grid-column: 1 / -1;
		display: flex;
		gap: var(--face-gutter, var(--spacing-sm));
		min-width: 0;
	}
	.pick-row > .panel-cell {
		flex: 1 1 0;
	}
	.knob-row {
		grid-column: 1 / -1;
		display: grid;
		min-width: 0;
		min-height: 0;
	}
	.knob-row.own-grid {
		column-gap: var(--face-gutter, var(--spacing-sm));
	}
	/* A last row short of its columns: its knobs centred, each a knob
	   column wide, so they draw as the rows above do. */
	.knob-tail {
		grid-column: 1 / -1;
		display: flex;
		justify-content: center;
		column-gap: var(--face-gutter, var(--spacing-sm));
		min-width: 0;
		min-height: 0;
	}
	.knob-tail > .panel-cell {
		flex: 0 0 calc((100% - (var(--knob-cols) - 1) * var(--face-gutter, var(--spacing-sm))) / var(--knob-cols));
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
	/* A selector row sits a gutter under the tab strip it belongs with, and
	   its knobs keep a few px under them: a whole-numbered knob's value
	   hangs under its name (a resonator's Tune), and must clear the inset. */
	.panel-group-grid.under-tabs.pick-over {
		margin-top: calc(var(--height-touch) + var(--face-gutter, var(--spacing-sm)));
	}
	.panel-group-grid.under-tabs.pick-over > .knob-row,
	.panel-group-grid.under-tabs.second-row {
		padding-bottom: 4px;
	}
	/* One row of knobs under a tab strip stands where a selector row would
	   leave it (`pick-over`), so a tab switch moves no knob up or down and
	   the knobs' names keep the line the sections beside them end on. */
	.panel-group-grid.under-tabs.second-row {
		padding-top: calc(var(--height-touch) + 2 * var(--face-gutter, var(--spacing-sm)) - var(--central-gap));
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
