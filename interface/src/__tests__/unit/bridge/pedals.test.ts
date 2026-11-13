/**
 * Every pedal, read by the bridge from any MIDI input (ADR-538): the loop
 * trigger (several pedals, momentary or latching, learned), the wah's toe
 * switch and sweep, the seed from `midiPedals`, and what is saved.
 *
 * Targets `interface/bridge/handlers/pedals.js` with byte arrays and fake
 * timers; no CoreMIDI. The tap/hold rules are the surface's MidiPedalInput's,
 * which this replaced.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as mod from '../../../../bridge/handlers/pedals.js';

type Sent = { address: string; args: Array<{ type: string; value: number }> };
type Pedals = {
	handleMidi: (port: string, bytes: number[]) => void;
	inputsReset: () => void;
	onClientMessage: (msg: { address: string; args: unknown[] }) => boolean;
	state: () => any;
};
const { createPedals } = mod as unknown as { createPedals: (deps: Record<string, unknown>) => Pedals };

const HOLD = 650;
const PEDAL = 'USB MIDI Device';
const PIANO = 'Digital Piano';
const MOVE = 'Ableton Move Live Port';
const cc = (num: number, value: number, channel = 1) => [0xb0 + channel - 1, num, value];

let sent: Sent[];
let dir: string;
const settingsPath = () => path.join(dir, 'pedals.json');

function make(extra: Record<string, unknown> = {}) {
	return createPedals({
		sendToSurface: (m: Sent) => sent.push(m),
		holdMs: HOLD,
		wahEnabled: true,
		isExcludedPort: (p: string) => p.startsWith('Ableton Move'),
		midiPedals: { channel: 10, footSwitchCC: 23, pianoPedalCC: 67, wahToeSwitchCC: 21, wahExpressionCC: 20 },
		timing: { learnTimeoutMs: 10000, learnReleaseWindowMs: 1500 },
		settingsPath: settingsPath(),
		...extra
	});
}
const addresses = () => sent.map((m) => [m.address, ...m.args.map((a) => a.value)]);
const learn = (p: Pedals, role: string, on = 1) => p.onClientMessage({ address: '/bridge/pedals/learn', args: [role, on] });

beforeEach(() => {
	vi.useFakeTimers();
	sent = [];
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pedals-'));
});
afterEach(() => {
	vi.useRealTimers();
	fs.rmSync(dir, { recursive: true, force: true });
});

describe('the seed', () => {
	it('makes the foot switch (its channel) and the piano pedal (any channel) loop pedals', () => {
		const s = make().state();
		expect(s.loop.pedals).toEqual([
			{ channel: 10, cc: 23, mode: 'momentary', pressHigh: true },
			{ channel: 0, cc: 67, mode: 'momentary', pressHigh: true }
		]);
		expect(s.wahToe.pedal).toEqual({ channel: 10, cc: 21 });
		expect(s.wahSweep.pedal).toEqual({ channel: 10, cc: 20 });
	});

	it('is no pedal at all when the config names none', () => {
		const s = make({ midiPedals: {} }).state();
		expect(s.loop.pedals).toEqual([]);
		expect(s.wahToe.pedal).toBeNull();
	});
});

describe('the loop trigger', () => {
	it('taps on a release before the hold time, on its own channel only', () => {
		const p = make();
		p.handleMidi(PEDAL, cc(23, 127, 9));
		p.handleMidi(PEDAL, cc(23, 0, 9));
		expect(sent).toEqual([]);
		p.handleMidi(PEDAL, cc(23, 127, 10));
		vi.advanceTimersByTime(HOLD - 1);
		p.handleMidi(PEDAL, cc(23, 0, 10));
		expect(addresses()).toEqual([['/looping/v3/foot/tap']]);
	});

	it('holds at the hold time, and its release sends nothing more', () => {
		const p = make();
		p.handleMidi(PEDAL, cc(23, 127, 10));
		vi.advanceTimersByTime(HOLD);
		p.handleMidi(PEDAL, cc(23, 0, 10));
		expect(addresses()).toEqual([['/looping/v3/foot/hold']]);
	});

	it('hears the piano pedal on any channel too, and ignores repeats', () => {
		const p = make();
		p.handleMidi(PIANO, cc(67, 127, 3));
		p.handleMidi(PIANO, cc(67, 100, 3));
		p.handleMidi(PIANO, cc(67, 0, 3));
		expect(addresses()).toEqual([['/looping/v3/foot/tap']]);
	});

	it('never hears the Move', () => {
		const p = make();
		p.handleMidi(MOVE, cc(67, 127));
		p.handleMidi(MOVE, cc(67, 0));
		expect(sent).toEqual([]);
	});

	it('is ignored while off, and the off is saved', () => {
		const p = make();
		p.onClientMessage({ address: '/bridge/pedals/enabled', args: [0] });
		p.handleMidi(PIANO, cc(67, 127));
		p.handleMidi(PIANO, cc(67, 0));
		expect(sent).toEqual([]);
		expect(make().state().loop.enabled).toBe(false);
	});

	it('drops a press cut off by the inputs reopening', () => {
		const p = make();
		p.handleMidi(PIANO, cc(67, 127));
		p.inputsReset();
		vi.advanceTimersByTime(HOLD * 2);
		p.handleMidi(PIANO, cc(67, 0));
		expect(sent).toEqual([]);
	});
});

describe('Learn', () => {
	it('adds a momentary pedal from a press and its release, and saves it', () => {
		const p = make({ midiPedals: {} });
		learn(p, 'loop');
		p.handleMidi(PEDAL, cc(64, 127, 2));
		vi.advanceTimersByTime(200);
		p.handleMidi(PEDAL, cc(64, 0, 2));
		expect(p.state().loop.pedals).toEqual([{ channel: 2, cc: 64, mode: 'momentary', pressHigh: true }]);
		expect(p.state().learn).toBeNull();
		expect(sent).toEqual([]); // teaching fires no gesture
		expect(make().state().loop.pedals).toHaveLength(1);
	});

	it('learns a normally-closed switch that presses low', () => {
		const p = make({ midiPedals: {} });
		learn(p, 'loop');
		p.handleMidi(PEDAL, cc(30, 0));
		p.handleMidi(PEDAL, cc(30, 127));
		expect(p.state().loop.pedals[0]).toMatchObject({ mode: 'momentary', pressHigh: false });
		p.handleMidi(PEDAL, cc(30, 0)); // press
		p.handleMidi(PEDAL, cc(30, 127)); // release
		expect(addresses()).toEqual([['/looping/v3/foot/tap']]);
	});

	it('names a pedal that sends nothing on release latching, which taps every stomp', () => {
		const p = make({ midiPedals: {} });
		learn(p, 'loop');
		p.handleMidi(PEDAL, cc(40, 127));
		vi.advanceTimersByTime(1500);
		expect(p.state().loop.pedals[0]).toMatchObject({ cc: 40, mode: 'latching' });
		p.handleMidi(PEDAL, cc(40, 0));
		p.handleMidi(PEDAL, cc(40, 127));
		vi.advanceTimersByTime(HOLD * 2);
		expect(addresses()).toEqual([['/looping/v3/foot/tap'], ['/looping/v3/foot/tap']]);
	});

	it('adds beside the pedals already there, replacing the same one', () => {
		const p = make();
		learn(p, 'loop');
		p.handleMidi(PEDAL, cc(23, 127, 10));
		p.handleMidi(PEDAL, cc(23, 0, 10));
		expect(p.state().loop.pedals.map((x: any) => x.cc)).toEqual([67, 23]);
	});

	it('times out, and Cancel stops it', () => {
		const p = make();
		learn(p, 'wahToe');
		vi.advanceTimersByTime(10000);
		expect(p.state().learn).toEqual({ role: 'wahToe', state: 'timeout' });
		learn(p, 'loop');
		learn(p, 'loop', 0);
		expect(p.state().learn).toBeNull();
	});

	it('learns the wah pedals from the first CC, ignoring the Move', () => {
		const p = make();
		learn(p, 'wahSweep');
		p.handleMidi(MOVE, cc(71, 1));
		p.handleMidi(PEDAL, cc(11, 64, 4));
		expect(p.state().wahSweep.pedal).toEqual({ channel: 4, cc: 11 });
	});

	it('forgets a role', () => {
		const p = make();
		p.onClientMessage({ address: '/bridge/pedals/forget', args: ['loop'] });
		expect(p.state().loop.pedals).toEqual([]);
		expect(make().state().loop.pedals).toEqual([]);
	});
});

describe('the wah', () => {
	it('engages on either edge of the latching toe switch, once per change', () => {
		const p = make();
		p.handleMidi(PEDAL, cc(21, 127, 10));
		p.handleMidi(PEDAL, cc(21, 127, 10));
		p.handleMidi(PEDAL, cc(21, 0, 10));
		expect(addresses()).toEqual([['/looping/v3/wah/engage'], ['/looping/v3/wah/engage']]);
	});

	it('sends every sweep value as an int', () => {
		const p = make();
		p.handleMidi(PEDAL, cc(20, 0, 10));
		p.handleMidi(PEDAL, cc(20, 64, 10));
		expect(addresses()).toEqual([['/looping/v3/wah/freq', 0], ['/looping/v3/wah/freq', 64]]);
		expect(sent[0].args[0].type).toBe('i');
	});

	it('does nothing while the wah is switched off, and refuses its Learn', () => {
		const p = make({ wahEnabled: false });
		p.handleMidi(PEDAL, cc(21, 127, 10));
		p.handleMidi(PEDAL, cc(20, 64, 10));
		learn(p, 'wahToe');
		expect(sent).toEqual([]);
		expect(p.state().learn).toBeNull();
	});
});

describe('the wire', () => {
	it('leaves other addresses to the router', () => {
		expect(make().onClientMessage({ address: '/looping/v3/foot/tap', args: [] })).toBe(false);
	});
});
