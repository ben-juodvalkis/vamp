<script lang="ts">
	/**
	 * The Reverb view's EQ tab (`reverbEq.ts`): the response of the reverb's
	 * own EQ, 20 Hz to 20 kHz across, -24..+12 dB up, with a handle per band.
	 * A press takes the nearest handle and a drag moves it relative to where
	 * the finger landed, as every XY pad here does: across is the band's
	 * frequency, up its gain — a cut has no gain, so it only slides. The
	 * band last touched draws its own curve dashed and names itself
	 * top-right in Live's words.
	 */
	import { onDestroy } from 'svelte';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { MIN_SEND_INTERVAL_MS } from '$lib/utils/sliderThrottle';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import {
		bandCurveDb,
		bandReadout,
		dbY,
		dragWrites,
		eqCurveDb,
		handleAt,
		hzX,
		nearestBand,
		type EqBand,
		type EqBandKey
	} from './reverbEq';

	interface Props {
		bands: EqBand[];
		on: boolean;
		color: DeviceColorScheme;
		isGhost?: boolean;
		selected: EqBandKey;
		onSelect: (key: EqBandKey) => void;
		onWrite: (index: number, value: number) => void;
	}

	let { bands, on, color, isGhost = false, selected, onSelect, onWrite }: Props = $props();

	// While a drag is in flight its values draw from here, at frame rate;
	// the writes behind them leave at no more than 60 Hz (issue #384).
	let draft = $state<Record<number, number>>({});
	let shown = $derived(
		bands.map((b) => ({ ...b, freq: draft[b.freqIndex] ?? b.freq, gain: draft[b.gainIndex] ?? b.gain }))
	);

	const HZ = Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199));
	const HZ_TICKS = [
		{ hz: 100, label: '100' },
		{ hz: 1000, label: '1k' },
		{ hz: 10000, label: '10k' }
	];
	const DB_TICKS = [12, 0, -12];

	// The shape draws even with the EQ off — dimmed — so switching it on
	// shows what it will do.
	let curve = $derived(eqCurveDb(shown, true, HZ));
	let focus = $derived(shown.find((b) => b.key === selected) ?? shown[0]);
	let focusCurve = $derived(bandCurveDb(focus, HZ));
	let readout = $derived(on ? bandReadout(focus) : { name: 'EQ', value: 'Off' });

	const X = (x: number) => (x * 1000).toFixed(1);
	const Y = (y: number) => ((1 - y) * 1000).toFixed(1);
	const line = (dbs: number[]) => 'M' + dbs.map((db, i) => `${X(hzX(HZ[i]))} ${Y(dbY(db))}`).join('L');
	let curvePath = $derived(line(curve));
	let fillPath = $derived(`${curvePath}L${X(hzX(HZ[HZ.length - 1]))} ${Y(dbY(0))}L${X(hzX(HZ[0]))} ${Y(dbY(0))}Z`);
	let focusPath = $derived(line(focusCurve));

	// ── The gesture ────────────────────────────────────────────────────
	let pad = $state<HTMLElement | null>(null);
	let grabbed: EqBand | null = null;
	let start = { freq: 0, gain: 0 };
	let box = { width: 1, height: 1 };

	const pending = new Map<number, number>();
	let raf: number | null = null;
	let lastSent = 0;

	function send() {
		for (const [index, value] of pending) onWrite(index, value);
		pending.clear();
	}
	function frame(now: number) {
		raf = null;
		if (!pending.size) return;
		if (now - lastSent < MIN_SEND_INTERVAL_MS) {
			raf = requestAnimationFrame(frame);
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
		if (raf === null) raf = requestAnimationFrame(frame);
	}

	function down(info: DragInfo) {
		if (!pad) return;
		const r = pad.getBoundingClientRect();
		box = { width: r.width, height: r.height };
		const x = (info.downX - r.left) / r.width;
		const y = 1 - (info.downY - r.top) / r.height;
		grabbed = nearestBand(shown, x, y, r.width, r.height);
		start = { freq: grabbed.freq, gain: grabbed.gain };
		onSelect(grabbed.key);
	}
	function move(info: DragInfo) {
		if (grabbed) queue(dragWrites(grabbed, start, info.dx, info.dy, box.width, box.height));
	}
	function end() {
		if (raf !== null) cancelAnimationFrame(raf);
		raf = null;
		send();
		grabbed = null;
		draft = {};
	}
	// Unmounted mid-drag: drop the writes rather than send them to whatever
	// device this view shows next.
	onDestroy(() => {
		if (raf !== null) cancelAnimationFrame(raf);
		pending.clear();
	});
</script>

<div
	class="eq-pad"
	class:ghost={isGhost}
	class:off={!on}
	style="--ink: {color.primary};"
	role="group"
	aria-label="Reverb EQ: {readout.name} {readout.value}"
	data-reverb-eq
	bind:this={pad}
	use:drag={{ commit: 'either', onDown: down, onMove: move, onEnd: end }}
>
	<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
		<!-- No grid (the user's call): 0 dB alone, the line every gain is read from. -->
		<line class="zero" x1="0" x2="1000" y1={Y(dbY(0))} y2={Y(dbY(0))} />
		<path class="eq-fill" d={fillPath} />
		<path class="focus-curve" d={focusPath} />
		<path class="eq-curve" d={curvePath} />
	</svg>

	{#each DB_TICKS as db (db)}
		<span class="db-label" style="bottom: {dbY(db) * 100}%;">{db > 0 ? `+${db}` : db}</span>
	{/each}
	{#each HZ_TICKS as t (t.hz)}
		<span class="hz-label" style="left: {hzX(t.hz) * 100}%;">{t.label}</span>
	{/each}

	{#each shown as b (b.key)}
		{@const h = handleAt(b)}
		<span
			class="handle"
			class:selected={b.key === selected}
			class:cut={b.kind === 'cut'}
			style="left: {h.x * 100}%; bottom: {h.y * 100}%;"
			data-eq-band={b.key}
		>{b.mark}</span>
	{/each}

	<div class="readout">
		<span class="readout-name">{readout.name}</span>
		<span class="readout-value">{readout.value}</span>
	</div>
</div>

<style>
	.eq-pad {
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
	.eq-pad.ghost svg,
	.eq-pad.ghost .handle {
		opacity: var(--opacity-ghost);
	}
	.eq-pad.off svg,
	.eq-pad.off .handle {
		opacity: 0.4;
	}

	.zero {
		stroke: var(--line-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.eq-fill {
		fill: color-mix(in oklab, var(--ink) 16%, transparent);
		stroke: none;
	}
	.eq-curve {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.5;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.focus-curve {
		fill: none;
		stroke: var(--ink);
		stroke-opacity: 0.55;
		stroke-width: 1;
		stroke-dasharray: 4 5;
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
		transform: translateY(50%);
	}
	.hz-label {
		bottom: 0.125rem;
		transform: translateX(-50%);
	}

	/* Flat grammar's grip: square, 2px corners. Lit, the band last touched. */
	.handle {
		position: absolute;
		width: 26px;
		height: 22px;
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
		pointer-events: none;
	}
	.handle.selected {
		background: var(--ink);
		color: var(--flat-on-fg);
	}

	.readout {
		position: absolute;
		top: 0.5rem;
		right: 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
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
	/* Narrow — a drum pad's pane — the tabs take the top-left corner's
	   whole width, so the readout steps down beneath them. */
	@container (max-width: 330px) {
		.readout {
			top: 2.75rem;
		}
	}
</style>
