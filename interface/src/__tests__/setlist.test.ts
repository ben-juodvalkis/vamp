import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchOscMessage } from '$lib/api/connection/oscMessageBus';
import { DOUBLE_TAP_MS, selectSound, setlist, startSetlist, tapArrow } from '$lib/services/setlist.svelte';

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

	it('says so when Live goes quiet', () => {
		vi.advanceTimersByTime(12000);
		expect(setlist.live).toBe(false);
		expect(send).toHaveBeenCalledWith(GET);
	});
});
