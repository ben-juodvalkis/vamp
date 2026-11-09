<script lang="ts">
	/**
	 * An instrument in Live's own arrangement (ADR-487): the panel's frame,
	 * left to right in Live's signal order with Global at the right edge,
	 * seams between its sections and Live's tab strip over the region Live
	 * swaps, or the tab its view picks (`tabOf`: Operator's oscillator, from
	 * its chain cell). A section's eyebrow is its name: the band opens no
	 * page (ADR-513); the panel's `pages` are the list of everything the
	 * instrument holds, which its board must reach.
	 *
	 * Which tab is up is view state: it never writes to Live.
	 *
	 * The frame is laid on the face grid (ADR-510): a section a region (a
	 * tab strip whose tabs share their shape, a section a group), its
	 * eyebrow on the one header line, every column one width and every seam
	 * the same. A tab strip lies over the top of its sections' controls,
	 * under the header line, which names the shown tab's groups.
	 *
	 * At full screen (`board`, ADR-512) a panel with a `board` draws it in
	 * place of the frame: `InstrumentBoard`'s rows of tiles, each tile a face
	 * grid of the panel's board sections, every control on screen at once,
	 * no tab strip and no page to open. A matrix section draws twin sections
	 * as a table (a row each, its name at the left; a column a control, its
	 * name once over it). Off the board the panel draws exactly as before.
	 */
	import type { Snippet } from 'svelte';
	import FaceGrid from '../../FaceGrid.svelte';
	import FaceSection from '../../FaceSection.svelte';
	import FaceSeam from '../../FaceSeam.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import PanelGroupView from './PanelGroupView.svelte';
	import PanelTabs from './PanelTabs.svelte';
	import PanelEyebrow from './PanelEyebrow.svelte';
	import PanelControlView from './PanelControlView.svelte';
	import InstrumentBoard, { type BoardRow } from '../../InstrumentBoard.svelte';
	import BoardTile from '../../BoardTile.svelte';
	import { boardGroupColumns, boardTileSections, boardTileWeight, groupColumns, regionSections, tabsByPosition, type InstrumentPanel, type PanelBoardTile, type PanelGroup, type PanelMatrix, type PanelPage, type PanelTab } from './panelTypes';
	import type { PanelParams } from './usePanelParams.svelte';

	interface Props {
		panel: InstrumentPanel;
		params: PanelParams;
		color: DeviceColorScheme;
		/** The device's own controls for the panel's `slot` regions, by slot name. */
		slots?: Record<string, Snippet>;
		/**
		 * A hand-laid face in place of the frame (a view whose layout carries
		 * widgets of its own: Drift's oscillator card, Analog's voice switch).
		 */
		face?: Snippet;
		/** Full screen (ADR-512): draw the panel's `board`, where it has one. */
		board?: boolean;
		/**
		 * The tab a `tabs` region shows, by the region's index, when the view
		 * picks it (Operator's oscillator, from its chain cell: ADR-513). A
		 * region so picked draws no tab strip.
		 */
		tabOf?: (region: number) => number | undefined;
	}

	let { panel, params, color, slots = {}, face, board = false, tabOf }: Props = $props();

	// The board's rows for InstrumentBoard: a tile's share of its row is its
	// face columns, plus what its inset and seams take in columns, so a
	// one-column tile's column comes out as wide as a sixteen-column one's.
	let boardRows = $derived<BoardRow[]>(
		(panel.board?.rows ?? []).map((r) => ({
			weight: r.weight,
			tiles: r.tiles.map((t) => ({ id: t.id, cols: boardTileWeight(boardTileSections(t), t.columnPx) }))
		}))
	);
	const boardTile = (id: string) => panel.board?.rows.flatMap((r) => r.tiles).find((t) => t.id === id);
	/** A tile's header line: only where a section has a name of its own, or columns to name (a matrix). */
	const tileHeads = (t: PanelBoardTile) => t.sections.some((s) => (s.kind === 'group' ? !!s.group.title && s.group.title !== t.title : s.kind === 'matrix' || !!s.title));
	/** The tile's bar switch: its section's on/off, flipped. */
	function flipSwitch(name: string) {
		const r = params.range(name);
		params.write(name, params.isOn(name) ? (r?.min ?? 0) : (r?.max ?? 1));
	}

	/** Where a matrix group's column starts on its section's grid lines (the rows' names take the first's first). */
	function matrixStarts(m: PanelMatrix, g: number): number[] {
		let line = g === 0 ? 2 : 1;
		return m.groups[g].columns.map((c) => {
			const at = line;
			line += c.span ?? 1;
			return at;
		});
	}

	let tabSelected = $state<Record<number, number>>({});

	// The frame's sections, region by region, and where each region's
	// columns start on the face (a grid line: a column a track, a seam a
	// track), for the tab strip that lies across a region's sections.
	let regionCols = $derived(panel.frame.map((r) => regionSections(r)));
	let sections = $derived(regionCols.flat());
	let regionLines = $derived.by(() => {
		const lines: { start: number; end: number }[] = [];
		let line = 1;
		for (const cols of regionCols) {
			const start = line;
			for (const n of cols) line += n + 1;
			lines.push({ start, end: line - 1 });
		}
		return lines;
	});

	/** A tab's groups with the face columns each takes in its one section. */
	function tabColumns(tab: PanelTab, span: number): { group: PanelGroup; cols: number }[] {
		if (tab.groups.length === 1) return [{ group: tab.groups[0], cols: span }];
		return tab.groups.map((group) => ({ group, cols: groupColumns(group) }));
	}
