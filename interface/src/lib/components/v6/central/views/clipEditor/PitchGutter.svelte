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
	 *  - tap or hold, and let go: show that row alone (`onSolo`). Fingers
	 *    on several names before the last lets go show all their rows.
	 *    The editor decides what a solo of the rows already shown means
	 *    (back to every row);
	 *  - hold, then drag up or down: scale every note on that pitch's
	 *    velocity, up louder, keeping their relative dynamics.
	 * "Held" is decided when the finger first moves past the slop, by how
	 * long it has been down, never by a timer: page timers are clamped to
	 * ~1 s on the rig. The highlight that says "held" is a CSS delay.
	 */

	import { sendModifyNotes, type RichNote } from '$lib/services/clipRichNotesService';
	import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
	import { MOMENTARY_HOLD_MS } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
	import { createGestures } from './gestures';
	import { pitchName, VELOCITY_MAX } from './noteStyle';

	interface Props {
		lanes: PitchLane[];
		notes: RichNote[];
		padLabels: Map<number, string>;
		/** Folded lanes aren't contiguous, so each is named; unfolded, only the Cs. */
		folded: boolean;
		/** The rows shown alone, lit so the way back is plain. */
		soloed: number[];
		clipPath: string | null;
		top: number;
		width: number;
		/** A key took its finger for itself: the canvas stops panning with it. */
		onHoldStart: (pointerId: number) => void;
		/** Tapped or held names, all let go: show these rows. */
		onSolo: (pitches: number[]) => void;
		/** The velocity scale under way, for the editor's readout. */
		scaling: { pitch: number; factor: number } | null;
	}

	let {
		lanes,
		notes,
		padLabels,
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

	interface KeyPress {
		pointerId: number;
		pitch: number;
		x: number;
		y: number;
		at: number;
		moved: boolean;
		/** Became a pan: no longer this gutter's. */
		dropped: boolean;
	}
	let presses = $state<KeyPress[]>([]);
	// The names pressed since the first finger landed; a solo when the last
	// lifts, unless a velocity scale spent the gesture.
	let chord = new Set<number>();
	let chordSpent = false;
	let velScale = $state<{
		pointerId: number;
		pitch: number;
		factor: number;
		members: { noteId: number; velocity: number }[];
	} | null>(null);

	let soloSet = $derived(new Set(soloed));

	$effect(() => {
		scaling = velScale ? { pitch: velScale.pitch, factor: velScale.factor } : null;
	});

	function handleKeyDown(event: PointerEvent, pitch: number) {
		if (clipPath === null || velScale !== null) return;
		const live = presses.filter((p) => !p.dropped);
		if (live.length > 0) {
			// A second name: a chord, not a pinch. Keep this finger off the
			// canvas and take the first ones off the pan.
			event.stopPropagation();
			for (const p of live) onHoldStart(p.pointerId);
		}
		const press: KeyPress = {
			pointerId: event.pointerId,
			pitch,
			x: event.clientX,
			y: event.clientY,
			at: performance.now(),
			moved: false,
			dropped: false
		};
		presses.push(press);
		chord.add(pitch);
		beginGesture(
			(e) => onKeyMove(e, press.pointerId),
			(e) => onKeyEnd(e, press.pointerId)
		);
	}

	function pressOf(pointerId: number): KeyPress | undefined {
		return presses.find((p) => p.pointerId === pointerId);
	}

	function onKeyMove(event: PointerEvent, pointerId: number) {
		const kp = pressOf(pointerId);
		if (!kp || kp.dropped || event.pointerId !== pointerId) return;
		const dy = event.clientY - kp.y;
		if (velScale === null) {
			// In a chord a finger's drift means nothing.
			if (presses.length > 1) return;
			if (Math.hypot(event.clientX - kp.x, dy) <= KEY_SLOP_PX) return;
			kp.moved = true;
			if (performance.now() - kp.at < MOMENTARY_HOLD_MS) {
				// A drag straight away is a pan; leave it to the canvas.
				kp.dropped = true;
				chord.delete(kp.pitch);
				return;
			}
			// Held, then moved: take the finger off the pan.
			onHoldStart(kp.pointerId);
			chordSpent = true;
			velScale = {
				pointerId,
				pitch: kp.pitch,
				factor: 1,
				members: notes
					.filter((n) => n.pitch === kp.pitch && n.noteId >= 0)
					.map((n) => ({ noteId: n.noteId, velocity: n.velocity }))
			};
		}
		if (velScale.pointerId !== pointerId) return;
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

	function onKeyEnd(event: PointerEvent, pointerId: number): false | void {
		// Another finger lifted: keep listening for this one.
		if (event.pointerId !== pointerId) return false;
		presses = presses.filter((p) => p.pointerId !== pointerId);
		const vs = velScale;
		if (vs !== null && vs.pointerId === pointerId) {
			velScale = null;
			commitVelocities(vs.members);
		}
		if (presses.length > 0) return;
		const pitches = [...chord];
		const spent = chordSpent;
		chord = new Set();
		chordSpent = false;
		if (!spent && pitches.length > 0 && clipPath !== null) onSolo(pitches);
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
			class:pressed={presses.some((p) => p.pitch === lane.pitch && !p.moved && !p.dropped)}
			class:soloed={soloSet.has(lane.pitch)}
			class:scaling={velScale?.pitch === lane.pitch}
			style="top: {lane.y}px; height: {lane.h}px;"
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
	.key.soloed .key-label {
		color: var(--foreground);
	}
	.key.scaling {
		background: var(--phosphor);
	}
	.key.scaling .key-label {
		color: var(--flat-on-fg, var(--background));
	}
	@keyframes key-held {
		to {
			background: color-mix(in oklab, var(--phosphor) 45%, var(--secondary));
		}
	}
	.key-label {
		font-family: var(--font-mono);
		font-size: 8px;
		line-height: 1;
		color: var(--fg-tertiary);
	}
	.pad-label {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	:global([data-grammar="flat"]) .pitch-gutter {
		border-right-color: var(--line-strong);
	}
</style>
