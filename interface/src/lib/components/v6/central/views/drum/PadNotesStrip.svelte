<script lang="ts">
	/**
	 * PadNotesStrip — the scoped pad's row of the track's playing clip,
	 * under the Drum Rack view's controls (2026-10-24, the user's call).
	 * While a pad is held or latched, its notes across the clip's window
	 * (the view's `useClipPads`: the playing MIDI clip and `clipViewWindow`)
	 * are full-height blocks, as long as the notes, inked by velocity as the
	 * clip editor inks a pad's notes (`noteColor`), over the window's steps.
	 *
	 * On a note: a drag up or down moves its velocity (relative, so a touch
	 * never jumps it), a drag sideways moves it step to step (the clip
	 * editor's quantizing drag, `dragSnapStart`), whichever way the drag
	 * sets off; a quick tap deletes it, as the clip editor's does, and a
	 * press held past MOMENTARY_HOLD_MS that lets go in place does nothing.
	 * A drag writes on release.
	 *
	 * On an empty step: a tap adds a note there; a press that swipes paints
	 * a note on every step it crosses (not one already holding a note), and
	 * travel up or down, before or after, sets the velocity of every note
	 * the stroke made, past a small deadband so a sideways swipe's wobble
	 * does not. New notes are a step long at PAINT_VELOCITY; the stroke is
	 * written on release, in one add (`sendAddNotes`).
	 *
	 * One bar at a time (the clip's bars, `barBeats` off the session's time
	 * signature), 16 steps of about 48pt on the iPad; the bar button on the
	 * left, a slide up for a later bar and down for an earlier one, moves
	 * between the loop's bars, and is not drawn on a one-bar loop. The strip
	 * opens on the loop's first bar, and again whenever the clip changes.
	 *
	 * Q, at the strip's right end and only while one of the bar's notes is
	 * off a step, quantizes the
	 * pad's notes to the strip's steps, 100% (`quantizedNotes`, the clip
	 * editor's Quantize).
	 *
	 * The notes are the clip's id-carrying ones (`requestRichNotes`), read
	 * and written by clip path, which the surface takes for any clip, not
	 * only Live's focused one, so the strip needs no focus. Re-read on the
	 * clip's `notes/changed`.
	 *
	 * Nothing playing on the track: the strip is one empty bar, and the
	 * first step added there makes a one-bar MIDI clip for it and fires it
	 * (`clip/create`, in the pedal's slot when that is empty, else the
	 * track's first empty one; `slotForNewClip`), then writes the step into
	 * it. The strip keeps editing that clip while its launch is queued, and
	 * hands over to it once it plays.
	 */

	import { untrack } from 'svelte';
	import { drag, type DragInfo } from '$lib/actions';
	import { session } from '$lib/stores/session.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { sceneWindowStore } from '$lib/stores/v6/sceneWindowStore.svelte';
	import { triggeredSlotsStore } from '$lib/stores/v6/triggeredSlotsStore.svelte';
	import { sendClipCreate } from '$lib/services/clipCommands';
	import {
		requestRichNotes,
		sendAddNotes,
		sendModifyNotes,
		sendRemoveNotes,
		type RichNote
	} from '$lib/services/clipRichNotesService';
	import { subscribeNotesChanged } from '$lib/services/clipNotesService';
	import { MOMENTARY_HOLD_MS } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
	import { logger } from '$lib/utils/logger';
	import { quantizedNotes } from '$lib/utils/clip/clipGesture';
	import type { TimeRange } from '$lib/utils/waveformPaint';
	import { noteColor } from '../clipEditor/noteStyle';
	import {
		barBeats,
		barWindow,
		slideBar,
		windowBars,
		dragStart,
		dragVelocity,
		paintSteps,
		paintVelocity,
		PAINT_VELOCITY,
		slotForNewClip,
		stepTaken,
		stripBlockAt,
		stripBlocks,
		stripStepAt,
		stripStepBeats,
		stripSteps
	} from './padNotesStrip';

	interface Props {
		/** The track the kit is on: where a clip is made when nothing plays. */
		trackPath: string;
		/** The track's playing MIDI clip; '' while nothing plays. */
		clipPath: string;
		/** The time the clip shows; null while nothing plays. */
		clipWindow: TimeRange | null;
		/** The scoped pad's note. */
		note: number;
		/** The pad's ink. */
		ink: string;
	}

	let { trackPath, clipPath: playingPath, clipWindow, note, ink }: Props = $props();

	const bar = $derived(barBeats(session.timeSignature.numerator, session.timeSignature.denominator));
	// The clip this strip made, while its launch is queued: the strip
	// writes there until the track plays it (or another clip, or the track
	// changes), when the playing clip takes over again.
	let made = $state<{ trackPath: string; clipPath: string } | null>(null);
	$effect(() => {
		if (made && (playingPath || made.trackPath !== trackPath)) made = null;
	});
	const clipPath = $derived(playingPath || made?.clipPath || '');
	// Nothing playing and nothing made: one empty bar, ready for a first step.
	const draft = $derived(!clipPath);
	const loopWin = $derived(
		playingPath && clipWindow && clipWindow.end > clipWindow.start ? clipWindow : { start: 0, end: bar }
	);
	const bars = $derived(loopWin ? windowBars(loopWin, bar) : { first: 0, last: 0 });
	let barIndex = $state(0);
	$effect(() => {
		void clipPath;
		untrack(() => (barIndex = bars.first));
	});
	const shownBar = $derived(Math.min(bars.last, Math.max(bars.first, barIndex)));
	// The bar on the strip: every step, block, drag and paint below is in it.
	const win = $derived(loopWin ? barWindow(loopWin, bar, shownBar) : null);
	const multiBar = $derived(bars.last > bars.first);

	let barSlideFrom = 0;
	function barDown() {
		barSlideFrom = shownBar;
	}
	function barMove(info: DragInfo) {
		barIndex = slideBar(barSlideFrom, info.dy, bars.first, bars.last);
	}

	let notes = $state<RichNote[]>([]);

	$effect(() => {
		const cp = clipPath;
		if (!cp) {
			notes = [];
			return;
		}
		let cancelled = false;
		const load = () => {
			requestRichNotes(cp)
				.then((result) => {
					if (!cancelled) notes = result;
				})
				.catch((error: Error) => {
					if (!cancelled) logger.debug('PadNotesStrip: notes fetch failed', { clipPath: cp, error: error.message });
				});
		};
		load();
		const release = subscribeNotesChanged(cp, load);
		return () => {
			cancelled = true;
			release();
		};
	});

	// The press: the note under it, when it began, and — once the drag sets
	// off — which way and what it has made of the note so far.
	let press = $state<{
		noteId: number;
		at: number;
		axis: 'velocity' | 'move' | null;
		velocity: number;
		startBeats: number;
	} | null>(null);

	// A paint stroke on empty steps: the steps laid down so far, in the
	// order crossed, the step the finger is on, and the stroke's velocity.
	let paint = $state<{ steps: number[]; last: number; velocity: number } | null>(null);
	// Notes written but not yet back from Live carry a temp id below 0.
	let nextTempId = -1;

	const padNotes = $derived(notes.filter((n) => n.pitch === note));
	const stepBeats = $derived(win ? stripStepBeats(win.end - win.start) : 0);
	const painted = $derived(
		paint && win
			? paint.steps.map((i) => ({
					noteId: -1000 - i,
					startBeats: win.start + i * stepBeats,
					durationBeats: stepBeats,
					velocity: paint!.velocity
				}))
			: []
	);
	const blocks = $derived(
		win
			? stripBlocks(
					[
						...padNotes.map((n) =>
							press?.noteId === n.noteId
								? { ...n, velocity: press.velocity, startBeats: press.startBeats }
								: n
						),
						...painted
					],
					win
				)
			: []
	);
	const steps = $derived(win ? stripSteps(win) : []);

	let box: HTMLElement | null = $state(null);

	function fractionAt(clientX: number): number | null {
		const rect = box?.getBoundingClientRect();
		return rect && rect.width > 0 ? (clientX - rect.left) / rect.width : null;
	}

	function onDown(info: DragInfo) {
		press = null;
		paint = null;
		const f = fractionAt(info.downX);
		if (f === null || !win) return;
		const i = stripBlockAt(blocks, f);
		if (i !== null) {
			const n = padNotes.find((p) => p.noteId === blocks[i].noteId);
			if (n) press = { noteId: n.noteId, at: performance.now(), axis: null, velocity: n.velocity, startBeats: n.startBeats };
			return;
		}
		// An empty step: the stroke starts there.
		const w = win;
		const step = stripStepAt(f, w);
		paint = { steps: paintSteps([], step, step, (k) => stepTaken(padNotes, k, w)), last: step, velocity: PAINT_VELOCITY };
	}

	function onStart(info: DragInfo) {
		if (!press) {
			onMove(info);
			return;
		}
		press = { ...press, axis: Math.abs(info.dx) > Math.abs(info.dy) ? 'move' : 'velocity' };
		onMove(info);
	}

	function onMove(info: DragInfo) {
		if (paint && win) {
			const w = win;
			const f = fractionAt(info.x);
			const step = f === null ? paint.last : stripStepAt(f, w);
			paint = {
				steps: paintSteps(paint.steps, paint.last, step, (k) => stepTaken(padNotes, k, w)),
				last: step,
				velocity: paintVelocity(info.dy, info.height)
			};
			return;
		}
		if (!press || !win) return;
		const n = padNotes.find((p) => p.noteId === press?.noteId);
		if (!n) return;
		if (press.axis === 'velocity') press = { ...press, velocity: dragVelocity(n.velocity, info.dy, info.height) };
		else if (press.axis === 'move') press = { ...press, startBeats: dragStart(n.startBeats, info.dx, info.width, win) };
	}

	// The stroke, written: its notes on screen at once under temp ids, the
	// real ids swapped in when Live returns them, a re-read if it fails.
	// A one-bar clip for the strip's first step, made and fired; its path,
	// or '' when the track has no empty slot.
	function makeClip(): string {
		const track = v3Store.tracks.get(trackPath);
		const slotAt = (i: number) => `${trackPath}/slots/${i}`;
		const index = slotForNewClip(
			(i) => {
				const slot = track?.slots.get(slotAt(i));
				return !slot || (slot.state === 'empty' && !slot.clip);
			},
			sceneWindowStore.sceneCount,
			session.selectedSceneIndex
		);
		if (index === null) {
			logger.info('PadNotesStrip: no empty slot for a new clip', { trackPath });
			return '';
		}
		const slotPath = slotAt(index);
		sendClipCreate(slotPath, bar);
		triggeredSlotsStore.markPending(slotPath);
		made = { trackPath, clipPath: `${slotPath}/clip` };
		return made.clipPath;
	}

	function commitPaint() {
		const p = paint;
		paint = null;
		if (!p || !win || p.steps.length === 0) return;
		// The surface takes its messages in order: the clip exists before the notes arrive.
		const cp = clipPath || makeClip();
		if (!cp) return;
		const added: RichNote[] = p.steps.map((i) => ({
			noteId: nextTempId--,
			pitch: note,
			startBeats: win!.start + i * stepBeats,
			durationBeats: stepBeats,
			velocity: p.velocity,
			mute: false
		}));
		notes = [...notes, ...added];
		sendAddNotes(cp, added)
			.then((ids) => {
				const real = new Map(added.map((n, k) => [n.noteId, ids[k]]));
				notes = notes.map((q) => (real.has(q.noteId) && real.get(q.noteId) !== undefined ? { ...q, noteId: real.get(q.noteId)! } : q));
			})
			.catch((error: Error) => {
				logger.debug('PadNotesStrip: add failed', { clipPath: cp, error: error.message });
				const temp = new Set(added.map((n) => n.noteId));
				notes = notes.filter((q) => !temp.has(q.noteId));
			});
	}

	function onEnd() {
		if (paint) {
			commitPaint();
			return;
		}
		const p = press;
		press = null;
		// A note just painted has no id of Live's yet: nothing to write to.
		if (!p || !clipPath || p.noteId < 0) return;
		const n = notes.find((q) => q.noteId === p.noteId);
		if (!n || (p.velocity === n.velocity && p.startBeats === n.startBeats)) return;
		const moved = { ...n, velocity: p.velocity, startBeats: p.startBeats };
		// Keep the edit on screen until the re-read brings it back.
		notes = notes.map((q) => (q.noteId === p.noteId ? moved : q));
		sendModifyNotes(clipPath, [moved]);
	}

	function onTap() {
		if (paint) {
			commitPaint();
			return;
		}
		const p = press;
		press = null;
		if (!p || !clipPath || p.noteId < 0 || performance.now() - p.at >= MOMENTARY_HOLD_MS) return;
		notes = notes.filter((q) => q.noteId !== p.noteId);
		sendRemoveNotes(clipPath, [p.noteId]);
	}

	// Q: the pad's notes in the bar on the strip onto its steps, in one write.
	const offGrid = $derived(
		win ? quantizedNotes(padNotes.filter((n) => n.startBeats >= win.start && n.startBeats < win.end), stepBeats) : []
	);
	function quantize() {
		const specs = offGrid;
		if (!clipPath || specs.length === 0) return;
		const moved = new Map(specs.map((n) => [n.noteId, n]));
		notes = notes.map((q) => moved.get(q.noteId) ?? q);
		sendModifyNotes(clipPath, specs);
	}

	// What the drag is doing, for the corner readout.
	const readout = $derived.by(() => {
		if (paint && paint.steps.length > 0) {
			const n = paint.steps.length;
			return `Velocity ${paint.velocity} · ${n} ${n === 1 ? 'note' : 'notes'}`;
		}
		if (!press?.axis || !win) return null;
		if (press.axis === 'velocity') return `Velocity ${press.velocity}`;
		const step = stripStepBeats(win.end - win.start);
		return `Step ${Math.round((press.startBeats - win.start) / step) + 1}`;
	});
