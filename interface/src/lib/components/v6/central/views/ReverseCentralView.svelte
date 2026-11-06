<script lang="ts">
	/**
	 * Pitch Hack's view, titled Reverse (the `pitchHack` slot). Every
	 * parameter the device has (user, 2026-10-26: "show more params"): the
	 * Rate column as pick-one tabs (1 to 1/16 top to bottom, the Pitch view's
	 * grammar), then value boxes (ADR-477): Mix over Level, Reverse full
	 * height, Recycle over Int Var, Coarse over Cents. Indices and ranges in
	 * `pitchHackParams.ts`, measured on the rig. It drew only Rate and Mix
	 * through `autopan/PitchGroup` until then.
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
	import KnobGrid from '$lib/components/v6/device-panel/KnobGrid.svelte';
	import type { KnobSize } from '$lib/components/v6/device-panel/knobLayout';
	import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const pitchHack = useFxGridSlot('pitchHack');

	let ink = $derived(trackInk(pitchHack.color.primary, paintModeReactive()));
	let inkScheme = $derived({
		primary: ink,
		secondary: pitchHack.color.secondary,
		accent: trackInk(pitchHack.color.accent, paintModeReactive())
	});

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
	// The two the device is played by, as full-height boxes: how often it
	// reverses, and how much of it you hear. The rest set its character, as
	// knobs in a grid of their own (ADR-509).
	const BOXES: { title: string; param: Param }[] = [
		{ title: 'Reverse', param: PITCH_HACK.reverse },
		{ title: 'Mix', param: PITCH_HACK.mix }
	];
	const KNOBS: { title: string; param: Param }[] = [
		{ title: 'Level', param: PITCH_HACK.level },
		{ title: 'Recycle', param: PITCH_HACK.recycle },
		{ title: 'Int Var', param: PITCH_HACK.intVar },
		{ title: 'Coarse', param: PITCH_HACK.coarse },
		{ title: 'Cents', param: PITCH_HACK.cents }
	];
</script>

{#snippet control(title: string, param: Param, face: 'slider' | 'knob', knobSize: KnobSize = 'm')}
	<DeviceSlider
		value={pitchHack.paramValue(param.index) ?? param.rest}
		{title}
		{face}
		{knobSize}
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

<div class="reverse-layout" data-view="pitchHack" style="--btn-tint: {ink};">
	<div class="ph-col" class:slot-ghost={pitchHack.isGhost}>
		<div class="ph-head text-xs font-bold text-center pb-1">Rate</div>
		<div class="ph-stack device-segmented seg-grid pitch-hack-rate" role="radiogroup" aria-label="Rate">
			{#each PITCH_HACK_RATES as stop (stop.value)}
				<button
					class="device-segment ph-btn"
					class:active={rate === stop.value}
					role="radio"
					aria-checked={rate === stop.value}
					onclick={() => send(PITCH_HACK.rate.index, stop.value)}
				>{stop.label}</button>
			{/each}
		</div>
	</div>
	{#each BOXES as { title, param } (param.index)}
		<div class="ph-col boxes" class:slot-ghost={pitchHack.isGhost}>
			<div class="box" data-param={title}>
				{@render control(title, param, 'slider')}
			</div>
		</div>
	{/each}
	<SectionDivider orientation="vertical" />
	<div class="ph-knobs" class:slot-ghost={pitchHack.isGhost}>
		<KnobGrid count={KNOBS.length}>
			{#snippet item(i, size)}
				<div class="box" data-param={KNOBS[i].title}>{@render control(KNOBS[i].title, KNOBS[i].param, 'knob', size)}</div>
			{/snippet}
		</KnobGrid>
	</div>
</div>

<style>
	.reverse-layout {
		display: grid;
		/* Rate, Reverse, Mix | the knobs across two. */
		grid-template-columns: repeat(3, minmax(0, 1fr)) auto minmax(0, 2fr);
		gap: var(--central-gap);
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
	}

	.ph-col {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	.boxes {
		gap: var(--central-gap);
	}
	.ph-knobs {
		display: flex;
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

	.ph-btn {
		flex: 1;
		min-height: 0;
		padding: 0 0.25rem;
		font-size: 1rem;
		font-weight: 700;
	}

	.ph-head {
		color: var(--muted-foreground);
		font-weight: var(--font-weight-medium);
	}

	/* As the Pitch view's tabs: the name in the device ink, the lit one
	   filled with it. */
	:global([data-skin="hybrid"]) .ph-btn {
		color: var(--btn-tint);
	}
	:global(.light[data-skin="hybrid"]) .ph-btn {
		color: color-mix(in oklab, var(--btn-tint) 55%, var(--foreground));
	}
	:global([data-grammar="flat"]) .ph-btn {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .ph-btn.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
</style>
