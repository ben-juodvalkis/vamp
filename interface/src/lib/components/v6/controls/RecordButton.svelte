<script lang="ts">
	import { captureStore } from '$lib/stores/v6/captureStore.svelte';
	import { captureSettings } from '$lib/stores/v6/captureSettingsStore.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { vampDevicesAvailable } from '$lib/services/effectSources.svelte';
	import { meterStore } from '$lib/stores/v3/meters.svelte';
	import { onDestroy } from 'svelte';

	// Shared record button — used both at the top of the browser rail
	// (sidebar) and in the Clip central view's button rail. Same
	// hold-to-record / tap-toggle behavior, same optimistic latch, and the
	// same single-dot indicator (○ idle → blinking ● while recording).
	//
	// Two separate recorders (Ben, 2026-11-13): `source="track"` records what
	// the selected track plays (the clip view's REC, through the Vamp-Capture
	// the bridge loads onto it); `source="input"` records the external input
	// Settings → Recording names (the sidebar's REC; Vamp for Mac records a
	// picked device, Vamp-Capture Live's own Ext. In). Each lights only for
	// its own take, and is greyed while the other's runs.
	//  - `meterLevel`: overrides what the fill follows. Otherwise it is always
	//    live: the selected track's meter for a track REC, the input's level
	//    for an input device, and the take's meter for Live's own input.
	//  - `shape`: `circle` (default) fits the largest circle its cell allows;
	//    `rect` fills the cell as a rounded rectangle. The browser rail uses
	//    `rect` because its slot is now a half-height band — a circle there
	//    would be sized by the SHORT axis and leave most of the 120px width
	//    empty, shrinking the target rather than just flattening it.
	let {
		source,
		meterLevel = undefined,
		shape = 'circle'
	}: {
		source: 'track' | 'input';
		meterLevel?: number;
		shape?: 'circle' | 'rect';
	} = $props();

	const HOLD_DURATION = 300;
	let holdTimeout: ReturnType<typeof setTimeout> | null = null;
	let isHolding = $state(false);
	let holdTriggered = $state(false);

	// REC needs the bridge (it loads the recorder and starts it) and a track
	// to record: the master is not one.
	let recorder = $derived(bridgeStatus.feature('captureRecorder'));
	let trackIndex = $derived(session.selectedTrackIndex);
	// A take is running, and whose: the other REC's take greys this one.
	let takeRunning = $derived(captureStore.state === 'recording' || captureStore.pending);
	let mine = $derived(!captureStore.takeSource || captureStore.takeSource === source);
	let recorderReason = $derived(
		!recorder.available
			? recorder.enabled
				? recorder.reason || 'Unavailable'
				: 'Waiting for the bridge'
			: trackIndex < 0
				? 'Select a track'
				: takeRunning && !mine
					? captureStore.takeSource === 'input'
						? 'Recording the input'
						: 'Recording the track'
					: ''
	);

	let canRecord = $derived(!recorderReason);

	function startRecording() {
		if (source === 'input') {
			captureStore.start(trackIndex, 'input', captureSettings.channel, captureSettings.deviceUid);
		} else {
			captureStore.start(trackIndex, 'track');
		}
	}

	function stopRecording() {
		captureStore.stop();
	}

	// The bridge went away: whatever the recorder last said is stale.
	$effect(() => {
		if (!recorder.available) captureStore.deviceGone();
	});

	onDestroy(() => {
		if (holdTimeout) {
			clearTimeout(holdTimeout);
			holdTimeout = null;
		}
	});

	function handlePointerDown() {
		if (!canRecord) return;
		isHolding = true;
		holdTriggered = false;

		holdTimeout = setTimeout(() => {
			holdTriggered = true;
			startRecording();
		}, HOLD_DURATION);
	}

	function handlePointerUp() {
		if (holdTimeout) {
			clearTimeout(holdTimeout);
			holdTimeout = null;
		}
		if (!canRecord) {
			isHolding = false;
			return;
		}

		if (isHolding && holdTriggered) {
			stopRecording();
		} else if (isHolding && !holdTriggered) {
			// A start still waiting for its answer (the recorder loading) is a
			// take in progress: the second tap stops it, never starts another.
			if (captureStore.state === 'idle' && !captureStore.pending) {
				startRecording();
			} else {
				stopRecording();
			}
		}
		isHolding = false;
	}

	// `pending` paints "recording" from the tap rather than the device's echo
	// (~300 ms later, longer when the recorder has to load first), so a quick
	// tap doesn't snap back to idle on release.
	let showRecording = $derived(!recorderReason && ((takeRunning && mine) || isHolding));

	// The fill is always live (Ben, 2026-11-13: "the meters should always be
	// accurate"): the selected track's meter on a track REC; on an input
	// device, that input's level from Vamp for Mac, take or no take; on Live's
	// own input, which nothing meters outside a take, the take's meter, which
	// drops to zero as it ends.
	let inputDevice = $derived(source === 'input' ? captureSettings.deviceUid : '');
	// The sidebar REC follows the rig's input, whatever this screen last knew.
	$effect(() => {
		if (source === 'input') captureStore.queryInputDevices();
	});
	$effect(() => captureStore.holdInputMonitor(inputDevice));
	let trackLevel = $derived.by(() => {
		const meter = trackIndex >= 0 ? meterStore.get(`tracks/${trackIndex}`) : undefined;
		return meter ? Math.max(meter.left, meter.right) : 0;
	});
	let fillLevel = $derived(
		meterLevel ??
			(source === 'track'
				? trackLevel
				: inputDevice
					? captureStore.inputLevelFor(inputDevice, captureSettings.channel)
					: mine && captureStore.state === 'recording'
						? captureStore.meterLevel
						: 0)
	);
	let meterHeight = $derived(fillLevel * 100);
