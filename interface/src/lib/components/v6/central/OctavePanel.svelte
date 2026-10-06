<script lang="ts">
	/**
	 * OctavePanel — the `octave` slot: Ben's Polyphonic Pitch Shifter
	 * (2026-10-05; a Helix Native before). Lived in GuitarCentralView until
	 * 2026-10-05, when it moved to the Chorus view beside Pitch Hack.
	 *
	 * Two knobs, measured off the running device: 1 Semitones, -12..12 in
	 * whole steps; 2 Mix, 0..100, where 50 is dry and shifted both at full
	 * level and 100 the shifted sound alone. The pitch is a four-way tab
	 * rather than a fader: the four intervals are the only useful stops,
	 * listed top-down as they draw.
	 */

	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { selectDevice, moveDeviceToTop, moveDeviceToEnd } from '$lib/services/deviceMoveService';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Check from '@lucide/svelte/icons/check';
	import Droplet from '@lucide/svelte/icons/droplet';
	import X from '@lucide/svelte/icons/x';
	import { logger } from '$lib/utils/logger';
	import { drag } from '$lib/actions';
	import type { DragInfo } from '$lib/actions/drag';
	import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

	const octave = useFxGridSlot('octave');

	const OCTAVE_PITCH_PARAM = 1;
	const OCTAVE_MIX_PARAM = 2;
	const PITCH_STEPS = [
		{ label: '+12', value: 12 },
		{ label: '+7', value: 7 },
		{ label: '-5', value: -5 },
		{ label: '-12', value: -12 }
	];
	let octaveMix = $derived(octave.paramValue(OCTAVE_MIX_PARAM) ?? 0);
	let octavePitch = $derived(octave.paramValue(OCTAVE_PITCH_PARAM) ?? 12);
	// The step nearest the device's value, so a pitch set by hand in the
	// plug-in still lights the closest stop.
	let pitchStep = $derived(
		PITCH_STEPS.reduce(
			(best, step, i) =>
				Math.abs(step.value - octavePitch) < Math.abs(PITCH_STEPS[best].value - octavePitch) ? i : best,
			0
		)
	);

	let octaveInk = $derived({
		primary: trackInk(octave.color.primary, paintModeReactive()),
		secondary: octave.color.secondary,
		accent: trackInk(octave.color.accent, paintModeReactive())
	});

	// A browser load lands at the END of the chain; an octave pedal belongs
	// at its head, ahead of the amp. `useBassChainPosition` is that one-shot
	// rule (the Bass tile's too). Arm it before any gesture that might load.
	const octaveChain = useBassChainPosition(octave, 'OctavePanel');
	const armOctaveLoad = () => octaveChain.arm();

	// The device saves -12 as its Semitones; a load from here starts an
	// octave UP instead (user, 2026-10-05). On a ghost slot the write is
	// pending and rides the load. A pitch tap writes its own value instead.
	const OCTAVE_LOAD_PITCH = 12;
	function loadOctaveUp() {
		if (octave.isGhost) octave.sendParam(OCTAVE_PITCH_PARAM, OCTAVE_LOAD_PITCH);
	}

	function setPitch(step: number) {
		armOctaveLoad();
		octave.sendParam(OCTAVE_PITCH_PARAM, PITCH_STEPS[step].value);
	}

	// The tab SCRUBS, like the Glue stepped rows in SquashCentralView: the
	// stack owns one pointer and resolves the step under it from geometry,
	// so a finger slides between intervals. The box is measured at press.
	let pitchBox: ScrubBox | null = null;

	function pitchScrub(clientY: number) {
		if (!pitchBox) return;
		const step = segmentIndex(clientY, pitchBox.top, pitchBox.height, PITCH_STEPS.length);
		if (step === pitchStep && !octave.isGhost) return;
		setPitch(step);
	}

	function pitchDown(info: DragInfo) {
		pitchBox = scrubBoxOf(info.event?.currentTarget as Element | null);
		pitchScrub(info.y);
	}

	// The reorder arrows are the TRACK chain's, the same rule
	// `BaseDeviceControl` states: a pad's chain is its instrument and an
	// effect or two, so "first position" there would put an audio effect
	// ahead of the instrument. Hidden under a scope — and `armOctaveLoad`
	// declines to arm there for the same reason.
	let showOctaveMove = $derived(octave.device !== null && octave.scope === null);

	let isMovingOctaveLeft = $state(false);
	let moveOctaveLeftResult = $state<'idle' | 'success' | 'error'>('idle');
	let isMovingOctaveRight = $state(false);
	let moveOctaveRightResult = $state<'idle' | 'success' | 'error'>('idle');

	function moveButtonClasses(isMoving: boolean, result: 'idle' | 'success' | 'error') {
		const base = 'octave-move-btn rounded transition-colors duration-200';
		if (result === 'success') return `${base} move-ok`;
		if (result === 'error') return `${base} move-err`;
		if (isMoving) return `${base} text-muted-foreground`;
		return `${base} text-muted-foreground hover:text-foreground cursor-pointer`;
	}

	async function moveOctave(edge: 'top' | 'end') {
		const path = octave.devicePath;
		const busy = edge === 'top' ? isMovingOctaveLeft : isMovingOctaveRight;
		if (busy || !path) return;
		if (edge === 'top') isMovingOctaveLeft = true;
		else isMovingOctaveRight = true;
		const settle = (result: 'success' | 'error') => {
			if (edge === 'top') moveOctaveLeftResult = result;
			else moveOctaveRightResult = result;
			setTimeout(() => {
				if (edge === 'top') moveOctaveLeftResult = 'idle';
				else moveOctaveRightResult = 'idle';
			}, 1000);
		};
		try {
			await (edge === 'top' ? moveDeviceToTop(path) : moveDeviceToEnd(path));
			await selectDevice(path);
			settle('success');
		} catch (error) {
			logger.error('Failed to move the octave device', {
				component: 'OctavePanel',
				edge,
				error
			});
			settle('error');
		} finally {
			if (edge === 'top') isMovingOctaveLeft = false;
			else isMovingOctaveRight = false;
		}
	}
