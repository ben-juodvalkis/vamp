/**
 * useFocusedClip — everything the clip editor reads about the focused
 * clip, from the existing read paths: `clipPropertiesStore` (loop,
 * markers, type), `focusedNotesStore` ← `clipRichNotesService` (the rich,
 * id-carrying notes), `clipWaveformService` (peaks), `clipSampleService`
 * and `playingClipsStore` (file path + live playhead when the focused
 * clip is the playing one), and the Drum Rack census for pad names.
 *
 * Call during component init; it owns the fetch effects. Read-only: the
 * editor's writes go through the services directly.
 */

import { session } from '$lib/stores/session.svelte';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { playingClipsStore, type PlayingClipEntry } from '$lib/stores/v6/playingClipsStore.svelte';
import { subscribeNotesChanged } from '$lib/services/clipNotesService';
import { requestRichNotes, shouldSuppressReconcile, type RichNote } from '$lib/services/clipRichNotesService';
import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
import { getPeaks, type PeakData } from '$lib/services/clipWaveformService';
import { invalidateSample, peekSample, requestSample, type ClipSample } from '$lib/services/clipSampleService';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
import { parseVmMembers, padColorCss, padTileLabels, VM } from '$lib/services/drumVirtualMacros';
import { slotOfClip } from '$lib/services/clipSimilarSwap.svelte';
import { logger } from '$lib/utils/logger';

const CENTRAL_BINS = 1024;

