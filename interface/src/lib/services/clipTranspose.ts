/**
 * Clip Transpose / Pitch / Device-Parameter Operations
 *
 * Split out of clipOperations.ts (code-quality audit hotspot #2). The
 * file owns one concern: shifting pitch on a clip or its driving
 * device. Routes by track/instrument type:
 *
 * - Audio tracks: clip `pitch_coarse` parameter (-48..+48 semitones)
 * - MIDI melodic (Omnisphere, Komplete Kontrol): notes via
 *   ClipNotesComponent's /looping/v3/clip/transpose
 * - MIDI Drum Racks: the surface's `vm.pitch` virtual macro (ADR-428,
 *   Milestone 1b) — whole semitones, ±48, fanned out to every pad's
 *   Transpose by the surface, on every native pad type, mapped or not.
 *   Never the name scan (the pipeline family's transpose macro is
 *   "Macro 4", so it never matched) and never note-shifting (on a Drum
 *   Rack +12 triggers different pads, or empty ones).
 * - MIDI instrument racks: first the surface's `/looping/v3/track/transpose`,
 *   which finds a Drum Rack wrapped inside the rack by class — the test
 *   Permute's pitch steps use — and moves that kit's `vm.pitch` (the UI
 *   cannot address a device inside a rack chain). Only when the surface
 *   says there is no kit does the rack transpose macro (name-based
 *   detection) or the note shift apply; a macro-held kit gets the macro
 *   and never the note shift.
 *
 * Stateless. Reads context from session / currentInstrument /
 * selectedTrack stores; sends via simpleClient + the v3 path-keyed
 * setters on selectedTrackStore.
 */

import { send } from '$lib/api/simpleClient';
import {
	addOscMessageListener,
	removeOscMessageListener,
	type OscBusMessage
} from '$lib/api/connection/oscMessageBus';
import { generateRequestId } from './trackPreparation';
import { V3_CLIP_SET_PITCH_COARSE_ADDRESS } from '$lib/api/handlers/v3Clip';
import { requireFocusedClip } from '$lib/stores/session.svelte';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
import {
	selectedTrackStore,
	type Device,
	type DeviceRecord
} from '$lib/stores/v6/selectedTrackStore.svelte';
import constants from '$config/constants.json';
import { logger } from '$lib/utils/logger';
import { getClipContext, type ClipContext } from './clipContext';
import {
	VM,
	clampVmPitch,
	parseVmMembers,
	vmFunctionState,
	vmStateAcceptsWrites
} from './drumVirtualMacros';

const TRANSPOSE_CONFIG = constants.instruments.transpose;

export const V3_TRACK_TRANSPOSE_ADDRESS = '/looping/v3/track/transpose';
export const V3_TRACK_TRANSPOSE_REPLY_ADDRESS = '/looping/v3/track/transpose/reply';
// A surface that predates the address never answers; past this the
// press falls back to the old macro / note path rather than doing nothing.
export const TRACK_TRANSPOSE_TIMEOUT_MS = 1000;

/**
 * What the surface did with an octave press on an Instrument Rack
 * (`TrackTransposeComponent`): `drum` moved a wrapped kit's pitch, `none`
 * found a kit with nothing to move, `held` found a kit whose pitch a macro
 * holds, `not-drum` found no kit. `timeout` is ours — no answer.
 */
export type TrackTransposeResult =
	| 'drum'
	| 'not-drum'
	| 'held'
	| 'none'
	| 'invalid-args'
	| 'no-track'
	| 'timeout';
const MACRO_RANGE = constants.devices.audioEffectRack.macroRange;

export interface TransposeParamInfo {
	index: number;
	shiftAmount: number;
	name: string;
}

