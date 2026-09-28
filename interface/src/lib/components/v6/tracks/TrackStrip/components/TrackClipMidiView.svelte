<script lang="ts">
	/**
	 * TrackClipMidiView — ADR-360 (Milestone 3).
	 *
	 * Renders MIDI notes inside the track strip's loop window. Notes
	 * are pulled via `clipNotesService.requestNotes(clipPath)` once
	 * per clip, with `notes/changed` pokes triggering a re-pull.
	 *
	 * Pitch on Y axis (auto-ranged across the clip's notes), beat
	 * position on X axis. Time axis spans the visible loop window only
	 * — notes outside `[windowStart, windowEnd]` are clipped, notes
	 * straddling a boundary are truncated. The notes blob always
	 * carries the full clip's notes; windowing is render-time slicing,
	 * not server-side filtering.
	 *
	 * Playhead overlay is driven by the parent (`TrackClipView`'s
	 * `fraction` prop) so audio + MIDI views share a single rAF source.
	 *
	 * A note Live has muted (`MidiNote.mute`, carried as the sign of the
	 * blob's velocity — ADR-444) draws hollow in signal-dim, the way Live's
	 * own clip view outlines it: there, and silent. Permute's step-mute
	 * writes that same flag, so its muted steps read hollow here too.
	 */

	import {
		requestNotes,
		subscribeNotesChanged,
		type MidiNote
	} from '$lib/services/clipNotesService';
	import { logger } from '$lib/utils/logger';
	import { clipViewWindow } from '$lib/utils/waveformPaint';

	interface Props {
		/** Clip to pull notes for. Any resolvable path, not just the
		 *  playing one — `clip/notes/get` is path-keyed, which is what
		 *  lets the session grid reuse this for cells that have never
		 *  played (ADR-415). */
		clipPath: string;
		lengthBeats: number;
		loopStartBeats: number;
		loopEndBeats: number;
		/** Accepted for the caller's convenience; the window doesn't need it
		 *  (see `clipViewWindow`). */
		looping?: boolean;
		/** 0 idle / 1 playing / 2 recording. Only 2 is acted on. */
		status: number;
		fraction: number;
		/**
		 * Draw the playhead at all. Defaults true for the track strip,
		 * whose only caller is the clip that IS playing. A session-grid
		 * cell passes false for every slot but the playing one —
		 * otherwise each idle cell paints a playhead frozen at `left: 0`,
		 * which reads as "playing from the top" against its own stopped
		 * glyph.
		 */
		showPlayhead?: boolean;
		color?: string;
		dimmed?: boolean;
	}

	let {
		clipPath,
		lengthBeats,
		loopStartBeats,
		loopEndBeats,
		status,
		fraction,
		showPlayhead = true,
		color,
		dimmed = false
	}: Props = $props();

	let notes = $state<MidiNote[]>([]);
	let loadState = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');

	// Re-fetch when the displayed clip path changes — never on
	// loop-window changes (same clip, same notes; windowing is render-
	// time slicing). While `status === recording` we drop notes/changed
	// pokes (each captured note would otherwise round-trip a full notes
	// blob through the surface, freezing the UI on busy MIDI input);
	// instead we re-fetch once the moment recording ends.
	let recordingDirty = $state(false);
	let prevStatus = -1;

	$effect(() => {
		if (!clipPath) {
			notes = [];
			loadState = 'idle';
			return;
		}

		let cancelled = false;
		loadState = 'loading';

		const fetch = () => {
			requestNotes(clipPath)
				.then((result) => {
					if (cancelled) return;
					notes = result;
					loadState = 'loaded';
				})
				.catch((err: Error) => {
					if (cancelled) return;
					logger.debug('TrackClipMidiView: notes fetch failed', {
						clipPath,
						error: err.message
					});
					notes = [];
					loadState = 'error';
				});
		};

		fetch();
		const release = subscribeNotesChanged(clipPath, () => {
			if (status === 2) {
				// Recording — defer until status flips. The notes view
				// during record can be a beat or two stale; the playhead
				// is what carries the live signal.
				recordingDirty = true;
				return;
			}
			fetch();
		});
		return () => {
			cancelled = true;
			release();
		};
	});

	// On the recording → playing/stopped edge, do the deferred fetch.
	$effect(() => {
		if (prevStatus === 2 && status !== 2 && recordingDirty && clipPath) {
			recordingDirty = false;
			requestNotes(clipPath).then((result) => {
				notes = result;
				loadState = 'loaded';
			}).catch(() => {
				/* surfaced by next fetch on clipPath change */
			});
		}
		prevStatus = status;
	});

	// The window primitives arrive as props rather than being read off a
	// store entry. That is what keeps `visibleNotes` from rebuilding at
	// the 30 Hz playhead rate: an entry ref changes every tick, whereas
	// these change only on slot/loop edits. It is also what makes the
	// component reusable — the session grid has no PlayingClipEntry for
	// a slot that isn't playing.
	let mvLoopStart = $derived(loopStartBeats);
	let mvLoopEnd = $derived(loopEndBeats);
	let mvLengthBeats = $derived(lengthBeats);
	// The loop fields whether or not the clip loops — Live reports the
	// start/end markers there when it doesn't (`clipViewWindow`, the rule
	// the waveform and the playhead use too).
	let window = $derived(
		clipViewWindow({
			loopStartBeats: mvLoopStart,
			loopEndBeats: mvLoopEnd,
			lengthBeats: mvLengthBeats,
			fileStartBeats: 0,
			fileEndBeats: 0
		})
	);
	let windowStart = $derived(window.start);
	let windowEnd = $derived(window.end);
	let windowSize = $derived(windowEnd - windowStart);

	// Auto-range pitch across the visible-window subset so the lane
	// strip always uses the full vertical space. Falls back to a
	// sensible band when there are no notes in the visible window.
	let visibleNotes = $derived.by(() => {
		const out: { pitch: number; xStart: number; xEnd: number; velocity: number; muted: boolean }[] = [];
		if (windowSize <= 0) return out;
		for (const n of notes) {
			const noteEnd = n.startBeats + n.durationBeats;
			if (noteEnd <= windowStart || n.startBeats >= windowEnd) continue;
			const clippedStart = Math.max(n.startBeats, windowStart);
			const clippedEnd = Math.min(noteEnd, windowEnd);
			out.push({
				pitch: n.pitch,
				xStart: (clippedStart - windowStart) / windowSize,
				xEnd: (clippedEnd - windowStart) / windowSize,
				velocity: n.velocity,
				muted: n.muted
			});
		}
		return out;
	});

	// Lay notes into lanes by *distinct pitch* rather than by raw
	// semitone span — so a clip with two pitches gets two big lanes,
	// not two thin lines floating in mostly empty space. We still
	// guarantee a minimum lane count so a single-pitch clip doesn't
	// fill the entire strip height with one fat bar.
	const MIN_LANES = 4;

	let pitchLanes = $derived.by(() => {
		const lookup = new Map<number, number>();
		if (visibleNotes.length === 0) {
			return { lookup, laneCount: MIN_LANES };
		}
		const distinct = new Set<number>();
		for (const n of visibleNotes) distinct.add(n.pitch);
		const sortedDesc = Array.from(distinct).sort((a, b) => b - a);
		for (let i = 0; i < sortedDesc.length; i++) {
			lookup.set(sortedDesc[i], i);
		}
		const laneCount = Math.max(MIN_LANES, sortedDesc.length);
		return { lookup, laneCount };
	});

	function noteColor(velocity: number, muted: boolean): string {
		// A muted note (ADR-444) gets no track ink at all: a faint signal-dim
		// wash under the hollow ring `.midi-note--muted` draws. Velocity is
		// deliberately ignored — a silent note has no loudness to show.
		if (muted) return 'color-mix(in oklab, var(--signal-dim) 22%, transparent)';
		// GRATICULE (§5.2): velocity drives BOTH saturation (toward signal-dim)
		// and alpha — louder notes read brighter AND more saturated. The track
		// ink (already trackInk-normalized by the parent) is the hue anchor.
		// Permute muting the current step (dimmed) swaps the whole fill to grey.
		const t = Math.min(1, Math.max(0, velocity / 127));
		const satPct = Math.round((0.45 + 0.55 * t) * 100); // 45%..100% ink vs signal-dim
		const alphaPct = Math.round((0.5 + 0.5 * t) * 100); // 50%..100% opacity
		const ink = dimmed ? 'var(--signal-dim)' : color ?? 'var(--signal-dim)';
		const sat = dimmed ? ink : `color-mix(in oklab, ${ink} ${satPct}%, var(--signal-dim))`;
		return `color-mix(in oklab, ${sat} ${alphaPct}%, transparent)`;
	}
