<script lang="ts">
import { logger } from '$lib/utils/logger';
	import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
	import { clipReverseStore } from '$lib/stores/clipReverse.svelte';
	import { session, requireFocusedClip } from '$lib/stores/session.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import {
		sendClipDelete,
		setClipWarpMode
	} from '$lib/services/clipCommands';
	import { sampleClipToSimpler, duplicateLoop, duplicateClipToNextSlot, transposeClipUp, transposeClipDown, transposeDeviceUp, transposeDeviceDown, reverseFocusedAudioClip, setAudioClipPitch, setAudioClipGain, roundGainDisplay } from '$lib/services/clipOperations';
	import { AUDIO_CLIP_PITCH_RANGE } from '$lib/services/clipTranspose';
	import { duplicateTrackAndReset } from '$lib/services/trackOperations';
	import { selectSlot, focusSlot } from '$lib/components/v6/tracks/composables/slotActions';
	import { groupGestureStore } from '$lib/stores/v6/groupGestureStore.svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { shouldRestoreOnRelease } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
	import { press, type PressReleaseInfo } from '$lib/actions/press';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import RecordButton from '$lib/components/v6/controls/RecordButton.svelte';
	import { currentInstrumentStore } from '$lib/stores/v6/currentInstrumentStore.svelte';
	import { sequencerStore } from '$lib/stores/v6/sequencerStore.svelte';
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { meterStore } from '$lib/stores/v3/meters.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { rgbToHex } from '$lib/utils/formatters/trackFormatters';
	import { selectedTrackInk, selectedTrackScheme } from '$lib/utils/selectedTrackInk';
	import ClipEditorView from './ClipEditorView.svelte';
	import {
		VM,
		parseVmMembers,
		vmFunctionState,
		vmStateAcceptsWrites
	} from '$lib/services/drumVirtualMacros';
	import SectionDivider from '../SectionDivider.svelte';
	import X from '@lucide/svelte/icons/x';
	import { fitText } from '$lib/utils/fitText';

	let trackColor = $derived.by(() => {
		const path = selectedTrackStore.selectedTrackPath;
		if (!path) return undefined;
		const rec = v3Store.tracks.get(path);
		return rec?.color !== undefined ? rgbToHex(rec.color) : undefined;
	});

	// Subtle context wash behind the whole clip zone (the frame is already
	// track-colored via CentralDisplay.zoneAccent). Calibrated ink so it matches
	// the frame in both themes.
	let trackWash = $derived.by(() => {
		const ink = selectedTrackInk();
		return ink ? `color-mix(in oklab, ${ink} 8%, transparent)` : 'transparent';
	});

	// Clip controls follow the focused track's ink (ADR-402): every slider,
	// switch, and action well takes trackScheme / trackTint. REC and Delete are
	// the deliberate exceptions — they keep their state/danger red (--act-rec /
	// master), since "recording / destructive" must stay glanceable in a looper.
	// Cold-start fallback keeps the old quant hue.
	const CLIP_FALLBACK_SCHEME = { primary: 'var(--act-quant)', secondary: 'var(--act-quant-wash)', accent: 'var(--act-quant)' } as const;
	let trackScheme = $derived(selectedTrackScheme() ?? CLIP_FALLBACK_SCHEME);
	let trackTint = $derived(trackScheme.primary);

	let warpMode = $derived(clipPropertiesStore.warpMode);
	let instrumentType = $derived(currentInstrumentStore.type);

	async function handleTransposeUp() {
		try {
			if (trackType === 'audio') {
				await transposeClipUp();
			} else if (instrumentType === 'drumrack' || instrumentType === 'instrument-rack') {
				await transposeDeviceUp();
			} else {
				await transposeClipUp();
			}
		} catch (error) {
			logger.error('Transpose up failed:', { component: 'ClipCentralView', error });
		}
	}

	async function handleTransposeDown() {
		try {
			if (trackType === 'audio') {
				await transposeClipDown();
			} else if (instrumentType === 'drumrack' || instrumentType === 'instrument-rack') {
				await transposeDeviceDown();
			} else {
				await transposeClipDown();
			}
		} catch (error) {
			logger.error('Transpose down failed:', { component: 'ClipCentralView', error });
		}
	}

	let clipIndices = $derived(session.focusedClipIndices);
	let hasClip = $derived(clipIndices !== null);
	let trackType = $derived(selectedTrackStore.trackType);

	// Drum Rack ±12 (ADR-428, Milestone 1b): the buttons move the surface's
	// `vm.pitch` virtual macro, which `transposeDevice` reads back from the
	// property store — so this view holds the `vm.pitch` / `vm.members`
	// subscriptions while a Drum Rack is the instrument, whether or not the
	// Drum Rack view (which also subscribes them) is showing. The census
	// also disables the buttons when pitch is macro-held or has no member
	// on the kit, rather than storing a pitch nothing has.
	let drumRackPath = $derived.by(() => {
		if (instrumentType !== 'drumrack') return undefined;
		const idx = currentInstrumentStore.deviceIndex;
		if (idx === null) return undefined;
		return selectedTrackStore.devicesByPath[idx]?.devicePath;
	});
	$effect(() => {
		if (!drumRackPath) return;
		const path = drumRackPath;
		const release = [
			selectedTrackStore.subscribeProperty(path, VM.pitch),
			selectedTrackStore.subscribeProperty(path, VM.members)
		];
		return () => release.forEach((fn) => fn());
	});
	let drumPitchWritable = $derived(
		drumRackPath
			? vmStateAcceptsWrites(
					vmFunctionState(
						parseVmMembers(selectedTrackStore.propertyValue(drumRackPath, VM.members)),
						'pitch'
					)
				)
			: true
	);

	// Audio-clip PITCH slider — replaces the ±12 octave buttons for audio.
	// Bound to the clip's absolute pitch_coarse (clipPropertiesStore),
	// clamped to the slider's −24..+24 semitone range for display. The
	// setter rounds to whole semitones and optimistically updates the store.
	let pitchCoarseDisplay = $derived(Math.max(-AUDIO_CLIP_PITCH_RANGE, Math.min(AUDIO_CLIP_PITCH_RANGE, clipPropertiesStore.pitchCoarse)));
	let pitchLabel = $derived.by(() => {
		const n = Math.round(pitchCoarseDisplay);
		return n === 0 ? 'Pitch 0' : `Pitch ${n > 0 ? '+' : ''}${n}`;
	});

	// Audio-clip GAIN fader, beside Pitch: Live's normalized 0..1, labelled
	// with Live's own dB text rounded to whole dB (the curve is not linear,
	// so the UI never computes dB itself). Under a Permute
	// mute step the surface echoes the gain the step will put back, never
	// the 0 it holds the clip at, so the fader stays where the user left it.
	let gain = $derived(clipPropertiesStore.gain);
	let gainDisplay = $derived(roundGainDisplay(clipPropertiesStore.gainDisplay));


	let trackMeterLevel = $derived.by(() => {
		const trackIndex = session.selectedTrackIndex;
		if (trackIndex < 0) return 0;
		const meter = meterStore.get(`tracks/${trackIndex}`);
		return meter?.left ?? 0;
	});

	const warpModeOptions = [
		{ value: 0, label: 'Beats' },
		{ value: 4, label: 'Complex' },
		{ value: 6, label: 'Pro' }
	];

	function setWarpMode(mode: number) {
		const clipPath = requireFocusedClip();
		if (!clipPath) return;
		setClipWarpMode(clipPath, mode);
	}

	let isSampling = $state(false);
	let isReversing = $derived(clipReverseStore.isReversing);
	// Reverse and Group drive Live's own UI through the AX helper (ADR-439),
	// the owner's (`features.axHelper`, general-release plan.md §4). Off,
	// neither is drawn; on while the helper is down, both grey out with why.
	let axOn = $derived(bridgeStatus.isFeatureOn('axHelper'));
	let axReason = $derived(bridgeStatus.unavailableReason('axHelper'));
	let isDuplicatingLoop = $state(false);

	async function handleSampleToSimpler() {
		if (!hasClip || trackType !== 'audio') return;
		isSampling = true;
		try {
			await sampleClipToSimpler();
		} catch (error) {
			logger.error('Failed to sample clip:', { component: 'ClipCentralView', error });
		} finally {
			isSampling = false;
		}
	}

	function handleReverseClip() {
		if (!hasClip || trackType !== 'audio') return;
		reverseFocusedAudioClip();
	}

	async function handleDuplicateLoop() {
		if (!hasClip || trackType !== 'midi') return;
		isDuplicatingLoop = true;
		try {
			await duplicateLoop();
		} catch (error) {
			logger.error('Failed to duplicate loop:', { component: 'ClipCentralView', error });
		} finally {
			isDuplicatingLoop = false;
		}
	}

	// Dup Clip copies into the next slot down, which Live only does when
	// that slot exists and is empty; otherwise the button greys out.
	let nextSlotEmpty = $derived.by(() => {
		if (!clipIndices) return false;
		const { track, scene } = clipIndices;
		const slot = v3Store.tracks.get(`tracks/${track}`)?.slots.get(`tracks/${track}/slots/${scene + 1}`);
		return slot?.state === 'empty';
	});

	// The copy becomes the selection: the pedal aims at it and the clip view
	// shows it. Both writes queue behind the duplicate on the same wire, so
	// Live has made the clip by the time they land.
	function handleDuplicateClip() {
		if (!clipIndices || !nextSlotEmpty) return;
		const { track, scene } = clipIndices;
		duplicateClipToNextSlot();
		selectSlot(track, scene + 1);
		focusSlot(track, `tracks/${track}/slots/${scene + 1}`);
	}

	let deleteClipHolding = $state(false);
	let deleteClipHoldTimeout: ReturnType<typeof setTimeout> | null = null;
	const HOLD_DURATION = 800;

	// Duplicate-track: hold to spin off a variation track (copies the rig,
	// then empties clips + resets Permute). Hold-gated like Delete/Replace
	// since it mutates the set; isDuplicatingTrack locks during the async op.
	let dupTrackHolding = $state(false);
	let dupTrackHoldTimeout: ReturnType<typeof setTimeout> | null = null;
	let isDuplicatingTrack = $state(false);
	const DUP_TRACK_HOLD_DURATION = 800;

	function handleDupTrackStart() {
		const trackPath = selectedTrackStore.selectedTrackPath;
		if (!trackPath || isDuplicatingTrack) return;
		dupTrackHolding = true;
		dupTrackHoldTimeout = setTimeout(() => {
			if (dupTrackHolding) {
				dupTrackHolding = false;
				void runDuplicateTrack(trackPath);
			}
		}, DUP_TRACK_HOLD_DURATION);
	}

	function handleDupTrackEnd() {
		if (dupTrackHoldTimeout) { clearTimeout(dupTrackHoldTimeout); dupTrackHoldTimeout = null; }
		dupTrackHolding = false;
	}

	async function runDuplicateTrack(trackPath: string) {
		isDuplicatingTrack = true;
		try {
			await duplicateTrackAndReset(trackPath);
		} catch (error) {
			logger.error('Failed to duplicate track:', { component: 'ClipCentralView', error });
		} finally {
			isDuplicatingTrack = false;
		}
	}


	// Group: gather tracks into a Group Track. The button is the modifier
	// for as long as it's down, the way holding Cmd is: press it, tap other
	// track strips while held (TrackStrip.svelte's dispatchSectionTap
	// intercepts a strip tap into `groupGestureStore.tap` whenever this is
	// active — purely local bookkeeping, nothing sent yet), release to
	// commit, drag off to cancel. Live's LOM cannot group at all, so commit
	// drives Live's real Accessibility surface directly, once, with the
	// finished member list (see services/trackOperations.ts and
	// handlers/liveGroupTracks.js).
	//
	// **Tap latches, hold is momentary** — the same rule Solo, mute and the
	// Drum Rack pad latch already share (`shouldRestoreOnRelease`,
	// MOMENTARY_HOLD_MS), reused rather than re-invented: a genuine hold
	// needs a second finger free to tap strips while the first stays down,
	// which a mouse does not have (2026-09-20, testing on desktop). Release
	// this first press quickly and the gesture LATCHES — stays open with no
	// pointer down, so tracks can be tapped one at a time with the one
	// pointer a mouse has — and the next tap on this same button commits it.
	// Hold it (real multitouch, e.g. the iPad) and release still commits
	// directly, exactly as before. Either way, no taps at all just groups
	// the anchor.
	//
	// **Runs on `use:press`, not a hand-rolled onpointerdown/up/leave/cancel
	// (2026-09-20 fix)** — the button's own content flips the instant the
	// press starts (`groupGestureStore.active` goes true synchronously, so
	// the SVG icon is replaced by the member-count digit while the finger is
	// still down), and release listeners bound to the node itself are
	// exactly the case `press.ts` was already fixing for Solo: "capturing
	// on a reactive component whose subtree re-renders mid-drag drops
	// pointerup on desktop Chrome". Reported as "flaky, can't get it to
	// work in Chrome" — a plain click landing on this button was silently
	// producing no `pointerup` at all, leaving the gesture started but
	// never latched or committed. `use:press` binds its release listeners
	// to `window` for exactly this reason, and its own elapsed-time and
	// slop tracking replace the manual `groupPressStartedAt` timestamp and
	// the `onpointerleave` cancel, which only ever caught a drag that left
	// the button's own (small) box rather than a real drag-away gesture.
	let isCommitting = $state(false);

	function handleGroupDown() {
		if (groupGestureStore.active) return; // the closing press on an already-latched gesture
		const trackPath = selectedTrackStore.selectedTrackPath;
		if (!trackPath || isCommitting) return;
		groupGestureStore.start(trackPath, v3Store.tracks.get(trackPath)?.name ?? '');
	}

	async function handleGroupRelease(info: PressReleaseInfo) {
		if (!groupGestureStore.active) return;
		if (info.reason !== 'up') {
			// Dragged past the slop threshold, or the gesture was otherwise
			// interrupted (a cancel, or the button unmounting mid-press):
			// drop it. Nothing has touched Live yet, so there's nothing to
			// restore.
			groupGestureStore.cancel();
			return;
		}
		if (!groupGestureStore.latched && !shouldRestoreOnRelease({ elapsedMs: info.elapsedMs, reason: 'up' })) {
			// A quick first release: open, no commit yet.
			groupGestureStore.latch();
			return;
		}
		// Either a genuine hold just ended (the original gesture, unchanged),
		// or this is the closing tap on an already-latched one — both commit.
		isCommitting = true;
		try {
			await groupGestureStore.commit();
		} catch (error) {
			logger.error('Failed to commit group gesture:', { component: 'ClipCentralView', error });
		} finally {
			isCommitting = false;
		}
	}

	onDestroy(() => {
		if (deleteClipHoldTimeout) { clearTimeout(deleteClipHoldTimeout); deleteClipHoldTimeout = null; }
		if (dupTrackHoldTimeout) { clearTimeout(dupTrackHoldTimeout); dupTrackHoldTimeout = null; }
		if (groupGestureStore.active) groupGestureStore.cancel();
	});

	function handleDeleteClipStart() {
		if (!clipIndices) return;
		deleteClipHolding = true;
		deleteClipHoldTimeout = setTimeout(() => {
			if (deleteClipHolding && clipIndices) {
				sendClipDelete(`tracks/${clipIndices.track}/slots/${clipIndices.scene}`);
				deleteClipHolding = false;
			}
		}, HOLD_DURATION);
	}

	function handleDeleteClipEnd() {
		if (deleteClipHoldTimeout) { clearTimeout(deleteClipHoldTimeout); deleteClipHoldTimeout = null; }
		deleteClipHolding = false;
	}

	// Transpose is available for: MIDI clip, OR drumrack/instrument-rack without a clip (device-level).
	// On a Drum Rack the buttons write `vm.pitch`, so they are only offered
	// while the census says pitch can move (see drumPitchWritable).
	let hasTranspose = $derived(
		instrumentType === 'drumrack'
			? trackType === 'midi' && drumPitchWritable
			: hasClip ||
				(trackType === 'midi' && instrumentType === 'instrument-rack')
	);


	let permuteDevice = $derived(sequencerStore.device);
	let chance = $derived(sequencerStore.chance);
	let temperature = $derived(sequencerStore.temperature);
	// ADR-435: under a pad scope the store is the pad's Permute, and
	// Temperature does nothing there — one pitch has nothing to swap.
	let temperatureInert = $derived(sequencerStore.temperatureInert);
