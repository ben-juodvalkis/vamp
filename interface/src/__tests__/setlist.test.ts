import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchOscMessage } from '$lib/api/connection/oscMessageBus';
import {
	DOUBLE_TAP_MS,
	holdControl,
	moveControl,
	releaseControl,
	selectSound,
	setlist,
	startSetlist,
	tapArrow
} from '$lib/services/setlist.svelte';

const send = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/simpleClient', () => ({ send }));

const reply = (state: object) =>
	dispatchOscMessage({ address: '/looping/v3/setlist/state', args: [JSON.stringify(state)] });
const state = { found: true, songs: ['Joke', 'Looks', 'Clowns'], song: 1, sounds: ['Lead', 'Organ'], sound: 0 };
const GET = '/looping/v3/setlist/get';

describe('setlist', () => {
	let stop: () => void;
	beforeEach(() => {
		vi.useFakeTimers();
		send.mockClear();
		stop = startSetlist();
		reply(state);
		send.mockClear();
	});
	afterEach(() => {
		stop();
		vi.useRealTimers();
	});

	it('shows what Live answered', () => {
		expect(setlist.live).toBe(true);
		expect(setlist.songs).toEqual(state.songs);
		expect(setlist.sound).toBe(0);
	});

	it('a tap on a sound asks Live and does not light it first', () => {
		selectSound(1);
		expect(send).toHaveBeenCalledWith('/looping/v3/setlist/select_sound', [1]);
		expect(setlist.sound).toBe(0);
	});

	it('one arrow tap changes no song; two inside the window do', () => {
		tapArrow(1, 1000);
		expect(send).not.toHaveBeenCalled();
		expect(setlist.armed).toBe(1);
		tapArrow(1, 1000 + DOUBLE_TAP_MS - 1);
		expect(send).toHaveBeenCalledWith('/looping/v3/setlist/select_song', [2]);
		expect(setlist.armed).toBe(0);
	});

	it('two slow taps change no song', () => {
		tapArrow(1, 1000);
		tapArrow(1, 1000 + DOUBLE_TAP_MS);
		expect(send).not.toHaveBeenCalled();
	});

	it('tapping left then right changes no song', () => {
		tapArrow(-1, 1000);
		tapArrow(1, 1010);
		expect(send).not.toHaveBeenCalled();
	});

	it('stops at the last song rather than wrapping', () => {
		reply({ ...state, song: 2 });
		tapArrow(1, 1000);
		tapArrow(1, 1010);
		expect(send).not.toHaveBeenCalled();
	});

	it('from nothing on, either arrow starts the first song', () => {
		reply({ ...state, song: -1, sound: -1 });
		tapArrow(-1, 1000);
		tapArrow(-1, 1010);
		expect(send).toHaveBeenCalledWith('/looping/v3/setlist/select_song', [0]);
	});

	it('asks again when a select gets no reply, and not when it does', () => {
		selectSound(1);
		vi.advanceTimersByTime(600);
		expect(send).toHaveBeenCalledWith(GET);
		send.mockClear();
		selectSound(0);
		vi.advanceTimersByTime(100);
		reply(state);
		vi.advanceTimersByTime(500);
		expect(send).not.toHaveBeenCalledWith(GET);
	});

	const withControls = (output: number, x: number) => ({
		...state,
		output: { key: '1/1', value: output },
		pads: [{ label: 'Stutter', x: { key: '3/1', value: x }, y: { key: '3/2', value: 0 } }]
	});
	const PARAM = '/looping/v3/setlist/param';

	it('shows the slider and pads Live reports', () => {
		reply(withControls(64, 127));
		expect(setlist.outputKey).toBe('1/1');
		expect(setlist.values['1/1']).toBe(64);
		expect(setlist.pads).toEqual([{ label: 'Stutter', xKey: '3/1', yKey: '3/2' }]);
		expect(setlist.values['3/1']).toBe(127);
	});

	it('shows the sound pads, and none when the sound has no rack', () => {
		const pad = { label: 'Delay Time', x: { key: 's/1/0/1', value: 52 }, y: { key: 's/1/0/2', value: 66 } };
		reply({ ...state, soundPads: [pad] });
		expect(setlist.soundPads).toEqual([{ label: 'Delay Time', xKey: 's/1/0/1', yKey: 's/1/0/2' }]);
		expect(setlist.values['s/1/0/2']).toBe(66);
		reply(state);
		expect(setlist.soundPads).toEqual([]);
	});

	it('a finger wins over Live, and a reset reaches a control nobody holds', () => {
		reply(withControls(64, 127));
		holdControl('3/1');
		moveControl('3/1', 40);
		reply(withControls(10, 127));
		expect(setlist.values['3/1']).toBe(40);
		expect(setlist.values['1/1']).toBe(10);
		releaseControl('3/1');
		reply(withControls(10, 127));
		expect(setlist.values['3/1']).toBe(40);
		vi.advanceTimersByTime(500);
		reply(withControls(10, 127));
		expect(setlist.values['3/1']).toBe(127);
	});

	it('limits writes while moving, clamps, and sends the last value on release', () => {
		reply(withControls(64, 0));
		holdControl('1/1');
		moveControl('1/1', 70);
		moveControl('1/1', 80);
		moveControl('1/1', 900);
		expect(setlist.values['1/1']).toBe(127);
		expect(send.mock.calls.filter(([a]) => a === PARAM)).toEqual([[PARAM, ['1/1', 70]]]);
		releaseControl('1/1');
		expect(send).toHaveBeenLastCalledWith(PARAM, ['1/1', 127]);
	});

	it('says so when Live goes quiet', () => {
		vi.advanceTimersByTime(12000);
		expect(setlist.live).toBe(false);
		expect(send).toHaveBeenCalledWith(GET);
	});
});
