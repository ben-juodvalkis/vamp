<script lang="ts">
	/**
	 * BrowserPresetWaveform — ADR-401.
	 *
	 * Paints a low-res waveform behind an audio sample's browser tile.
	 * Peaks come from the **baked thumbnail** on the preset (decoded from
	 * `preset.peaks`, zero network) when present; otherwise it lazily
	 * fetches full peaks from the live `/api/sample-peaks` endpoint via
	 * `clipWaveformService`. Both paths are gated behind an
	 * IntersectionObserver so a folder of hundreds of tiles only decodes
	 * or fetches the handful actually on screen — the browser is the one
	 * surface that renders *many* waveforms at once, unlike the strip /
	 * Simpler / editor which each render one.
	 *
	 * Presentational only. The parent tile owns the tap/load gesture; this
	 * layer is `pointer-events: none` and sits behind the tile label.
	 *
	 * Draw math mirrors TrackClipView (ADR-360): per-sample normalisation
	 * with a gain cap + 0.6 power curve so quiet samples still read tall.
	 * Rendered **unipolar** — bars grow up from the tile's bottom edge using
	 * the per-sample peak magnitude (max of |min|,|max|), so the thumbnail
	 * reads as a compact bottom-anchored envelope rather than a mirrored strip.
	 */

	import type { Preset } from '$lib/services/adapters/browserAdapter';
	import { getPeaks } from '$lib/services/clipWaveformService';
	import { decodeThumbnailPeaks, isAudioThumbnailType, THUMB_BINS } from '$lib/utils/waveformThumbnail';
	import { resolvedTheme } from '$lib/stores/theme';

	interface Props {
		preset: Preset;
		/** Canvas-safe fill for the waveform (concrete color, never a CSS var). */
		ink?: string;
	}

	// Default ink is set as CSS `color` on the container (see the style block) and read
	// back resolved via getComputedStyle, so the canvas gets a concrete colour.
	// Under Graticule that is the legacy rgba(255,255,255,.32) literal (bit-
	// identical to the pre-skin render); under the flat grammar it is the theme
	// foreground at 32%, so it follows the active skin. Callers can still pin one.
	let { preset, ink }: Props = $props();
	const LEGACY_INK = 'rgba(255, 255, 255, 0.32)';

	let containerRef = $state<HTMLElement | null>(null);
	let canvasRef = $state<HTMLCanvasElement | null>(null);
	let peaks = $state<[number, number][] | null>(null);
	let sizeTick = $state(0);

	const isAudio = $derived(isAudioThumbnailType(preset.type));

	// Resolve peaks lazily when the tile scrolls into view: decode the baked
	// thumbnail if we have one, else fall back to a live fetch. Re-runs when the
	// tile's preset changes (grid reflow / drill), resetting cleanly.
	$effect(() => {
		peaks = null;
		if (!isAudio) return;
		const el = containerRef;
		if (!el) return;

		const bakedStr = preset.peaks;
		const path = preset.fullPath;
		let cancelled = false;
		let resolved = false;

		const resolve = () => {
			if (resolved || cancelled) return;
			resolved = true;
			const baked = decodeThumbnailPeaks(bakedStr);
			if (baked) {
				peaks = baked;
				return;
			}
			if (!path) return;
			getPeaks(path, THUMB_BINS).then((data) => {
				if (!cancelled && data) peaks = data.peaks;
			});
		};

		if (typeof IntersectionObserver === 'undefined') {
			resolve();
			return () => {
				cancelled = true;
			};
		}

		const obs = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						resolve();
						obs.disconnect();
						break;
					}
				}
			},
			{ rootMargin: '150px' }
		);
		obs.observe(el);
		return () => {
			cancelled = true;
			obs.disconnect();
		};
	});

	// Redraw on tile resize (rotation / grid reflow) without re-fetching peaks.
	$effect(() => {
		const el = containerRef;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => {
			sizeTick++;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	// Canvas draw. Reads peaks + ink + sizeTick; whole-sample envelope (no loop
	// window — the browser shows the full file).
	$effect(() => {
		const canvas = canvasRef;
		const container = containerRef;
		const data = peaks;
		void sizeTick; // redraw dependency
		// A theme flip changes the container's computed `color`, so it is a
		// redraw dependency too (only matters when no explicit ink is set).
		void $resolvedTheme;
		if (!canvas || !container) return;
		const fill = ink ?? getComputedStyle(container).color;

		const dpr = window.devicePixelRatio || 1;
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w === 0 || h === 0) return;
		const targetW = Math.round(w * dpr);
		const targetH = Math.round(h * dpr);
		if (canvas.width !== targetW) canvas.width = targetW;
		if (canvas.height !== targetH) canvas.height = targetH;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!data || !data.length) return;

		// Unipolar: columns grow up from the bottom edge, one per bin, using the
		// bin magnitude (max of |lo|,|hi| — RMS for decoded PCM, peak for
		// .asd/PCM-stream bins). Full canvas height is available since we no
		// longer mirror around the midline.
		const baseline = canvas.height;
		const MAX_GAIN = 20;
		// Gentler than the strip's 0.6: with 256 dense bins a hard curve lifts
		// every quiet bin and flattens loops toward the top (picket fence). 0.85
		// keeps more of the natural dynamic range so the envelope shape reads.
		const SHAPE = 0.85;
		let maxAbs = 0;
		for (const [min, max] of data) {
			const a = Math.max(Math.abs(min), Math.abs(max));
			if (a > maxAbs) maxAbs = a;
		}
		const norm = maxAbs > 0 ? Math.min(1 / maxAbs, MAX_GAIN) : 1;
		const ampScale = canvas.height * 0.82;
		const binWidth = canvas.width / data.length;

		// Snap each column's left and right edge to the device-pixel grid so
		// adjacent columns share an exact edge (no 1px background seams) and
		// tile the width edge-to-edge. At 256 bins each column is ~1–2px, so the
		// density itself reads as a smooth envelope — no per-bar gaps wanted.
		ctx.fillStyle = fill;
		// A canvas that can't parse the computed colour keeps its previous
		// fillStyle (opaque black); the 32% mix is never opaque, so that
		// serialisation is a reliable "unparsed" tell — fall back to the legacy ink.
		if (ink === undefined && ctx.fillStyle === '#000000') ctx.fillStyle = LEGACY_INK;
		for (let i = 0; i < data.length; i++) {
			const [min, max] = data[i];
			const amp = Math.max(Math.abs(min), Math.abs(max));
			const scaled = Math.pow(Math.min(1, amp * norm), SHAPE);
			const left = Math.round(i * binWidth);
			const right = Math.round((i + 1) * binWidth);
			const drawH = Math.max(1, scaled * ampScale);
			ctx.fillRect(left, Math.floor(baseline - drawH), Math.max(1, right - left), drawH);
		}
	});
</script>

<div class="preset-waveform" bind:this={containerRef} aria-hidden="true">
	<canvas bind:this={canvasRef}></canvas>
</div>

<style>
	.preset-waveform {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
		/* Default waveform ink, read back by the draw effect (canvas can't
		   resolve CSS vars itself). Graticule keeps the legacy literal white
		   wash verbatim (both polarities — bit-identical to the pre-skin
		   render); the flat grammar below swaps in the theme foreground. */
		color: rgba(255, 255, 255, 0.32);
	}
	/* Flat grammar: foreground at 32% so the wash follows the skin — white on
	   the dark ladders, a dark wash on light where a white one was invisible.
	   Mixed in srgb so the computed value serialises as a plain
	   `color(srgb …)` / rgba() the canvas parser accepts everywhere. */
	:global([data-grammar='flat']) .preset-waveform {
		color: color-mix(in srgb, var(--foreground, #fff) 32%, transparent);
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
