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
	 *  - double-tap: delete every note on that pitch;
	 *  - hold, then drag up or down: scale every note on that pitch's
	 *    velocity, up louder, keeping their relative dynamics.
	 * "Held" is decided when the finger first moves past the slop, by how
	 * long it has been down, never by a timer: page timers are clamped to
	 * ~1 s on the rig. The highlight that says "held" is a CSS delay.
	 */

	import {
		sendModifyNotes,
		sendRemoveNotes,
		type RichNote
	} from '$lib/services/clipRichNotesService';
	import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
	import { DOUBLE_TAP_MS } from '$lib/utils/clip/warpMarkers';
	import { MOMENTARY_HOLD_MS } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
	import { createGestures } from './gestures';
	import { pitchName, VELOCITY_MAX } from './noteStyle';

	interface Props {
		lanes: PitchLane[];
		notes: RichNote[];
		padLabels: Map<number, string>;
		/** Folded lanes aren't contiguous, so each is named; unfolded, only the Cs. */
		folded: boolean;
		clipPath: string | null;
		top: number;
		width: number;
		/** A held key took its finger: the canvas stops panning with it. */
		onHoldStart: (pointerId: number) => void;
		/** The velocity scale under way, for the editor's readout. */
		scaling: { pitch: number; factor: number } | null;
	}

	let {
		lanes,
		notes,
		padLabels,
		folded,
		clipPath,
		top,
		width,
		onHoldStart,
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
	} | null>(null);
	let velScale = $state<{
		pitch: number;
		factor: number;
		members: { noteId: number; velocity: number }[];
	} | null>(null);
	let lastKeyTap: { pitch: number; at: number } | null = null;

	$effect(() => {
		scaling = velScale ? { pitch: velScale.pitch, factor: velScale.factor } : null;
	});

	function handleKeyDown(event: PointerEvent, pitch: number) {
		if (clipPath === null || keyPress !== null) return;
		keyPress = {
			pointerId: event.pointerId,
			pitch,
			x: event.clientX,
			y: event.clientY,
			at: performance.now(),
			moved: false
		};
		beginGesture(onKeyMove, onKeyEnd);
	}

	function onKeyMove(event: PointerEvent) {
		const kp = keyPress;
		if (kp === null || event.pointerId !== kp.pointerId) return;
		const dy = event.clientY - kp.y;
		if (velScale === null) {
			if (Math.hypot(event.clientX - kp.x, dy) <= KEY_SLOP_PX) return;
			kp.moved = true;
			if (performance.now() - kp.at < MOMENTARY_HOLD_MS) {
				// A drag straight away is a pan; leave it to the canvas.
				keyPress = null;
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

	function onKeyEnd() {
		const kp = keyPress;
		const vs = velScale;
		keyPress = null;
		velScale = null;
		if (kp === null || clipPath === null) return;
		if (vs !== null) {
			const specs = [];
			for (const m of vs.members) {
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
			return;
		}
		// A tap: not moved, and not held (a hold that lets go is nothing).
		const now = performance.now();
		if (kp.moved || now - kp.at >= MOMENTARY_HOLD_MS) {
			lastKeyTap = null;
			return;
		}
		const prev = lastKeyTap;
		if (prev && prev.pitch === kp.pitch && now - prev.at <= DOUBLE_TAP_MS) {
			lastKeyTap = null;
			deletePitch(kp.pitch);
		} else {
			lastKeyTap = { pitch: kp.pitch, at: now };
		}
	}

	function deletePitch(pitch: number) {
		if (clipPath === null) return;
		const ids = notes.filter((n) => n.pitch === pitch).map((n) => n.noteId);
		if (ids.length === 0) return;
		focusedNotesStore.optimisticRemove(ids);
		const real = ids.filter((id) => id >= 0);
		if (real.length > 0) sendRemoveNotes(clipPath, real);
	}
</script>

<div class="pitch-gutter" style="top: {top}px; width: {width}px; --key-hold-ms: {MOMENTARY_HOLD_MS}ms;">
	{#each lanes as lane (lane.pitch)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="key"
			class:black={lane.black}
			class:pressed={keyPress?.pitch === lane.pitch && !keyPress.moved}
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
