<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * Pitch Shift's view (the `octave` slot):
	 * three pick-one tabs, as the Variation view draws them (user,
	 * 2026-10-26): Pitch (+12, +7, -5, -12, high to low), Response and
	 * Quality; then Tone, a knob (ADR-509). The grid's Pitch slider is
	 * its Mix. Indices and labels in
	 * `octaveParams.ts`, measured on the rig.
	 *
	 * On the face grid (ADR-510), sections [2, 1, 1, 1], five equal columns,
	 * each named on the header line: Pitch, the one that is played, takes
	 * two, and Response, Quality and Tone, set once, one each (four equal
	 * columns until the Ink rollout, ADR-544, Tone a lone knob in a quarter
	 * of the view). A step's word is a label and the chosen one on's block.
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
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const octave = useFxGridSlot('octave');
	const octaveChain = useBassChainPosition(octave, 'PitchCentralView');

	// The selected track's ink, as the slot's scheme hands it over (ADR-544).
	let inkScheme = $derived(octave.color);
	let ink = $derived(inkScheme.primary);

	const OCTAVE_LOAD_MIX = 50;
	function send(index: number, v: number) {
		if (octave.isGhost) {
			octaveChain.arm();
			octave.sendParam(OCTAVE_MIX_PARAM, OCTAVE_LOAD_MIX);
		}
		octave.sendParam(index, v);
	}

	const COLUMNS = [
		{ title: 'Pitch', span: 2, index: OCTAVE_PITCH_PARAM, steps: OCTAVE_PITCH_STEPS.map((s) => ({ label: s.label, value: s.value })) },
		{ title: 'Response', span: 1, index: OCTAVE_RESPONSE_PARAM, steps: OCTAVE_RESPONSE_STEPS.map((label, value) => ({ label, value })) },
		{ title: 'Quality', span: 1, index: OCTAVE_QUALITY_PARAM, steps: OCTAVE_QUALITY_STEPS.map((label, value) => ({ label, value })) }
	];

	// The lit step is the one the device matches exactly; a ghost lights none.
	const current = (index: number) => {
		const v = octave.paramValue(index);
		return octave.isGhost || v === undefined ? null : Math.round(v);
	};
</script>

<div class="pitch-layout" data-view="octave">
	<FaceGrid sections={[2, 1, 1, 1]}>
		{#each COLUMNS as column (column.index)}
			<FaceSection span={column.span}>
				{#snippet head()}<PanelEyebrow title={column.title} color={ink} />{/snippet}
				<div class="pitch-col face-span-all" class:slot-ghost={octave.isGhost}>
					<div class="pitch-stack device-segmented seg-grid" role="radiogroup" aria-label={column.title}>
						{#each column.steps as step (step.value)}
							<button
								class="device-segment pitch-btn"
								class:active={current(column.index) === step.value}
								role="radio"
								aria-checked={current(column.index) === step.value}
								use:press={{ onPress: () => send(column.index, step.value) }}
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
	/* The face is the FaceGrid (ADR-510): five equal columns, Pitch two. */
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

	/* A step's word is a label and the chosen one on's block, by app.css's
	   own law (ADR-544): the view passes no tint. */
	.pitch-btn {
		flex: 1;
		min-height: 0;
		padding: 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
	}

	:global([data-grammar="flat"]) .pitch-btn {
		font-weight: var(--font-weight-medium);
	}
</style>
