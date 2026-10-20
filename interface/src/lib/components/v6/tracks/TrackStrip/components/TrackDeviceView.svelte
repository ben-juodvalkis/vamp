<script lang="ts">
	/**
	 * TrackDeviceView — the strip's device band.
	 *
	 * One wordless picture of what makes this track's sound, chosen by
	 * `glance.mode` (see `composables/useTrackDevice.svelte.ts`):
	 *
	 *   glyph  one mark for what kind of thing is on the track: for an
	 *          instrument, the category its preset came from (a keyboard,
	 *          a djembe, an upright bass, …), else the instrument's own
	 *          (Omnisphere's orb, Drift's saw, …); the pattern rack's
	 *          shaker; the guitar track's guitar
	 *   ghost  an empty chain
	 *
	 * No text, deliberately (user, 2026-09-14). The device's name rides
	 * the band's `title` instead, which is a tooltip and costs no pixels.
	 *
	 * Presentational only; `TrackStrip` owns every pointer gesture, the
	 * same contract `MiniSequencer` and `TrackClipView` keep. A tap
	 * anywhere in the band opens the full view.
	 */

	import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
	import Drum from '@lucide/svelte/icons/drum';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Guitar from '@lucide/svelte/icons/guitar';
	import IconNodeGlyph from './IconNodeGlyph.svelte';
	import Mic from '@lucide/svelte/icons/mic';
	import Music from '@lucide/svelte/icons/music';
	import Plug from '@lucide/svelte/icons/plug';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Waves from '@lucide/svelte/icons/waves';
	import Zap from '@lucide/svelte/icons/zap';
	import type { TrackDeviceGlance } from '../../composables/useTrackDevice.svelte';
	import type { DeviceGlyph } from '$lib/config/deviceGlyphMap';
	import {
		BEATER,
		HAND_DRUM,
		HARP,
		KEYBOARD,
		MELD,
		OPERATOR,
		ORB,
		SAW,
		SAXOPHONE,
		SAMPLER,
		SHAKER,
		SIMPLER,
		SQUARE,
		SYNTH,
		TINE,
		TRUMPET,
		UPRIGHT_BASS,
		VIOLIN,
		WAVETABLE
	} from './instrumentGlyphNodes';
	interface Props {
		glance: TrackDeviceGlance;
		/** The track's calibrated ink — the head's colour when it is the instrument. */
		color?: string;
		/** Mirrors the strip: greys out while Live's own mute is on. */
		dimmed?: boolean;
	}

	let { glance, color, dimmed = false }: Props = $props();

	// An instrument is the track's own voice and wears the track ink; a
	// plain device wears its family's, so an audio track's band reads as
	// the chain it is rather than as a second copy of the track colour.
	let headInk = $derived(
		dimmed
			? 'var(--signal-dim)'
			: glance.kind === 'instrument'
				? (color ?? 'var(--signal-dim)')
				: (glance.ink ?? color ?? 'var(--signal-dim)')
	);

	// The device's name, as a tooltip. Nothing here is drawn.
	let title = $derived(glance.mode === 'ghost' ? 'No devices on this track' : (glance.name ?? ''));

	// Lucide components, or icon nodes drawn through `IconNodeGlyph` — the
	// marks lucide has no icon for, drawn in `instrumentGlyphNodes`.
	const GLYPHS = {
		guitar: Guitar,
		mic: Mic,
		keyboard: KEYBOARD,
		synth: SYNTH,
		'upright-bass': UPRIGHT_BASS,
		'hand-drum': HAND_DRUM,
		violin: VIOLIN,
		trumpet: TRUMPET,
		saxophone: SAXOPHONE,
		harp: HARP,
		sampler: SAMPLER,
		simpler: SIMPLER,
		orb: ORB,
		saw: SAW,
		wavetable: WAVETABLE,
		meld: MELD,
		operator: OPERATOR,
		beater: BEATER,
		tine: TINE,
		square: SQUARE,
		plug: Plug,
		fx: Sparkles,
		drum: Drum,
		shaker: SHAKER,
		filter: AudioWaveform,
		space: Waves,
		dynamics: Gauge,
		drive: Zap,
		movement: Music,
		gain: SlidersHorizontal,
		device: Music
	} as const satisfies Record<DeviceGlyph, unknown>;

	const mark = $derived(GLYPHS[glance.glyph]);
</script>

<div class="track-device-view" class:dimmed style="--head-ink: {headInk};" {title}>
	{#if glance.mode === 'glyph'}
		<div class="glyph" aria-hidden="true">
			{#if Array.isArray(mark)}
				<IconNodeGlyph iconNode={mark} />
			{:else}
				{@const Glyph = mark}
				<Glyph />
			{/if}
		</div>
	{:else}
		<!-- Ghost: the dashed idiom MiniSequencer uses for a track with no
		     Permute, so "nothing here" looks the same in both bands. -->
		<div class="glyph ghost" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.track-device-view {
		height: 100%;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		min-width: 0;
		/* Every mark in the band at one still weight (user, 2026-09-14):
		   the level a drum hit used to flash to, with no motion. 0.3 — an
		   inert Permute row's weight — was tried first and read too faint. */
		--band-rest-opacity: 0.85;
	}

	.glyph {
		opacity: var(--band-rest-opacity);
	}

	/* ---- glyph ------------------------------------------------------ */

	.glyph {
		height: 100%;
		aspect-ratio: 1;
		max-width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--head-ink);
	}

	/* A lucide stroke is in the icon's 24-unit space and scales with the
	   icon, so at band size "1.5" drew ~2.5px. non-scaling-stroke makes
	   stroke-width a screen width: 1px whatever size the glyph lands at. */
	.glyph :global(svg) {
		width: 100%;
		height: 100%;
		stroke-width: 1px;
	}

	.glyph :global(svg *) {
		vector-effect: non-scaling-stroke;
	}

	.glyph.ghost {
		border-radius: var(--radius-sm);
		border: 1px dashed color-mix(in srgb, var(--muted-foreground), transparent 70%);
		/* Wider and emptier than a glyph: nothing is here. */
		aspect-ratio: 1.6;
	}

	/* Muted: the ink already greys to --signal-dim; drop a notch further. */
	.track-device-view.dimmed {
		--band-rest-opacity: 0.5;
	}
</style>
