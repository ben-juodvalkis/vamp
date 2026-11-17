<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * RandomCentralView — the Random MIDI effect's own view (MidiRandom).
	 * Chance, the `random` control (`deviceControls`, ADR-479), then the rest
	 * of the device (the user, 2026-10-26: "more params"):
	 *
	 *   Chance [Rand Oct] | Notes [Choices] [Interval] over [Scale] |
	 *   Sign [Add Sub Bi] | Mode [Rnd Alt]
	 *
	 * On the face grid (ADR-510), sections [1, 2, 1, 1]: five columns of
	 * about 190px (ADR-544 rollout; Chance took two until then, and a box
	 * wider than it is tall drew its name in the middle of its own fill and
	 * read as an empty pad at 0). Chance is the amount ridden, so a box, its
	 * mark over its name at its head; Choices and Interval are set and left,
	 * two large knobs of one size (an extra large one put its value on the
	 * switch's edge). Scale sets what
	 * Interval counts in (the current scale's degrees), so it is the switch
	 * under the two knobs, one touch row across both; it sat under Mode.
	 * Sign and Mode are pick-one tabs, every option a touch row.
	 *
	 * Measured on the rig (device_dump on the set's "Random Octave",
	 * 2026-10-26): 1 Chance 0..1, 2 Choices 1..24, 3 Interval 1..24, 4 Sign
	 * 0..2 (Add, Sub, Bi), 5 Mode 0..1 (Rnd, Alt), 6 Use Current Scale 0..1.
	 * Choices and Interval are stepped, so each keeps its value under its
	 * name (the user, 2026-10-26; ADR-544's rule for a discrete control). A
	 * ghost draws Live's defaults, and its first write loads the device.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import ControlTile from '../../device-panel/ControlTile.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const random = useFxGridSlot('random');

	// One ink (ADR-544): the selected track's, as the slot's scheme hands it over.
	let ink = $derived(random.color);

	const P = { choices: 2, interval: 3, sign: 4, mode: 5, scale: 6 } as const;
	/** Live's values on a fresh Random, what a ghost shows. */
	const REST: Record<number, number> = { 2: 12, 3: 1, 4: 0, 5: 0, 6: 0 };
	const value = (index: number) => random.paramValue(index) ?? REST[index];
	const step = (index: number) => Math.round(value(index));

	const KNOBS = [
		{ index: P.choices, title: 'Choices' },
		{ index: P.interval, title: 'Interval' }
	];
	const SIGNS = ['Add', 'Sub', 'Bi'];
	const MODES = ['Rnd', 'Alt'];
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="random-layout" data-view="random">
	<FaceGrid sections={[1, 2, 1, 1]}>
		<!-- Chance: the `random` control. A drag loads a ghost; a tap loads nothing (ADR-167). -->
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Chance" color={ink.primary} />{/snippet}
			<div class="col">
				<ControlTile type="random" device={random.device} icon="dice" disableCentralViewOnTap />
			</div>
		</FaceSection>
		<FaceSeam ink={ink.primary} />

		<FaceSection span={2}>
			{#snippet head()}<PanelEyebrow title="Notes" color={ink.primary} />{/snippet}
			<div class="notes face-span-all" class:slot-ghost={random.isGhost}>
				{#each KNOBS as knob (knob.index)}
					<div class="knob">
						<DeviceSlider
							value={value(knob.index)}
							title={knob.title}
							valueText={String(step(knob.index))}
							steps={24}
							face="knob"
							knobSize="l"
							knobFit
							orientation="vertical"
							min={1}
							max={24}
							isGhost={random.isGhost}
							color={ink}
							onInteraction={(v) => random.sendParam(knob.index, Math.round(Math.max(1, Math.min(24, v))))}
						/>
					</div>
				{/each}
				<button
					class="physical-button btn-toggle scale"
					class:active={step(P.scale) === 1}
					aria-pressed={step(P.scale) === 1}
					use:press={{ onPress: () => random.sendParam(P.scale, step(P.scale) === 1 ? 0 : 1) }}
				>Scale</button>
			</div>
		</FaceSection>
		<FaceSeam ink={ink.primary} />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Sign" color={ink.primary} />{/snippet}
			<div class="col" class:slot-ghost={random.isGhost}>
				<div class="tabs device-segmented seg-grid" role="radiogroup" aria-label="Sign">
					{#each SIGNS as label, i (label)}
						<button
							class="device-segment tab"
							class:active={!random.isGhost && step(P.sign) === i}
							role="radio"
							aria-checked={step(P.sign) === i}
							use:press={{ onPress: () => random.sendParam(P.sign, i) }}
						>{label}</button>
					{/each}
				</div>
			</div>
		</FaceSection>
		<FaceSeam ink={ink.primary} />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Mode" color={ink.primary} />{/snippet}
			<div class="col" class:slot-ghost={random.isGhost}>
				<div class="tabs device-segmented seg-grid" role="radiogroup" aria-label="Mode">
					{#each MODES as label, i (label)}
						<button
							class="device-segment tab"
							class:active={!random.isGhost && step(P.mode) === i}
							role="radio"
							aria-checked={step(P.mode) === i}
							use:press={{ onPress: () => random.sendParam(P.mode, i) }}
						>{label}</button>
					{/each}
				</div>
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): five equal columns, Notes two. */
	.random-layout {
		height: 100%;
		width: 100%;
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: var(--face-gutter);
		min-width: 0;
		min-height: 0;
	}
	.col > :global(*) {
		min-height: 0;
	}

	/* Notes: the two knobs on the face's columns, their switch under both. */
	.notes {
		display: grid;
		grid-template-columns: subgrid;
		grid-template-rows: minmax(0, 1fr) var(--height-touch);
		row-gap: var(--face-gutter);
		min-width: 0;
		min-height: 0;
	}
	.knob {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.knob > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	.scale {
		grid-column: 1 / -1;
		min-height: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.tabs {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.tab {
		flex: 1;
		min-height: 0;
		font-size: 1rem;
		font-weight: 700;
	}

	/* Ink (ADR-544): a tab's word is a label and the chosen one ON's block,
	   which app.css draws; nothing here passes a tint. */
	:global([data-grammar="flat"]) .tab,
	:global([data-grammar="flat"]) .scale {
		font-weight: var(--font-weight-medium);
	}
</style>