</script>

<div class="octave-panel" style="--btn-tint: {octaveInk.primary};">
	<!-- The arrows FLANK the title rather than sitting absolute in the
	     panel's corners the way BaseDeviceControl's do: this column is
	     narrow and a corner button would land on top of the label. Left =
	     head of the chain, right = end, the same bearing they have on every
	     FX tile. -->
	<div class="octave-head">
		{#if showOctaveMove}
			<button
				class={moveButtonClasses(isMovingOctaveLeft, moveOctaveLeftResult)}
				onclick={() => moveOctave('top')}
				disabled={isMovingOctaveLeft || moveOctaveLeftResult !== 'idle'}
				aria-label="Move octave device to first position"
			>
				{#if isMovingOctaveLeft}
					<div class="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full"></div>
				{:else if moveOctaveLeftResult === 'success'}
					<Check class="w-3 h-3" />
				{:else if moveOctaveLeftResult === 'error'}
					<X class="w-3 h-3" />
				{:else}
					<ArrowLeft class="w-3 h-3" />
				{/if}
			</button>
		{/if}
		<span class="octave-title" style="color: {octaveInk.primary};">Octave</span>
		{#if showOctaveMove}
			<button
				class={moveButtonClasses(isMovingOctaveRight, moveOctaveRightResult)}
				onclick={() => moveOctave('end')}
				disabled={isMovingOctaveRight || moveOctaveRightResult !== 'idle'}
				aria-label="Move octave device to last position"
			>
				{#if isMovingOctaveRight}
					<div class="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full"></div>
				{:else if moveOctaveRightResult === 'success'}
					<Check class="w-3 h-3" />
				{:else if moveOctaveRightResult === 'error'}
					<X class="w-3 h-3" />
				{:else}
					<ArrowRight class="w-3 h-3" />
				{/if}
			</button>
		{/if}
	</div>
	<div class="octave-body">
		<div class="octave-fader">
			<DeviceSlider
				value={octaveMix}
				title="Mix"
				icon={Droplet}
				orientation="vertical"
				labelOrientation="horizontal"
				labelSize="small"
				isGhost={octave.isGhost}
				color={octaveInk}
				min={0}
				max={100}
				onTap={() => {
					armOctaveLoad();
					loadOctaveUp();
				}}
				onInteraction={(val) => {
					armOctaveLoad();
					loadOctaveUp();
					octave.sendParam(OCTAVE_MIX_PARAM, val);
				}}
			/>
		</div>
		<!-- The house segmented control (app.css .device-segmented), the
		     Glue stepped rows' component stood upright: +12 at the top,
		     -12 at the bottom. -->
		<div
			class="device-segmented pitch-stack"
			class:is-ghost-tab={octave.isGhost}
			style="grid-template-rows: repeat({PITCH_STEPS.length}, 1fr);"
			use:drag={{
				commit: 'immediate',
				onDown: (info) => pitchDown(info),
				onMove: (info) => pitchScrub(info.y)
			}}
		>
			{#each PITCH_STEPS as step, i}
				<button
					class="device-segment pitch-step num"
					class:active={!octave.isGhost && pitchStep === i}
					aria-label="Octave pitch {step.label}"
					aria-pressed={!octave.isGhost && pitchStep === i}
					onclick={() => setPitch(i)}
				>{step.label}</button>
			{/each}
		</div>
	</div>
</div>

<style>
	/* A PANEL, not a bare fader: its own title and ink say "different
	   device" from its neighbours. No frame: the seam beside it is a
	   `SectionDivider`, and the fader runs the full height of the band. */
	.octave-panel {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		width: 100%;
		height: 100%;
		min-height: 0;
		min-width: 0;
	}

	/* Title row: the two reorder arrows flank the label, which keeps the
	   label centred in the column whether the arrows are drawn or not. */
	.octave-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-xs);
		flex: 0 0 auto;
		min-height: 1rem;
	}

	/* The house eyebrow for a named group in a central view. */
	.octave-title {
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		font-weight: 700;
		text-align: center;
		flex: 1 1 0;
		min-width: 0;
	}

	.octave-move-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		padding: 2px;
	}
	.octave-move-btn:disabled {
		cursor: default;
	}
	/* Status inks are tokens in every skin, the same pair
	   `BaseDeviceControl` and the Arpeggiator view flash. */
	.octave-move-btn.move-ok {
		color: var(--act-play);
	}
	.octave-move-btn.move-err {
		color: var(--act-rec);
	}

	.octave-body {
		display: flex;
		flex-direction: row;
		gap: var(--central-gap);
		flex: 1 1 0;
		min-height: 0;
	}

	.octave-fader {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
	}

	.pitch-stack {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		display: grid;
	}

	/* The stack owns the pointer; the steps are its face. Keyboard focus
	   and Enter still activate one. */
	.pitch-step {
		pointer-events: none;
		min-height: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.is-ghost-tab {
		opacity: var(--opacity-ghost);
	}

	/* One ink per device: a lit step takes the Octave's own ink rather than
	   the house --phosphor. */
	:global([data-grammar="flat"]) .pitch-step.active {
		background: var(--btn-tint);
		border-color: var(--btn-tint);
		color: var(--flat-on-fg);
	}

	:global([data-grammar="flat"]) .octave-title {
		text-transform: none;
		letter-spacing: normal;
	}
</style>
