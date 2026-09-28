<script lang="ts">
	import { tick } from 'svelte';
	import constants from '$config/constants.json';
	import { logger } from '$lib/utils/logger';
	import TrackStrip from '$lib/components/v6/tracks/TrackStrip.svelte';
	import SlotGrid from '$lib/components/v6/tracks/TrackStrip/components/SlotGrid.svelte';
	import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
	import type { SlotState } from '$lib/stores/v3/normalized.svelte';
	import {
		selectSlot,
		actOnSlot,
		focusSlot,
		stopTrack
	} from '$lib/components/v6/tracks/composables/slotActions';
	import { sceneWindowStore } from '$lib/stores/v6/sceneWindowStore.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { clipStateStore } from '$lib/stores/v6/clipStateStore.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { setTrackFoldState } from '$lib/services/trackCommands';
	import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { press } from '$lib/actions/press';

	interface Props {
		onTrackSelect?: (trackIndex: number) => void;
	}

	let { onTrackSelect }: Props = $props();

	let visibleTracks = $derived(
		clipStateStore.getVisibleTracks(session.numTracks, session.selectedTrackIndex)
	);

	// ---- Group brackets (ADR-413) -----------------------------------------
	//
	// An open group draws a "panhandle": an arm growing out of the top of
	// the group's own strip and reaching right, over every visible track
	// inside the group. The group's strip keeps its FULL height and the
	// arm is part of its outline — together they make one ⌐-shaped body.
	// The member strips start below the arm with a gap, keeping their own
	// complete rounded outlines, so they read as tracks hanging under the
	// group rather than as cells fused to it.
	//
	// The row is a grid rather than a flex line purely because of this:
	// an arm has to span N columns *and* the gaps between them, which
	// grid does by line number with no measurement. Column sizing is
	// unchanged in effect — `minmax(--track-min-w, 1fr)` is the grid
	// spelling of the old `flex: 1 1 0` + `min-width`.
	let layout = $derived(clipStateStore.groupBands(visibleTracks));

	// Flipped stack (ADR-421, default ON): the strips row sits BELOW the
	// clip grid, against the bottom of the screen. The bracket arm has to
	// follow — it is the group strip's title block continuing sideways,
	// and the title band is now at the strip's foot — so the band rows
	// move to the bottom of this grid and the whole bracket geometry
	// mirrors: rows counted from the end, strips growing down from row 1
	// instead of up from the last, and the group strip squaring its
	// bottom-right corner instead of its top-right.
	//
	// Always true (FLIP went 2026-09-26; uiPrefsStore pins it). Every
	// unflipped arm below — `rowStyle`, `bandRow`, `stripRow`, the group
	// strip's `--strip-radius` — and the base rules `.tracks-panel.is-flipped`
	// overrides are UNREACHABLE since 2026-09-26, kept until the flag goes.
	let flipLayout = $derived(uiPrefsStore.flipLayout);

	let rowStyle = $derived(
		`grid-template-columns: repeat(${Math.max(visibleTracks.length, 1)}, minmax(var(--track-min-w), 1fr));` +
			` grid-template-rows: ${
				layout.bandCount > 0
					? flipLayout
						? `1fr repeat(${layout.bandCount}, var(--group-band-h))`
						: `repeat(${layout.bandCount}, var(--group-band-h)) 1fr`
					: '1fr'
			};` +
			` --meter-wash: ${constants.ui.meters.opacity};`
	);

	/**
	 * Grid row placement for one bracket arm, and for one strip column.
	 *
	 * Unflipped the band rows come first: band level `b` is row `b + 1`,
	 * and a strip enclosed by `k` open groups starts below those `k` rows
	 * and runs to the end (`k + 1 / -1`).
	 *
	 * Flipped, the 1fr strips row comes first and the bands stack BELOW
	 * it outermost-last, so the outermost group's arm ends up furthest
	 * from the strips in both layouts. Counting from the end makes that
	 * placement independent of the band count: level `b` is the pair of
	 * lines `(-2 - b, -1 - b)`, and a strip enclosed by `k` groups runs
	 * from row 1 down to line `-(k + 1)`.
	 */
	function bandRow(band: number): string {
		return flipLayout ? `${-2 - band} / ${-1 - band}` : `${band + 1}`;
	}

	function stripRow(offset: number): string {
		return flipLayout ? `1 / ${-1 - offset}` : `${offset + 1} / -1`;
	}

	// Name + ink for each arm. Read straight off the v3 record — the arm
	// is chrome around the strips, not a strip, so it must not spin up a
	// `useTrackData` (which mounts per-track observers). `selected` makes
	// the arm follow its strip through the selection highlight: the two
	// are one outline, so they must change state as one shape.
	let bands = $derived(
		layout.bands.map((band) => {
			const record = v3Store.tracks.get(`tracks/${band.groupIndex}`);
			return {
				...band,
				name: record?.name ?? `Group ${band.groupIndex + 1}`,
				ink: trackInk(rgbToHex(record?.color ?? 0x808080), paintModeReactive()),
				selected: session.selectedTrackIndex === band.groupIndex,
				muted: record?.mute ?? false
			};
		})
	);

	// Columns whose strip the arm grows out of — the group's own column.
	// Only that strip squares a corner; every member strip keeps its full
	// rounded outline and simply hangs below the arm.
	let bandHeadCols = $derived(new Set(layout.bands.map((b) => b.start)));

	function foldGroup(groupIndex: number) {
		setTrackFoldState(`tracks/${groupIndex}`, true);
	}

	// How far each arm reaches back into its own group's column, in px.
	//
	// The arm grows out of the group's NAME block, and the name is not always
	// the column's full width: with Solo shown the button takes a column on
	// the name's right, lifted clear of the arm by `--arm-clearance`. An arm
	// that started at the column edge left a hole under Solo, between the
	// name and the arm. So the arm reaches back under Solo to the name's own
	// right edge — 0 when Solo is off or hidden on a narrow strip.
	//
	// Measured rather than derived: the name's width is Solo's
	// `clamp(36px, 28%, 56px)` plus a gap, gated by a container query on the
	// strip, and repeating that here would be a second copy that drifts. The
	// name box resizes whenever the answer changes (a column resize moves
	// Solo's width by less than the column's, a Solo toggle or hide moves it
	// outright), so observing it is enough.
	//
	// Keyed on the group indices alone, so a record update that re-derives
	// `bands` — a fader drag, a rename — doesn't tear the observer down.
	let bandHeadKey = $derived(layout.bands.map((b) => b.groupIndex).join(','));
	let armReach = $state<Record<number, number>>({});

	$effect(() => {
		const key = bandHeadKey;
		const el = panelEl;
		if (!el || !key || typeof ResizeObserver === 'undefined') {
			armReach = {};
			return;
		}
		const heads = key.split(',').map((groupIndex) => {
			const col = el.querySelector<HTMLElement>(`.track-col[data-track-index="${groupIndex}"]`);
			return { groupIndex: Number(groupIndex), col, name: col?.querySelector<HTMLElement>('.header-name') };
		});
		const measure = () => {
			const next: Record<number, number> = {};
			for (const { groupIndex, col, name } of heads) {
				if (!col || !name) continue;
				next[groupIndex] = Math.max(
					0,
					col.getBoundingClientRect().right - name.getBoundingClientRect().right
				);
			}
			armReach = next;
		};
		measure();
		const ro = new ResizeObserver(measure);
		for (const { col, name } of heads) {
			if (col) ro.observe(col);
			if (name) ro.observe(name);
		}
		return () => ro.disconnect();
	});

	// ---- Session clip grid (ADR-415) --------------------------------------
	//
	// The clip grid is a SECOND grid row inside this panel, not a separate
	// panel. That is the whole reason it lives here: both rows then sit in
	// one horizontal scroller with one `scrollLeft`, so a clip column can
	// never drift out from under the strip it belongs to — no scroll
	// syncing, no drift to reconcile. They also share
	// `grid-template-columns` verbatim, so column N is the same column in
	// both rows by construction rather than by measurement.
	//
	// The panel is therefore worth TWO sections of the main-area stack
	// when session mode is on — its two rows plus the gap between them
	// are exactly the strips' section + the grid's section — which
	// `+page.svelte` buys with `flex: 2 1 var(--spacing-lg)` (ADR-416).
	let sessionMode = $derived(uiPrefsStore.sessionMode);

	// The grid row's own column template. Identical to the strips' except
	// it never carries band rows — a group's bracket arm is chrome over
	// the strips, and has no counterpart among the clip columns.
	let slotRowStyle = $derived(
		`grid-template-columns: repeat(${Math.max(visibleTracks.length, 1)}, minmax(var(--track-min-w), 1fr));`
	);

	// Row pitch, measured rather than authored: the grid is one section
	// of the main-area stack, and the pitch is that section divided by
	// the rows actually drawn — a set with fewer scenes than the window
	// gets taller rows rather than dead space below the last one.
	// Published in px as --session-row-h for the columns to read
	// (SlotGrid converts a pixel drag into scene rows through it). The
	// scene rail measures its own section exactly the same way and lands
	// on the same number, which is what aligns the two without a shared
	// absolute length.
	//
	// The +1 is the stop row: it is one more row of the grid, same pitch
	// as a clip slot, so the section divides into `renderedRows` scene
	// rows plus it. The rail applies the same +1 for its STOP ALL, which
	// is why adding the strip cost the alignment nothing.
	//
	// How many rows that is is not fixed: `sceneWindowStore` grows the
	// window as main-area sections are switched off (4 · 6 · 8), so a
	// taller section shows more scenes at roughly the same pitch rather
	// than the same scenes at a taller one. Nothing here changes for
	// that — the pitch is still this box divided by the rows drawn.
	let slotSectionEl = $state<HTMLDivElement | null>(null);
	let slotSectionHeightPx = $state(0);
	let renderedRows = $derived(sceneWindowStore.renderedRows);
	let rowPitchPx = $derived(
		renderedRows > 0 ? slotSectionHeightPx / (renderedRows + 1) : 0
	);

	$effect(() => {
		const el = slotSectionEl;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			const h = el.getBoundingClientRect().height;
			if (h > 0) slotSectionHeightPx = h;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	// The cell gestures themselves live in `composables/slotActions` — the
	// FX grid's mini session column renders the same `SlotGrid`, and a cell
	// has to mean the same thing in both. Bound here only to hand them this
	// panel's `onTrackSelect`.
	const slotActionOptions = $derived({ onTrackSelect });

	$effect(() => {
		logger.debug('Showing tracks', {
			component: 'TracksPanelV6',
			numTracks: session.numTracks,
			visible: visibleTracks.length,
			filterMode: clipStateStore.filterMode
		});
	});

	function handleTrackSelect(trackIndex: number) {
		logger.debug('🎯 TracksPanelV6: Selecting track:', { component: 'TracksPanelV6', trackIndex });
		onTrackSelect?.(trackIndex);
	}

	// ---- Keep the selected strip on screen --------------------------------
	//
	// Once the row is wide enough to scroll, the selected track has to stay
	// visible — it is the track every other panel on the screen is about,
	// and a Central View editing a strip you cannot see is the wrong kind of
	// surprise. `inline: 'nearest'` makes the scroll a no-op for a strip
	// that is already visible, so this only ever moves the row when it has
	// to; tapping a visible strip never lurches it.
	//
	// Three things can put the selected strip out of view, and all three
	// re-follow:
	//
	//   selection changes  — a tap here, or Ableton-initiated via
	//                        song.view.selected_track → session store
	//   the row's contents change — a group folds/unfolds, the filter mode
	//                        switches, a track is added or deleted: every
	//                        column left of the selection shifts
	//   the panel resizes  — rotation, or a section toggling on/off; the
	//                        columns re-divide and the row can end up
	//                        scrolled past its own new width
	//
	// While a finger/button is down on the panel the follow is deferred (a
	// smooth-scroll would fight an in-flight pan) and replayed on release
	// only if something actually arrived meanwhile — deliberately scrolling
	// the selected strip out of view must not snap back on finger-up.

	let panelEl = $state<HTMLDivElement | null>(null);
	// Plain (non-reactive) gesture bookkeeping — must not re-trigger the
	// follow $effect.
	const panelPointers = new Set<number>();
	let pendingFollow = false;

	function followSelected() {
		const idx = session.selectedTrackIndex;
		if (idx < 0) return; // master / none
		panelEl
			?.querySelector(`[data-track-index="${idx}"]`)
			?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
	}

	/** Follow now, or on finger-up if the row is being panned right now. */
	function requestFollow() {
		if (panelPointers.size > 0) {
			pendingFollow = true;
			return;
		}
		// tick(): in `active` filter mode the strip can enter the DOM in the
		// same flush as the change that triggered this.
		tick().then(followSelected);
	}

	$effect(() => {
		if (session.selectedTrackIndex < 0) return;
		// Read the column roster so a fold/filter/add/delete that reshuffles
		// the row re-follows too, not only an actual selection change. The
		// join is the dependency: a re-render that produces the same columns
		// must not re-scroll.
		void visibleTracks.join(',');
		requestFollow();
	});

	// Resize is not a store change, so it needs its own trigger. Same
	// deferral, same `inline: 'nearest'` no-op when the strip is already
	// visible — which is the common case, so this costs nothing at rest.
	$effect(() => {
		const el = panelEl;
		if (!el || typeof ResizeObserver === 'undefined') return;
		let first = true;
		const ro = new ResizeObserver(() => {
			// The observer fires once on observe(); the mount-time follow
			// above already covers that frame.
			if (first) {
				first = false;
				return;
			}
			requestFollow();
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	/**
	 * Can the strips row actually scroll horizontally?
	 *
	 * Handed to every `TrackStrip`, where it decides mute's timing (ADR-427
	 * addendum 2). Mute's release-wait exists for exactly one reason — so a
	 * row pan that begins on a track name scrolls the row instead of muting
	 * — and when the row cannot scroll, that reason does not exist and the
	 * wait is pure latency on the most-used control on the surface.
	 *
	 * Measured on the running artifact at the iPad's 1366x1024: the tracks
	 * panel is 1062px wide, `--track-min-w` is 64px with a 16px gap, so
	 * **13 tracks fit before the row overflows**. Below that the row is not
	 * a scroller at all.
	 *
	 * Observed rather than read at press time: `scrollWidth` forces layout,
	 * and the touch path is the one place not to do that. Both boxes are
	 * observed because either can move the answer — the panel when the
	 * window or the section stack changes, and the row itself when a
	 * fourteenth track pushes it past the panel's width. (Below the
	 * threshold the row is exactly the panel's width whatever the track
	 * count, so adding tracks there fires nothing and changes nothing.)
	 *
	 * The 1px tolerance is for sub-pixel grid rounding, which otherwise
	 * reports a 1062.0001px row inside a 1062px panel as scrollable.
	 */
	let rowScrolls = $state(false);

	$effect(() => {
		const el = panelEl;
		// Re-run on every roster change. The row element does not exist
		// until there is at least one track — a first run that captured a
		// null `rowEl` would observe only the panel, whose size does not
		// change when tracks arrive, and the answer would then never
		// update. Reading the length is also what makes a track added or
		// removed re-measure at all.
		void visibleTracks.length;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			rowScrolls = el.scrollWidth > el.clientWidth + 1;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		const rowEl = el.querySelector('.tracks-row');
		if (rowEl) ro.observe(rowEl);
		return () => ro.disconnect();
	});

	function handlePanelPointerDown(e: PointerEvent) {
		if (panelPointers.size === 0) {
			window.addEventListener('pointerup', handlePanelPointerEnd);
			window.addEventListener('pointercancel', handlePanelPointerEnd);
		}
		panelPointers.add(e.pointerId);
	}

	function handlePanelPointerEnd(e: PointerEvent) {
		if (!panelPointers.delete(e.pointerId) || panelPointers.size > 0) return;
		window.removeEventListener('pointerup', handlePanelPointerEnd);
		window.removeEventListener('pointercancel', handlePanelPointerEnd);
		if (pendingFollow) {
			pendingFollow = false;
			tick().then(followSelected);
		}
	}

	// Effect teardown, not onDestroy: onDestroy also runs during SSR, where
	// `window` is undefined — it threw and 500'd the whole page render.
	// Effects are client-only, so this detach is inherently server-safe.
	$effect(() => () => {
		window.removeEventListener('pointerup', handlePanelPointerEnd);
		window.removeEventListener('pointercancel', handlePanelPointerEnd);
	});
</script>

<!-- Tracks panel — one self-contained strip per visible track. Strips share
     the width evenly until they hit their min-width, then the row overflows
     into horizontal scroll (native pan-x on touch, strip-level mouse
     drag-scroll on desktop). Open groups add a bracket band above their
     members (ADR-413), which shortens those strips by one band. -->
<div
	class="tracks-panel"
	class:is-flipped={flipLayout}
	data-debug="tracks-panel"
	bind:this={panelEl}
	onpointerdown={handlePanelPointerDown}
>
	{#if visibleTracks.length === 0}
		<div class="flex items-center justify-center text-muted-foreground w-full h-full">
			<p>No tracks in session</p>
		</div>
	{:else}
		<div class="tracks-row" data-debug="tracks-row" style={rowStyle}>
			{#each bands as band (band.groupIndex)}
				<!-- Placed over the MEMBER columns only; a negative left margin
				     then pulls it back across the column gap, under the group's
				     Solo button when it has one, and 2px into the group's name
				     block, so it covers the name's right edge for the arm's
				     height — at rest and at selection's 2px width — and the two
				     outlines join without a seam.

				     The arm is the group's collapse affordance as well as its
				     indicator: it only exists while the group is open, so its
				     one action is fold. Unfolding stays on the strip's chevron,
				     which is the only control a folded group still shows. -->
				<button
					type="button"
					class="group-band"
					class:is-selected={band.selected}
					class:is-muted={band.muted}
					data-debug="group-band"
					data-group-index={band.groupIndex}
					style="grid-column: {band.start + 2} / span {band.span - 1}; grid-row: {bandRow(
						band.band
					)}; --band-ink: {band.ink}; --arm-reach: {armReach[band.groupIndex] ?? 0}px;"
					aria-label="Fold group {band.name}"
					use:press={{
						onPress: () => foldGroup(band.groupIndex),
						touchAction: 'pan-x'
					}}
				></button>
			{/each}
			{#each visibleTracks as trackIndex, col (trackIndex)}
				<!-- A group's strip squares only its top-right corner, where
				     its arm grows out. Member strips keep their full rounded
				     outline — they hang below the arm, they don't fuse to it.
				     `--arm-clearance` lifts the group's Solo button off the
				     arm, level with the members' own ends. -->
				<div
					class="track-col"
					class:is-first={col === 0}
					class:is-last={col === visibleTracks.length - 1}
					data-track-index={trackIndex}
					style="grid-column: {col + 1}; grid-row: {stripRow(
						layout.offsets[col]
					)};{bandHeadCols.has(col)
						? flipLayout
							? ' --strip-radius: var(--radius-md) var(--radius-md) 0 var(--radius-md); --arm-clearance: calc(var(--group-band-h) + var(--group-band-gap));'
							: ' --strip-radius: var(--radius-md) 0 var(--radius-md) var(--radius-md); --arm-clearance: calc(var(--group-band-h) + var(--group-band-gap));'
						: ''}"
				>
					<TrackStrip {trackIndex} onTrackSelect={handleTrackSelect} {rowScrolls} />
				</div>
			{/each}
		</div>

		<!-- Session clip grid (ADR-415) — a second grid row in THIS scroller,
		     one section of the stack tall, columns identical to the strips'.
		     Same scroller ⇒ one scrollLeft ⇒ a clip column cannot drift out
		     from under its track. -->
		{#if sessionMode}
			<div
				class="slots-section"
				data-debug="slots-section"
				bind:this={slotSectionEl}
				style={rowPitchPx > 0 ? `--session-row-h: ${rowPitchPx}px;` : ''}
			>
				<div class="slots-row" data-debug="slots-row" style={slotRowStyle}>
					{#each visibleTracks as trackIndex, col (trackIndex)}
						<div class="slot-col" style="grid-column: {col + 1};">
							<SlotGrid
								trackPath={`tracks/${trackIndex}`}
								trackColor={trackInk(
									rgbToHex(v3Store.tracks.get(`tracks/${trackIndex}`)?.color ?? 0x808080),
									paintModeReactive()
								)}
								{trackIndex}
								isGroup={clipStateStore.isGroupTrack(trackIndex)}
								onSelect={(slotIndex) => selectSlot(trackIndex, slotIndex, slotActionOptions)}
								onAction={(slotIndex, slotPath, slotState) =>
									actOnSlot(trackIndex, slotIndex, slotPath, slotState, slotActionOptions)}
								onFocus={(slotPath) => focusSlot(trackIndex, slotPath, slotActionOptions)}
							/>
						</div>
					{/each}
				</div>

				<!-- Stop row — one button per track, always, on the same
				     columns and at the same pitch as the grid above it:
				     it is one more row of the grid, not a strip of
				     chrome, so it aims exactly like a clip slot. Every
				     track gets one whether or not it holds clips: "stop
				     this track" is a fixed place your hand goes to, and a
				     button that comes and goes with the set's contents is
				     one you cannot aim for without looking. The scene rail
				     carries the matching STOP ALL in its own extra row, so
				     both columns divide by the same (rows + 1) and their
				     scene rows stay level. -->
				<div class="stops-row" data-debug="stops-row" style={slotRowStyle}>
					{#each visibleTracks as trackIndex, col (trackIndex)}
						<button
							type="button"
							class="stop-button"
							class:is-track-selected={session.selectedTrackIndex === trackIndex}
							data-debug="stop-button"
							data-track-stop={trackIndex}
							style="grid-column: {col + 1}; --stop-ink: {trackInk(
								rgbToHex(v3Store.tracks.get(`tracks/${trackIndex}`)?.color ?? 0x808080),
								paintModeReactive()
							)};"
							aria-label="Stop clips on {v3Store.tracks.get(`tracks/${trackIndex}`)?.name ??
								`track ${trackIndex + 1}`}"
							use:press={{
								onPress: () => stopTrack(trackIndex),
								touchAction: 'pan-x'
							}}
						>
							<span class="stop-glyph" aria-hidden="true">■</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* ONE scroller for both rows (ADR-415). The strips and the session clip
	   grid are separate grids, but they share this box — so there is a
	   single `scrollLeft` and a clip column physically cannot drift out
	   from under the strip it belongs to. Panning either row pans both.

	   In session mode the panel is therefore worth two sections of the
	   main-area stack: its two rows plus the gap between them are exactly
	   the strips' section + the grid's section, which is what keeps every
	   section the same height in both modes. */
	.tracks-panel {
		width: 100%;
		height: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
		/* Keep a followed strip clear of the hard panel edge. */
		scroll-padding-inline: var(--spacing-lg);
		/* Below this width strips stop compressing and the row scrolls
		   instead. Declared ONCE here rather than per row: the strips, the
		   clip grid and the stop row must resolve the SAME floor or their
		   columns stop lining up, and three literals is three chances to
		   drift. Inheritance makes that structural.

		   64px leaves the 10px edge-tick clearance per side (padding drops
		   to 12px under 100px, see TrackStrip) plus a ~40px name/clip/
		   permute column — tighter than the old 80px, so 13 tracks fit the
		   busiest layout where 11 did. */
		--track-min-w: 64px;
	}

	/* Flipped stack (ADR-421): the strips row goes to the FOOT of the
	   panel and the clip grid above it, so the strips sit against the
	   bottom of the screen. Order only — the two rows keep their flex
	   shares and the one gap between them, so the panel is still worth
	   exactly two sections in session mode and one outside it.

	   The grid's own contents deliberately do NOT mirror: scene rows
	   still read downward (scene order is music, not chrome), and the
	   stop row stays at the foot of `.slots-section` — which under the
	   flip lands it directly above the strip it stops, and keeps it
	   level with the scene rail's own footer row exactly as before. */
	.tracks-panel.is-flipped {
		flex-direction: column-reverse;
	}

	/* Both rows take an equal share of the panel, so with the grid showing
	   each is one section of the stack and with it hidden the strips row
	   is the whole panel — one section either way.

	   The section is the grid PLUS its stop row, and the flex share lives
	   here: this box is what gets measured, and the pitch is it divided
	   by (renderedRows + 1) — the scene rows plus the stop row. No gap
	   between the two rows, because every row already carries its own
	   `--session-row-gap` inset as a bottom margin. */
	.slots-section {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.slots-row {
		display: grid;
		flex: 1 1 0;
		min-height: 0;
		column-gap: var(--spacing-lg);
	}

	/* One row of the grid, taken at the section's own pitch. The rail's
	   STOP ALL takes exactly the same share of its section, so both
	   columns still divide by the same number and no row edge splits. */
	.stops-row {
		display: grid;
		flex: 0 0 var(--session-row-h);
		column-gap: var(--spacing-lg);
	}

	/* Stop wears the track's ink at low saturation rather than the
	   transport red: this is where a clip goes quiet, not a danger
	   control, and a column of red squares under a grid of playing
	   clips reads as an alarm. */
	.stop-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 0;
		/* Sized exactly like a SlotCell: a full row minus the inset the
		   cells keep between themselves. */
		height: calc(var(--session-row-h) - var(--session-row-gap));
		padding: 0;
		border: 1px solid color-mix(in oklab, var(--stop-ink) 40%, transparent);
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--stop-ink) 10%, var(--card));
		color: color-mix(in oklab, var(--stop-ink) 70%, var(--foreground));
		/* The cells' type, not the browser's button default — a stop
		   cell sits in the same column as the clip labels above it. */
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		line-height: 1;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		/* `touch-action: pan-x` — "chrome under a pannable row: never eat a
		   horizontal drag" — is declared by the `use:press` on this button,
		   not here. One author for the CSS policy and the handler it
		   protects; see ADR-427. */
		transition:
			background-color 90ms var(--ease-precise),
			border-color 90ms var(--ease-precise);
	}

	.stop-button:active {
		background: color-mix(in oklab, var(--stop-ink) 26%, var(--card));
		border-color: color-mix(in oklab, var(--stop-ink) 70%, transparent);
	}

	/* Carries the selected track's column rules down through the stop
	   row, so the column runs unbroken from the strip to the bottom of
	   the section instead of stopping a row short. Same side-rule
	   treatment `SlotGrid`'s zone uses, in the same track ink. */
	.stop-button.is-track-selected {
		box-shadow:
			inset 2px 0 0 0 color-mix(in oklab, var(--stop-ink) 75%, transparent),
			inset -2px 0 0 0 color-mix(in oklab, var(--stop-ink) 75%, transparent);
	}

	/* Live skin: the group arm is the group's title block continuing
	   sideways — a solid fill of the group's ink, exactly like the
	   header it grows out of (Live's unfolded group header extends its
	   colour over the member tracks). No meter well under this skin, so
	   the ::before twin goes too. */
	:global([data-grammar="flat"]) .group-band {
		background: var(--band-ink);
		border-color: var(--line-strong);
		border-radius: 0 2px 2px 0;
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .group-band::before {
		display: none;
	}
	:global([data-grammar="flat"]) .group-band.is-selected {
		border-width: 1px;
		border-left: none;
		border-color: var(--flat-selection);
		background: var(--band-ink);
		box-shadow: none;
	}
	/* Muted group: the arm dims with the header it extends —
	   DeactivatedClipHeader, same as TrackHeader's is-muted fill. After
	   .is-selected so mute wins the fill (selection keeps its border),
	   exactly as the header greys regardless of selection. */
	:global([data-grammar="flat"]) .group-band.is-muted {
		background: var(--flat-deactivated);
	}
	:global([data-grammar="flat"]) .group-band::after {
		border-color: var(--flat-selection);
	}

	/* Live skin: the per-track stop cell is Live's ClipSlotButton — a dark
	   control field with a small square, never a track-ink wash. */
	:global([data-grammar="flat"]) .stop-button {
		background: var(--card);
		border: 1px solid var(--flat-clip-border);
		border-radius: 2px;
		color: var(--flat-slot-empty); /* the ■ is Live's ClipSlotButton square */
	}
	:global([data-grammar="flat"]) .stop-button:active {
		background: var(--secondary);
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .stop-button.is-track-selected {
		box-shadow:
			inset 2px 0 0 0 var(--flat-selection),
			inset -2px 0 0 0 var(--flat-selection);
	}

	/* Same scale as a cell's action-strip glyph, so the column reads as one
	   family of marks top to bottom. */
	.stop-glyph {
		font-size: 0.75rem;
		line-height: 1;
	}

	.slot-col {
		min-width: 0;
		min-height: 0;
	}

	.tracks-row {
		flex: 1 1 0;
		min-height: 0;
		/* Grid, not flex, so a group bracket can span N columns and the
		   gaps between them by line number (ADR-413). Columns behave
		   exactly as the old `flex: 1 1 0` + `min-width` did. */
		display: grid;
		--strip-gutter: var(--spacing-lg);
		column-gap: var(--strip-gutter);
		/* The clear space between an arm and the member strips hanging
		   below it. A strip spanning several rows covers these gaps, so
		   the group's own full-height strip stays continuous through
		   them. */
		row-gap: var(--group-band-gap);
		--group-band-gap: var(--spacing-sm);
		/* Height of one group arm. Member strips lose this plus the
		   row-gap per enclosing group; the group's own strip loses
		   nothing, since its arm grows sideways out of its top edge. */
		--group-band-h: 14px;
	}

	.track-col {
		min-width: 0;
		min-height: 0;
		/* The gutter is dead space to the grid, but not to a finger aimed
		   at a strip's edge — which is where its volume ticks are drawn.
		   Each strip's fader takes half of the gutter on each side
		   (`.fader::before` in TrackStrip), so every point between two
		   Cards belongs to the nearer one. */
		--fader-slop-left: calc(var(--strip-gutter) / 2);
		--fader-slop-right: calc(var(--strip-gutter) / 2);
	}

	/* Not past the row's own ends, where there is no gutter to share. It
	   matters at the right-hand end: a slop hanging past the LAST column
	   is scrollable overflow of this panel, so the row would scroll by
	   half a gutter and `rowScrolls` would read true — putting every name
	   band back on the release-wait mute. Classes set from the column
	   index rather than `:first-/:last-of-type`: the bracket arms share
	   this row, and a DOM-order selector would break the day one more
	   kind of child joins them. */
	.track-col.is-first {
		--fader-slop-left: 0px;
	}

	.track-col.is-last {
		--fader-slop-right: 0px;
	}

	/* Group bracket ("panhandle", ADR-413): the arm that grows out of the
	   top-right of a group's strip and reaches over its members.

	   Wash and border are `.glass-card`'s own values, in the group's ink,
	   because the arm is not a separate bar — it is that strip's outline
	   continuing sideways. Left edge is open and the negative margin pulls
	   it a pixel into the strip, so the strip's right border is covered
	   for the arm's height and the two read as one continuous shape.

	   Members hang below with `row-gap` between, keeping their own full
	   outlines — the arm is above them, not attached to them. */
	.group-band {
		position: relative;
		/* Paints ABOVE the strips. Without this the arm loses the paint
		   order to the cards (they come later in the DOM) and the group
		   strip's own right border draws straight across the join — the
		   arm then reads as a separate rectangle butted against the strip
		   instead of continuing its outline. The overlap below only erases
		   that border if the arm is on top. */
		z-index: 1;
		/* Opts out of the 44px touch-target floor app.css puts on every
		   button under `max-width: 1024px` — i.e. on the iPad itself. The
		   arm is a 14px band by design; left at 44px it overflows its grid
		   row and swallows the strips below, which does not show up at
		   desktop widths where that media query is inactive. Folding has a
		   full-section chevron on the group strip; this is the secondary
		   path, and it is wide even when thin. */
		min-height: 0;
		min-width: 0;
		/* 2px into the group's name block: enough to cover its right edge at
		   the join in BOTH states — 1px at rest, 2px while the selection ring
		   widens it. The extra pixel at rest lands on the name's own fill,
		   which the arm's background matches, so it can't show.
		   `--arm-reach` carries it back under a Solo button to where the name
		   actually ends (measured in the script; 0 with Solo off). */
		margin-left: calc(-1 * var(--spacing-lg) - var(--arm-reach, 0px) - 2px);
		border: 1px solid color-mix(in oklab, var(--band-ink) 55%, transparent);
		border-left: none;
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		background: color-mix(in oklab, var(--band-ink) 12%, var(--card));
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.04);
		cursor: pointer;
		/* The selected glow below is a blurred box-shadow, which paints on
		   all four sides — its left side would smear over the strip's
		   interior at the overlap. Clip the arm's painting at its own left
		   edge and leave the other three sides open for the glow and the
		   ::after ring.

		   Inside the 2px overlap only the FILL is kept: its top and bottom
		   2px are cut too. Otherwise the arm's border and ring lines ran
		   2px on into the name block's fill, a visible nub at the corner of
		   the join. The fill between them is what covers the name's edge,
		   and the name's own fill shows through the two cut corners. */
		clip-path: polygon(
			2px -16px,
			calc(100% + 16px) -16px,
			calc(100% + 16px) calc(100% + 16px),
			2px calc(100% + 16px),
			2px calc(100% - 2px),
			0 calc(100% - 2px),
			0 2px,
			2px 2px
		);
		/* `touch-action: pan-x` — "the arm is chrome: never let it eat a
		   horizontal pan of the row" — is declared by this button's
		   `use:press`, not here (ADR-427). */
		/* Same clock as `.track-selected` so arm and strip flip together. */
		transition:
			background-color 75ms var(--ease-precise),
			border-color 75ms var(--ease-precise),
			box-shadow 75ms var(--ease-precise);
	}

	/* Selected group (§5.2): the arm is part of the strip's outline, so it
	   wears the same highlight — 2px full-ink border, 18% wash (under the
	   same meter-well flatten), soft glow. The strip's crisp 1px ring is a
	   spread box-shadow, which an element can only draw on ALL four sides;
	   on the arm that would paint a vertical seam inside the strip at the
	   overlap. So the arm's ring is the ::after below instead — a border on
	   three sides, left edge open, exactly where a spread ring would sit. */
	.group-band.is-selected {
		border-width: 2px;
		border-left: none;
		border-color: var(--band-ink);
		background: color-mix(in oklab, var(--band-ink) 18%, var(--card));
		box-shadow:
			inset 0 1px 0 oklch(1 0 0 / 0.04),
			0 0 12px color-mix(in oklab, var(--band-ink) 50%, transparent);
	}

	/* The strip's visible field is NOT the bare `.glass-card` wash: the
	   full-height meter well (an opaque `--surface-well` layer at the
	   meter opacity) sits over it, darkening the whole card. The arm has
	   no meter, so without this its field splits from the strip's at the
	   join even at rest. Reproduced STRUCTURALLY — same color, same
	   element-opacity compositing the strip's `.meter-background` uses —
	   rather than flattened into one color-mix, so the two can't drift
	   apart across browsers, themes, or compositing color spaces.
	   `--meter-wash` rides in from the row style so the opacity stays
	   `constants.ui.meters.opacity`, not a copy. inset: 0 keeps it off
	   the border (it starts at the padding box, like the strip's meter,
	   which lives inside the card's border). */
	.group-band::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: var(--surface-well);
		opacity: var(--meter-wash, 0.4);
		border-radius: inherit;
	}

	/* Three-sided twin of `.track-selected`'s `0 0 0 1px` ring: 1px ink,
	   1px outside the arm's border-box (inset -3px = 2px border + 1px gap
	   from the padding box). Its open left end overlaps the strip's own
	   ring along the shared top edge, so the two rings meet seamlessly. */
	.group-band::after {
		content: '';
		position: absolute;
		inset: -3px -3px -3px 0;
		pointer-events: none;
		border: 1px solid var(--band-ink);
		border-left: none;
		border-radius: 0 calc(var(--radius-md) + 2px) calc(var(--radius-md) + 2px) 0;
		opacity: 0;
		transition: opacity 75ms var(--ease-precise);
	}

	.group-band.is-selected::after {
		opacity: 1;
	}
</style>
