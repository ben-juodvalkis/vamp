<script lang="ts">
	/**
	 * RandomCentralView — the Random MIDI effect's own view (MidiRandom).
	 * Chance, the `random` control (`deviceControls`, ADR-479), then the rest
	 * of the device (the user, 2026-10-26: "more params"):
	 *
	 *   Chance [Chance] | Notes [Choices] [Interval] | Sign [Add Sub Bi] |
	 *   Mode [Rnd Alt, Scale]
	 *
	 * On the face grid (ADR-510), sections [2, 2, 1, 1]: six columns of
	 * about 142px, Chance two, Choices and Interval a large knob each.
	 *
	 * Measured on the rig (device_dump on the set's "Random Octave",
	 * 2026-10-26): 1 Chance 0..1, 2 Choices 1..24, 3 Interval 1..24, 4 Sign
	 * 0..2 (Add, Sub, Bi), 5 Mode 0..1 (Rnd, Alt), 6 Use Current Scale 0..1.
	 * Choices and Interval are value boxes (ADR-477), each labelled with its
	 * current value at all times (the user, the same day), Sign and Mode pick-one
	 * tabs as the Variation view draws them, Scale a switch. A ghost draws
	 * Live's defaults, and its first write loads the device.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import ControlTile from '../../device-panel/ControlTile.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const random = useFxGridSlot('random');

	let ink = $derived({
		primary: trackInk(random.color.primary, paintModeReactive()),
		secondary: random.color.secondary,
		accent: trackInk(random.color.accent, paintModeReactive())
	});

	const P = { choices: 2, interval: 3, sign: 4, mode: 5, scale: 6 } as const;
	/** Live's values on a fresh Random, what a ghost shows. */
	const REST: Record<number, number> = { 2: 12, 3: 1, 4: 0, 5: 0, 6: 0 };
	const value = (index: number) => random.paramValue(index) ?? REST[index];
	const step = (index: number) => Math.round(value(index));

	const BOXES = [
		{ index: P.choices, title: 'Choices' },
		{ index: P.interval, title: 'Interval' }
	];
	const SIGNS = ['Add', 'Sub', 'Bi'];
	const MODES = ['Rnd', 'Alt'];
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="random-layout" data-view="random" style="--btn-tint: {ink.primary};">
	<FaceGrid sections={[2, 2, 1, 1]}>
		<!-- Chance: the `random` control. A drag loads a ghost; a tap loads nothing (ADR-167). -->
		<FaceSection span={2}>
			{#snippet head()}<PanelEyebrow title="Chance" color={ink.primary} />{/snippet}
			<div class="col face-span-2">
				<ControlTile type="random" device={random.device} disableCentralViewOnTap />
			</div>
		</FaceSection>
		<FaceSeam ink={ink.primary} />

		<FaceSection span={2}>
			{#snippet head()}<PanelEyebrow title="Notes" color={ink.primary} />{/snippet}
			{#each BOXES as box (box.index)}
				<div class="col boxes" class:slot-ghost={random.isGhost}>
					<DeviceSlider
						value={value(box.index)}
						title={box.title}
						valueText={String(step(box.index))}
						steps={24}
						face="knob"
						knobSize="l"
						orientation="vertical"
						min={1}
						max={24}
						isGhost={random.isGhost}
						color={ink}
						onInteraction={(v) => random.sendParam(box.index, Math.round(Math.max(1, Math.min(24, v))))}
					/>
				</div>
			{/each}
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
							onclick={() => random.sendParam(P.sign, i)}
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
							onclick={() => random.sendParam(P.mode, i)}
						>{label}</button>
					{/each}
				</div>
				<button
					class="physical-button scale"
					class:active={step(P.scale) === 1}
					aria-pressed={step(P.scale) === 1}
					onclick={() => random.sendParam(P.scale, step(P.scale) === 1 ? 0 : 1)}
				>Scale</button>
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): six equal columns, Chance two. */
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
	.boxes > :global(*) {
		flex: 1 1 0;
	}

	.tabs {
		flex: 3 1 0;
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
	.scale {
		flex: 1 1 0;
		font-size: 1rem;
		font-weight: 600;
	}

	/* As the Variation view's tabs: the name in the device ink, the lit one filled with it. */
	:global([data-skin="hybrid"]) .tab {
		color: var(--btn-tint);
	}
	:global(.light[data-skin="hybrid"]) .tab {
		color: color-mix(in oklab, var(--btn-tint) 55%, var(--foreground));
	}
	:global([data-grammar="flat"]) .tab,
	:global([data-grammar="flat"]) .scale {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .tab.active,
	:global([data-grammar="flat"]) .scale.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