/**
 * Find transpose parameter by scanning device parameter names.
 * Returns the first match based on priority order from config.
 * V5.0: Name-based parameter detection (case-insensitive, exact match).
 *
 * Instrument racks only since ADR-428 Milestone 1b — Drum Racks route to
 * the `vm.pitch` virtual macro, never to a macro found by name.
 *
 * This is the UI equivalent of the name scan the fat Permute device's
 * permute-utils.js used to run (retired with the thin Permute, permute
 * ADR-020).
 *
 * PR-3.5.4 (2026-04-16): reads names synchronously off the v3 store via
 * `paramNamesForDevice(device)`. Dropped the prior `cachedDeviceId` /
 * `cachedTransposeParam` memoisation — names are already in-store and
 * the scan is `O(n_params)` over a small list (≤16 macros for racks),
 * so re-running on each transpose press is cheaper than maintaining a
 * v2-`deviceId`-keyed cache that stales on preset swap.
 */
export function findTransposeParameter(device: Device | DeviceRecord): TransposeParamInfo | null {
	const paramNames = selectedTrackStore.paramNamesForDevice(device);

	if (!paramNames || paramNames.length === 0) {
		return null;
	}

	const nameLookup = new Map<string, { shiftAmount: number; description: string }>();
	const priorityOrder: string[] = [];

	for (const entry of TRANSPOSE_CONFIG.parameterNames) {
		const lowerName = entry.name.toLowerCase();
		nameLookup.set(lowerName, { shiftAmount: entry.shiftAmount, description: entry.description });
		priorityOrder.push(lowerName);
	}

	const matches = new Map<string, number>();

	for (let i = 0; i < paramNames.length; i++) {
		const paramName = paramNames[i];
		if (!paramName) continue;

		const lowerName = paramName.toLowerCase();
		if (nameLookup.has(lowerName)) {
			matches.set(lowerName, i);
		}
	}

	for (const name of priorityOrder) {
		if (matches.has(name)) {
			const config = nameLookup.get(name)!;
			const result = {
				index: matches.get(name)!,
				shiftAmount: config.shiftAmount,
				name: name
			};

			logger.debug(
				`Found transpose param "${name}" at index ${result.index} (shift: ${result.shiftAmount})`,
				{ component: 'clipTranspose' }
			);
			return result;
		}
	}

	return null;
}

/**
 * Adjust audio clip pitch_coarse by a relative amount, clamped to [-48, 48].
 *
 * Reads current value from `clipPropertiesStore.pitchCoarse` (seeded by
 * the `ClipPropertiesComponent` listener echo on `/looping/v3/clip/property`)
 * and writes via `/looping/v3/clip/set/pitch_coarse [clipPath, value]`.
 * The focused clip is identified by `session.focusedClipPath`.
 */
function adjustClipPitch(semitones: number): void {
	const clipPath = requireFocusedClip({ component: 'clipTranspose', op: 'adjustClipPitch' });
	if (!clipPath) return;
	const current = clipPropertiesStore.pitchCoarse;
	const next = Math.max(-48, Math.min(48, current + semitones));
	if (next === current) return;
	send(V3_CLIP_SET_PITCH_COARSE_ADDRESS, [clipPath, next]);
}

/**
 * Set an audio clip's pitch_coarse to an ABSOLUTE value in [-12, +12],
 * snapped to whole semitones. Backs the audio-clip PITCH slider in
 * ClipCentralView (which replaced the old ±12 octave buttons for audio).
 *
 * Optimistically writes `clipPropertiesStore` so the slider tracks the
 * finger and snaps per-semitone without waiting for the surface's
 * `/looping/v3/clip/property pitch_coarse` echo (the echo later confirms
 * the same value — a no-op). No-ops when the rounded target already
 * matches the current value, which also pulls an out-of-range value
 * (pitch_coarse spans ±48 on the wire) back into the slider's ±12 range.
 *
 * Audio only — MIDI clips have no absolute clip-transpose state a slider
 * could reflect (transpose there physically shifts notes), so they keep
 * the relative octave buttons.
 */
export function setAudioClipPitch(semitones: number): void {
	const clipPath = requireFocusedClip({ component: 'clipTranspose', op: 'setAudioClipPitch' });
	if (!clipPath) return;
	const clamped = Math.max(-12, Math.min(12, Math.round(semitones)));
	if (clamped === clipPropertiesStore.pitchCoarse) return;
	clipPropertiesStore.handlePitchCoarse(clamped);
	send(V3_CLIP_SET_PITCH_COARSE_ADDRESS, [clipPath, clamped]);
}

