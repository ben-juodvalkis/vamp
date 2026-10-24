<script lang="ts" module>
	export interface PitchLane {
		y: number;
		h: number;
		pitch: number;
		black: boolean;
	}
</script>

<script lang="ts">
	/**
	 * The pitch gutter: a mini piano key per lane, named after the Drum
	 * Rack's pads on a kit. A press on a note name still pans like the
	 * rest of the canvas (the event bubbles to it). Two gestures of its own
	 * ride on top:
	 *  - solo: at finger-down the roll shows that row alone, or, on a row
	 *    already soloed, every row again. Mute's and Solo's rule
	 *    (`momentaryPress`): let go under MOMENTARY_HOLD_MS and it latches,
	 *    at or over it the rows from before the press come back, so a hold
	 *    is momentary. A press that turns into a pan puts them back too;
	 *  - hold, then drag up or down: scale every note on that pitch's
	 *    velocity, up louder, keeping their relative dynamics (the row
	 *    stays soloed while the finger is down; the hold restores it).
	 * "Held" is decided when the finger first moves past the slop, by how
	 * long it has been down, never by a timer: page timers are clamped to
	 * ~1 s on the rig. The highlight that says "held" is a CSS delay.
	 */

	import { sendModifyNotes, type RichNote } from '$lib/services/clipRichNotesService';
	import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
	import {
		MOMENTARY_HOLD_MS,
		shouldRestoreOnRelease
	} from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
	import { createGestures } from './gestures';
	import { padInk, pitchName, VELOCITY_MAX } from './noteStyle';

	interface Props {
		lanes: PitchLane[];
		notes: RichNote[];
		padLabels: Map<number, string>;
		/** A Drum Rack pad's chain colour by note: its name wears it. */
		padColors: Map<number, string>;
		/** Folded lanes aren't contiguous, so each is named; unfolded, only the Cs. */
		folded: boolean;
		/** The rows shown alone, lit so the way back is plain. */
		soloed: number[];
		clipPath: string | null;
		top: number;
		width: number;
		/** A key took its finger for itself: the canvas stops panning with it. */
		onHoldStart: (pointerId: number) => void;
		/** Show these rows alone (none: every row). */
		onSolo: (pitches: number[]) => void;
		/** The velocity scale under way, for the editor's readout. */
		scaling: { pitch: number; factor: number } | null;
	}

	let {
		lanes,
		notes,
		padLabels,
		padColors,
		folded,
		soloed,
		clipPath,
		top,
		width,
		onHoldStart,
		onSolo,
		scaling = $bindable()
	}: Props = $props();

	const beginGesture = createGestures();

	const KEY_SLOP_PX = 8;
	const VEL_DOUBLING_PX = 120; // drag this far up to double the velocities
	let keyPress = $state<{
		pointerId: number;
		pitch: number;
		x: number;
		y: number;
		at: number;
		moved: boolean;
		/** The soloed rows before the press, put back by a hold or a pan. */
		before: number[];
		/** Became a pan: the press is the canvas's now. */
		dropped: boolean;
	} | null>(null);
	let velScale = $state<{
		pitch: number;
		factor: number;
		members: { noteId: number; velocity: number }[];
	} | null>(null);

	let soloSet = $derived(new Set(soloed));

	$effect(() => {
		scaling = velScale ? { pitch: velScale.pitch, factor: velScale.factor } : null;
	});

	function handleKeyDown(event: PointerEvent, pitch: number) {
		if (clipPath === null) return;
		if (keyPress !== null) {
			// One name at a time, as one pad latches at a time; a second
			// finger here is a fumble, not a pinch.
			event.stopPropagation();
			return;
		}
		keyPress = {
			pointerId: event.pointerId,
			pitch,
			x: event.clientX,
			y: event.clientY,
			at: performance.now(),
			moved: false,
			before: soloed,
			dropped: false
		};
		onSolo(soloSet.has(pitch) ? soloed.filter((p) => p !== pitch) : [pitch]);
		beginGesture(onKeyMove, onKeyEnd);
	}

	function onKeyMove(event: PointerEvent) {
		const kp = keyPress;
		if (kp === null || kp.dropped || event.pointerId !== kp.pointerId) return;
		const dy = event.clientY - kp.y;
		if (velScale === null) {
			if (Math.hypot(event.clientX - kp.x, dy) <= KEY_SLOP_PX) return;
			kp.moved = true;
			if (performance.now() - kp.at < MOMENTARY_HOLD_MS) {
				// A drag straight away is a pan; leave it to the canvas, and
				// the rows as they were.
				kp.dropped = true;
				onSolo(kp.before);
				return;
			}
			// Held, then moved: take the finger off the pan.
			onHoldStart(kp.pointerId);
			velScale = {
				pitch: kp.pitch,
				factor: 1,
				members: notes
					.filter((n) => n.pitch === kp.pitch && n.noteId >= 0)
					.map((n) => ({ noteId: n.noteId, velocity: n.velocity }))
			};
		}
		if (event.cancelable) event.preventDefault();
		const factor = Math.pow(2, -dy / VEL_DOUBLING_PX);
		velScale.factor = factor;
		for (const m of velScale.members) {
			focusedNotesStore.optimisticModify(m.noteId, { velocity: scaledVelocity(m.velocity, factor) });
		}
	}

	function scaledVelocity(velocity: number, factor: number): number {
		return Math.max(1, Math.min(VELOCITY_MAX, Math.round(velocity * factor)));
	}

	function onKeyEnd(event: PointerEvent): false | void {
		const kp = keyPress;
		// Another finger lifted: keep listening for this one.
		if (kp !== null && event.pointerId !== kp.pointerId) return false;
		const vs = velScale;
		keyPress = null;
		velScale = null;
		if (kp === null) return;
		if (vs !== null) commitVelocities(vs.members);
		if (kp.dropped) return;
		const restore = shouldRestoreOnRelease({
			elapsedMs: performance.now() - kp.at,
			reason: event.type === 'pointercancel' ? 'cancel' : 'up'
		});
		if (restore) onSolo(kp.before);
	}

	function commitVelocities(members: { noteId: number; velocity: number }[]) {
		if (clipPath === null) return;
		const specs = [];
		for (const m of members) {
			const n = focusedNotesStore.get(m.noteId);
			if (!n || n.velocity === m.velocity) continue;
			specs.push({
				noteId: n.noteId,
				pitch: n.pitch,
				startBeats: n.startBeats,
				durationBeats: n.durationBeats,
				velocity: n.velocity,
				mute: n.mute
			});
		}
		if (specs.length > 0) sendModifyNotes(clipPath, specs);
	}
