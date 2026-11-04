<script lang="ts">
	/**
	 * The phone's Clips tab (ADR-503): the iPad's session grid at full
	 * height — one `SlotGrid` column per track under a name tab, the stop
	 * row at the foot, the scene rail pinned at the right edge as the
	 * iPad's right sidebar has it.
	 *
	 * The cells are the iPad's: a tap on the action strip records, plays or
	 * stops; a tap on the body aims the pedal; a long press shows the clip. A
	 * vertical drag scrolls the scenes, every column and the rail together
	 * (`sceneWindowStore`), which this tab holds at four rows.
	 *
	 * The row pitch is measured, as on the iPad: the body under the name
	 * tabs divided by the rows drawn plus the stop row. The rail measures
	 * the same box the same way, so the two land on the same pitch.
	 */
	import { tick, untrack } from 'svelte';
	import SlotGrid from '$lib/components/v6/tracks/TrackStrip/components/SlotGrid.svelte';
	import SceneRail from '$lib/components/v6/tracks/SceneRail.svelte';
	import {
		selectSlot,
		actOnSlot,
		focusSlot,
		stopTrack
	} from '$lib/components/v6/tracks/composables/slotActions';
	import { selectTrackByIndex } from '$lib/components/v6/tracks/composables/useTrackData.svelte';
	import { sceneWindowStore } from '$lib/stores/v6/sceneWindowStore.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { clipStateStore } from '$lib/stores/v6/clipStateStore.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { padTextCss } from '$lib/services/drumVirtualMacros';
	import { press } from '$lib/actions/press';
	import { ribbonWindow } from '$lib/utils/phoneLayout';
	import {
		PHONE_COLUMN_PITCH,
		PHONE_ROW_INSET,
		PHONE_RAIL_WIDTH,
		PHONE_COLUMN_GAP,
		PHONE_SCENE_ROWS
	} from './phoneGeometry';

	interface Props {
		tracks: number[];
		active: boolean;
		scrollLeft: number;
		onScroll: (scrollLeft: number) => void;
		onWindow: (window: { start: number; end: number }) => void;
		/** A long press showed a clip: the Track tab is where it is drawn. */
		onShowClip?: () => void;
	}

	let { tracks, active, scrollLeft, onScroll, onWindow, onShowClip }: Props = $props();

	$effect(() => {
		sceneWindowStore.setVisibleCountOverride(PHONE_SCENE_ROWS);
		return () => sceneWindowStore.setVisibleCountOverride(null);
	});

	const columns = $derived(
		tracks.map((trackIndex) => {
			const record = v3Store.tracks.get(`tracks/${trackIndex}`);
			const color = record?.color ?? 0x808080;
			return {
				trackIndex,
				name: record?.name ?? `Track ${trackIndex + 1}`,
				fill: rgbToHex(color),
				text: padTextCss(color),
				ink: trackInk(rgbToHex(color), paintModeReactive()),
				muted: record?.mute ?? false,
				isGroup: clipStateStore.isGroupTrack(trackIndex)
			};
		})
	);

	let scroller = $state<HTMLDivElement | null>(null);
	let body = $state<HTMLDivElement | null>(null);
	let bodyHeightPx = $state(0);
	const rowPitchPx = $derived(
		sceneWindowStore.renderedRows > 0 ? bodyHeightPx / (sceneWindowStore.renderedRows + 1) : 0
	);

	$effect(() => {
		const el = body;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			const h = el.getBoundingClientRect().height;
			if (h > 0) bodyHeightPx = h;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	function report() {
		if (!scroller) return;
		onWindow(
			ribbonWindow({
				scrollLeft: scroller.scrollLeft,
				clientWidth: scroller.clientWidth,
				pitch: PHONE_COLUMN_PITCH,
				count: tracks.length,
				inset: PHONE_ROW_INSET,
				pinned: PHONE_RAIL_WIDTH + PHONE_COLUMN_GAP + PHONE_ROW_INSET
			})
		);
	}

	function handleScroll() {
		if (!scroller) return;
		onScroll(scroller.scrollLeft);
		report();
	}

	$effect(() => {
		if (!active || !scroller) return;
		const el = scroller;
		tick().then(() => {
			el.scrollLeft = untrack(() => scrollLeft);
			report();
		});
	});

	// The ribbon's frame follows the scroller's size and the column count.
	$effect(() => {
		void tracks.length;
		const el = scroller;
		if (!active || !el || typeof ResizeObserver === 'undefined') return;
		tick().then(report);
		const ro = new ResizeObserver(() => report());
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		const idx = session.selectedTrackIndex;
		void tracks.join(',');
		if (!active || !scroller || idx < 0) return;
		const el = scroller;
		tick().then(() =>
			el
				.querySelector(`[data-track-index="${idx}"]`)
				?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
		);
	});

	function showClip(trackIndex: number, slotPath: string) {
		focusSlot(trackIndex, slotPath);
		onShowClip?.();
	}
</script>

<div
	class="phone-clips"
	data-debug="phone-clips"
	bind:this={scroller}
	onscroll={handleScroll}
	style={rowPitchPx > 0 ? `--session-row-h: ${rowPitchPx}px;` : ''}
>
	{#each columns as c (c.trackIndex)}
		<div class="clip-col" data-track-index={c.trackIndex}>
			<button
				type="button"
				class="col-name"
				class:is-muted={c.muted}
				class:is-selected={session.selectedTrackIndex === c.trackIndex}
				style="--name-fill: {c.fill}; --name-text: {c.text};"
				aria-label="Select {c.trackIndex + 1} {c.name}"
				use:press={{ onPress: () => selectTrackByIndex(c.trackIndex), touchAction: 'pan-x' }}
			>{c.trackIndex + 1} {c.name}</button>
			<div class="col-body">
				<div class="col-slots">
					<SlotGrid
						trackPath={`tracks/${c.trackIndex}`}
						trackColor={c.ink}
						trackIndex={c.trackIndex}
						isGroup={c.isGroup}
						onSelect={(slotIndex) => selectSlot(c.trackIndex, slotIndex)}
						onAction={(slotIndex, slotPath, slotState) =>
							actOnSlot(c.trackIndex, slotIndex, slotPath, slotState)}
						onFocus={(slotPath) => showClip(c.trackIndex, slotPath)}
					/>
				</div>
				<div class="col-stop">
					<button
						type="button"
						class="stop-button"
						class:is-track-selected={session.selectedTrackIndex === c.trackIndex}
						data-track-stop={c.trackIndex}
						style="--stop-ink: {c.ink};"
						aria-label="Stop clips on {c.name}"
						use:press={{ onPress: () => stopTrack(c.trackIndex), touchAction: 'pan-x' }}
					>
						<span class="stop-glyph" aria-hidden="true">■</span>
					</button>
				</div>
			</div>
		</div>
	{/each}
	<div class="rail-col" data-debug="phone-scene-rail">
		<div class="col-name is-blank" aria-hidden="true"></div>
		<div class="col-body" bind:this={body}>
			<SceneRail />
		</div>
	</div>
</div>

<style>
	.phone-clips {
		height: 100%;
		display: flex;
		gap: var(--phone-gap);
		padding-left: var(--phone-inset);
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		/* A followed column stops clear of the rail pinned over the right. */
		scroll-padding-inline: var(--phone-inset)
			calc(var(--phone-rail-w) + var(--phone-gap) + var(--phone-inset));
	}
	.phone-clips::-webkit-scrollbar {
		display: none;
	}

	.clip-col,
	.rail-col {
		flex: none;
		width: var(--phone-col-w);
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	/* The scene rail, pinned over the right edge once the columns scroll,
	   with the gap to its left painted so columns pass under it cleanly. */
	.rail-col {
		position: sticky;
		right: 0;
		z-index: 2;
		width: calc(var(--phone-rail-w) + var(--phone-gap) + var(--phone-inset));
		margin-left: calc(-1 * var(--phone-gap));
		padding-left: var(--phone-gap);
		padding-right: var(--phone-inset);
		background: var(--background);
	}

	/* The column's name, in the track's own colour: there are no strips
	   on this tab to say whose column it is. A tap selects the track. */
	.col-name {
		flex: none;
		height: 24px;
		min-height: 0;
		min-width: 0;
		padding: 0 4px;
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--name-fill);
		color: var(--name-text);
		font-size: 0.6875rem;
		font-weight: var(--font-weight-semibold, 600);
		line-height: 24px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		-webkit-tap-highlight-color: transparent;
		cursor: pointer;
	}
	.col-name.is-muted {
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.col-name.is-selected {
		box-shadow: inset 0 0 0 2px var(--foreground);
	}
	.col-name.is-blank {
		background: transparent;
	}

	.col-body {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.col-slots {
		flex: 1 1 0;
		min-height: 0;
	}
	.col-stop {
		flex: 0 0 var(--session-row-h, 0px);
		min-height: 0;
	}

	/* The iPad's stop cell (TracksPanelV6), at this tab's pitch. */
	.stop-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-width: 0;
		min-height: 0;
		height: calc(var(--session-row-h, 0px) - var(--session-row-gap));
		padding: 0;
		border: 1px solid color-mix(in oklab, var(--stop-ink) 40%, transparent);
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--stop-ink) 10%, var(--card));
		color: color-mix(in oklab, var(--stop-ink) 70%, var(--foreground));
		font-size: 0.9375rem;
		line-height: 1;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.stop-button:active {
		background: color-mix(in oklab, var(--stop-ink) 26%, var(--card));
	}
	.stop-button.is-track-selected {
		box-shadow:
			inset 2px 0 0 0 color-mix(in oklab, var(--stop-ink) 75%, transparent),
			inset -2px 0 0 0 color-mix(in oklab, var(--stop-ink) 75%, transparent);
	}
	.stop-glyph {
		font-size: 0.75rem;
		line-height: 1;
	}
</style>
