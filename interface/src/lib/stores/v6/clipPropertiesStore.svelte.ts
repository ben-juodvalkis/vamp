/**
 * Clip Properties Store
 * Manages clip loop, warp, and other properties
 */

import type { WarpMarker } from '$lib/utils/clip/warpMarkers';

export interface LoopSettings {
	enabled: boolean;
	start: number;
	end: number;
	length: number;
}

export interface WarpSettings {
	enabled: boolean;
	mode: number;
}

class ClipPropertiesStore {
	// State
	private _loopEnabled = $state<boolean>(false);
	private _loopStart = $state<number>(0);
	private _loopEnd = $state<number>(0);
	private _startMarker = $state<number>(0);
	private _endMarker = $state<number>(8);
	private _clipLength = $state<number>(8);
	private _warpEnabled = $state<boolean>(false);
	private _warpMode = $state<number>(0);
	private _detune = $state<number>(0);
	private _transpose = $state<number>(0);
	private _isAudioClip = $state<boolean | null>(null);
	private _pitchCoarse = $state<number>(0);
	private _pitchFine = $state<number>(0);
	private _gain = $state<number>(1);
	// Live's own text for the gain (`Clip.gain_display_string`, "-6.0 dB"):
	// the 0..1 value is not linear in dB. "" until the surface sends one.
	private _gainDisplay = $state<string>('');
	// The focused audio clip's warp markers (`clip/warp_markers`), Live's
	// hidden trailing one included; [] when unwarped, MIDI or not yet sent.
	private _warpMarkers = $state.raw<WarpMarker[]>([]);
	private _warpFileSeconds = $state<number>(0);
	// Bumped on every `clip/warp_markers`, so a drag can wait for the echo
	// of its own move even when the list comes back unchanged.
	private _warpMarkersVersion = $state<number>(0);


	// Reactive getters
	get loopEnabled(): boolean {
		return this._loopEnabled;
	}
	get loopStart(): number {
		return this._loopStart;
	}
	get loopEnd(): number {
		return this._loopEnd;
	}
	get loopLength(): number {
		return this._loopEnd - this._loopStart;
	}
	get startMarker(): number {
		return this._startMarker;
	}
	get endMarker(): number {
		return this._endMarker;
	}
	get clipLength(): number {
		return this._clipLength;
	}
	get warpEnabled(): boolean {
		return this._warpEnabled;
	}
	get warpMode(): number {
		return this._warpMode;
	}
	get detune(): number {
		return this._detune;
	}
	get transpose(): number {
		return this._transpose;
	}
	get isAudioClip(): boolean | null {
		return this._isAudioClip;
	}
	get pitchCoarse(): number {
		return this._pitchCoarse;
	}
	get pitchFine(): number {
		return this._pitchFine;
	}
	get gain(): number {
		return this._gain;
	}
	get gainDisplay(): string {
		return this._gainDisplay;
	}
	get warpMarkers(): WarpMarker[] {
		return this._warpMarkers;
	}
	get warpFileSeconds(): number {
		return this._warpFileSeconds;
	}
	get warpMarkersVersion(): number {
		return this._warpMarkersVersion;
	}
	get clipType(): 'audio' | 'midi' | null {
		if (this._isAudioClip === null) return null;
		return this._isAudioClip ? 'audio' : 'midi';
	}

	// Derived state
	get loopSettings(): LoopSettings {
		return {
			enabled: this._loopEnabled,
			start: this._loopStart,
			end: this._loopEnd,
			length: this.loopLength
		};
	}

	get warpSettings(): WarpSettings {
		return {
			enabled: this._warpEnabled,
			mode: this._warpMode
		};
	}

	// Message handlers

	handleLoopEnabled(enabled: boolean) {
		this._loopEnabled = enabled;
	}

	handleLoopStart(value: number) {
		this._loopStart = value;
	}

	handleLoopEnd(value: number) {
		this._loopEnd = value;
	}

	handleWarpEnabled(enabled: boolean) {
		this._warpEnabled = enabled;
	}

	handleWarpMode(mode: number) {
		this._warpMode = mode;
	}

	handleDetune(value: number) {
		this._detune = value;
	}

	handleTranspose(value: number) {
		this._transpose = value;
	}

	handleStartMarker(value: number) {
		this._startMarker = value;
	}

	handleEndMarker(value: number) {
		this._endMarker = value;
	}

	handleClipLength(value: number) {
		this._clipLength = value;
	}

	handleIsAudioClip(value: boolean) {
		this._isAudioClip = value;
	}

	handlePitchCoarse(value: number) {
		this._pitchCoarse = value;
	}

	handlePitchFine(value: number) {
		this._pitchFine = value;
	}

	handleGain(value: number) {
		this._gain = value;
	}

	handleGainDisplay(text: string) {
		this._gainDisplay = text;
	}

	handleWarpMarkers(warping: boolean, fileSeconds: number, markers: WarpMarker[]) {
		this._warpEnabled = warping;
		this._warpFileSeconds = fileSeconds;
		this._warpMarkers = warping ? markers : [];
		this._warpMarkersVersion++;
	}

	// Handle batch properties update
	handleBatchProperties(properties: Record<string, any>) {
		if ('loop_start' in properties) this._loopStart = properties.loop_start;
		if ('loop_end' in properties) this._loopEnd = properties.loop_end;
		if ('start_marker' in properties) this._startMarker = properties.start_marker;
		if ('end_marker' in properties) this._endMarker = properties.end_marker;
		if ('length' in properties) this._clipLength = properties.length;
		if ('looping' in properties) this._loopEnabled = properties.looping === 1;
		if ('warp_enabled' in properties) this._warpEnabled = properties.warp_enabled === 1;
		if ('warp_mode' in properties) this._warpMode = properties.warp_mode;
		if ('detune' in properties) this._detune = properties.detune;
		if ('transpose' in properties) this._transpose = properties.transpose;
		if ('is_audio_clip' in properties) this._isAudioClip = properties.is_audio_clip === 1;
	}

	// Reset
	reset() {
		this._loopEnabled = false;
		this._loopStart = 0;
		this._loopEnd = 0;
		this._startMarker = 0;
		this._endMarker = 8;
		this._clipLength = 8;
		this._warpEnabled = false;
		this._warpMode = 0;
		this._detune = 0;
		this._transpose = 0;
		this._isAudioClip = null;
		this._pitchCoarse = 0;
		this._pitchFine = 0;
		this._gain = 1;
		this._gainDisplay = '';
	}

	/**
	 * PR-5e1: Clear all v3-owned clip-property fields on focus change.
	 *
	 * Called from `session.handleFocusedClipPath` whenever the focused
	 * clipPath changes (including → null). Stops stale values from the
	 * previous clip bleeding through while the Python surface's listener
	 * echoes for the new clip are in flight.
	 *
	 * Resets the v3-owned fields (loop_start/loop_end/start_marker/
	 * end_marker/warp_mode/looping/pitch_coarse + M2's pitch_fine/gain).
	 * Leaves legacy fields (warpEnabled, detune, transpose, clipLength,
	 * isAudioClip) alone — those are still fed by M4L handlers until
	 * PR-5e2/3 migrates them.
	 */
	clearAll() {
		this._loopEnabled = false;
		this._loopStart = 0;
		this._loopEnd = 0;
		this._startMarker = 0;
		this._endMarker = 8;
		this._warpMode = 0;
		this._pitchCoarse = 0;
		this._pitchFine = 0;
		this._gain = 1;
		this._gainDisplay = '';
		this._warpMarkers = [];
		this._warpFileSeconds = 0;
	}
}

export const clipPropertiesStore = new ClipPropertiesStore();