</script>

{#if board && panel.board}
	<!-- Full screen (ADR-512): the panel's board, every control at once. -->
	<InstrumentBoard rows={boardRows} ink={color.primary}>
		{#snippet tile(id)}
			{@const t = boardTile(id)}
			{#if t}
				{@const sw = t.switchParam}
				<!-- A panel (ADR-516): the tile's name and its section's switch on
				     the bar; its sections' own names on the header line below, where
				     a section has one. -->
				<BoardTile
					title={t.title ?? ''}
					ink={color.primary}
					on={sw ? params.isOn(sw) : undefined}
					onToggle={() => sw && flipSwitch(sw)}
					switchParam={sw}
					switchDisabled={!!sw && !params.has(sw)}
				>
				<FaceGrid sections={boardTileSections(t)} heads={tileHeads(t)} data-board-face={id}>
					{#each t.sections as section, s (s)}
						{#if s > 0}<FaceSeam ink={color.primary} />{/if}
						{#if section.kind === 'group'}
							{@const span = boardGroupColumns(section)}
							<FaceSection {span} data-group={section.group.title ?? ''}>
								{#snippet head()}
									{#if section.group.title && section.group.title !== t.title}<PanelEyebrow title={section.group.title} color={color.primary} />{/if}
								{/snippet}
								<PanelGroupView group={section.group} {params} {color} boxFace={panel.boxFace} columns={span} stack={section.stack} lead={section.lead} tabMax={section.tabMax} />
							</FaceSection>
						{:else if section.kind === 'slot'}
							<FaceSection span={section.columns} data-group={section.title ?? section.slot}>
								{#snippet head()}<PanelEyebrow title={section.title} color={color.primary} />{/snippet}
								{#if section.below}
									<!-- The view's control across the section, its groups under it on the same columns. -->
									<div class="slot-stack face-span-all" data-slot-stack={section.slot}>
										<div class="panel-slot-body slot-main">{@render slots[section.slot]?.()}</div>
										{#each section.below as b, k (k)}
											<div class="slot-below" style="grid-column: span {b.columns};" data-group={b.group.title ?? ''}>
												<span class="slot-below-name"><PanelEyebrow title={b.group.title} color={color.primary} /></span>
												<PanelGroupView group={b.group} {params} {color} boxFace={panel.boxFace} columns={b.columns} stack={b.stack} tabMax={1} />
											</div>
										{/each}
									</div>
								{:else}
									<div class="panel-slot-body face-span-all">{@render slots[section.slot]?.()}</div>
								{/if}
							</FaceSection>
						{:else}
							{@render matrix(section.matrix)}
						{/if}
					{/each}
				</FaceGrid>
				</BoardTile>
			{/if}
		{/snippet}
	</InstrumentBoard>
	<!-- A matrix (ADR-512): a section a group of its columns, seamed; the
	     header line names each column over it (the rows' names under the
	     matrix's own), then a row a twin, the first section starting with
	     the rows' names. A matrix whose columns repeat a name across groups
	     (`groupLine`) puts the groups' names on the header line and the
	     columns' on a line under it. Cells sit on the face's own columns. -->
	{#snippet matrix(m: PanelMatrix)}
		{#each m.groups as mg, g (g)}
			{@const starts = matrixStarts(m, g)}
			{@const span = mg.columns.reduce((n, c) => n + (c.span ?? 1), g === 0 ? 1 : 0)}
			{#if g > 0}<FaceSeam ink={color.primary} />{/if}
			<FaceSection {span} data-group={mg.title}>
				{#snippet head()}
					{#if m.groupLine}
						<PanelEyebrow title={mg.title} color={color.primary} />
					{:else}
						<div class="head-cols" style="grid-template-columns: repeat({span}, minmax(0, 1fr));">
							{#if g === 0}<span class="matrix-col-name matrix-title" style="grid-column: 1; color: {color.primary};">{m.title ?? ''}</span>{/if}
							{#each mg.columns as col, c (c)}
								<span class="matrix-col-name" style="grid-column: {starts[c]} / span {col.span ?? 1}; color: {color.primary};">{col.title}</span>
							{/each}
						</div>
					{/if}
				{/snippet}
				{@const top = m.groupLine ? 2 : 1}
				<div class="matrix face-span-all" data-matrix={mg.title} style="grid-template-rows: {m.groupLine ? 'auto ' : ''}repeat({m.rows.length}, minmax(0, 1fr));">
					{#if m.groupLine}
						{#if g === 0}<span class="matrix-col-name matrix-title" style="grid-column: 1; grid-row: 1; color: {color.primary};">{m.title ?? ''}</span>{/if}
						{#each mg.columns as col, c (c)}
							<span class="matrix-col-name" style="grid-column: {starts[c]} / span {col.span ?? 1}; grid-row: 1; color: {color.primary};">{col.title}</span>
						{/each}
					{/if}
					{#if g === 0}
						{#each m.rows as row, r (r)}
							<div class="matrix-cell matrix-name" style="grid-column: 1; grid-row: {r + top};">
								{#if row.switchParam && !row.quiet}
									<PanelControlView control={{ kind: 'switch', param: row.switchParam, title: row.title }} {params} {color} switchParam={row.switchParam} face="knob" />
								{:else}
									<span class="matrix-row-name" style="color: {color.primary};">{row.title}</span>
								{/if}
							</div>
						{/each}
					{/if}
					{#each mg.columns as col, c (c)}
						{#each col.cells as cell, r (r)}
							{#if cell}
								<div class="matrix-cell" style="grid-column: {starts[c]} / span {col.span ?? 1}; grid-row: {r + top};">
									<PanelControlView
										control={cell}
										{params}
										{color}
										switchParam={m.rows[r]?.switchParam}
										face={col.face ?? panel.boxFace ?? 'slider'}
										knobSize="m"
										pick={cell.kind === 'choice' || (cell.kind === 'step' && !!cell.labels)}
										bareCaption
										caption={false}
									/>
								</div>
							{/if}
						{/each}
					{/each}
				</div>
			</FaceSection>
		{/each}
	{/snippet}
{:else if face}
	<div class="h-full w-full" data-panel-page="frame">{@render face()}</div>
{:else}
	<div class="h-full w-full" data-panel-page="frame">
		<FaceGrid {sections} class="panel-face">
			{#each panel.frame as region, i (i)}
				{#if i > 0}<FaceSeam ink={color.primary} />{/if}
				{#if region.kind === 'group'}
					<FaceSection span={regionCols[i][0]} data-group={region.group.title ?? ''}>
						{#snippet head()}<PanelEyebrow title={region.group.title} color={color.primary} />{/snippet}
						<PanelGroupView group={region.group} {params} {color} boxFace={panel.boxFace} columns={regionCols[i][0]} />
					</FaceSection>
				{:else if region.kind === 'slot'}
					<FaceSection span={regionCols[i][0]} data-group={region.title ?? region.slot}>
						{#snippet head()}<PanelEyebrow title={region.title} color={color.primary} />{/snippet}
						<div class="panel-slot-body face-span-all">{@render slots[region.slot]?.()}</div>
					</FaceSection>
				{:else}
					{@const picked = tabOf?.(i)}
					{@const sel = Math.min(picked ?? tabSelected[i] ?? 0, region.tabs.length - 1)}
					{@const tab = region.tabs[sel]}
					{#if tabsByPosition(region.tabs)}
						<!-- A section a group, the shown tab's in each, seamed. -->
						{#each tab.groups as group, g (g)}
							{#if g > 0}<FaceSeam ink={color.primary} />{/if}
							<FaceSection span={regionCols[i][g]} data-group={group.title ?? ''}>
								{#snippet head()}<PanelEyebrow title={group.title} color={color.primary} />{/snippet}
								<PanelGroupView {group} {params} {color} boxFace={panel.boxFace} columns={regionCols[i][g]} underTabs={picked === undefined} />
							</FaceSection>
						{/each}
					{:else}
						{@const placed = tabColumns(tab, regionCols[i][0])}
						{#if placed.length === 1}
							{@const group = placed[0].group}
							<FaceSection span={regionCols[i][0]} data-group={group.title ?? ''}>
								{#snippet head()}{#if group.page}<PanelEyebrow title={group.title} color={color.primary} />{/if}{/snippet}
								<PanelGroupView {group} {params} {color} boxFace={panel.boxFace} columns={regionCols[i][0]} underTabs={picked === undefined} />
							</FaceSection>
						{:else}
							<!-- Several groups in one section: each eyebrow over its own columns. -->
							<FaceSection span={regionCols[i][0]}>
								{#snippet head()}
									<div class="head-cols" style="grid-template-columns: repeat({regionCols[i][0]}, minmax(0, 1fr));">
										{#each placed as { group, cols }, g (g)}
											<span class="head-col" style="grid-column: span {cols};" data-group={group.title ?? ''}><PanelEyebrow title={group.title} color={color.primary} /></span>
										{/each}
									</div>
								{/snippet}
								{#each placed as { group, cols }, g (g)}
									<PanelGroupView {group} {params} {color} boxFace={panel.boxFace} columns={cols} underTabs={picked === undefined} dataGroup={group.title ?? ''} />
								{/each}
							</FaceSection>
						{/if}
					{/if}
					{#if picked === undefined}
						<!-- Live's tabs, across the region's sections under the header line. -->
						<div class="face-tabs" style="grid-column: {regionLines[i].start} / {regionLines[i].end};">
							<PanelTabs tabs={region.tabs} selected={sel} {params} {color} onSelect={(t) => (tabSelected = { ...tabSelected, [i]: t })} />
						</div>
					{/if}
				{/if}
			{/each}
		</FaceGrid>
	</div>
{/if}

<style>
	/* The tab strip lies over its region's controls, out of the grid's
	   flow, so the sections around it place as on any face (ADR-510). */
	:global(.panel-face) {
		position: relative;
	}
	.face-tabs {
		position: absolute;
		grid-row: 2;
		top: 0;
		left: 0;
		right: 0;
		height: var(--height-touch);
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* A section's header line over several groups: each eyebrow over its
	   own columns, on the face's gutters. */
	.head-cols {
		flex: 1 1 auto;
		align-self: stretch;
		display: grid;
		column-gap: var(--face-gutter);
		min-width: 0;
	}
	.head-col {
		display: flex;
		justify-content: center;
		align-items: center;
		min-width: 0;
	}
	/* A board's matrix (ADR-512): the face's columns, a line of names over
	   rows of equal height. */
	.matrix {
		display: grid;
		grid-template-columns: subgrid;
		row-gap: var(--face-gutter, var(--spacing-sm));
		min-width: 0;
		min-height: 0;
	}
	.matrix-col-name,
	.matrix-row-name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1rem;
		text-align: center;
		white-space: nowrap;
		min-width: 0;
		opacity: 0.85;
	}
	.matrix-row-name {
		align-self: center;
		font-weight: 700;
		opacity: 1;
	}
	.matrix-cell {
		display: flex;
		align-items: center;
		min-width: 0;
		min-height: 0;
	}
	.matrix-cell > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	/* The rows' names stand at the section's left edge, as a table's do,
	   so a seam before the matrix keeps its gap to them. */
	.matrix-name {
		justify-content: flex-start;
	}
	.matrix-row-name,
	.matrix-col-name.matrix-title {
		text-align: left;
	}
	.panel-slot-body {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.panel-slot-body > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	/* A board slot with groups under it: the control takes what the groups
	   leave, the groups sit on the section's own columns. */
	.slot-stack {
		display: grid;
		grid-template-columns: subgrid;
		/* The pad and the controls under it, a half each. */
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		row-gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.slot-main {
		grid-column: 1 / -1;
	}
	.slot-below {
		display: grid;
		grid-template-columns: subgrid;
		grid-template-rows: auto minmax(0, 1fr);
		row-gap: 0.25rem;
		min-width: 0;
		min-height: 0;
	}
	.slot-below-name {
		grid-column: 1 / -1;
		display: flex;
		justify-content: center;
		min-width: 0;
	}
</style>