</script>

<!--
	One clip view: the note / audio editor across the left, and a narrow
	rail of clip controls down its right edge (2026-10-09, the user's
	call). It used to be either the editor or a full-width rail of big
	buttons, swapped by a toggle; now both are always on screen.

	The rail, left to right:
	  Dup Trk / Group · REC | (audio: Rev / to Simpler) · ±12 or Pitch · Temp over Chance
	(audio: Gain over the warp modes in the last column). Loop X2 and Dup
	Clip are a column of the editor's own toolbar; Delete is the red X on
	the editor's top-left corner. The two buttons
	that halved the loop are gone: the editor's loop braces do that job.
-->
<div class="clip-central-root h-full w-full relative" style="--clip-track-wash: {trackWash}; --clip-track-tint: {trackTint};">
<div class="outer h-full w-full p-(--central-inset)" class:no-loop={trackType !== 'audio'}>
	<!-- Loop X2 and Dup Clip act on the clip in the editor, so they are a
	     column of its toolbar, beside Fold · grid · Triplet · Quantize. -->
	{#snippet clipTools()}
		<button
			onclick={handleDuplicateLoop}
			disabled={!hasClip || isDuplicatingLoop}
			class="edit-chip"
			aria-label="Duplicate loop"
		>{isDuplicatingLoop ? '…' : 'Loop ×2'}</button>
		<button
			onclick={handleDuplicateClip}
			disabled={!hasClip || !nextSlotEmpty}
			class="edit-chip"
			aria-label="Duplicate clip to the next slot"
		>Dup Clip</button>
	{/snippet}
	<div class="editor-cell">
		<ClipEditorView color={trackColor} tools={trackType === 'midi' ? clipTools : undefined} />
		<!-- Delete: a red X on the editor's top-left corner, over the clip
		     it deletes. Still an 800ms hold; the fill shows the hold. -->
		<button
			onpointerdown={handleDeleteClipStart}
			onpointerup={handleDeleteClipEnd}
			onpointerleave={handleDeleteClipEnd}
			onpointercancel={handleDeleteClipEnd}
			disabled={!hasClip}
			class="delete-x"
			class:holding={deleteClipHolding}
			aria-label="Delete clip (hold)"
			title="Hold to delete the clip"
		>
			{#if deleteClipHolding}<div class="hold-fill" style="animation-duration:{HOLD_DURATION}ms; background: color-mix(in oklab, var(--act-rec), transparent 55%);"></div>{/if}
			<X class="relative z-10 w-6 h-6" strokeWidth={3} />
		</button>
	</div>
	<div class="seam seam-editor"><SectionDivider orientation="vertical" /></div>

	{#if browser}
		<!-- Dup Trk top + Group bottom: both restructure the set around the
		     track you are looking at. -->
		<div class="col col-track">
			<!-- Without the AX helper there is no Group, and Dup Trk takes the
			     column's whole height. -->
			<div class="stacked-btns" class:single={!axOn}>
				<div class="btn-cell">
					<button
						onpointerdown={handleDupTrackStart}
						onpointerup={handleDupTrackEnd}
						onpointerleave={handleDupTrackEnd}
						onpointercancel={handleDupTrackEnd}
						disabled={isDuplicatingTrack}
						class="btn btn-switch dup-trk-btn clip-switch relative overflow-hidden font-bold text-base {dupTrackHolding ? 'active' : ''} {isDuplicatingTrack ? 'cursor-wait' : ''}"
					>
						{#if dupTrackHolding}<div class="hold-fill" style="animation-duration:{DUP_TRACK_HOLD_DURATION}ms; background: color-mix(in oklab, var(--clip-track-tint, var(--act-quant)) 30%, transparent);"></div>{/if}
						<span class="relative z-10 flex items-center justify-center btn-caps" aria-label="Duplicate track">
							{#if isDuplicatingTrack}
								...
							{:else if dupTrackHolding}
								Hold...
							{:else}
								<!-- Source track lane copied down to a duplicate lane (with notes + a + cue) -->
								<svg class="w-9 h-9" fill="none" viewBox="0 0 32 28" style="transform: rotate(-90deg)">
									<!-- source lane -->
									<rect x="3" y="1.5" width="26" height="9" rx="1.5" stroke="currentColor" stroke-width="2" />
									<rect x="6" y="4.5" width="6" height="3" rx="0.75" fill="currentColor" />
									<rect x="14" y="4.5" width="4" height="3" rx="0.75" fill="currentColor" />
									<rect x="20" y="4.5" width="6" height="3" rx="0.75" fill="currentColor" />
									<!-- duplicate arrow -->
									<path d="M16 12.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
									<path d="M12.5 14.5l3.5 3 3.5-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
									<!-- duplicate lane -->
									<rect x="3" y="19.5" width="26" height="9" rx="1.5" stroke="currentColor" stroke-width="2" stroke-dasharray="2.5 2" />
									<rect x="6" y="22.5" width="6" height="3" rx="0.75" fill="currentColor" fill-opacity="0.55" />
									<rect x="14" y="22.5" width="4" height="3" rx="0.75" fill="currentColor" fill-opacity="0.55" />
									<rect x="20" y="22.5" width="6" height="3" rx="0.75" fill="currentColor" fill-opacity="0.55" />
								</svg>
							{/if}
						</span>
					</button>
				</div>
				{#if axOn}
				<div class="btn-cell">
					<button
						use:press={{ onDown: handleGroupDown, onRelease: handleGroupRelease, touchAction: 'none', disabled: isCommitting || !!axReason }}
						disabled={isCommitting || !!axReason}
						title={axReason || undefined}
						class="btn btn-switch dup-trk-btn clip-switch group-btn relative overflow-hidden font-bold text-base {groupGestureStore.active ? 'active' : ''} {isCommitting ? 'cursor-wait' : ''}"
					>
						<span class="relative z-10 flex items-center justify-center btn-caps" aria-label={groupGestureStore.latched ? 'Group tracks — tap tracks, then tap here to finish' : 'Group tracks — hold, tap other tracks, release (or tap once to keep tapping with one finger)'}>
							{#if isCommitting}
								...
							{:else if groupGestureStore.active}
								{groupGestureStore.memberPaths.size}
							{:else}
								<!-- Two lanes gathered inside one bracket: the group track -->
								<svg class="w-9 h-9" fill="none" viewBox="0 0 32 28" style="transform: rotate(-90deg)">
									<!-- the bracket that closes around them -->
									<path d="M9 3H5.5A1.5 1.5 0 0 0 4 4.5v19A1.5 1.5 0 0 0 5.5 25H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
									<!-- the tracks it gathers -->
									<rect x="13" y="5" width="15" height="7" rx="1.5" stroke="currentColor" stroke-width="2" />
									<rect x="13" y="16" width="15" height="7" rx="1.5" stroke="currentColor" stroke-width="2" />
									<rect x="16" y="7.5" width="5" height="2" rx="0.5" fill="currentColor" />
									<rect x="16" y="18.5" width="5" height="2" rx="0.5" fill="currentColor" />
								</svg>
							{/if}
						</span>
					</button>
				</div>
				{/if}
			</div>
		</div>

		<!-- REC, the column's full height. -->
		<div class="col col-rec">
			<div class="stacked-btns single">
				<div class="btn-cell">
					<RecordButton
						armTrackIndex={session.selectedTrackIndex}
						meterLevel={trackMeterLevel}
					/>
				</div>
			</div>
		</div>

		<!-- What acts on the track and the clip | what shapes what it plays. -->
		<div class="seam seam-a"><SectionDivider orientation="vertical" /></div>

		<!-- Rev + to Simpler (audio only; a MIDI clip's Loop X2 and Dup Clip
		     are in the editor's toolbar). Without the AX helper there is no
		     Reverse, and to Simpler takes the column's whole height. -->
		{#if trackType === 'audio'}
		<div class="col col-loop">
			<div class="stacked-btns" class:single={!axOn}>
				{#if axOn}
				<div class="btn-cell">
							<button
								onclick={handleReverseClip}
								disabled={!hasClip || isReversing || !!axReason}
								class="btn btn-well fam-monitor font-bold {isReversing ? 'cursor-wait' : ''}"
								aria-label={axReason ? `Reverse clip — ${axReason}` : 'Reverse clip'}
								title={axReason || undefined}
							>{#if isReversing}...{:else}<span class="flex items-center justify-center gap-1 btn-caps"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M11 19l-7-7 7-7M19 12H4" /></svg>Rev</span>{/if}</button>
				</div>
				{/if}
				<div class="btn-cell">
						<button
							onclick={handleSampleToSimpler}
							disabled={!hasClip || isSampling}
							class="btn btn-well fam-monitor font-bold {isSampling ? 'cursor-wait' : ''}"
							aria-label="Sample to Simpler"
						>{#if isSampling}...{:else}<span class="flex flex-col items-center leading-tight btn-caps fit-label" style:--fit-pad="0px" use:fitText={'to Simpler'}><span>to</span><span>Simpler</span></span>{/if}</button>
				</div>
			</div>
		</div>
		{/if}

		<!-- ±12 (MIDI) / +12 · Pitch · −12 (audio). -->
		<div class="col col-pitch transition-opacity duration-200 {trackType === 'audio' && !hasClip ? 'opacity-30' : 'opacity-100'}">
			{#if trackType === 'audio'}
				<!-- Thirds: +12 over the slider over −12. The buttons jump
					 the slider an octave and stop at its ends. -->
				<div class="stacked-btns thirds">
					<div class="btn-cell">
						<button
							onclick={() => setAudioClipPitch(pitchCoarseDisplay + 12)}
							disabled={!hasClip || pitchCoarseDisplay >= AUDIO_CLIP_PITCH_RANGE}
							class="btn btn-well fam-quant"
						>+12</button>
					</div>
					<div class="slider-cell">
						<DeviceSlider
							value={pitchCoarseDisplay}
							title={pitchLabel}
							icon="transpose"
							orientation="vertical"
							labelOrientation="horizontal"
							color={trackScheme}
							min={-AUDIO_CLIP_PITCH_RANGE}
							max={AUDIO_CLIP_PITCH_RANGE}
							centerOrigin={true}
							centerValue={0}
							onInteraction={(val) => setAudioClipPitch(val)}
						/>
					</div>
					<div class="btn-cell">
						<button
							onclick={() => setAudioClipPitch(pitchCoarseDisplay - 12)}
							disabled={!hasClip || pitchCoarseDisplay <= -AUDIO_CLIP_PITCH_RANGE}
							class="btn btn-well fam-quant"
						>−12</button>
					</div>
				</div>
			{:else}
				<div class="stacked-btns">
					<div class="btn-cell">
						<button
							onclick={handleTransposeUp}
							disabled={!hasTranspose}
							class="btn btn-well fam-quant"
						>+12</button>
					</div>
					<div class="btn-cell">
						<button
							onclick={handleTransposeDown}
							disabled={!hasTranspose}
							class="btn btn-well fam-quant"
						>−12</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Temp over Chance (MIDI) / Gain over the warp modes (audio): the
		     two that set how the clip sounds, sharing one column. Temp is
		     dimmed and inert under a pad scope (ADR-435). -->
		<div class="col col-shape">
			{#if trackType === 'midi'}
				<div class="half transition-opacity duration-200 {(permuteDevice === null || temperatureInert) ? 'opacity-30' : 'opacity-100'}" data-temperature-inert={temperatureInert ? '' : undefined}>
					<DeviceSlider
						value={temperature}
						labelOrientation="horizontal"
						title="Temp"
						icon="temperature"
						color={trackScheme}
						onInteraction={(val) => {
							if (temperatureInert) return;
							(permuteDevice
								? sequencerStore.handleTemperatureChange
								: sequencerStore.handleTemperatureChangeGhost)(val);
						}}
					/>
				</div>
				<div class="half transition-opacity duration-200 {permuteDevice === null ? 'opacity-30' : 'opacity-100'}">
					<DeviceSlider
						value={chance}
						labelOrientation="horizontal"
						title="Chance"
						icon="chance"
						color={trackScheme}
						onInteraction={(val) => permuteDevice
							? sequencerStore.handleChanceChange(val)
							: sequencerStore.handleChanceChangeGhost(val)
						}
					/>
				</div>
			{:else if trackType === 'audio'}
				<div class="half transition-opacity duration-200 {!hasClip ? 'opacity-30' : 'opacity-100'}">
					<DeviceSlider
						value={gain}
						title="Gain"
						icon="gain"
						labelOrientation="horizontal"
						color={trackScheme}
						onInteraction={(val) => setAudioClipGain(val)}
					>
						{#snippet label()}<span class="flex flex-col items-center leading-tight"><span>Gain</span>{#if gainDisplay}<span class="gain-db">{gainDisplay}</span>{/if}</span>{/snippet}
					</DeviceSlider>
				</div>
				<div class="half transition-opacity duration-200 {!hasClip ? 'opacity-30' : 'opacity-100'}">
					<div class="stacked-switches">
						{#each warpModeOptions as option}
							<button
								onclick={() => setWarpMode(option.value)}
								disabled={!hasClip}
								class="btn btn-switch clip-switch font-bold text-base"
								class:active={warpMode === option.value}
							><span class="fit-label" style:--fit-pad="0px" use:fitText={option.label}>{option.label}</span></button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
</div>

<style>
	.clip-central-root {
		min-height: 0;
		background: var(--clip-track-wash); /* faint track wash (lifted off inline) */
	}

	/* The editor takes whatever width the rail leaves. The rail is narrow
	   columns at one fixed width (`--rail-w`) with two hairline seams:
	   editor | Dup Trk · REC | (audio: Rev) · Pitch · Temp/Chance. */
	.outer {
		--rail-w: 4.5rem;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto repeat(2, var(--rail-w)) auto repeat(3, var(--rail-w));
		grid-template-rows: 1fr;
		gap: var(--central-gap);
		min-height: 0;
		overflow: hidden;
		align-items: stretch;
	}

	.col { min-height: 0; min-width: 0; display: flex; flex-direction: column; grid-row: 1; }
	.seam { grid-row: 1; display: flex; align-items: stretch; }
	.editor-cell { grid-column: 1; grid-row: 1; min-width: 0; min-height: 0; position: relative; }
	.seam-editor { grid-column: 2; }
	.col-track { grid-column: 3; }
	.col-rec { grid-column: 4; }
	.seam-a { grid-column: 5; }
	.col-loop { grid-column: 6; }
	.col-pitch { grid-column: 7; }
	.col-shape { grid-column: 8; gap: var(--central-gap); }
	/* MIDI: no Rev / to Simpler column, so Pitch and Temp/Chance move left. */
	.outer.no-loop {
		grid-template-columns: minmax(0, 1fr) auto repeat(2, var(--rail-w)) auto repeat(2, var(--rail-w));
	}
	.outer.no-loop .col-pitch { grid-column: 6; }
	.outer.no-loop .col-shape { grid-column: 7; }

	/* Delete: a red X over the editor's top-left corner (the corner of the
	   ruler and the key gutter), a 40px square so a finger can hold it. */
	.delete-x {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 30;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-strong);
		background: var(--surface-well);
		color: var(--act-rec);
		cursor: pointer;
		touch-action: manipulation;
	}
	.delete-x:disabled { color: var(--flat-disabled-fg, var(--muted-foreground)); cursor: default; }
	.delete-x.holding { border-color: var(--act-rec); }
	:global([data-grammar="flat"]) .delete-x { border-radius: 2px; }


	/* Temp over Chance (Gain over warp on audio): two equal halves. */
	.half { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }

	/* Full-height stack of 3 switch buttons (warp modes) */
	/* `minmax(0, 1fr)`, not the implicit `auto` column: auto sizes to the
	   widest label's min-content, so "Complex" held the warp column wider
	   than its share and pushed it into the seam beside it. The buttons drop their side padding for the same
	   reason — the label gets the whole cell. */
	.stacked-switches {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: var(--central-gap);
		flex: 1;
		min-height: 0;
	}
	/* Each switch is its own container, so its `.fit-label` word measures the
	   button it is in (app.css) — "Complex" in a narrow warp column. */
	.stacked-switches .btn-switch { padding-inline: 0; min-width: 0; container-type: inline-size; }

	/* Two-row stack for button columns */
	.stacked-btns {
		display: grid;
		grid-template-rows: 1fr 1fr;
		gap: var(--central-gap);
		flex: 1;
		min-height: 0;
	}
	/* One button the column's full height (Loop X2 / Reverse since it left
	   Replace behind) — same cell machinery, one row. */
	.stacked-btns.single { grid-template-rows: 1fr; }
	/* +12 · Pitch · −12: the slider takes half the column, so its label
	   still fits in a rail this narrow. */
	.stacked-btns.thirds { grid-template-rows: 1fr 2fr 1fr; }
	.slider-cell { display: flex; flex-direction: column; min-height: 0; min-width: 0; }

	/* Each cell centres its button — container-type:size lets the button use cqw/cqh */
	.btn-cell {
		container-type: size;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		min-width: 0;
	}

	/* Shared button styles — always circular: size = min(cell-width, cell-height) */
	.btn {
		border-radius: 9999px;
		width: min(100cqw, 100cqh);
		height: min(100cqw, 100cqh);
		border: 1px solid;
		font-weight: 700;
		font-size: 1.125rem;
		transition: background-color 0.15s, border-color 0.15s, color 0.15s;
		touch-action: manipulation;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.btn:active { transform: scale(0.96); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	/* Upper-case caption spans (Rev / Hold…) — GRATICULE caps them in CSS;
	   the literals are authored mixed-case. */
	.btn-caps { text-transform: uppercase; }
	/* Live's dB text under the Gain title: smaller, steady digits. */
	.gain-db { font-size: 0.75em; font-variant-numeric: tabular-nums; white-space: nowrap; }

	/* §5.5 button-rail wells — each circular rail button is a recessed well
	   (surface-well bed, inset top-shadow) ringed by a 1px function-family
	   border. Families: rec, monitor (duplicate/replace), quant (grid/clip-trim/
	   transpose), del (master-deep). Dead-flat: no glow, no gradient. */
	.btn-well {
		background: var(--surface-well);
		border: 1px solid var(--fam-color, var(--line-strong));
		color: var(--fam-color, var(--foreground));
		box-shadow: inset 0 1px 0 oklch(0 0 0 / 0.5);
		transition: background-color var(--t-fast) var(--ease-precise),
		            border-color var(--t-fast) var(--ease-precise),
		            color var(--t-fast) var(--ease-precise),
		            transform var(--t-fast) var(--ease-precise);
	}
	.btn-well:hover:not(:disabled) {
		background: color-mix(in oklab, var(--fam-color) 12%, var(--surface-well));
	}
	/* Monitor + quant wells follow the focused track (ADR-402); REC keeps
	   its recording red, a state signal. */
	.fam-monitor { --fam-color: var(--clip-track-tint, var(--act-monitor)); }
	.fam-quant { --fam-color: var(--clip-track-tint, var(--act-quant)); }

	/* Track-tinted switch/action buttons (ADR-402) — warp, base grid, Dup Trk,
	   to-Simpler. Everything in the rail except REC + Delete wears the track's
	   ink, distinguished by label + active state. */
	.clip-switch {
		border: 1px solid color-mix(in oklab, var(--clip-track-tint, var(--act-quant)) 55%, transparent);
		background: color-mix(in oklab, var(--clip-track-tint, var(--act-quant)) 10%, transparent);
		color: var(--clip-track-tint, var(--act-quant));
	}
	.clip-switch:hover:not(:disabled) {
		border-color: var(--clip-track-tint, var(--act-quant));
		background: color-mix(in oklab, var(--clip-track-tint, var(--act-quant)) 20%, transparent);
	}
	.clip-switch.active {
		border-color: var(--clip-track-tint, var(--act-quant));
		background: color-mix(in oklab, var(--clip-track-tint, var(--act-quant)) 30%, var(--card));
		color: var(--foreground);
	}

	/* ---- Live skin: the clip view is Live's detail panel — flat
	   DetailViewBackground, no track wash, and every control is a
	   rectangular field on ControlBackground with a 1px dark frame:
	   OFF = light-grey glyph, ON = solid ChosenDefault with dark glyph.
	   REC / Delete keep their red glyphs (state / danger). */
	:global([data-grammar="flat"]) .clip-central-root {
		background: transparent; /* no track wash */
	}
	:global([data-grammar="flat"]) .btn {
		border-radius: 2px;
		width: 100%;
		height: 100%;
		font-weight: var(--font-weight-medium);
		font-size: 0.9375rem;
	}
	:global([data-grammar="flat"]) .btn-caps { text-transform: none; }
	/* The warp labels keep the `text-base` they ask for: at the flat .btn's
	   1.125rem "Complex" is wider than its column (see .stacked-switches). */
	:global([data-grammar="flat"]) .stacked-switches .btn-switch { font-size: 0.8125rem; }
	:global([data-grammar="flat"]) .btn-well {
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		color: var(--foreground);
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .btn-well:hover:not(:disabled) {
		background: var(--secondary);
	}
	/* Disabled = Live's idiom (ControlOffDisabledForeground on the same
	   field), not opacity — a half-transparent orange reads as a tan wash. */
	:global([data-grammar="flat"]) .btn:disabled {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
	:global([data-grammar="flat"]) .clip-switch.active:disabled {
		background: #868686;         /* ViewCheckControlDisabledOn */
		border-color: #868686;
		color: #242424;              /* ControlOnDisabledForeground */
	}
	/* The "not applicable" column dim: keep it, but not so deep that the
	   labels fall under 3:1 on the light ladder. */
	:global([data-grammar="flat"]) .clip-central-root .opacity-30 {
		opacity: 0.55;
	}
	/* Light: ON fills sit at ~1:1 luminance against the light ladder, so the
	   frame stays dark. */
	:global(.light[data-grammar="flat"]) .clip-switch.active {
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .clip-switch {
		border: 1px solid var(--line-strong);
		background: var(--surface-well);
		color: var(--foreground);
	}
	:global([data-grammar="flat"]) .clip-switch:hover:not(:disabled) {
		border-color: var(--line-strong);
		background: var(--secondary);
	}
	:global([data-grammar="flat"]) .clip-switch.active {
		border-color: var(--phosphor);
		background: var(--phosphor);
		color: var(--flat-on-fg);
	}

	/* Group is coded green (`--act-group`), not the track ink or the flat
	   skin's orange ON: the same green the strips it gathers and the banner
	   wear, so the button reads as the source of that mode. Off = green
	   glyph on the usual field; on = solid green. After the flat rules so
	   it wins them at equal specificity. */
	.clip-switch.group-btn,
	:global([data-grammar="flat"]) .clip-switch.group-btn {
		color: var(--act-group);
	}
	.clip-switch.group-btn.active,
	:global([data-grammar="flat"]) .clip-switch.group-btn.active {
		border-color: var(--act-group);
		background: var(--act-group);
		color: var(--flat-on-fg, var(--card));
	}

	/* Switch buttons (toggles/radio) are squares */
	.btn-switch {
		border-radius: var(--radius-sm);
		aspect-ratio: unset;
		width: 100%;
		height: 100%;
	}

	/* Dup Trk, Group and Sample fill their cell (no inner stack wrapper to flex them). */
	.dup-trk-btn {
		flex: 1;
		min-height: 0;
	}

	.hold-fill {
		position: absolute;
		bottom: 0; left: 0; right: 0;
		height: 0%;
		animation: holdProgress linear forwards;
		z-index: 0;
	}

	@keyframes holdProgress {
		from { height: 0%; }
		to   { height: 100%; }
	}
</style>