/**
 * Adjust a device parameter by a relative amount, clamped to [macro min, max].
 *
 * Reads the current value from `selectedTrackStore.paramValue(paramPath)`
 * (seeded by state/full + listener echoes on `/looping/v3/param/value`)
 * and writes via `selectedTrackStore.setParamValue`, which sends
 * `/looping/v3/param/set [paramPath, value, generation]` — no round-trip.
 */
function adjustDeviceParameterRelative(
	device: Device | DeviceRecord,
	parameterIndex: number,
	amount: number
): void {
	const paramPath = selectedTrackStore.paramPath(device, parameterIndex);
	const current = selectedTrackStore.paramValue(paramPath);
	if (current === undefined) {
		logger.warn('adjustDeviceParameterRelative: no cached value for paramPath', {
			component: 'clipTranspose',
			paramPath
		});
		return;
	}
	const next = Math.max(MACRO_RANGE.min, Math.min(MACRO_RANGE.max, current + amount));
	if (next === current) return;
	selectedTrackStore.setParamValue(paramPath, next);
}

/**
 * Shift a Drum Rack's pitch by `semitones` through the surface's `vm.pitch`
 * virtual macro (ADR-428, Milestone 1b).
 *
 * Reads the current value from the property store — seeded by the
 * `vm.pitch` cold-read the Drum Rack view, the FX-grid Pitch slider and
 * the clip view's ±12 host all subscribe — clamps to the ±48 rail and
 * writes back through `setPropertyValue`, which optimistically updates the
 * store and sends `/looping/v3/property/set`; the surface echoes what it
 * stored. Refuses, with a warning, when the census says the function is
 * held by a Live macro or has no member on this kit (the surface would
 * skip every write and the Trnsp slider would show a pitch nothing has),
 * and when no cold-read has landed yet (nothing to add ±12 to).
 */
function transposeDrumRackPitch(device: DeviceRecord, semitones: number): void {
	const devicePath = device.devicePath;
	const members = parseVmMembers(selectedTrackStore.propertyValue(devicePath, VM.members));
	const state = vmFunctionState(members, 'pitch');
	if (!vmStateAcceptsWrites(state)) {
		logger.warn('transposeDrumRackPitch: pitch is not writable on this kit', {
			component: 'clipTranspose',
			devicePath,
			state
		});
		return;
	}
	const current = selectedTrackStore.propertyValue(devicePath, VM.pitch);
	if (typeof current !== 'number' || !Number.isFinite(current)) {
		logger.warn('transposeDrumRackPitch: no cached vm.pitch for device', {
			component: 'clipTranspose',
			devicePath
		});
		return;
	}
	const next = clampVmPitch(current + semitones);
	if (next === current) return;
	selectedTrackStore.setPropertyValue(devicePath, VM.pitch, next);
}

/**
 * Ask the surface to move the pitch of a Drum Rack wrapped in the track's
 * Instrument Rack (`/looping/v3/track/transpose`), and resolve with what it
 * did. Never rejects: a missing answer resolves `timeout`.
 */
export function transposeTrackKit(trackPath: string, semitones: number): Promise<TrackTransposeResult> {
	const requestId = generateRequestId();
	return new Promise<TrackTransposeResult>((resolve) => {
		let settled = false;
		const settle = (result: TrackTransposeResult) => {
			if (settled) return;
			settled = true;
			removeOscMessageListener(handler);
			clearTimeout(timer);
			resolve(result);
		};
		const handler = (msg: OscBusMessage) => {
			if (msg?.address !== V3_TRACK_TRANSPOSE_REPLY_ADDRESS || !msg.args) return;
			if (msg.args[0] !== requestId) return;
			const result = String(msg.args[1] ?? '') as TrackTransposeResult;
			logger.debug('transposeTrackKit: reply', {
				component: 'clipTranspose',
				trackPath,
				result,
				detail: msg.args[2],
				pitch: msg.args[3]
			});
			settle(result);
		};
		addOscMessageListener(handler);
		send(V3_TRACK_TRANSPOSE_ADDRESS, [requestId, trackPath, semitones]);
		const timer = setTimeout(() => settle('timeout'), TRACK_TRANSPOSE_TIMEOUT_MS);
	});
}

