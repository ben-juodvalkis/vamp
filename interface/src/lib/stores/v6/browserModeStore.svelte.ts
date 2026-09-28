/**
 * Shared store for browser persistent mode state (Svelte 5 runes)
 * Allows BottomControls Inst button to communicate with both browsers
 *
 * IMPORTANT: We need separate states for instrument browser vs scale browser
 * The "Inst" button controls the INSTRUMENT browser only, not the scale browser
 */

const LOCK_STORAGE_KEY = 'browserModeStore.isLocked';
const SOURCE_MODE_STORAGE_KEY = 'browserModeStore.sourceMode';
const AUDIO_LOAD_TARGET_STORAGE_KEY = 'browserModeStore.audioLoadTarget';

/** Browse source axis: instrument presets vs audio samples (the Audio toggle). */
export type SourceMode = 'instruments' | 'audio';
/** What a picked audio sample becomes: a clip on an audio track, or a Simpler. */
export type AudioLoadTarget = 'clip' | 'simpler';
/**
 * The top-bar three-way switch position — a UI projection over the two
 * orthogonal fields above (`sourceMode` × `audioLoadTarget`). Only three of
 * the four combinations are meaningful, so the switch collapses them:
 *   `midi`    → instruments            (label Instrument — MIDI track: instrument preset)
 *   `simpler` → audio + simpler target (label Simpler — MIDI track: sample on a fresh Simpler)
 *   `audio`   → audio + clip target    (label Clip — a sample or clip into a Session slot)
 * `sourceMode`/`audioLoadTarget` stay the persisted source of truth; this is
 * the derived label the browser reads/writes via `browseMode`/`setBrowseMode`.
 */
export type BrowseMode = 'midi' | 'simpler' | 'audio';

function readStringFromStorage(key: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStringToStorage(key: string, value: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, value);
	} catch {
		/* ignore quota / disabled storage */
	}
}

function readLockedFromStorage(): boolean {
	return readStringFromStorage(LOCK_STORAGE_KEY) === '1';
}

function writeLockedToStorage(value: boolean): void {
	writeStringToStorage(LOCK_STORAGE_KEY, value ? '1' : '0');
}

function readSourceModeFromStorage(): SourceMode {
	return readStringFromStorage(SOURCE_MODE_STORAGE_KEY) === 'audio' ? 'audio' : 'instruments';
}

function readAudioLoadTargetFromStorage(): AudioLoadTarget {
	return readStringFromStorage(AUDIO_LOAD_TARGET_STORAGE_KEY) === 'simpler' ? 'simpler' : 'clip';
}