export function useFocusedClip() {
	// ── Focused clip identity ────────────────────────────────────────
	const clipPath = $derived(session.focusedClipPath);
	const clipIndices = $derived(session.focusedClipIndices);
	const hasClip = $derived(clipPath !== null && clipIndices !== null);
	// Clip type: prefer the selected track's type (the reliable v3 signal
	// ClipCentralView itself branches on), then the playing entry's audio
	// flag, then clipPropertiesStore. `clipPropertiesStore.clipType` alone
	// is `null` for the focused clip — `is_audio_clip` is still M4L-fed and
	// `clearAll()` deliberately doesn't reseed it (see clipPropertiesStore).
	const clipType = $derived.by<'audio' | 'midi' | null>(() => {
		const tt = selectedTrackStore.trackType; // 'midi' | 'audio' | null
		if (tt === 'midi' || tt === 'audio') return tt;
		if (entryMatchesFocus && playingEntry) return playingEntry.isAudioClip ? 'audio' : 'midi';
		return clipPropertiesStore.clipType;
	});
	const isAudio = $derived(clipType === 'audio');
	const isMidi = $derived(clipType === 'midi');

	// ── Playing-clip entry for this focused clip (file path + playhead) ──
	const focusedTrackPath = $derived(clipIndices !== null ? `tracks/${clipIndices.track}` : '');

	// ── Drum Rack pad names for the gutter ───────────────────────────
	// A clip on a Drum Rack track names its lanes after the pads, with the
	// labels the pad grid wears (`padTileLabels`: the kit's shared words
	// dropped). Only when the focused clip is on the selected track, whose
	// instrument `selectedDrumRack` reads.
	const drumRackPath = $derived.by(() => {
		if (!isMidi || focusedTrackPath !== selectedTrackStore.selectedTrackPath) return undefined;
		return selectedDrumRack()?.rackPath;
	});
	$effect(() => {
		if (!drumRackPath) return;
		return selectedTrackStore.subscribeProperty(drumRackPath, VM.members);
	});
	const census = $derived(drumRackPath ? parseVmMembers(selectedTrackStore.propertyValue(drumRackPath, VM.members)) : null);
	const padLabels = $derived.by((): Map<number, string> => {
		const out = new Map<number, string>();
		for (const [note, text] of padTileLabels(census?.pads ?? [])) if (text.label) out.set(note, text.label);
		return out;
	});
	// Each pad's chain colour, by note: a row's name, notes and velocity
	// bars wear it, as its tile in the pad grid does (2026-10-24, the
	// user's call). A pad Live left uncoloured is absent, and its row keeps
	// the track's ink.
	const padColors = $derived.by((): Map<number, string> => {
		const out = new Map<number, string>();
		for (const pad of census?.pads ?? []) {
			const css = padColorCss(pad);
			if (css) out.set(pad.note, css);
		}
		return out;
	});

	const playingEntry = $derived<PlayingClipEntry | undefined>(
		focusedTrackPath ? playingClipsStore.get(focusedTrackPath) : undefined
	);
	// Only treat the playing entry as "this clip" when its clipPath matches
	// the focused clip — otherwise the file path / playhead belong to a
	// different slot on the same track.
	const entryMatchesFocus = $derived(
		!!playingEntry && playingEntry.clipPath === clipPath && playingEntry.slotIdx >= 0
	);
	// A focused audio clip that ISN'T the track's playing (or display)
	// clip has no entry to read — another slot on the same track is
	// playing. Ask for its sample the way a session-grid cell does
	// (`clip/sample/get`), so the editor draws the clip you're looking at
	// rather than nothing. Asked again when a different clip lands in the
	// same slot — `useClipSwap`'s identity rule, off the C record.
	const focusedClipRecord = $derived.by(() => {
		const slot = clipPath ? slotOfClip(clipPath) : null;
		return slot ? v3Store.tracks.get(slot.trackPath)?.slots.get(slot.slotPath)?.clip : undefined;
	});
	let pulledSample = $state<ClipSample | null>(null);
	let lastPulledIdentity: string | null = null;
	$effect(() => {
		const path = clipPath;
		if (!path || !isAudio || entryMatchesFocus) {
			pulledSample = null;
			return;
		}
		const identity = `${path}::${focusedClipRecord?.name ?? ''}::${focusedClipRecord?.length ?? 0}`;
		if (lastPulledIdentity?.startsWith(`${path}::`) && lastPulledIdentity !== identity) {
			invalidateSample(path);
		}
		lastPulledIdentity = identity;
		const cached = peekSample(path);
		if (cached) {
			pulledSample = cached;
			return;
		}
		let cancelled = false;
		requestSample(path)
			.then((answer) => {
				if (!cancelled) pulledSample = answer;
			})
			.catch(() => {
				if (!cancelled) pulledSample = null;
			});
		return () => {
			cancelled = true;
		};
	});

	const wavFilePath = $derived(
		entryMatchesFocus && playingEntry
			? playingEntry.filePath
			: pulledSample?.isAudioClip
				? pulledSample.filePath
				: ''
	);
	// Where the file sits in clip time — what the peaks array covers.
	// `0, 0` = unknown; the draw then falls back to `[0, totalBeats]`.
	const fileStartBeats = $derived(
		entryMatchesFocus && playingEntry ? playingEntry.fileStartBeats : (pulledSample?.fileStartBeats ?? 0)
	);
	const fileEndBeats = $derived(
		entryMatchesFocus && playingEntry ? playingEntry.fileEndBeats : (pulledSample?.fileEndBeats ?? 0)
	);

	// Total beat extent the view can reach — end marker is the right edge
	// for audio, the file's own end when it runs past it; MIDI uses
	// loopEnd/endMarker too. Fall back to a small window.
	const totalBeats = $derived(
		Math.max(
			clipPropertiesStore.endMarker,
			clipPropertiesStore.loopEnd,
			clipPropertiesStore.clipLength,
			fileEndBeats,
			4
		)
	);
	// What the view may show: the clip's start and end markers — never
	// zoomed or panned past them (the user's call, 2026-10-07) — widened
	// to the loop only where it reaches past a marker, so a loop brace is
	// never off-screen. `totalBeats` above stays the brace's and the
	// waveform fallback's reach.
	const viewStart = $derived(Math.max(0, Math.min(clipPropertiesStore.startMarker, clipPropertiesStore.loopStart)));
	const viewEnd = $derived.by(() => {
		const end = Math.max(clipPropertiesStore.endMarker, clipPropertiesStore.loopEnd);
		return end > viewStart ? end : viewStart + Math.max(clipPropertiesStore.clipLength, 4);
	});
	// No playhead on a stopped clip — only one Live is playing (or holds as
	// playing while the transport is stopped) has a position worth drawing.
	const livePosition = $derived(
		entryMatchesFocus && focusedTrackPath && playingClipsStore.liveStatus(focusedTrackPath) > 0
			? playingClipsStore.position(focusedTrackPath)
			: -1
	);

	// ── Notes (M3: rich, id-carrying channel via focusedNotesStore) ──
	// The editor reads from the rich channel (note identity is what makes
	// M4 editing possible); strip thumbnails keep the cheap blob. The
	// store is the reconcile point — a fresh pull REPLACES its id-keyed
	// map, so external edits + write rejections both land here.
	const notes = $derived<RichNote[]>(focusedNotesStore.notes);
	const notesLoadState = $derived(focusedNotesStore.loadState);

	$effect(() => {
		const path = clipPath;
		if (!path || !isMidi) {
			focusedNotesStore.clearAll();
			return;
		}
		let cancelled = false;
		focusedNotesStore.setLoading(path);
		const fetch = () => {
			requestRichNotes(path)
				.then((result) => {
					if (cancelled) return;
					focusedNotesStore.reconcile(path, result);
				})
				.catch((err: Error) => {
					if (cancelled) return;
					logger.debug('ClipEditorView: rich notes fetch failed', {
						clipPath: path,
						error: err.message
					});
					focusedNotesStore.setError();
				});
		};
		fetch();
		// Re-pull on notes/changed — but suppress our OWN-write echo
		// (plan decision 4) so we don't reconcile against our optimistic
		// edit mid-gesture. External edits (no recent local write) re-pull.
		const release = subscribeNotesChanged(path, () => {
			if (shouldSuppressReconcile(path)) return;
			fetch();
		});
		return () => {
			cancelled = true;
			release();
		};
	});

	// ── Waveform peaks (audio) ───────────────────────────────────────
	let peakData = $state<PeakData | null>(null);
	$effect(() => {
		if (!isAudio || !wavFilePath) {
			peakData = null;
			return;
		}
		const path = wavFilePath;
		let cancelled = false;
		getPeaks(path, CENTRAL_BINS).then((data) => {
			if (cancelled) return;
			peakData = data;
		});
		return () => {
			cancelled = true;
		};
	});

	return {
		get clipPath() { return clipPath; },
		get hasClip() { return hasClip; },
		get clipType() { return clipType; },
		get isAudio() { return isAudio; },
		get isMidi() { return isMidi; },
		get padLabels() { return padLabels; },
		get padColors() { return padColors; },
		get wavFilePath() { return wavFilePath; },
		get fileStartBeats() { return fileStartBeats; },
		get fileEndBeats() { return fileEndBeats; },
		get totalBeats() { return totalBeats; },
		get viewStart() { return viewStart; },
		get viewEnd() { return viewEnd; },
		get livePosition() { return livePosition; },
		get notes() { return notes; },
		get notesLoadState() { return notesLoadState; },
		get peakData() { return peakData; }
	};
}