</script>

<div class="pad-notes-row">
{#if multiBar}
	<!-- The bar on the strip: slide up for a later bar, down for an earlier one. -->
	<div
		class="physical-button strip-bar-pick"
		use:drag={{ commit: 'y', onDown: barDown, onStart: barMove, onMove: barMove }}
		role="slider"
		tabindex="-1"
		aria-label="Bar"
		aria-valuenow={shownBar + 1}
		aria-valuemin={bars.first + 1}
		aria-valuemax={bars.last + 1}
	>
		<span class="strip-bar-word">Bar</span>
		<span class="strip-bar-num">{shownBar + 1}</span>
	</div>
{/if}
<div
	class="pad-notes-strip"
	bind:this={box}
	use:drag={{ commit: 'either', onDown, onStart, onMove, onEnd, onTap }}
	data-pad-notes={note}
	role="group"
	aria-label="The pad's notes in the playing clip: drag a note up or down for its velocity, sideways to move it, tap to delete it; tap an empty step to add one, swipe to paint several"
>
	{#if win}
		{#each steps as s}
			<div class="strip-step" class:beat={s.beat} style="left: {s.at * 100}%;"></div>
		{/each}
		{#each blocks as block (block.noteId)}
			<div
				class="strip-note"
				class:active={press?.axis && press.noteId === block.noteId}
				style="left: {block.left * 100}%; width: {block.width * 100}%; background: {noteColor(ink, block.velocity, true)};"
			></div>
		{/each}
		{#if blocks.length === 0}
			<span class="strip-msg">{draft ? 'No clip playing: add a step to start one' : 'No notes on this pad'}</span>
		{/if}
		{#if readout}
			<span class="strip-readout">{readout}</span>
		{/if}
	{/if}
</div>
{#if offGrid.length > 0}
	<!-- Only while a note in the bar is off a step: nothing to quantize, no Q. -->
	<button
		class="physical-button strip-q"
		onclick={quantize}
		title="Quantize this pad's notes to the steps"
		aria-label="Quantize this pad's notes to the steps"
	>Q</button>
{/if}
</div>

<style>
	.pad-notes-row {
		display: flex;
		gap: var(--central-gap);
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	.pad-notes-strip {
		flex: 1 1 0;
		position: relative;
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-well);
	}
	.strip-step {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: color-mix(in oklab, var(--line-strong) 60%, transparent);
		pointer-events: none;
	}
	.strip-step.beat {
		background: var(--line-strong);
	}
	/* A note, the strip's full height, as long as it is: the row of the
	   clip editor, the pad's alone. A short note keeps a fingertip's sliver. */
	.strip-note {
		position: absolute;
		top: 0;
		bottom: 0;
		min-width: 4px;
		box-sizing: border-box;
		border: 1px solid var(--surface-well);
		border-radius: 2px;
		pointer-events: none;
	}
	.strip-note.active {
		outline: 2px solid var(--foreground);
		outline-offset: -2px;
	}
	.strip-msg {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		pointer-events: none;
	}
	/* The bar button: Q's size, its number large beside the word. Stacked,
	   the two overflowed the strip's row on the smaller iPads (~36px there),
	   the word drawn on the button's top border. */
	.strip-bar-pick {
		flex: 0 0 var(--vm-slider-w, 56px);
		min-height: 0;
		display: flex;
		flex-direction: row;
		align-items: baseline;
		align-content: center;
		flex-wrap: wrap;
		justify-content: center;
		column-gap: 3px;
		cursor: ns-resize;
	}
	.strip-bar-word {
		font-size: 0.6875rem;
		color: var(--muted-foreground);
	}
	.strip-bar-num {
		font-size: 1.25rem;
		font-weight: var(--font-weight-medium);
		font-variant-numeric: tabular-nums;
	}
	/* Q: a slider's width, the strip's height. */
	.strip-q {
		flex: 0 0 var(--vm-slider-w, 56px);
		min-height: 0;
		font-size: 1.25rem;
		font-weight: var(--font-weight-medium);
	}
	.strip-readout {
		position: absolute;
		top: 4px;
		right: 6px;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		pointer-events: none;
	}
</style>