</script>

<div class="midi-lanes" role="presentation">
	{#if loadState === 'loading' && notes.length === 0}
		<div class="midi-status midi-status--loading" aria-hidden="true"></div>
	{:else if loadState === 'error' && notes.length === 0}
		<div class="midi-status midi-status--error" aria-hidden="true"></div>
	{:else if visibleNotes.length === 0}
		<div class="midi-status midi-status--empty" aria-hidden="true"></div>
	{:else}
		<!-- Deliberately UNKEYED — do not re-key this (ADR-419).
		     The key was `pitch:xStart.toFixed(6):xEnd.toFixed(6)`, and
		     toFixed(6) quantizes. A note ending a hair past `windowStart`
		     survives the `noteEnd <= windowStart` guard and clips to a width
		     around 1e-10, whose xEnd rounds to "0.000000" — identical to a
		     note that starts there. Two such notes on one pitch collide, and
		     Svelte 5 THROWS on a duplicate key rather than warning.
		     Thrown from inside flush_effects, that error wedges the effect
		     scheduler app-wide, so one drum clip froze the entire UI while
		     DOM handlers kept firing.
		     These divs are stateless and `visibleNotes` is rebuilt wholesale
		     on every fetch, so a key bought no identity to preserve. -->
		{#each visibleNotes as note}
			{@const laneIdx = pitchLanes.lookup.get(note.pitch) ?? 0}
			{@const laneHeightPct = 100 / pitchLanes.laneCount}
			<div
				class="midi-note"
				class:midi-note--muted={note.muted}
				style="
					left: {note.xStart * 100}%;
					width: {Math.max(1.5, (note.xEnd - note.xStart) * 100)}%;
					top: {laneIdx * laneHeightPct}%;
					height: {laneHeightPct}%;
					background: {noteColor(note.velocity, note.muted)};
				"
			></div>
		{/each}
	{/if}
	{#if showPlayhead}
		<div class="strip-playhead" style="left: {fraction * 100}%;" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.midi-lanes {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: var(--radius-sm);
		background: transparent;
		overflow: hidden;
	}

	.midi-note {
		position: absolute;
		min-height: 2px;
		border-radius: 1px;
		opacity: 0.85;
		pointer-events: none;
	}

	/* A muted note (ADR-444) reads as Live draws one: hollow. A 1px inset
	   ring of signal-dim over the faint wash `noteColor` gives it — no
	   track ink, so it can never be mistaken for a sounding note. On a
	   bar only 2px tall the ring fills the bar, and it still reads grey. */
	.midi-note--muted {
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--signal-dim) 70%, transparent);
	}

	.midi-status {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.midi-status--loading::after {
		content: '';
		width: 18px;
		height: 2px;
		border-radius: 1px;
		background: color-mix(in srgb, var(--muted-foreground), transparent 40%);
		animation: pulse 1s ease-in-out infinite;
	}

	.midi-status--error::after {
		content: '';
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--act-rec);
		opacity: 0.6;
	}

	.midi-status--empty::after {
		content: '';
		width: 24px;
		height: 1px;
		background: color-mix(in srgb, var(--muted-foreground), transparent 70%);
	}

	/* Playhead is the shared global .strip-playhead (phosphor-white, §4.2). */

	/* ---- Flat grammar (Live / Hybrid skins, ui-architecture §8.1) ------
	   Live's clip previews are square-cornered: the lane well takes the 2px
	   control radius and the note bars / loading dash lose their 1px
	   rounding entirely (a 2px radius on a 2px-tall bar reads as a pill).
	   The error dot stays round — dots are round in Live too. Colours are
	   untouched: the note ink already comes from the skin-aware track ink. */
	:global([data-grammar="flat"]) .midi-lanes {
		border-radius: 2px;
	}
	:global([data-grammar="flat"]) .midi-note {
		border-radius: 0;
	}
	:global([data-grammar="flat"]) .midi-status--loading::after {
		border-radius: 0;
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 0.9; }
	}
</style>
