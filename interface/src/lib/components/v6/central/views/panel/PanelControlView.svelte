<script lang="ts">
	/**
	 * One control of an instrument panel (ADR-487), bound to its parameter by
	 * name: a value box over the parameter's own range (centre-origin when
	 * the range spans 0), a stepping box for a quantized parameter with many
	 * values, a column of cells for one with few, or an on/off switch. Raw
	 * values in and out: the box sweeps the parameter's range, so nothing
	 * here converts. A parameter the device does not list draws ghosted and
	 * inert; one in a switched-off section draws ghosted and, touched, turns
	 * the section on.
	 */
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import { choiceColumns, type PanelControl } from './panelTypes';
	import type { PanelParams } from './usePanelParams.svelte';

	interface Props {
		control: PanelControl;
		params: PanelParams;
		color: DeviceColorScheme;
		/** The section's switch, when the control belongs to one. */
		switchParam?: string;
		/** Rows on the page: see `choiceColumns`. */
		pageRows?: number;
	}

	let { control, params, color, switchParam, pageRows = 1 }: Props = $props();

	let listed = $derived(params.has(control.param));
	let range = $derived(params.range(control.param));
	let raw = $derived(params.raw(control.param));
	// A section that is off ghosts its controls; its own switch stays lit.
	let sectionOff = $derived(control.param !== switchParam && !params.isOn(switchParam));
	let ghost = $derived(!listed || sectionOff);

	let lo = $derived(range?.min ?? 0);
	let hi = $derived(range?.max ?? 1);
	let bipolar = $derived(lo < 0 && hi > 0);
	let step = $derived(raw === undefined ? undefined : Math.round(raw - lo));

	function write(value: number) {
		if (!listed) return;
		params.write(control.param, value, control.param === switchParam ? undefined : switchParam);
	}
</script>

{#if control.kind === 'box'}
	<div class="panel-control" class:ghost data-param={control.param}>
		<DeviceSlider
			value={raw ?? lo}
			title={control.title}
			labelAt="top"
			min={lo}
			max={hi}
			centerOrigin={bipolar}
			centerValue={bipolar ? 0 : undefined}
			isGhost={!listed}
			{color}
			readout={params.display(control.param)}
			onInteraction={write}
		/>
	</div>
{:else if control.kind === 'step'}
	{@const name = control.title}
	{@const shown = step === undefined ? '' : (control.labels?.[step] ?? String(Math.round(raw ?? 0)))}
	<div class="panel-control" class:ghost data-param={control.param}>
		<DeviceSlider
			value={raw ?? lo}
			title={`${name} ${shown}`}
			labelAt="top"
			min={lo}
			max={hi}
			isGhost={!listed}
			{color}
			onInteraction={(v) => {
				const next = Math.round(v);
				if (next !== Math.round(raw ?? lo)) write(next);
			}}
		>
			{#snippet label()}
				<span class="step-label"><span class="step-name">{name}</span><span class="step-value">{shown}</span></span>
			{/snippet}
		</DeviceSlider>
	</div>
{:else if control.kind === 'choice'}
	<div
		class="device-segmented panel-choice"
		class:ghost
		style="--btn-tint: {color.primary}; grid-template-columns: repeat({choiceColumns(control.options.length, pageRows)}, minmax(0, 1fr)); grid-template-rows: repeat({Math.ceil(control.options.length / choiceColumns(control.options.length, pageRows))}, minmax(0, 1fr)); grid-auto-flow: column;"
		role="group"
		aria-label={control.param}
		data-param={control.param}
	>
		{#each control.options as option, i (option)}
			<button
				class="device-segment panel-choice-option"
				class:active={listed && step === i}
				aria-pressed={listed && step === i}
				disabled={!listed}
				onclick={() => write(lo + i)}
			><span class="option-text">{option}</span></button>
		{/each}
	</div>
{:else}
	{@const on = listed && (raw ?? 0) >= 0.5}
	<button
		class="physical-button panel-switch"
		class:active={on}
		class:ghost={!listed}
		aria-pressed={on}
		disabled={!listed}
		style="--btn-tint: {color.primary};"
		data-param={control.param}
		onclick={() => write(on ? lo : hi)}
	>{control.title}</button>
{/if}

<style>
	.panel-control {
		display: flex;
		min-width: 0;
		min-height: 0;
		height: 100%;
	}
	.panel-control > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	.ghost {
		opacity: var(--opacity-ghost);
	}

	/* A stepping box names the parameter over the value it steps through. */
	.step-label {
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1.15;
		text-align: center;
	}
	.step-name {
		font-size: 0.75em;
		opacity: 0.8;
	}
	.step-value {
		font-size: 0.85em;
	}

	.panel-choice {
		display: grid;
		min-width: 0;
		min-height: 0;
		height: 100%;
	}
	.panel-choice-option + .panel-choice-option {
		border-top: 0;
	}
	/* Each option its own cell, edged, so a grid of them reads as cells. */
	.panel-choice-option {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 0;
		padding: 2px 4px;
		font-size: 0.75rem;
		line-height: 1.1;
		text-align: center;
		box-shadow: inset 0 0 0 0.5px var(--line-faint);
	}
	.option-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.panel-switch {
		min-width: 0;
		min-height: 0;
		height: 100%;
		font-size: 0.9375rem;
	}

	:global([data-grammar='flat']) .panel-choice .device-segment.active,
	:global([data-grammar='flat']) .panel-switch.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}
	:global([data-grammar='flat']) .panel-choice .device-segment:not(.active),
	:global([data-grammar='flat']) .panel-switch:not(.active) {
		color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
	}
	:global([data-grammar='flat']) .panel-switch {
		font-weight: var(--font-weight-medium);
	}
</style>