</script>

<!-- The recorder is a Vamp Devices utility: no REC until that folder is a Place in Live. -->
{#if vampDevicesAvailable()}
<div class="record-button-fit">
	<button
		class="record-button font-bold text-3xl flex items-center justify-center select-none touch-manipulation"
		class:is-rect={shape === 'rect'}
		class:recording={showRecording}
		class:unavailable={!!recorderReason}
		aria-disabled={recorderReason ? 'true' : undefined}
		aria-label={recorderReason ? `Record — ${recorderReason}` : 'Record'}
		title={recorderReason || undefined}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointerleave={handlePointerUp}
		onpointercancel={handlePointerUp}
	>
	<!-- Meter fill behind button content (30Hz node — headroom red is in the gradient) -->
	<div class="meter-fill" style="--clip-top: {100 - meterHeight}%"></div>

	<!-- The central dot itself is the record indicator: idle it's a hollow ○;
	     while recording it fills (●) and blinks. No separate LED — the one
	     glyph carries the whole state. -->
	<span class="button-label">
			<span class="rec-glyph" class:blink={showRecording}>{showRecording ? '●' : '○'}</span>
			{#if recorderReason}<span class="rec-reason">{recorderReason}</span>{/if}
		</span>
	</button>
</div>
{/if}

<style>
	/* Perfect circle in EITHER orientation. The wrapper fills the parent cell
	   and is a size-container; the button is sized to the LARGEST square that
	   fits — `min(100cqw, 100cqh)` picks the SMALLER of the cell's two axes,
	   so a wide cell (sidebar) and a tall cell (clip-view rail) both yield a
	   circle, never a stretched pill. The wrapper centers it. */
	.record-button-fit {
		container-type: size;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.record-button {
		position: relative;
		overflow: hidden;
		border-radius: 9999px;
		width: min(100cqw, 100cqh);
		height: min(100cqw, 100cqh);
		flex-shrink: 0;
		border: 1px solid var(--act-rec-line);
		background: var(--act-rec-wash);
		color: color-mix(in oklab, var(--act-rec) 70%, transparent);
		transition: border-color 0.15s, background-color 0.15s, color 0.15s;
	}

	/* Rounded rectangle: take the whole cell instead of the largest circle
	   inside it. In a short, wide slot the circle rule throws away every
	   pixel of width past the height — as a rect the same slot is a full
	   120px-wide target, and it matches the slabs stacked under it. */
	.record-button.is-rect {
		width: 100%;
		height: 100%;
		border-radius: var(--radius-md);
	}

	.record-button:hover {
		border-color: var(--act-rec);
		color: var(--act-rec);
		background: var(--act-rec-wash);
	}

	.record-button:active { transform: scale(0.95); }

	.record-button.recording {
		border-color: var(--act-rec);
		background: var(--act-rec-wash);
		color: var(--act-rec);
	}

	/* Live skin: Live's Arrangement/Session Record button — a rectangular
	   control field with a red glyph, solid ChosenRecord with a dark glyph
	   while recording; the level ramp is Live's VU colours. */
	:global([data-grammar="flat"]) .record-button {
		border-radius: 2px;
		width: 100%;
		height: 100%;
		/* A button is framed bright in its own glyph colour (as the clip
		   view's buttons are), which a slider never is. */
		border: 1px solid var(--button-frame);
		background: var(--surface-well);
		color: var(--act-rec);
	}
	:global([data-grammar="flat"]) .record-button:hover {
		background: var(--secondary);
		border-color: var(--button-frame);
	}
	:global([data-grammar="flat"]) .record-button.recording {
		background: var(--act-rec);
		border-color: var(--act-rec);
		color: var(--flat-on-fg);
	}
	:global([data-grammar="flat"]) .meter-fill {
		background: linear-gradient(to top, #00f758 0%, #00f758 72%, #ffd100 84%, #ffd100 94%, #ff0a0a 94%, #ff0a0a 100%);
	}
	/* Flat-grammar leftovers (cookbook §8.1): the rect variant's own
	   `.is-rect` rule (radius-md → 3px under flat) outranks the block above,
	   so pin it to 2px; the glyph drops from font-bold (700) to medium; and
	   on the light ladder the solid ChosenRecord ON fill keeps a dark frame,
	   as every other ON field does. */
	:global([data-grammar="flat"]) .record-button.is-rect {
		border-radius: 2px;
	}
	:global([data-grammar="flat"]) .record-button {
		font-weight: var(--font-weight-medium);
	}
	:global(.light[data-grammar="flat"]) .record-button.recording {
		border-color: var(--line-strong);
	}

	/* 30Hz node (§7 #1): default oklch ramp with the act-rec headroom band in the
	   top 6% — NO filter / box-shadow; keep ONLY the existing 50ms clip-path smoothing. */
	.meter-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: linear-gradient(
			to top,
			color-mix(in srgb, var(--act-master), black 55%) 0%,
			var(--act-master) 70%,
			color-mix(in oklab, var(--act-master) 75%, white) 88%,
			var(--act-rec) 94%,
			var(--act-rec) 100%
		);
		clip-path: inset(var(--clip-top) 0 0 0);
		transition: clip-path 0.05s ease-out;
		opacity: 0.4;
		pointer-events: none;
		z-index: 0;
	}

	/* Recording, the button turns red, and the 40% fill over red read as
	   tan (Ben, 2026-11-13: "keep it green"): solid while recording. */
	.record-button.recording .meter-fill {
		opacity: 1;
	}

	.button-label {
		position: relative;
		z-index: 1;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
	}

	/* Nothing to record: greyed and inert, with the reason under the
	   glyph — the swap pill's grey-with-a-reason. Readable on the iPad,
	   where a title tooltip never shows. */
	.record-button.unavailable,
	:global([data-grammar="flat"]) .record-button.unavailable {
		border-color: var(--line-strong);
		background: var(--surface-well);
		color: var(--fg-tertiary);
		cursor: not-allowed;
	}
	.record-button.unavailable:active { transform: none; }
	.record-button.unavailable .rec-glyph { opacity: 0.5; }

	.rec-reason {
		max-width: 11ch;
		margin-top: 0.15rem;
		font-size: 0.6875rem;
		font-weight: var(--font-weight-medium, 500);
		line-height: 1.15;
		text-align: center;
		white-space: normal;
	}

	/* The glyph itself blinks while recording (replaces the separate LED). */
	.rec-glyph.blink {
		animation: rec-blink 1s steps(1, end) infinite;
	}

	@keyframes rec-blink {
		0%, 49.99% { opacity: 1; }
		50%, 100% { opacity: 0.15; }
	}
</style>
