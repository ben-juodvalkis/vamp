/**
 * The bridge's own MIDI controllers (ADR-537), which replaced the owner's
 * standalone Max patch: Move pad hold, the Move's track-volume and TotalMix
 * knobs, and the piano pedal with its saved CC and Learn.
 *
 * Targets `interface/bridge/handlers/midiControllers.js` with plain byte
 * arrays and vitest's fake timers; no CoreMIDI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as mod from '../../../../bridge/handlers/midiControllers.js';
import constants from '../../../../../config/constants.json';

type Sent = { address: string; args: Array<{ type: string; value: number }> };
type Controllers = {
	handleMidi: (port: string, bytes: number[]) => void;
	inputsReset: () => void;
	onClientMessage: (msg: { address: string; args: unknown[] }) => boolean;
	pedalState: () => { enabled: boolean; cc: number; learn: string; heard: boolean };
};
const { createMidiControllers } = mod as unknown as {
	createMidiControllers: (deps: Record<string, unknown>) => Controllers;
};

const MOVE = 'Ableton Move Live Port';
const PIANO = 'USB MIDI Device';
const PAD_MS = 300;
const PEDAL_MS = 650;

const noteOn = (note: number, vel = 100) => [0x90, note, vel];
const noteOff = (note: number) => [0x80, note, 0];
const cc = (num: number, value: number, channel = 1) => [0xb0 + channel - 1, num, value];

let sent: Sent[];
let levels: Record<string, number>;
let written: Array<[string, number]>;
let states: Array<Record<string, unknown>>;
let dir: string;

function make(extra: Record<string, unknown> = {}) {
	return createMidiControllers({
		config: constants.midiControllers,
		padHoldMs: PAD_MS,
		pedalHoldMs: PEDAL_MS,
		sendToSurface: (msg: Sent) => sent.push(msg),
		getTotalMixLevel: (ch: string) => levels[ch],
		writeTotalMix: (ch: string, db: number) => {
			written.push([ch, db]);
			levels[ch] = db;
		},
		onPedalState: (s: Record<string, unknown>) => states.push(s),
		settingsPath: path.join(dir, 'piano-pedal.json'),
		...extra
	});
}

const addresses = () => sent.map((m) => [m.address, ...m.args.map((a) => a.value)]);

beforeEach(() => {
	vi.useFakeTimers();
	sent = [];
	levels = {};
	written = [];
	states = [];
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midi-controllers-'));
});

afterEach(() => {
	vi.useRealTimers();
	fs.rmSync(dir, { recursive: true, force: true });
});

describe('the config the bridge reads', () => {
	it('carries what the handler needs, and the hold times it is given', () => {
		expect(constants.midiControllers.move.portName).toBe(MOVE);
		expect(constants.ui.gestures.momentaryHoldMs).toBe(PAD_MS);
		expect(constants.osc.footTrigger.holdThresholdMs).toBe(PEDAL_MS);
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
		c.handleMidi(PIANO, noteOn(40));
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

describe('the piano pedal', () => {
	it('taps on CC 67 from any input and any channel by default', () => {
		const c = make();
		c.handleMidi(PIANO, cc(67, 127, 5));
		vi.advanceTimersByTime(100);
		c.handleMidi(PIANO, cc(67, 0, 5));
		expect(addresses()).toEqual([['/looping/v3/foot/tap']]);
	});

	it('holds at the hold time, and its release sends nothing more', () => {
		const c = make();
		c.handleMidi(PIANO, cc(67, 127));
		vi.advanceTimersByTime(PEDAL_MS);
		c.handleMidi(PIANO, cc(67, 0));
		expect(addresses()).toEqual([['/looping/v3/foot/hold']]);
	});

	it('presses above 64 only, and ignores repeats while down', () => {
		const c = make();
		c.handleMidi(PIANO, cc(67, 64));
		c.handleMidi(PIANO, cc(67, 65));
		c.handleMidi(PIANO, cc(67, 100));
		c.handleMidi(PIANO, cc(67, 10));
		expect(addresses()).toEqual([['/looping/v3/foot/tap']]);
	});

	it('never hears the Move, whatever CC it sends', () => {
		const c = make();
		c.onClientMessage({ address: '/bridge/piano_pedal/learn', args: [1] });
		c.handleMidi(MOVE, cc(75, 127));
		expect(c.pedalState().learn).toBe('listening');
	});

	it('learns the next CC pressed, saves it, and uses it from then on', () => {
		const c = make();
		c.onClientMessage({ address: '/bridge/piano_pedal/learn', args: [1] });
		c.handleMidi(PIANO, cc(64, 127));
		expect(c.pedalState()).toMatchObject({ cc: 64, learn: 'idle', enabled: true });
		c.handleMidi(PIANO, cc(64, 0)); // the learning press's release taps nothing
		c.handleMidi(PIANO, cc(67, 127));
		c.handleMidi(PIANO, cc(67, 0));
		expect(sent).toEqual([]);
		c.handleMidi(PIANO, cc(64, 127));
		c.handleMidi(PIANO, cc(64, 0));
		expect(addresses()).toEqual([['/looping/v3/foot/tap']]);

		const again = make();
		expect(again.pedalState().cc).toBe(64);
	});

	it('times Learn out, and Cancel stops it', () => {
		const c = make();
		c.onClientMessage({ address: '/bridge/piano_pedal/learn', args: [{ type: 'i', value: 1 }] });
		vi.advanceTimersByTime(constants.midiControllers.pianoPedal.learnTimeoutMs);
		expect(c.pedalState().learn).toBe('timeout');
		c.onClientMessage({ address: '/bridge/piano_pedal/learn', args: [1] });
		c.onClientMessage({ address: '/bridge/piano_pedal/learn', args: [0] });
		expect(c.pedalState().learn).toBe('idle');
		expect(states.map((s) => s.learn)).toEqual(['listening', 'timeout', 'listening', 'idle']);
	});

	it('is ignored while off, and the off is saved', () => {
		const c = make();
		expect(c.onClientMessage({ address: '/bridge/piano_pedal/enabled', args: [0] })).toBe(true);
		c.handleMidi(PIANO, cc(67, 127));
		c.handleMidi(PIANO, cc(67, 0));
		expect(sent).toEqual([]);
		expect(make().pedalState().enabled).toBe(false);
	});

	it('leaves other client addresses to the router', () => {
		expect(make().onClientMessage({ address: '/looping/v3/foot/tap', args: [] })).toBe(false);
	});
});
