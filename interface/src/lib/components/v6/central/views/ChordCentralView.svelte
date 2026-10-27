<script lang="ts">
	/**
	 * The Chord's view: all of the device (the user, 2026-10-27: "set up the
	 * central view to give us more control"), as Live's panel lays it out.
	 *
	 *   Note 1: [Shift] [Vel] [Chance] | Note 2: [Shift] [Vel] [Chance] |
	 *   [Scale] over [Strum] [Tension] [Crescendo]
	 *
	 * Two notes, not Live's six (the user, 2026-10-27: "we don't need all 6"),
	 * and every control a tall value box side by side, not a short row of
	 * them (the same day: "the sliders are super wide and short").
	 *
	 * With Scale on (Use Current Scale) a note's shift is its Scale Degrees
	 * parameter, as Live's panel shows it, and semitones otherwise. A note at
	 * 0 adds nothing, so its Velocity and Chance dim. The chain cell's slider
	 * is the first note's Velocity (`deviceControls`).
	 *
	 * Measured on the rig (device_dump, 2026-10-27, MidiChord, 29 params):
	 * note n (1..6) is Shift at 4n - 3 (-36..36 st), Scale Degrees at 4n - 2
	 * (-36..36 sd), Velocity at 4n - 1 (0.01..2, 1.0 % .. 200 %) and Chance
	 * at 4n (0..1); 25 Strum -20..20 (Live's label v·|v| ms, ±400 ms), 26
	 * Strum Tension and 27 Strum Crescendo -100..100 %, 28 Use Current Scale
	 * 0/1. Every default 0 but Velocity and Chance at 1. A ghost draws those,
	 * and its first write loads it.
	 *
	 * NO {#if device} gate - every control handles its own ghost state.
	 */
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const chord = useFxGridSlot('chord');

	let ink = $derived({
		primary: trackInk(chord.color.primary, paintModeReactive()),
		secondary: chord.color.secondary,
		accent: trackInk(chord.color.accent, paintModeReactive())
	});

	const NOTES = [1, 2].map((n) => ({ n, shift: 4 * n - 3, degrees: 4 * n - 2, velocity: 4 * n - 1, chance: 4 * n }));
	const P = { strum: 25, tension: 26, crescendo: 27, scale: 28 } as const;
	const SHIFT_MAX = 36;
	const VELOCITY_MIN = 0.01;
	/** A whole shift's travel: 72 steps over 480px, so a finger lands on one. */
	const SHIFT_TRAVEL = 480;
	/** Live's values on a fresh Chord, what a ghost shows: Velocity and Chance at 1, the rest 0. */
	const rest = (index: number) => (index <= 24 && index % 4 !== 1 && index % 4 !== 2 ? 1 : 0);

	const value = (index: number) => chord.paramValue(index) ?? rest(index);
	const scaled = $derived(value(P.scale) >= 0.5);
	const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${Math.round(v)} ${unit}`;
	const percent = (v: number) => `${Math.round(v * 100)} %`;

	const STRUM = [
		{ index: P.strum, title: 'Strum', min: -20, max: 20, round: true },
		{ index: P.tension, title: 'Tension', min: -100, max: 100, round: false },
		{ index: P.crescendo, title: 'Crescendo', min: -100, max: 100, round: false }
	];
</script>

<div class="chord-layout" data-view="chord" style="--btn-tint: {ink.primary};">
	{#each NOTES as note, i (note.n)}
		{@const shiftIndex = scaled ? note.degrees : note.shift}
		{@const shift = value(shiftIndex)}
		{@const silent = Math.round(shift) === 0}
		{@const col = 1 + i * 4}
		{#if i > 0}<div class="seam" style="grid-column: {col - 1};"><SectionDivider orientation="vertical" /></div>{/if}
		<div class="group-head" style="grid-column: {col} / span 3;">Note {note.n}</div>
		{#each [['Shift', col], ['Velocity', col + 1], ['Chance', col + 2]] as [name, c] (name)}
			<div class="caption" class:silent={silent && name !== 'Shift'} style="grid-column: {c};">{name}</div>
		{/each}
		<div class="cell" style="grid-column: {col};" data-note={note.n} data-fn="shift">
			<DeviceSlider
				value={shift}
				title={signed(shift, scaled ? 'sd' : 'st')}
				min={-SHIFT_MAX}
				max={SHIFT_MAX}
				centerOrigin
				centerValue={0}
				travel={SHIFT_TRAVEL}
				isGhost={chord.isGhost}
				color={ink}
				readout={chord.paramDisplay(shiftIndex)}
				onInteraction={(v) => chord.sendParam(shiftIndex, Math.round(v))}
			/>
		</div>
		<div class="cell" class:silent style="grid-column: {col + 1};" data-note={note.n} data-fn="velocity">
			<DeviceSlider
				value={value(note.velocity)}
				title={percent(value(note.velocity))}
				min={VELOCITY_MIN}
				max={2}
				isGhost={chord.isGhost}
				color={ink}
				readout={chord.paramDisplay(note.velocity)}
				onInteraction={(v) => chord.sendParam(note.velocity, v)}
			/>
		</div>
		<div class="cell" class:silent style="grid-column: {col + 2};" data-note={note.n} data-fn="chance">
			<DeviceSlider
				value={value(note.chance)}
				title={percent(value(note.chance))}
				min={0}
				max={1}
				isGhost={chord.isGhost}
				color={ink}
				readout={chord.paramDisplay(note.chance)}
				onInteraction={(v) => chord.sendParam(note.chance, v)}
			/>
		</div>
	{/each}

	<div class="seam" style="grid-column: 8;"><SectionDivider orientation="vertical" /></div>

	<button
		class="physical-button switch"
		class:active={!chord.isGhost && scaled}
		class:slot-ghost={chord.isGhost}
		aria-pressed={scaled}
		data-fn="scale"
		onclick={() => chord.sendParam(P.scale, scaled ? 0 : 1)}
	>Scale</button>
	{#each STRUM as b, i (b.index)}
		<div class="cell" style="grid-column: {9 + i};" data-fn={b.title.toLowerCase()}>
			<DeviceSlider
				value={value(b.index)}
				title={b.title}
				min={b.min}
				max={b.max}
				centerOrigin
				centerValue={0}
				isGhost={chord.isGhost}
				color={ink}
				readout={chord.paramDisplay(b.index)}
				onInteraction={(v) => chord.sendParam(b.index, b.round ? Math.round(v) : v)}
			/>
		</div>
	{/each}
</div>

<style>
	/* Nine tall value boxes on one ruler: each note's three under its name and
	   their captions, a seam, the strum's three under the Scale switch. */
	.chord-layout {
		display: grid;
		grid-template-columns:
			repeat(3, minmax(0, 1fr)) auto
			repeat(3, minmax(0, 1fr)) auto
			repeat(3, minmax(0, 1fr));
		grid-template-rows: auto auto minmax(0, 1fr);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
		column-gap: var(--central-gap);
		row-gap: 4px;
	}
	.cell {
		grid-row: 3;
		display: flex;
		min-width: 0;
		min-height: 0;
		margin-top: calc(var(--central-gap) - 4px);
	}
	.cell > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	/* A note at 0 adds nothing: its velocity and chance step back. */
	.cell.silent,
	.caption.silent {
		opacity: var(--opacity-ghost);
	}
	.group-head {
		grid-row: 1;
		text-align: center;
		font-size: 0.75rem;
		color: var(--btn-tint);
	}
	.caption {
		grid-row: 2;
		text-align: center;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.seam {
		grid-row: 1 / -1;
		display: flex;
	}
	.switch {
		grid-column: 9 / span 3;
		grid-row: 1 / span 2;
		min-height: var(--height-touch);
		font-size: 1rem;
		font-weight: 600;
	}

	:global([data-grammar="flat"]) .switch {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .switch.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
