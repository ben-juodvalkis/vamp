<script lang="ts">
	/**
	 * Pitch Shift's view (the `octave` slot):
	 * three pick-one tabs, as the Variation view draws them (user,
	 * 2026-10-26): Pitch (+12, +7, -5, -12, high to low), Response and
	 * Quality; then Tone, a value box (ADR-477). The grid's Pitch slider is
	 * its Mix. Indices and labels in
	 * `octaveParams.ts`, measured on the rig. On the face grid (ADR-510),
	 * four one-column sections, each named on the header line.
	 *
	 * A step on a ghost loads the device with its Mix at 50, dry and shifted
	 * both at full level, and lands it at the head of the chain, as the Pitch
	 * column did before.
	 *
	 * NO {#if device} gate - every control handles its own ghost state.
	 */
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';
	import {
		OCTAVE_PITCH_PARAM,
		OCTAVE_PITCH_STEPS,
		OCTAVE_MIX_PARAM,
		OCTAVE_RESPONSE_PARAM,
		OCTAVE_RESPONSE_STEPS,
		OCTAVE_QUALITY_PARAM,
		OCTAVE_QUALITY_STEPS,
		OCTAVE_TONE_PARAM,
		OCTAVE_TONE_MAX
	} from '$lib/components/v6/device-panel/octaveParams';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const octave = useFxGridSlot('octave');
	const octaveChain = useBassChainPosition(octave, 'PitchCentralView');

	let ink = $derived(trackInk(octave.color.primary, paintModeReactive()));
	let inkScheme = $derived({
		primary: ink,
		secondary: octave.color.secondary,
		accent: trackInk(octave.color.accent, paintModeReactive())
	});

	const OCTAVE_LOAD_MIX = 50;
	function send(index: number, v: number) {
		if (octave.isGhost) {
			octaveChain.arm();
			octave.sendParam(OCTAVE_MIX_PARAM, OCTAVE_LOAD_MIX);
		}
		octave.sendParam(index, v);
	}

	const COLUMNS = [
		{ title: 'Pitch', index: OCTAVE_PITCH_PARAM, steps: OCTAVE_PITCH_STEPS.map((s) => ({ label: s.label, value: s.value })) },
		{ title: 'Response', index: OCTAVE_RESPONSE_PARAM, steps: OCTAVE_RESPONSE_STEPS.map((label, value) => ({ label, value })) },
		{ title: 'Quality', index: OCTAVE_QUALITY_PARAM, steps: OCTAVE_QUALITY_STEPS.map((label, value) => ({ label, value })) }
	];

	// The lit step is the one the device matches exactly; a ghost lights none.
	const current = (index: number) => {
		const v = octave.paramValue(index);
		return octave.isGhost || v === undefined ? null : Math.round(v);
	};
</script>

<div class="pitch-layout" data-view="octave" style="--btn-tint: {ink};">
	<FaceGrid sections={[1, 1, 1, 1]}>
		{#each COLUMNS as column (column.index)}
			<FaceSection span={1}>
				{#snippet head()}<PanelEyebrow title={column.title} color={ink} />{/snippet}
				<div class="pitch-col" class:slot-ghost={octave.isGhost}>
					<div class="pitch-stack device-segmented seg-grid" role="radiogroup" aria-label={column.title}>
						{#each column.steps as step (step.value)}
							<button
								class="device-segment pitch-btn"
								class:active={current(column.index) === step.value}
								role="radio"
								aria-checked={current(column.index) === step.value}
								onclick={() => send(column.index, step.value)}
							>{step.label}</button>
						{/each}
					</div>
				</div>
			</FaceSection>
			<FaceSeam ink={ink} />
		{/each}
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Tone" color={ink} />{/snippet}
			<div class="pitch-col tone" class:slot-ghost={octave.isGhost}>
				<DeviceSlider
					value={octave.paramValue(OCTAVE_TONE_PARAM) ?? OCTAVE_TONE_MAX}
					title="Tone"
					face="knob"
					knobSize="l"
					orientation="vertical"
					min={0}
					max={OCTAVE_TONE_MAX}
					isGhost={octave.isGhost}
					color={inkScheme}
					readout={octave.paramDisplay(OCTAVE_TONE_PARAM)}
					onInteraction={(v) => send(OCTAVE_TONE_PARAM, Math.max(0, Math.min(OCTAVE_TONE_MAX, v)))}
				/>
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): four equal columns. */
	.pitch-layout {
		height: 100%;
		width: 100%;
	}

	.pitch-col {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	.pitch-stack {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.tone {
		flex-direction: row;
	}
	.tone > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
	}

	.pitch-btn {
		flex: 1;
		min-height: 0;
		padding: 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
	}

	/* As the Variation view's tabs: the name in the device ink, the lit one
	   filled with it. */
	:global([data-skin="hybrid"]) .pitch-btn {
		color: var(--btn-tint);
	}
	:global(.light[data-skin="hybrid"]) .pitch-btn {
		color: color-mix(in oklab, var(--btn-tint) 55%, var(--foreground));
	}
	:global([data-grammar="flat"]) .pitch-btn {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .pitch-btn.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
