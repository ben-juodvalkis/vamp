<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * The Chord's view: all of the device (the user, 2026-10-27: "set up the
	 * central view to give us more control").
	 *
	 *   Notes                               | Strum
	 *   [Shift 1] [Velocity] [Chance]       | [Strum]     [Tension]
	 *   [Shift 2] [Velocity] [Chance]       | [Crescendo] [Scale]
	 *
	 * On the face grid (ADR-510), sections [3, 2]: five columns of about
	 * 190px and two rows, a note a row, so all nine knobs are one large size
	 * with their names beside them and the band is filled (ADR-544 rollout;
	 * until then one row of ten 85px columns, where a knob could be no
	 * larger than 70px and the row floated in the band's middle). A note's
	 * row opens with its Shift, which names the note ("Shift 1", Live's own
	 * name), with its value in Live's words under the name: it is whole
	 * semitones, so it says `discrete` and keeps its value; every other knob
	 * is an amount and shows a number only under a finger (Strum, Tension
	 * and Crescendo kept a bare "+6" or "0" until then). The Scale switch closes the
	 * strum's grid, one touch row.
	 *
	 * Two notes, not Live's six (the user, 2026-10-27: "we don't need all 6").
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
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const chord = useFxGridSlot('chord');

	// One ink (ADR-544): the selected track's, as the slot's scheme hands it over.
	let ink = $derived(chord.color);

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
		{ index: P.strum, title: 'Strum', icon: 'delay', min: -20, max: 20, round: true },
		{ index: P.tension, title: 'Tension', icon: 'shape', min: -100, max: 100, round: false },
		{ index: P.crescendo, title: 'Crescendo', icon: 'gain', min: -100, max: 100, round: false }
	] as const;
</script>

<div class="chord-layout" data-view="chord">
	<FaceGrid sections={[3, 2]}>
		<FaceSection span={3}>
			{#snippet head()}<PanelEyebrow title="Notes" color={ink.primary} />{/snippet}
			<div class="rows face-span-all">
				{#each NOTES as note (note.n)}
					{@const shiftIndex = scaled ? note.degrees : note.shift}
					{@const shift = value(shiftIndex)}
					{@const silent = Math.round(shift) === 0}
					<div class="cell" data-note={note.n} data-fn="shift">
						<DeviceSlider
							value={shift}
							title="Shift {note.n}"
							valueText={signed(shift, scaled ? 'sd' : 'st')}
							discrete
							face="knob"
							knobSize="l"
							knobFit
							icon="transpose"
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
					<div class="cell" class:silent data-note={note.n} data-fn="velocity">
						<DeviceSlider
							value={value(note.velocity)}
							title="Velocity"
							valueText={percent(value(note.velocity))}
							face="knob"
							knobSize="l"
							knobFit
							icon="velocity"
							min={VELOCITY_MIN}
							max={2}
							isGhost={chord.isGhost}
							color={ink}
							readout={chord.paramDisplay(note.velocity)}
							onInteraction={(v) => chord.sendParam(note.velocity, v)}
						/>
					</div>
					<div class="cell" class:silent data-note={note.n} data-fn="chance">
						<DeviceSlider
							value={value(note.chance)}
							title="Chance"
							valueText={percent(value(note.chance))}
							face="knob"
							knobSize="l"
							knobFit
							icon="chance"
							min={0}
							max={1}
							isGhost={chord.isGhost}
							color={ink}
							readout={chord.paramDisplay(note.chance)}
							onInteraction={(v) => chord.sendParam(note.chance, v)}
						/>
					</div>
				{/each}
			</div>
		</FaceSection>
		<FaceSeam ink={ink.primary} />

		<FaceSection span={2}>
			{#snippet head()}<PanelEyebrow title="Strum" color={ink.primary} />{/snippet}
			<div class="rows face-span-all">
				{#each STRUM as b (b.index)}
					<div class="cell" data-fn={b.title.toLowerCase()}>
						<DeviceSlider
							value={value(b.index)}
							title={b.title}
							valueText={chord.paramDisplay(b.index)}
							face="knob"
							knobSize="l"
							knobFit
							icon={b.icon}
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
				<div class="cell switch-cell">
					<button
						class="physical-button btn-toggle switch"
						class:active={!chord.isGhost && scaled}
						class:slot-ghost={chord.isGhost}
						aria-pressed={scaled}
						data-fn="scale"
						use:press={{ onPress: () => chord.sendParam(P.scale, scaled ? 0 : 1) }}
					>Scale</button>
				</div>
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): five equal columns, the notes'
	   three and the strum's two, and two rows on them, a large knob a cell
	   with its name beside it. */
	.chord-layout {
		height: 100%;
		width: 100%;
	}
	.rows {
		display: grid;
		grid-template-columns: subgrid;
		grid-template-rows: repeat(2, minmax(0, 1fr));
		row-gap: var(--face-gutter);
		min-width: 0;
		min-height: 0;
	}
	.cell {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.cell > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	/* A note at 0 adds nothing: its velocity and chance step back. */
	.cell.silent {
		opacity: var(--opacity-ghost);
	}
	/* A switch among knobs is one touch row, centred (ADR-509). */
	.switch-cell {
		flex-direction: column;
		justify-content: center;
	}
	.switch {
		flex: 0 0 var(--height-touch);
		min-height: var(--height-touch);
		font-size: 1rem;
		font-weight: 600;
	}

	:global([data-grammar="flat"]) .switch {
		font-weight: var(--font-weight-medium);
	}
</style>