function createBrowserModeStore() {
	let isInstrumentPersistent = $state(false);
	let isScalePersistent = $state(false);
	let isReplacingInstrument = $state(false);
	let replaceInstrumentTargetPath = $state<string | null>(null);
	let replaceInstrumentPresetPath = $state<string | null>(null);
	let audioClipReplaceTarget = $state<{ trackIndex: number; clipIndex: number } | null>(null);
	let isLocked = $state(readLockedFromStorage());
	// Source axis + audio load target — persisted so the performer's last
	// choice survives reloads (the rail Audio toggle + the top load-as switch).
	let sourceMode = $state<SourceMode>(readSourceModeFromStorage());
	let audioLoadTarget = $state<AudioLoadTarget>(readAudioLoadTargetFromStorage());

	return {
		// Instrument browser persistent mode
		get isInstrumentPersistent() {
			return isInstrumentPersistent;
		},
		set isInstrumentPersistent(value: boolean) {
			isInstrumentPersistent = value;
		},

		// Scale browser persistent mode
		get isScalePersistent() {
			return isScalePersistent;
		},
		set isScalePersistent(value: boolean) {
			isScalePersistent = value;
		},

		// Replace instrument mode (loads on current track without creating new one)
		get isReplacingInstrument() {
			return isReplacingInstrument;
		},
		set isReplacingInstrument(value: boolean) {
			isReplacingInstrument = value;
		},

		// Legacy alias for backwards compatibility (maps to instrument browser)
		get isPersistent() {
			return isInstrumentPersistent;
		},
		set isPersistent(value: boolean) {
			isInstrumentPersistent = value;
		},

		// Helper function to open browser in replace mode.
		// `targetTrackPath` pins the swap to the current track (clips and
		// all) — without it, Python's reuse-vs-create logic skips any
		// track that has clips and spawns a NEW track instead of swapping
		// the instrument in place.
		//
		// `targetPresetPath` is that track's recorded patch (`TrackRecord.preset`),
		// frozen at the same moment and for the same reason as the pin: the browser
		// opens ON that patch's catalog folder instead of wherever the last browse
		// ended (ADR-441). Optional — a track with no record just opens where it
		// always did.
		openForReplace(targetTrackPath?: string | null, targetPresetPath?: string | null) {
			isReplacingInstrument = true;
			replaceInstrumentTargetPath = targetTrackPath ?? null;
			replaceInstrumentPresetPath = targetPresetPath || null;
			// Exactly one replace mode at a time — drop any audio-clip replace pin so
			// it can't linger underneath (the two flows are launched from mutually
			// exclusive gestures today, but keep the invariant caller-proof).
			audioClipReplaceTarget = null;
			// Force MIDI: a replace-instrument swaps a MIDI-track instrument in
			// place, so a picked instrument preset must load via the pinned
			// `replaceTrackPath`. Now that the browse mode persists across opens
			// (ADR-397), the resumed mode could be audio/Simpler — whose load path
			// ignores the pin and spawns a NEW track, defeating the swap. Symmetric
			// with openAudioBrowserForReplace forcing 'audio'.
			sourceMode = 'instruments';
			writeStringToStorage(SOURCE_MODE_STORAGE_KEY, sourceMode);
			isInstrumentPersistent = true; // Replace mode uses persistent browse mode
		},

		// Target track for the in-progress instrument replace (or null).
		get replaceInstrumentTargetPath() {
			return replaceInstrumentTargetPath;
		},

		// The pinned track's patch at arm time — where the browser opens (ADR-441).
		get replaceInstrumentPresetPath() {
			return replaceInstrumentPresetPath;
		},

		// Helper function to exit replace mode
		exitReplaceMode() {
			isReplacingInstrument = false;
			replaceInstrumentTargetPath = null;
			replaceInstrumentPresetPath = null;
		},

		// Open the browser in audio-sample source mode (external trigger).
		// Audio is no longer a standalone category — it's the source axis, so
		// "open audio" just arms audio mode and opens; the performer taps a
		// type (Drum/Bass/…) to browse that family's samples.
		openAudioBrowser() {
			sourceMode = 'audio';
			writeStringToStorage(SOURCE_MODE_STORAGE_KEY, sourceMode);
			isInstrumentPersistent = true;
		},

		// Open scale browser from external trigger (SystemCentralView Key button)
		openScaleBrowser() {
			isScalePersistent = true;
		},

		// Open the browser in audio mode to replace an existing audio clip.
		openAudioBrowserForReplace(trackIndex: number, clipIndex: number) {
			sourceMode = 'audio';
			writeStringToStorage(SOURCE_MODE_STORAGE_KEY, sourceMode);
			isInstrumentPersistent = true;
			audioClipReplaceTarget = { trackIndex, clipIndex };
			// Exactly one replace mode at a time — drop any instrument-replace pin
			// (mirror of openForReplace clearing the audio-clip target).
			isReplacingInstrument = false;
			replaceInstrumentTargetPath = null;
			replaceInstrumentPresetPath = null;
		},

		// Check if replacing audio clip
		isReplacingAudioClip(): boolean {
			return audioClipReplaceTarget !== null;
		},

		// Get audio clip replace target
		getAudioClipReplaceTarget() {
			return audioClipReplaceTarget;
		},

		// Clear audio clip replace target
		clearAudioClipReplaceTarget() {
			audioClipReplaceTarget = null;
		},

		// Lock state — when true, browser stays open after preset load (tap or drag).
		// Persisted to localStorage so it survives reloads.
		get isLocked() {
			return isLocked;
		},
		set isLocked(value: boolean) {
			isLocked = value;
			writeLockedToStorage(value);
		},

		// Source axis — instrument presets (default) vs audio samples. The rail
		// Audio button toggles this; every type button (Drum/Bass/…) re-skins to
		// browse the matching source. Persisted.
		get sourceMode(): SourceMode {
			return sourceMode;
		},
		set sourceMode(value: SourceMode) {
			sourceMode = value;
			writeStringToStorage(SOURCE_MODE_STORAGE_KEY, value);
		},
		get isAudioSource(): boolean {
			return sourceMode === 'audio';
		},
		toggleSourceMode() {
			this.sourceMode = sourceMode === 'audio' ? 'instruments' : 'audio';
		},

		// Load-as switch (audio mode only) — a picked sample becomes a clip on an
		// audio track, or a sample dropped onto a Simpler on a MIDI track. Persisted.
		get audioLoadTarget(): AudioLoadTarget {
			return audioLoadTarget;
		},
		set audioLoadTarget(value: AudioLoadTarget) {
			audioLoadTarget = value;
			writeStringToStorage(AUDIO_LOAD_TARGET_STORAGE_KEY, value);
		},
		toggleAudioLoadTarget() {
			this.audioLoadTarget = audioLoadTarget === 'simpler' ? 'clip' : 'simpler';
		},

		// Three-way top-bar switch (Instrument | Simpler | Clip; ids midi | simpler | audio) — a projection over
		// `sourceMode` × `audioLoadTarget`. Reading derives the label; writing
		// sets both underlying (persisted) fields so the projection round-trips.
		get browseMode(): BrowseMode {
			if (sourceMode === 'instruments') return 'midi';
			return audioLoadTarget === 'simpler' ? 'simpler' : 'audio';
		},
		setBrowseMode(mode: BrowseMode) {
			if (mode === 'midi') {
				this.sourceMode = 'instruments';
				return;
			}
			this.sourceMode = 'audio';
			this.audioLoadTarget = mode === 'simpler' ? 'simpler' : 'clip';
		}
	};
}

export const browserModeStore = createBrowserModeStore();
