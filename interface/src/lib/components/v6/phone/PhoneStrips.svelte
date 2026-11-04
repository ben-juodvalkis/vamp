<script lang="ts">
	/**
	 * The phone's Mix tab (ADR-503): the iPad's own track strips, every one
	 * full height, in one row that scrolls sideways, the master last.
	 *
	 * The strips are `TrackStrip` unchanged — the whole strip is the
	 * volume fader, a tap on the name mutes, two fingers solo — told the row
	 * scrolls (`rowScrolls`), which it always does at phone width, so a
	 * sideways start pans the row instead of moving a fader.
	 *
	 * The row shares its scroll position with the Clips tab's columns
	 * (`scrollLeft`, held by the layout), so switching tabs keeps the same
	 * tracks in front of you.
	 */
	import { tick, untrack } from 'svelte';
	import constants from '$config/constants.json';
	import TrackStrip from '$lib/components/v6/tracks/TrackStrip.svelte';
	import MasterTrack from '$lib/components/v6/tracks/MasterTrack.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { ribbonWindow } from '$lib/utils/phoneLayout';
	import { PHONE_COLUMN_PITCH, PHONE_ROW_INSET } from './phoneGeometry';

	interface Props {
		tracks: number[];
		/** True while this tab is the one on screen. */
		active: boolean;
		scrollLeft: number;
		onScroll: (scrollLeft: number) => void;
		onWindow: (window: { start: number; end: number }) => void;
	}

	let { tracks, active, scrollLeft, onScroll, onWindow }: Props = $props();

	let row = $state<HTMLDivElement | null>(null);

	function report() {
		if (!row) return;
		onWindow(
			ribbonWindow({
				scrollLeft: row.scrollLeft,
				clientWidth: row.clientWidth,
				pitch: PHONE_COLUMN_PITCH,
				count: tracks.length,
				inset: PHONE_ROW_INSET
			})
		);
	}

	function handleScroll() {
		if (!row) return;
		onScroll(row.scrollLeft);
		report();
	}

	// Coming on screen: take up where the other tab left the row. Hidden,
	// the row has no scroll position to keep (`display: none`).
	$effect(() => {
		if (!active || !row) return;
		const el = row;
		tick().then(() => {
			el.scrollLeft = untrack(() => scrollLeft);
			report();
		});
	});

	// The ribbon's frame follows the row's size and its column count too:
	// the tracks arrive after the first paint, and a rotation re-divides.
	$effect(() => {
		void tracks.length;
		const el = row;
		if (!active || !el || typeof ResizeObserver === 'undefined') return;
		tick().then(report);
		const ro = new ResizeObserver(() => report());
		ro.observe(el);
		return () => ro.disconnect();
	});

	// The selected strip stays on screen: a ribbon tap, a selection from
	// Live, or a fold reshuffling the columns. `nearest` is a no-op for a
	// strip already showing.
	$effect(() => {
		const idx = session.selectedTrackIndex;
		void tracks.join(',');
		if (!active || !row || idx < 0) return;
		const el = row;
		tick().then(() =>
			el
				.querySelector(`[data-track-index="${idx}"]`)
				?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
		);
	});
</script>

<div
	class="phone-strips"
	data-debug="phone-strips"
	bind:this={row}
	onscroll={handleScroll}
	style="--meter-wash: {constants.ui.meters.opacity};"
>
	{#each tracks as trackIndex, col (trackIndex)}
		<div class="strip-col" class:is-first={col === 0} data-track-index={trackIndex}>
			<TrackStrip {trackIndex} rowScrolls={true} />
		</div>
	{/each}
	<div class="strip-col is-last" data-debug="phone-master">
		<MasterTrack />
	</div>
</div>

<style>
	.phone-strips {
		height: 100%;
		display: flex;
		gap: var(--phone-gap);
		padding-inline: var(--phone-inset);
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		scroll-padding-inline: var(--phone-inset);
		--track-min-w: var(--phone-col-w);
	}
	.phone-strips::-webkit-scrollbar {
		display: none;
	}

	/* One strip. Its fader takes half of each gap beside it, as on the
	   iPad, so a finger between two strips belongs to the nearer one. */
	.strip-col {
		flex: none;
		width: var(--phone-col-w);
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		isolation: isolate;
		--fader-slop-left: calc(var(--phone-gap) / 2);
		--fader-slop-right: calc(var(--phone-gap) / 2);
	}
	.strip-col.is-first {
		--fader-slop-left: 0px;
	}
	.strip-col.is-last {
		--fader-slop-right: 0px;
	}
</style>