/**
 * An octave press on an Instrument Rack. The surface looks inside it first
 * (by class, as Permute does): a wrapped kit moves its own pitch and that
 * is the end of it. With no kit — or no answer — the rack's named pitch
 * macro moves, else the notes shift when `notesFallback` (the clip path)
 * says so. A kit whose pitch a macro holds gets that macro, never the note
 * shift: +12 on a kit plays different pads, not higher ones.
 */
async function transposeInstrumentRack(
	ctx: ClipContext,
	device: DeviceRecord,
	semitones: number,
	notesFallback: boolean
): Promise<void> {
	const result =
		ctx.trackIndex >= 0 ? await transposeTrackKit(`tracks/${ctx.trackIndex}`, semitones) : 'timeout';
	if (result === 'drum') return;
	if (result !== 'not-drum' && result !== 'held' && result !== 'timeout') {
		logger.warn('transposeInstrumentRack: the wrapped kit has no pitch to move', {
			component: 'clipTranspose',
			result
		});
		return;
	}

	const transposeParam = findTransposeParameter(device);
	if (transposeParam) {
		const shiftAmount = (semitones / 12) * transposeParam.shiftAmount;
		adjustDeviceParameterRelative(device, transposeParam.index, shiftAmount);
		return;
	}
	if (result === 'held') {
		logger.warn('transposeInstrumentRack: kit pitch is macro-held and no pitch macro is named', {
			component: 'clipTranspose'
		});
		return;
	}
	if (notesFallback) {
		logger.debug('No transpose param found, using note-based shifting', { component: 'clipTranspose' });
		sendTransposeClipNotes(semitones);
		return;
	}
	logger.warn(
		'No transpose parameter found on device. Hint: Name a macro "Pitch", "Transpose", "Octave", "Tune", or "Custom E"',
		{ component: 'clipTranspose' }
	);
}

/**
 * Phase 8 PR-8b: send the path-keyed v3 clip-transpose write.
 *
 * Routes to Python ClipNotesComponent (`/looping/v3/clip/transpose`).
 * Path-keyed off `session.focusedClipPath` so a focus change between
 * the gesture and wire arrival doesn't drop the write — the surface
 * resolves whatever clipPath we send. No-ops with a warn if no clip
 * is focused.
 */
function sendTransposeClipNotes(semitones: number): void {
	const clipPath = requireFocusedClip({
		component: 'clipTranspose',
		op: 'transposeClipNotes',
	});
	if (!clipPath) return;
	send('/looping/v3/clip/transpose', [clipPath, semitones]);
}

/**
 * Transpose MIDI clip based on instrument type
 * Routes to different methods based on instrument
 *
 * V5.0: Uses name-based parameter detection (same as sequencer device)
 *
 * Note: Different instruments use different scaling:
 * - Melodic instruments: Direct semitone values (12 = 1 octave)
 * - Instrument/drum racks: Device-specific units determined by parameter name
 *   - "Custom E" (KK): 21 units per octave
 *   - "Pitch"/"Transpose"/"Octave"/"Tune": 16 units per octave
 */
