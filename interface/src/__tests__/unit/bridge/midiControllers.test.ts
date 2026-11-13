/**
 * The owner's Ableton Move, read by the bridge (ADR-537), which replaced the
 * standalone Max patch: pad hold, and the track-volume and TotalMix knobs.
 * The pedals are `pedals.test.ts` (ADR-538).
 *
 * Targets `interface/bridge/handlers/midiControllers.js` with plain byte
 * arrays and vitest's fake timers; no CoreMIDI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as mod from '../../../../bridge/handlers/midiControllers.js';
import constants from '../../../../../config/constants.json';

type Sent = { address: string; args: Array<{ type: string; value: number }> };
type Controllers = {
	handleMidi: (port: string, bytes: number[]) => void;
	inputsReset: () => void;
};
const { createMidiControllers } = mod as unknown as {
	createMidiControllers: (deps: Record<string, unknown>) => Controllers;
};

const MOVE = 'Ableton Move Live Port';
const OTHER = 'USB MIDI Device';
const PAD_MS = 300;

const noteOn = (note: number, vel = 100) => [0x90, note, vel];
const noteOff = (note: number) => [0x80, note, 0];
const cc = (num: number, value: number, channel = 1) => [0xb0 + channel - 1, num, value];

let sent: Sent[];
let levels: Record<string, number>;
let written: Array<[string, number]>;

function make(extra: Record<string, unknown> = {}) {
	return createMidiControllers({
		config: constants.midiControllers,
		padHoldMs: PAD_MS,
		sendToSurface: (msg: Sent) => sent.push(msg),
		getTotalMixLevel: (ch: string) => levels[ch],
		writeTotalMix: (ch: string, db: number) => {
			written.push([ch, db]);
			levels[ch] = db;
		},
		...extra
	});
}

const addresses = () => sent.map((m) => [m.address, ...m.args.map((a) => a.value)]);

beforeEach(() => {
	vi.useFakeTimers();
	sent = [];
	levels = {};
	written = [];
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the config the bridge reads', () => {
	it('carries what the handler needs, and the hold times it is given', () => {
		expect(constants.midiControllers.move.portName).toBe(MOVE);
		expect(constants.ui.gestures.momentaryHoldMs).toBe(PAD_MS);
	});
});

describe('Move pad hold', () => {
	it('sends a hold once a pad has been down for the hold time, and its release', () => {
		const c = make();
		c.handleMidi(MOVE, noteOn(40));
		vi.advanceTimersByTime(PAD_MS - 1);
		expect(sent).toEqual([]);
		vi.advanceTimersByTime(1);
		c.handleMidi(MOVE, noteOff(40));
		expect(addresses()).toEqual([
			['/looping/v3/move/pad_hold', 40, 1],
			['/looping/v3/move/pad_hold', 40, 0]
		]);
		expect(sent[0].args.map((a) => a.type)).toEqual(['i', 'i']);
	});

	it('sends nothing for a hit released before the hold time', () => {
		const c = make();
		c.handleMidi(MOVE, noteOn(40));
		vi.advanceTimersByTime(PAD_MS - 50);
		c.handleMidi(MOVE, [0x90, 40, 0]); // note-on at velocity 0 is a release
		vi.advanceTimersByTime(PAD_MS);
		expect(sent).toEqual([]);
	});

	it('ignores the step buttons, other Move ports and other inputs', () => {
		const c = make();
		c.handleMidi(MOVE, noteOn(16));
		c.handleMidi(MOVE, noteOn(31));
		c.handleMidi('Ableton Move User Port', noteOn(40));
		c.handleMidi(OTHER, noteOn(40));
		vi.advanceTimersByTime(PAD_MS * 2);
		expect(sent).toEqual([]);
	});

	it('holds two pads at once, and lets go of both when the inputs reopen', () => {
		const c = make();
		c.handleMidi(MOVE, noteOn(40));
		c.handleMidi(MOVE, noteOn(41));
		vi.advanceTimersByTime(PAD_MS);
		c.inputsReset();
		expect(addresses()).toEqual([
			['/looping/v3/move/pad_hold', 40, 1],
			['/looping/v3/move/pad_hold', 41, 1],
			['/looping/v3/move/pad_hold', 40, 0],
			['/looping/v3/move/pad_hold', 41, 0]
		]);
	});
});

describe('Move knobs', () => {
	it('sends CC 71 raw to the selected track volume, on channel 1 only', () => {
		const c = make();
		c.handleMidi(MOVE, cc(71, 1));
		c.handleMidi(MOVE, cc(71, 127));
		c.handleMidi(MOVE, cc(71, 1, 2));
		expect(addresses()).toEqual([
			['/looping/v3/selected_track/volume_relative', 1],
			['/looping/v3/selected_track/volume_relative', 127]
		]);
	});

	it('no longer sends CC 72 anywhere (the drum-chain knob was cut)', () => {
		const c = make();
		c.handleMidi(MOVE, cc(72, 1));
		expect(sent).toEqual([]);
	});

	it('nudges each TotalMix channel 0.1 dB per click from its known level', () => {
		const c = make();
		levels = { room: -20, playback: -10, click: -15, phones: 0 };
		c.handleMidi(MOVE, cc(75, 1));
		c.handleMidi(MOVE, cc(76, 127));
		c.handleMidi(MOVE, cc(77, 1));
		c.handleMidi(MOVE, cc(78, 127));
		expect(written).toEqual([['room', -19.9], ['playback', -10.1], ['click', -14.9], ['phones', -0.1]]);
	});

	it('does not drift over many clicks', () => {
		const c = make();
		levels = { click: -15 };
		for (let i = 0; i < 100; i++) c.handleMidi(MOVE, cc(77, 1));
		expect(levels.click).toBe(-5);
	});

	it('leaves a channel with no known level alone, and ignores other values', () => {
		const c = make();
		c.handleMidi(MOVE, cc(77, 1));
		levels = { click: -15 };
		c.handleMidi(MOVE, cc(77, 64));
		expect(written).toEqual([]);
	});

	it('does nothing for the TotalMix knobs while TotalMix is off', () => {
		const c = make({ getTotalMixLevel: null, writeTotalMix: null });
		c.handleMidi(MOVE, cc(77, 1));
		expect(sent).toEqual([]);
	});
});