</script>

<div class="pitch-gutter" style="top: {top}px; width: {width}px; --key-hold-ms: {MOMENTARY_HOLD_MS}ms;">
	{#each lanes as lane (lane.pitch)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="key"
			class:black={lane.black}
			class:pressed={keyPress?.pitch === lane.pitch && !keyPress.moved}
			class:soloed={soloSet.has(lane.pitch)}
			class:scaling={velScale?.pitch === lane.pitch}
			style="top: {lane.y}px; height: {lane.h}px;"
			style:--pad-ink={padLabels.has(lane.pitch) && padColors.has(lane.pitch) ? padInk(padColors.get(lane.pitch)!) : undefined}
			onpointerdown={(e) => handleKeyDown(e, lane.pitch)}
		>
			{#if padLabels.has(lane.pitch)}<span class="key-label pad-label">{padLabels.get(lane.pitch)}</span>
			{:else if folded || lane.pitch % 12 === 0}<span class="key-label">{pitchName(lane.pitch)}</span>{/if}
		</div>
	{/each}
</div>

<style>
	.pitch-gutter {
		position: absolute;
		left: 0;
		bottom: 0;
		overflow: hidden;
		border-right: 1px solid var(--line);
	}

	/* Real mini piano keys (§5.4): white keys --secondary, black keys --canvas. */
	.key {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--secondary);
		border-bottom: 1px solid var(--line-faint);
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 2px;
	}
	.key.black {
		background: var(--canvas);
	}
	/* Held long enough to scale velocities: lights after the hold time,
	   with no JS timer (page timers are clamped on the rig). */
	.key.pressed {
		animation: key-held 1ms linear var(--key-hold-ms, 300ms) forwards;
	}
	/* A row shown alone: the key wears the ON ink at a wash, so the way
	   back to every row (tap it again) is plain. */
	.key.soloed {
		background: color-mix(in oklab, var(--phosphor) 30%, var(--secondary));
		box-shadow: inset 3px 0 0 var(--phosphor);
	}
	/* A pad's row lights in its own chain colour, the name kept in it
	   (2026-10-24, the user's call: the house orange took the colour away). */
	.key.soloed:has(.pad-label) {
		/* A lighter wash than the orange's, so the name in the same ink reads
		   on it; the edge bar carries the lit state. */
		background: color-mix(in oklab, var(--pad-ink, var(--phosphor)) 18%, var(--secondary));
		box-shadow: inset 3px 0 0 var(--pad-ink, var(--phosphor));
	}
	.key.soloed .key-label.pad-label {
		color: var(--pad-ink, var(--foreground));
	}
	.key.soloed .key-label {
		color: var(--foreground);
	}
	.key.scaling {
		background: var(--phosphor);
	}
	.key.scaling:has(.pad-label) {
		background: var(--pad-ink, var(--phosphor));
	}
	.key.scaling .key-label {
		color: var(--flat-on-fg, var(--background));
	}
	@keyframes key-held {
		to {
			background: color-mix(in oklab, var(--pad-ink, var(--phosphor)) 45%, var(--secondary));
		}
	}
	.key-label {
		font-family: var(--font-mono);
		font-size: 8px;
		line-height: 1;
		color: var(--fg-tertiary);
	}
	/* A pad's name in its chain colour (`padInk`, set on the key so a
	   soloed or scaling row can light in it too). */
	.pad-label {
		color: var(--pad-ink, var(--fg-tertiary));
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	:global([data-grammar="flat"]) .pitch-gutter {
		border-right-color: var(--line-strong);
	}
</style>
