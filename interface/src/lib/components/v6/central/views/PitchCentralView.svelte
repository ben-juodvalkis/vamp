<script lang="ts">
	/**
	 * The Octave's view, Pitch Shift on the effects shelf (the `octave` slot):
	 * three pick-one tabs, as the Variation view draws them (user,
	 * 2026-10-26): Pitch (+12, +7, -5, -12, high to low), Response and
	 * Quality. The grid's Pitch slider is its Mix. Indices and labels in
	 * `octaveParams.ts`, measured on the rig.
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
		OCTAVE_QUALITY_STEPS
	} from '$lib/components/v6/device-panel/octaveParams';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const octave = useFxGridSlot('octave');
	const octaveChain = useBassChainPosition(octave, 'PitchCentralView');

	let ink = $derived(trackInk(octave.color.primary, paintModeReactive()));

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
	{#each COLUMNS as column (column.index)}
		<div class="pitch-col" class:slot-ghost={octave.isGhost}>
			<div class="pitch-head text-xs font-bold text-center pb-1">{column.title}</div>
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
	{/each}
</div>

<style>
	.pitch-layout {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
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

	.pitch-btn {
		flex: 1;
		min-height: 0;
		padding: 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
	}

	.pitch-head {
		color: var(--muted-foreground);
		font-weight: var(--font-weight-medium);
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
