<script lang="ts">
	/**
	 * The audio clip's waveform at central scale (peaks @1024), placed by
	 * time under the view window and stretched through the warp markers.
	 */

	import type { PeakData } from '$lib/services/clipWaveformService';
	import { paintPeaks, peakSpan } from '$lib/utils/waveformPaint';
	import { paintTokens, paintMode, withAlpha } from '$lib/utils/paintTokens';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import type { BeatWindow } from '$lib/utils/clip/clipEditorGeometry';

	interface Props {
		peakData: PeakData | null;
		width: number;
		height: number;
		beatWindow: BeatWindow;
		totalBeats: number;
		fileStartBeats: number;
		fileEndBeats: number;
		color?: string;
		place?: (fraction: number) => number;
		/** The loop's edges in px: inside them the waveform takes the track ink. */
		loopStartX: number;
		loopEndX: number;
		looped: boolean;
	}

	let {
		peakData,
		width,
		height,
		beatWindow,
		totalBeats,
		fileStartBeats,
		fileEndBeats,
		color,
		place,
		loopStartX,
		loopEndX,
		looped
	}: Props = $props();

	let canvasRef = $state<HTMLCanvasElement | null>(null);
	$effect(() => {
		const canvas = canvasRef;
		if (!canvas) return;
		const data = peakData;
		const w = width;
		const h = height;
		const win = beatWindow;
		const total = totalBeats;
		const fileStart = fileStartBeats;
		const fileEnd = fileEndBeats;
		const colorStyle = color;
		const warp = place;
		if (w <= 0 || h <= 0) return;

		const dpr = window.devicePixelRatio || 1;
		const targetW = Math.round(w * dpr);
		const targetH = Math.round(h * dpr);
		if (canvas.width !== targetW) canvas.width = targetW;
		if (canvas.height !== targetH) canvas.height = targetH;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!data || !data.peaks.length || total <= 0) return;

		// GRATICULE two-tone (§4.5): inside the loop braces → trackInk; outside →
		// DIM_GREY @45%. ONE createLinearGradient per repaint for the vertical
		// alpha falloff (NOT per bin). fillStyle stays canvas-safe strings.
		const pt = paintTokens();
		const ink = colorStyle ? trackInk(colorStyle, paintMode()) : pt.EDITOR_ACCENT;
		const dim = pt.DIM_GREY_45;
		const inkGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
		inkGrad.addColorStop(0, withAlpha(ink, 0.4));
		inkGrad.addColorStop(0.5, ink);
		inkGrad.addColorStop(1, withAlpha(ink, 0.4));
		const isLooped = looped;
		const braceStartPx = loopStartX * dpr;
		const braceEndPx = loopEndX * dpr;
		// Peaks placed by time under the view window — the file's own span
		// when known, so a take that doesn't start at beat 0 (or runs past
		// the end marker) still lines up with the grid and the braces.
		paintPeaks(ctx, data.peaks, canvas.width, canvas.height, {
			span: peakSpan(fileStart, fileEnd, total),
			view: { start: win.startBeats, end: win.endBeats },
			place: warp,
			amplitude: 'perceptual',
			headroom: 0.9,
			ink: (x0) => (!isLooped || (x0 >= braceStartPx && x0 < braceEndPx) ? inkGrad : dim)
		});
	});
</script>

<canvas bind:this={canvasRef} class="waveform"></canvas>

<style>
	.waveform {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
