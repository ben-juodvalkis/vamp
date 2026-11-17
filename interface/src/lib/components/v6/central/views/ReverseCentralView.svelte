<script lang="ts">
  import { press } from '$lib/actions/press';
	/**
	 * Pitch Hack's view, titled Reverse (the `pitchHack` slot). Every
	 * parameter the device has (user, 2026-10-26: "show more params").
	 * Indices and ranges in `pitchHackParams.ts`, measured on the rig. It
	 * drew only Rate and Mix through `autopan/PitchGroup` until then.
	 *
	 * On the face grid (ADR-510), sections [2, 5, 1], eight columns of about
	 * 108px:
	 *
	 *   Reverse [Rate tab][Reverse] | Voice [Level][Recycle][Int Var]
	 *   [Coarse][Cents] | Mix [Mix]
	 *
	 * Rate and Reverse are one function, how often it turns the sound round
	 * and how much of the time, so they share a section: the Rate column as
	 * a pick-one tab (1 to 1/16 top to bottom, the Pitch view's grammar)
	 * beside the Reverse box (ADR-477), the one ridden. Voice sets its
	 * character, five knobs of one size, one to a column (ADR-509). Mix, the
	 * level, is a box past a seam at the right edge, where every view keeps
	 * it (ADR-544 rollout; it stood beside Reverse under "Amount" until then).
	 *
	 * Coarse, Cents and Int Var are whole numbers on the device (semitones,
	 * cents, semitones), so each keeps its value under its name; Level and
	 * Recycle are amounts and show none at rest (ADR-544).
	 *
	 * A write on a ghost loads the device with Dry / Wet at full, so it is
	 * heard once touched (user, 2026-10-08); on a loaded device the Mix
	 * slider owns Dry / Wet.
	 *
	 * NO {#if device} gate - every control handles its own ghost state.
	 */
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { PITCH_HACK, PITCH_HACK_RATES } from '$lib/components/v6/device-panel/pitchHackParams';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import type { KnobSize } from '$lib/components/v6/device-panel/knobLayout';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const pitchHack = useFxGridSlot('pitchHack');

	// The selected track's ink, as the slot's scheme hands it over (ADR-544).
	let inkScheme = $derived(pitchHack.color);
	let ink = $derived(inkScheme.primary);

	function send(index: number, v: number) {
		if (pitchHack.isGhost && index !== PITCH_HACK.mix.index) {
			pitchHack.sendParam(PITCH_HACK.mix.index, PITCH_HACK.mix.max);
		}
		pitchHack.sendParam(index, v);
	}

	// The lit stop is the one Rate matches exactly; a ghost lights none.
	let rate = $derived.by(() => {
		const v = pitchHack.paramValue(PITCH_HACK.rate.index);
		return pitchHack.isGhost || v === undefined ? null : Math.round(v);
	});

	type Param = { index: number; min: number; max: number; rest: number };
	// The two the device is played by, as full-height boxes: how much of
	// the time it reverses, and how much of it you hear. The rest set its
	// character, as knobs, one to a column (ADR-509). `steps` marks a whole
	// number that is not about a centre (Int Var, 0..24 st), so it keeps its
	// value as Coarse and Cents do; the writes are the same either way.
	const REVERSE = { title: 'Reverse', param: PITCH_HACK.reverse };
	const MIX = { title: 'Mix', param: PITCH_HACK.mix };
	const KNOBS: { title: string; param: Param; steps?: number }[] = [
		{ title: 'Level', param: PITCH_HACK.level },
		{ title: 'Recycle', param: PITCH_HACK.recycle },
		{ title: 'Int Var', param: PITCH_HACK.intVar, steps: PITCH_HACK.intVar.max - PITCH_HACK.intVar.min + 1 },
		{ title: 'Coarse', param: PITCH_HACK.coarse },
		{ title: 'Cents', param: PITCH_HACK.cents }
	];
</script>

{#snippet control(title: string, param: Param, face: 'slider' | 'knob', knobSize: KnobSize = 'm', steps: number | undefined = undefined, icon: 'mix' | undefined = undefined)}
	<DeviceSlider
		value={pitchHack.paramValue(param.index) ?? param.rest}
		{title}
		{face}
		{knobSize}
		{steps}
		{icon}
		orientation="vertical"
		min={param.min}
		max={param.max}
		centerOrigin={param.min < 0 && param.max > 0}
		centerValue={param.min < 0 && param.max > 0 ? 0 : undefined}
		isGhost={pitchHack.isGhost}
		color={inkScheme}
		readout={pitchHack.paramDisplay(param.index)}
		onTap={() => pitchHack.loadIfGhost()}
		onInteraction={(v) => send(param.index, Math.max(param.min, Math.min(param.max, v)))}
	/>
{/snippet}

<div class="reverse-layout" data-view="pitchHack">
	<FaceGrid sections={[2, 5, 1]}>
		<FaceSection span={2}>
			{#snippet head()}<PanelEyebrow title="Reverse" color={ink} />{/snippet}
			<div class="ph-col" class:slot-ghost={pitchHack.isGhost}>
				<div class="ph-stack device-segmented seg-grid pitch-hack-rate" role="radiogroup" aria-label="Rate">
					{#each PITCH_HACK_RATES as stop (stop.value)}
						<button
							class="device-segment ph-btn"
							class:active={rate === stop.value}
							role="radio"
							aria-checked={rate === stop.value}
							use:press={{ onPress: () => send(PITCH_HACK.rate.index, stop.value) }}
						>{stop.label}</button>
					{/each}
				</div>
			</div>
			<div class="ph-col" class:slot-ghost={pitchHack.isGhost}>
				<div class="box" data-param={REVERSE.title}>
					{@render control(REVERSE.title, REVERSE.param, 'slider')}
				</div>
			</div>
		</FaceSection>
		<FaceSeam ink={ink} />

		<FaceSection span={5}>
			{#snippet head()}<PanelEyebrow title="Voice" color={ink} />{/snippet}
			{#each KNOBS as { title, param, steps } (param.index)}
				<div class="ph-col" class:slot-ghost={pitchHack.isGhost}>
					<div class="box" data-param={title}>{@render control(title, param, 'knob', 'l', steps)}</div>
				</div>
			{/each}
		</FaceSection>
		<FaceSeam ink={ink} />

		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Mix" color={ink} />{/snippet}
			<div class="ph-col" class:slot-ghost={pitchHack.isGhost}>
				<div class="box" data-param={MIX.title}>
					{@render control(MIX.title, MIX.param, 'slider', 'm', undefined, 'mix')}
				</div>
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* The face is the FaceGrid (ADR-510): eight equal columns, Rate and
	   Reverse, a knob to a column, then Mix. */
	.reverse-layout {
		height: 100%;
		width: 100%;
	}

	.ph-col {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	.ph-stack {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.box {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
	}
	.box > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* A stop's word is a label and the chosen one on's block, by app.css's
	   own law (ADR-544): the view passes no tint. */
	.ph-btn {
		flex: 1;
		min-height: 0;
		padding: 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
	}

	:global([data-grammar="flat"]) .ph-btn {
		font-weight: var(--font-weight-medium);
	}
</style>