async function transposeMIDIClip(ctx: ClipContext, semitones: number): Promise<void> {
	if (ctx.instrumentType === 'omnisphere' || ctx.instrumentType === 'komplete-kontrol') {
		sendTransposeClipNotes(semitones);
		return;
	}

	if (ctx.instrumentType === 'drumrack' && ctx.deviceIndex !== null) {
		// A Drum Rack is never note-shifted: +12 on a kit triggers different
		// pads (or empty ones), not a higher pitch. The virtual macro moves
		// every pad's Transpose instead, whatever the pad type.
		const device = selectedTrackStore.devicesByPath[ctx.deviceIndex];
		if (!device) {
			logger.warn('Device not found in store', { component: 'clipTranspose' });
			return;
		}
		transposeDrumRackPitch(device, semitones);
		return;
	}

	if (ctx.instrumentType === 'instrument-rack' && ctx.deviceIndex !== null) {
		const device = selectedTrackStore.devicesByPath[ctx.deviceIndex];
		if (!device) {
			logger.warn('Device not found in store', { component: 'clipTranspose' });
			return;
		}
		await transposeInstrumentRack(ctx, device, semitones, true);
		return;
	}

	logger.debug('Unknown instrument type, using note-based shifting:', {
		component: 'clipTranspose',
		instrumentType: ctx.instrumentType
	});
	sendTransposeClipNotes(semitones);
}

/**
 * Transpose clip by arbitrary semitones
 * Routes to appropriate method based on track/instrument type
 *
 * Methods:
 * - Audio tracks: Adjust clip pitch_coarse parameter (-48 to +48)
 * - MIDI melodic (Omnisphere, Komplete Kontrol): Transpose notes via Max4Live
 * - MIDI drum racks: Adjust device transpose parameter (0-127)
 * - MIDI instrument racks: Adjust rack transpose parameter (0-127, 64=center)
 */
export async function transposeClip(semitones: number): Promise<void> {
	const ctx = getClipContext();

	if (!ctx.hasDetailClip || !ctx.detailClipIndices) {
		logger.warn('No detail clip selected', { component: 'clipTranspose' });
		return;
	}

	if (ctx.trackType === 'audio') {
		adjustClipPitch(semitones);
	} else if (ctx.trackType === 'midi') {
		await transposeMIDIClip(ctx, semitones);
	}
}

/** Transpose clip up by one octave (12 semitones). */
export async function transposeClipUp(): Promise<void> {
	return transposeClip(12);
}

/** Transpose clip down by one octave (12 semitones). */
export async function transposeClipDown(): Promise<void> {
	return transposeClip(-12);
}

/**
 * Transpose device parameter (for racks) by semitones
 * Works without requiring a clip - adjusts the device parameter directly
 *
 * Drum Racks go through the surface's `vm.pitch` virtual macro (every
 * native pad type, mapped or unmapped — ADR-428 Milestone 1b); instrument
 * racks keep the name-based macro detection (same as the sequencer device).
 */
export async function transposeDevice(semitones: number): Promise<void> {
	const ctx = getClipContext();

	if (ctx.trackType !== 'midi') {
		logger.warn('transposeDevice requires MIDI track (trackType is null or audio)', {
			component: 'clipTranspose'
		});
		return;
	}

	if (!ctx.instrumentType || ctx.deviceIndex === null) {
		logger.warn('No device to transpose', { component: 'clipTranspose' });
		return;
	}

	if (ctx.instrumentType === 'drumrack') {
		const device = selectedTrackStore.devicesByPath[ctx.deviceIndex];
		if (!device) {
			logger.warn('Device not found in store', { component: 'clipTranspose' });
			return;
		}
		transposeDrumRackPitch(device, semitones);
		return;
	}

	if (ctx.instrumentType === 'instrument-rack') {
		const device = selectedTrackStore.devicesByPath[ctx.deviceIndex];
		if (!device) {
			logger.warn('Device not found in store', { component: 'clipTranspose' });
			return;
		}
		await transposeInstrumentRack(ctx, device, semitones, false);
		return;
	}

	logger.warn('Instrument type does not support device transpose:', {
		component: 'clipTranspose',
		instrumentType: ctx.instrumentType
	});
}

/** Transpose device up by one octave (12 semitones). */
export async function transposeDeviceUp(): Promise<void> {
	return transposeDevice(12);
}

/** Transpose device down by one octave (12 semitones). */
export async function transposeDeviceDown(): Promise<void> {
	return transposeDevice(-12);
}
