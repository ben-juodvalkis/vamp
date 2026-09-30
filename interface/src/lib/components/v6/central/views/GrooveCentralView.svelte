<script lang="ts">
	/**
	 * The Groove view (2026-09-29): which groove the focused clip swings to,
	 * and how much. Opened by touching Q in the right sidebar
	 * (`VerticalQuantizeControl`), whose well wears the selection edge while
	 * this is up.
	 *
	 * Tiles: the grooves ticked in Settings → Grooves, in tick order, laid out
	 * by the browser's own grid solver (`computeGridLayout`): a few grooves
	 * grow to fill the view, many hold at a finger's target (the approved
	 * design's size) and scroll. Each shows its name, grid and timing picture,
	 * the picture taller as the tile is. The clip's current groove
	 * is lit in phosphor. A tap puts the clip on that groove file
	 * (`/looping/v3/clip/groove/set/file`; the surface keeps the clip's
	 * Quantize and amounts), with the same focus fallback Q uses: the clip
	 * running on the selected track.
	 *
	 * Sliders on the right edge, Amount outermost (the user's call): Random,
	 * Velocity and Amount — `random_amount`, `velocity_amount`,
	 * `timing_amount` on the clip's groove. A clip with no groove takes the
	 * first tile on its first move, as Q does (`services/grooveChooser`). The lit tile's picture moves from
	 * straight (Amount 0) to the file's pattern (Amount 100); the others show
	 * the whole pattern. A file Live stores in its binary format has no
	 * picture.
	 */
	import { onMount } from 'svelte';
	import { send } from '$lib/api/simpleClient';
	import {
		V3_CLIP_GROOVE_SET_FILE_ADDRESS,
		V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS,
		V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS,
		V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS
	} from '$lib/api/handlers/v3ClipGroove';
	import { clipGrooveStore } from '$lib/stores/v6/clipGrooveStore.svelte';
	import { groovesStore } from '$lib/stores/v6/groovesStore.svelte';
	import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
	import { loadFirstGrooveIfNone } from '$lib/services/grooveChooser';
	import { session } from '$lib/stores/session.svelte';
	import { focusPlayingClipOnSelectedTrack } from '$lib/components/v6/tracks/composables/slotActions';
	import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import GroovePicture from '$lib/components/v6/clips/GroovePicture.svelte';
	import { computeGridLayout } from '$lib/components/v6/browser/utils/drillDownModel';
	import SectionDivider from '../SectionDivider.svelte';

	onMount(() => {
		void groovesStore.refresh();
	});

	const tiles = $derived(groovesStore.tickedFiles);

	// The browser's tile solver: tiles fill the host, and only once filling
	// would shrink them below the floors do they hold there and scroll. The
	// floors are the approved design's tile (four across, three down on the
	// iPad), so twelve or more look exactly as they did.
	const TILE_GAP = 12;
	const TILE_COMFORT = { gap: TILE_GAP, minTile: 140, minTileHeight: 84, targetAspect: 1.5 };
	let hostEl = $state<HTMLDivElement | undefined>(undefined);
	let hostW = $state(0);
	let hostH = $state(0);
	$effect(() => {
		if (!hostEl) return;
		const measure = () => {
			hostW = hostEl!.clientWidth;
			hostH = hostEl!.clientHeight;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(hostEl);
		return () => ro.disconnect();
	});
	const layout = $derived(
		tiles.length && hostW > 0 && hostH > 0
			? computeGridLayout({ width: hostW, height: hostH, count: tiles.length, ...TILE_COMFORT })
			: null
	);
	const lit = $derived(clipGrooveStore.hasGroove ? clipGrooveStore.file : '');
	// The clip view's own fallback, for a cold start with no track record yet.
	const FALLBACK_SCHEME = { primary: 'var(--act-quant)', secondary: 'var(--act-quant-wash)', accent: 'var(--act-quant)' } as const;
	const scheme = $derived(selectedTrackScheme() ?? FALLBACK_SCHEME);
	const hasClip = $derived(!!session.focusedClipPath);

	/** The clip a tap or a slider writes to: the focused one, else the one running on the selected track. */
	function targetClip(): string | null {
		return focusPlayingClipOnSelectedTrack({ showClip: false });
	}

	function choose(name: string) {
		const path = targetClip();
		if (!path) return;
		if (path === session.focusedClipPath) clipGrooveStore.chooseFile(name);
		send(V3_CLIP_GROOVE_SET_FILE_ADDRESS, [path, name]);
	}

	function write(address: string, value: number) {
		const path = targetClip();
		if (!path) return;
		// A clip with no groove (or on Live's auto-load Vamp Groove, which
		// reads as none) takes the first tile before the write, as Q does.
		loadFirstGrooveIfNone(path);
		send(address, [path, Math.max(0, Math.min(100, value))]);
	}
</script>

<div class="groove-view p-(--central-inset)" style:--groove-ink={scheme.primary} data-debug="groove-view">
	<div class="tiles-host" bind:this={hostEl}>
		{#if groovesStore.failed && !groovesStore.listing}
			<p class="groove-note">No grooves from the Mac ({groovesStore.failed}).</p>
		{:else if groovesStore.listing && tiles.length === 0}
			<div class="groove-note">
				<p>No grooves are ticked for this view.</p>
				<button class="btn btn-switch clip-switch" onclick={() => settingsStore.openSettings('grooves')}>
					Choose grooves in Settings
				</button>
			</div>
		{:else}
			<div
				class="tiles"
				class:dim={!hasClip}
				class:solved={!!layout}
				style:--tile-gap="{TILE_GAP}px"
				style:--cols={layout?.columns}
				style:--tile-h={layout ? `${layout.tileHeight}px` : undefined}
				data-debug="groove-tiles"
			>
				{#each tiles as g (g.name)}
					{@const on = g.name === lit}
					<button
						class="tile"
						class:on
						aria-pressed={on}
						onclick={() => choose(g.name)}
						data-groove={g.name}
					>
						<span class="tile-top">
							<span class="tile-name">{g.name}</span>
							{#if g.grid}<span class="tile-grid">{g.grid}</span>{/if}
						</span>
						{#if g.events?.length}
							<GroovePicture events={g.events} amount={on ? clipGrooveStore.timingAmount : 100} />
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="seam"><SectionDivider orientation="vertical" /></div>

	<div class="slider" class:dim={!hasClip}>
		<DeviceSlider
			value={clipGrooveStore.randomAmount / 100}
			title="Random"
			color={scheme}
			onInteraction={(v) => write(V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS, v * 100)}
		/>
	</div>
	<div class="slider" class:dim={!hasClip}>
		<DeviceSlider
			value={clipGrooveStore.velocityAmount / 100}
			title="Velocity"
			color={scheme}
			onInteraction={(v) => write(V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS, v * 100)}
		/>
	</div>
	<div class="slider" class:dim={!hasClip}>
		<DeviceSlider
			value={clipGrooveStore.timingAmount / 100}
			title="Amount"
			color={scheme}
			onInteraction={(v) => write(V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS, v * 100)}
		/>
	</div>
</div>

<style>
	.groove-view {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto repeat(3, 5.5rem);
		grid-template-rows: minmax(0, 1fr);
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.seam,
	.slider {
		display: flex;
		align-items: stretch;
		min-height: 0;
		min-width: 0;
	}
	.slider {
		flex-direction: column;
	}
	.dim {
		opacity: 0.45;
		transition: opacity 0.2s;
	}

	/* Columns and row height come from the solver (`--cols` / `--tile-h`);
	   until the host has been measured, the design's four by three. */
	.tiles-host {
		container-type: size;
		min-width: 0;
		min-height: 0;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		grid-auto-rows: calc((100cqh - 2 * var(--tile-gap)) / 3);
		gap: var(--tile-gap);
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
	}
	.tiles.solved {
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		grid-auto-rows: var(--tile-h);
	}
	.tile {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 0.375rem;
		min-width: 0;
		min-height: 0;
		padding: 0.625rem 0.75rem;
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		color: var(--foreground);
		font: inherit;
		text-align: left;
		cursor: pointer;
		--groove-tick: var(--groove-ink);
		/* The picture takes what the name and padding leave: 1.5rem at the
		   design's size, taller as the solver grows the tile. */
		--groove-pic-h: clamp(1.5rem, calc(var(--tile-h, 0px) - 3.875rem), 6rem);
	}
	.tile.on {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
		--groove-tick: var(--flat-on-fg);
		--groove-line: color-mix(in srgb, var(--flat-on-fg) 20%, transparent);
	}
	.tile:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	.tile-top {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		min-width: 0;
	}
	.tile-name {
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.15;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tile-grid {
		margin-left: auto;
		flex: none;
		font-size: 0.75rem;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		color: var(--muted-foreground);
	}
	.tile.on .tile-grid {
		color: color-mix(in srgb, var(--flat-on-fg) 75%, transparent);
	}

	.groove-note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--central-gap);
		color: var(--muted-foreground);
		font-size: 0.9375rem;
	}
	.groove-note .btn {
		min-height: var(--height-touch);
		padding: 0 1rem;
	}
</style>
