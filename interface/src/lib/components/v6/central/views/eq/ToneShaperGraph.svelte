<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * Ben's Adaptive Tone Shaper's face, on the face grid (ADR-510), sections
	 * [5, 1]:
	 *
	 *   Tone [the graph, a handle per tone]  |  Global [Amount / Zero · Eco]
	 *
	 * The graph is the device's own (`toneShaper.ts` has the geometry): the
	 * input's spectrum as a filled area, the curve being applied (boosts
	 * filled above the zero line, cuts below), the four tone handles — a
	 * press takes the nearest, a drag moves it up and down for the level and
	 * sideways for the center, relative to where the finger landed, as every
	 * pad here does. A handle wears its center, as on the device; while a
	 * finger holds it, it names itself top-left with its level and center
	 * (no number at rest, ADR-544; until then the readout stood there
	 * always, the Amount's when no handle had been touched).
	 *
	 * Beside the graph, as the Channel EQ's view has its Global column: the
	 * Amount, the level that is ridden, a value box (`DeviceSlider`; a thin
	 * bar of its own with its number under it until ADR-544, "AMT"), over
	 * the Zero (latency) and Eco (quality) switches, one touch row (two
	 * 22px buttons in the graph's corner until then, lit in the ink).
	 *
	 * The spectrum and the curve are the device's own, thirty a second
	 * (`frame`); without one the graph is still a graph, with the handles
	 * where the parameters say.
	 */
	import { onDestroy } from 'svelte';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { MIN_SEND_INTERVAL_MS } from '$lib/utils/sliderThrottle';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import type { ToneShaperFrame } from '$lib/stores/v3/toneShaper.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import FaceGrid from '../../FaceGrid.svelte';
	import FaceSection from '../../FaceSection.svelte';
	import FaceSeam from '../../FaceSeam.svelte';
	import PanelEyebrow from '../panel/PanelEyebrow.svelte';
	import {
		TS_PARAM,
		TS_BANDS,
		TS_HANDLE,
		TS_AMOUNT_MAX,
		bandHz,
		dbY,
		handleDrag,
		hzLabel,
		hzX,
		levelLabel,
		nearestHandle,
		spectrumY
	} from './toneShaper';

	interface Props {
		frame?: ToneShaperFrame;
		amount: number;
		/** The four tone levels, -10..10. */
		levels: number[];
		/** The four centers in Hz. */
		hz: number[];
		zero: boolean;
		eco: boolean;
		color: DeviceColorScheme;
		isGhost?: boolean;
		onWrite: (index: number, value: number) => void;
		/** A tap anywhere: a ghost loads. */
		onTap?: () => void;
	}

	let { frame, amount, levels, hz, zero, eco, color, isGhost = false, onWrite, onTap }: Props = $props();

	// While a drag is in flight its values draw from here, at frame rate;
	// the writes behind them leave at no more than 60 Hz.
	let draft = $state<Record<number, number>>({});
	let shownLevels = $derived(TS_HANDLE.map((_, i) => draft[TS_PARAM.levels[i]] ?? levels[i]));
	let shownHz = $derived(TS_HANDLE.map((_, i) => draft[TS_PARAM.hz[i]] ?? hz[i]));

	const X = (x: number) => (x * 1000).toFixed(1);
	const Y = (y: number) => ((1 - y) * 1000).toFixed(1);
	const BAND_X = Array.from({ length: TS_BANDS }, (_, b) => hzX(bandHz(b)));
	const HZ_TICKS = [
		{ hz: 100, label: '100' },
		{ hz: 1000, label: '1k' },
		{ hz: 10000, label: '10k' }
	];
	const DB_TICKS = [12, 6, 0, -6, -12];

	let spectrumPath = $derived.by(() => {
		if (!frame) return '';
		const ys = spectrumY(frame.levels);
		return `M0 1000L${ys.map((y, b) => `${X(BAND_X[b])} ${Y(y)}`).join('L')}L1000 1000Z`;
	});
	let gains = $derived(frame?.gains ?? null);
	const along = (g: number[], f: (db: number) => number) =>
		g.map((db, b) => `${X(BAND_X[b])} ${Y(dbY(f(db)))}`).join('L');
	let curvePath = $derived(gains ? `M${along(gains, (db) => db)}` : '');
	let boostPath = $derived(gains ? `M0 ${Y(dbY(0))}L${along(gains, (db) => Math.max(0, db))}L1000 ${Y(dbY(0))}Z` : '');
	let cutPath = $derived(gains ? `M0 ${Y(dbY(0))}L${along(gains, (db) => Math.min(0, db))}L1000 ${Y(dbY(0))}Z` : '');

	// ── The readout: the handle a finger holds, and only while it does ──
	let focus = $state(-1);
	let readout = $derived(
		focus >= 0
			? { name: TS_HANDLE[focus].name, value: `${levelLabel(shownLevels[focus])} dB · ${hzLabel(shownHz[focus], true)}` }
			: null
	);

	// ── The gesture ────────────────────────────────────────────────────
	let pad = $state<HTMLElement | null>(null);
	let grabbed = -1; // the handle held, or none
	let start = { level: 0, hz: 0 };
	let box = { width: 1, height: 1 };

	const pending = new Map<number, number>();
	let raf: number | null = null;
	let lastSent = 0;

	function send() {
		for (const [index, value] of pending) onWrite(index, value);
		pending.clear();
	}
	function tick(now: number) {
		raf = null;
		if (!pending.size) return;
		if (now - lastSent < MIN_SEND_INTERVAL_MS) {
			raf = requestAnimationFrame(tick);
			return;
		}
		send();
		lastSent = now;
	}
	function queue(writes: [number, number][]) {
		for (const [index, value] of writes) {
			pending.set(index, value);
			draft[index] = value;
		}
		if (raf === null) raf = requestAnimationFrame(tick);
	}

	function padDown(info: DragInfo) {
		if (!pad) return;
		const r = pad.getBoundingClientRect();
		box = { width: r.width, height: r.height };
		const x = (info.downX - r.left) / r.width;
		const y = 1 - (info.downY - r.top) / r.height;
		grabbed = nearestHandle(shownLevels, shownHz, x, y, r.width, r.height);
		if (grabbed >= 0) {
			start = { level: shownLevels[grabbed], hz: shownHz[grabbed] };
			focus = grabbed;
		}
	}
	function padMove(info: DragInfo) {
		if (grabbed < 0) return;
		const { level, hz: center } = handleDrag(grabbed, start, info.dx, info.dy, box.width, box.height);
		queue([
			[TS_PARAM.levels[grabbed], level],
			[TS_PARAM.hz[grabbed], center]
		]);
	}
	function end() {
		if (raf !== null) cancelAnimationFrame(raf);
		raf = null;
		send();
		grabbed = -1;
		focus = -1;
		draft = {};
	}
	function tap() {
		if (isGhost) onTap?.();
	}
	// Unmounted mid-drag: drop the writes rather than send them to whatever
	// device this view shows next.
	onDestroy(() => {
		if (raf !== null) cancelAnimationFrame(raf);
		pending.clear();
	});
</script>

<div class="ts-face" class:ghost={isGhost} style="--ink: {color.primary};" data-toneshaper-graph>
<FaceGrid sections={[5, 1]}>
	<FaceSection span={5}>
	{#snippet head()}<PanelEyebrow title="Tone" color={color.primary} />{/snippet}
	<div
		class="ts-pad face-span-all"
		role="group"
		aria-label={readout ? `Tone Shaper: ${readout.name} ${readout.value}` : 'Tone Shaper'}
		bind:this={pad}
		use:drag={{ commit: 'either', onDown: padDown, onMove: padMove, onEnd: end, onTap: tap }}
	>
		<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
			{#each HZ_TICKS as t (t.hz)}
				<line class="grid" x1={X(hzX(t.hz))} x2={X(hzX(t.hz))} y1="0" y2="1000" />
			{/each}
			{#each DB_TICKS as db (db)}
				<line class="grid" class:zero={db === 0} x1="0" x2="1000" y1={Y(dbY(db))} y2={Y(dbY(db))} />
			{/each}
			{#if spectrumPath}<path class="spectrum" d={spectrumPath} />{/if}
			{#if gains}
				<path class="boost" d={boostPath} />
				<path class="cut" d={cutPath} />
				<path class="curve" d={curvePath} />
			{/if}
			{#each TS_HANDLE as h, i (h.key)}
				<line class="stem" x1={X(hzX(shownHz[i]))} x2={X(hzX(shownHz[i]))} y1="0" y2="1000" />
			{/each}
		</svg>

		<!-- The edges' labels sit inside the pad; 0 straddles its line. -->
		<span class="db-label" style="top: 0.125rem;">+12</span>
		<span class="db-label" style="bottom: 50%; transform: translateY(50%);">0</span>
		<span class="db-label" style="bottom: 0.125rem;">-12</span>
		{#each HZ_TICKS as t (t.hz)}
			<span class="hz-label" style="left: {hzX(t.hz) * 100}%;">{t.label}</span>
		{/each}

		{#each TS_HANDLE as h, i (h.key)}
			<span
				class="handle"
				class:selected={i === focus}
				style="left: {hzX(shownHz[i]) * 100}%; bottom: {dbY(shownLevels[i]) * 100}%;"
				data-ts-handle={h.key}
				data-ts-level={shownLevels[i].toFixed(2)}
				data-ts-hz={Math.round(shownHz[i])}
			>{hzLabel(shownHz[i])}</span>
		{/each}

		{#if readout}
			<div class="readout">
				<span class="readout-name">{readout.name}</span>
				<span class="readout-value">{readout.value}</span>
			</div>
		{/if}
	</div>
	</FaceSection>
	<FaceSeam />

	<FaceSection span={1}>
	{#snippet head()}<PanelEyebrow title="Global" color={color.primary} />{/snippet}
	<div class="ts-side">
		<!-- The Amount: ridden, so a value box; its number only while it moves. -->
		<div class="ts-amount" data-ts-amount>
			<DeviceSlider
				value={amount}
				title="Amount"
				orientation="vertical"
				min={0}
				max={TS_AMOUNT_MAX}
				{isGhost}
				{color}
				readout={amount.toFixed(1)}
				onTap={tap}
				onInteraction={(v) => onWrite(TS_PARAM.amount, v)}
			/>
		</div>
		<!-- Latency and quality, lit when on: Zero is the device's default. -->
		<div class="ts-switches">
			<button
				class="physical-button btn-toggle ts-switch"
				class:active={zero}
				aria-pressed={zero}
				data-ts-switch="zero"
				use:press={{ onPress: () => (isGhost ? onTap?.() : onWrite(TS_PARAM.latency, zero ? 0 : 1)) }}
			>Zero</button>
			<button
				class="physical-button btn-toggle ts-switch"
				class:active={eco}
				aria-pressed={eco}
				data-ts-switch="eco"
				use:press={{ onPress: () => (isGhost ? onTap?.() : onWrite(TS_PARAM.quality, eco ? 0 : 1)) }}
			>Eco</button>
		</div>
	</div>
	</FaceSection>
</FaceGrid>
</div>

<style>
	.ts-face {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	.ts-pad {
		position: relative;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		cursor: crosshair;
		user-select: none;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.ts-face.ghost svg,
	.ts-face.ghost .handle {
		opacity: var(--opacity-ghost);
	}

	.grid {
		stroke: var(--line-strong);
		stroke-opacity: 0.5;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.grid.zero {
		stroke-opacity: 1;
	}
	/* The spectrum is the sound, in the page's own grey; the ink is for what
	   the device does to it. */
	.spectrum {
		fill: color-mix(in oklab, var(--foreground) 14%, transparent);
		stroke: none;
	}
	.boost {
		fill: color-mix(in oklab, var(--ink) 40%, transparent);
		stroke: none;
	}
	/* A cut is the ink too, fainter: it reads on the dark well and on paper. */
	.cut {
		fill: color-mix(in oklab, var(--ink) 18%, transparent);
		stroke: none;
	}
	.curve {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.5;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.stem {
		stroke: var(--ink);
		stroke-opacity: 0.35;
		stroke-width: 1;
		stroke-dasharray: 3 4;
		vector-effect: non-scaling-stroke;
	}

	.db-label,
	.hz-label {
		position: absolute;
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		pointer-events: none;
		white-space: nowrap;
	}
	.db-label {
		left: 0.375rem;
	}
	.hz-label {
		bottom: 0.125rem;
		transform: translateX(-50%);
	}

	/* The handles: the flat grammar's grip, each wearing its center. Lit,
	   the one last touched. */
	.handle {
		position: absolute;
		min-width: 30px;
		height: 22px;
		padding: 0 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translate(-50%, 50%);
		border: 1px solid var(--ink);
		border-radius: 2px;
		background: var(--surface-well);
		color: var(--ink);
		font-size: 0.6875rem;
		font-weight: var(--font-weight-medium);
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		white-space: nowrap;
	}
	.handle.selected {
		background: var(--ink);
		color: var(--flat-on-fg);
	}

	.readout {
		position: absolute;
		top: 0.5rem;
		left: 2.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		white-space: nowrap;
		pointer-events: none;
	}
	.readout-name {
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.readout-value {
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}

	/* The Global column: the Amount box over the two switches' touch row. */
	.ts-side {
		display: flex;
		flex-direction: column;
		gap: var(--face-gutter);
		min-width: 0;
		min-height: 0;
	}
	.ts-amount {
		flex: 1 1 0;
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.ts-amount > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	.ts-switches {
		flex: 0 0 var(--height-touch);
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--face-gutter);
	}
	.ts-switch {
		min-width: 0;
		min-height: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	/* ---- Flat grammar: the switches' words are medium; ON and the label's
	   colour are app.css's (ADR-544). The pad is a well already. */
	:global([data-grammar="flat"]) .ts-switch {
		font-weight: var(--font-weight-medium);
	}
</style>
