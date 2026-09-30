<script lang="ts">
	/**
	 * TrackDeviceView — the strip's device band.
	 *
	 * One wordless picture of what makes this track's sound, chosen by
	 * `glance.mode` (see `composables/useTrackDevice.svelte.ts`):
	 *
	 *   glyph  one mark for what kind of thing is on the track: for an
	 *          instrument, the category its preset came from (a keyboard,
	 *          a djembe, an upright bass, …); the pattern rack's shaker;
	 *          the guitar track's guitar
	 *   knobs  an instrument with no category mark — one knob: the first
	 *          control its central view leads with, at the position it is
	 *          actually at
	 *   ghost  an empty chain
	 *
	 * No text, deliberately (user, 2026-09-14). The device's name and the
	 * controls' labels ride the band's `title` instead, which is a
	 * tooltip and costs no pixels.
	 *
	 * Presentational only; `TrackStrip` owns every pointer gesture, the
	 * same contract `MiniSequencer` and `TrackClipView` keep — the knobs
	 * are a reading, not a control. A tap anywhere in the band opens the
	 * full view, where they can be moved.
	 */

	import {
		AudioWaveform,
		Disc3,
		Drum,
		Gauge,
		Guitar,
		Icon,
		Mic,
		Music,
		Piano,
		SlidersHorizontal,
		Waves,
		Zap
	} from '@lucide/svelte';
	import type { TrackDeviceGlance } from '../../composables/useTrackDevice.svelte';
	import type { DeviceGlyph } from '$lib/config/deviceGlyphMap';
	import {
		HAND_DRUM,
		HARP,
		KEYBOARD,
		SAXOPHONE,
		SHAKER,
		SIMPLER,
		SYNTH,
		TRUMPET,
		UPRIGHT_BASS,
		VIOLIN
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

	// The whole band's readout, as a tooltip: the device, then what the
	// knob is showing when one is drawn. Nothing here is drawn.
	let title = $derived(
		glance.mode === 'ghost'
			? 'No devices on this track'
			: glance.mode === 'knobs' && glance.controls.length > 0
				? `${glance.name} — ${glance.controls[0].label}`
				: (glance.name ?? '')
	);

	// Lucide components, or icon nodes drawn through lucide's `Icon` — the
	// marks lucide has no icon for, drawn in `instrumentGlyphNodes`.
	const GLYPHS = {
		guitar: Guitar,
		mic: Mic,
		keys: Piano,
		keyboard: KEYBOARD,
		synth: SYNTH,
		'upright-bass': UPRIGHT_BASS,
		'hand-drum': HAND_DRUM,
		violin: VIOLIN,
		trumpet: TRUMPET,
		saxophone: SAXOPHONE,
		harp: HARP,
		sampler: Disc3,
		simpler: SIMPLER,
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

	/**
	 * Knob geometry. One 270° sweep opening downward — the arc every
	 * rotary in the rig draws — as a dashed circle so the value is one
	 * `stroke-dasharray` and needs no path maths per frame.
	 */
	const R = 15;
	const SWEEP = 0.75; // 270° of the circle
	const CIRCUMFERENCE = 2 * Math.PI * R;
	const TRACK_LENGTH = CIRCUMFERENCE * SWEEP;

	/** The pointer's tip for a 0..1 value, on the same 270° opening downward. */
	function pointer(value: number): { x: number; y: number } {
		const angle = (135 + value * 270) * (Math.PI / 180);
		return { x: 20 + Math.cos(angle) * R, y: 20 + Math.sin(angle) * R };
	}
</script>

<div class="track-device-view" class:dimmed style="--head-ink: {headInk};" {title}>
	{#if glance.mode === 'knobs'}
		<div class="knobs">
			{#each glance.controls.slice(0, 1) as control (control.paramPath)}
				{@const tip = pointer(control.value)}
				<svg class="knob" viewBox="0 0 40 40" aria-hidden="true">
					<circle
						class="knob-track"
						cx="20"
						cy="20"
						r={R}
						stroke-dasharray="{TRACK_LENGTH} {CIRCUMFERENCE}"
					/>
					<circle
						class="knob-value"
						cx="20"
						cy="20"
						r={R}
						stroke-dasharray="{TRACK_LENGTH * control.value} {CIRCUMFERENCE}"
					/>
					<line class="knob-pointer" x1="20" y1="20" x2={tip.x} y2={tip.y} />
				</svg>
			{/each}
		</div>
	{:else if glance.mode === 'glyph'}
		<div class="glyph" aria-hidden="true">
			{#if Array.isArray(mark)}
				<Icon iconNode={mark} />
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

	.knobs,
	.glyph {
		opacity: var(--band-rest-opacity);
	}

	/* ---- knobs ---------------------------------------------------- */

	/* One knob, sized like a glyph (user, 2026-09-14, after 2x2 and four
	   in a row): the first control, a mark the size of the icons beside it. */
	.knobs {
		height: 100%;
		aspect-ratio: 1;
		max-width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
	}

	.knob {
		width: 100%;
		aspect-ratio: 1;
		min-width: 0;
		min-height: 0;
		overflow: visible;
	}

	.knob-track {
		fill: none;
		stroke: var(--line);
		/* Units of the 40-unit viewBox, which draws ~50px wide: 0.8 ≈ 1px,
		   the icons' line. Not non-scaling-stroke, because the dash arrays
		   that draw the value are in these units too. */
		stroke-width: 0.8;
		transform: rotate(135deg);
		transform-origin: 20px 20px;
	}

	.knob-value {
		fill: none;
		stroke: var(--head-ink);
		stroke-width: 0.8;
		stroke-linecap: butt;
		transform: rotate(135deg);
		transform-origin: 20px 20px;
	}

	.knob-pointer {
		stroke: color-mix(in srgb, var(--head-ink), white 25%);
		stroke-width: 0.8;
		stroke-linecap: round;
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
		/* Squarer than a knob and emptier than a glyph: nothing is here. */
		aspect-ratio: 1.6;
	}

	/* Muted: the ink already greys to --signal-dim; drop a notch further. */
	.track-device-view.dimmed {
		--band-rest-opacity: 0.5;
	}

	:global([data-grammar='flat']) .knob-track {
		stroke: var(--line-strong);
	}
</style>
