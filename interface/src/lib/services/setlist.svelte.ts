/**
 * The setlist page's state (ADR-519): which song and sound Live has on.
 *
 * Live is the only holder of the selection. A tap sends a select and the page
 * lights what comes back, never what it hoped for. The surface's replies
 * travel by loopback UDP, so a lost one must not leave the page wrong: an
 * unanswered select asks again, and a slow poll keeps the page true whatever
 * else moved in Live. Asking changes nothing in Live.
 */

import { send } from '$lib/api/simpleClient';
import {
	addOscMessageListener,
	removeOscMessageListener,
	type OscBusMessage
} from '$lib/api/connection/oscMessageBus';
import { logger } from '$lib/utils/logger';

const GET = '/looping/v3/setlist/get';
const SELECT_SONG = '/looping/v3/setlist/select_song';
const SELECT_SOUND = '/looping/v3/setlist/select_sound';
const PARAM = '/looping/v3/setlist/param';
const OCTAVE = '/looping/v3/setlist/octave';
const STATE = '/looping/v3/setlist/state';

const POLL_MS = 1500;
/** Macro writes per control while a finger moves. */
const WRITE_MS = 33;
/** After a release, how long a reply already on its way may not undo the move. */
const RELEASE_GRACE_MS = 400;
export const MACRO_MAX = 127;
const RETRY_MS = 500;
const STALE_MS = 8000;
/** A song change takes two taps this close, as the rig's old remote did: one
 * stray touch must not end the sound mid-song. */
export const DOUBLE_TAP_MS = 500;

export interface SetlistPad {
	label: string;
	xKey: string;
	yKey: string;
}

export const setlist = $state({
	/** False until the surface has answered. */
	live: false,
	found: false,
	songs: [] as string[],
	song: -1,
	sounds: [] as string[],
	sound: -1,
	armed: 0,
	outputKey: null as string | null,
	/** The Octave rack's transpose, -2..2; null when the set has no Octave rack. */
	octave: null as number | null,
	pads: [] as SetlistPad[],
	/** The two pads on the sound's own macros; none for a bare plug-in. */
	soundPads: [] as SetlistPad[],
	/** Macro values by control key. A finger's value wins over Live's here. */
	values: {} as Record<string, number>
});

const heldUntil = new Map<string, number>();
const writes = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> | null }>();

function receive(control: { key: string; value: number } | null | undefined): void {
	if (!control) return;
	if ((heldUntil.get(control.key) ?? 0) > Date.now()) return;
	setlist.values[control.key] = control.value;
}

/** A finger is down on these controls: Live's replies may not move them. */
export function holdControl(key: string): void {
	heldUntil.set(key, Infinity);
}

export function releaseControl(key: string): void {
	heldUntil.set(key, Date.now() + RELEASE_GRACE_MS);
	flushWrite(key);
}

function flushWrite(key: string): void {
	const write = writes.get(key);
	if (write?.timer) clearTimeout(write.timer);
	if (write) write.timer = null;
	const value = setlist.values[key];
	if (value === undefined) return;
	writes.set(key, { at: Date.now(), timer: null });
	send(PARAM, [key, value]);
}

/** Show the value now and send it to Live at most every WRITE_MS. */
export function moveControl(key: string, value: number): void {
	setlist.values[key] = Math.min(MACRO_MAX, Math.max(0, value));
	const write = writes.get(key);
	if (write?.timer) return;
	const wait = write ? write.at + WRITE_MS - Date.now() : 0;
	if (wait <= 0) return flushWrite(key);
	writes.set(key, { at: write!.at, timer: setTimeout(() => flushWrite(key), wait) });
}

let lastReply = 0;
let answered = true;
let armedAt = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let armTimer: ReturnType<typeof setTimeout> | null = null;

interface WirePad {
	label: string;
	x: { key: string; value: number };
	y: { key: string; value: number };
}

function receivePads(pads: WirePad[] | undefined): SetlistPad[] {
	return (pads ?? []).map((pad) => {
		receive(pad.x);
		receive(pad.y);
		return { label: pad.label, xKey: pad.x.key, yKey: pad.y.key };
	});
}

function onMessage(message: OscBusMessage): void {
	if (message.address !== STATE) return;
	let parsed;
	try {
		parsed = JSON.parse(String(message.args?.[0]));
	} catch (error) {
		logger.warn('setlist: unreadable state', { error: String(error) });
		return;
	}
	lastReply = Date.now();
	answered = true;
	setlist.live = true;
	setlist.found = !!parsed.found;
	setlist.songs = parsed.songs ?? [];
	setlist.song = parsed.song ?? -1;
	setlist.sounds = parsed.sounds ?? [];
	setlist.sound = parsed.sound ?? -1;
	setlist.outputKey = parsed.output?.key ?? null;
	receive(parsed.output);
	setlist.octave = typeof parsed.octave === 'number' ? parsed.octave : null;
	setlist.pads = receivePads(parsed.pads);
	setlist.soundPads = receivePads(parsed.soundPads);
}

function askAgainUnlessAnswered(): void {
	answered = false;
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = setTimeout(() => {
		if (!answered) send(GET);
	}, RETRY_MS);
}

export function selectSound(index: number): void {
	send(SELECT_SOUND, [index]);
	askAgainUnlessAnswered();
}

function disarm(): void {
	armedAt = 0;
	setlist.armed = 0;
}

/** One octave up or down. Live clamps at ±2 and the reply shows where it landed. */
export function stepOctave(delta: -1 | 1): void {
	send(OCTAVE, [delta]);
	askAgainUnlessAnswered();
}

/** One arrow tap: the first arms it, a second within DOUBLE_TAP_MS moves. */
export function tapArrow(delta: -1 | 1, now = Date.now()): void {
	if (setlist.armed === delta && now - armedAt < DOUBLE_TAP_MS) {
		disarm();
		const last = setlist.songs.length - 1;
		const target = setlist.song < 0 ? 0 : Math.min(Math.max(setlist.song + delta, 0), last);
		if (target !== setlist.song && last >= 0) {
			send(SELECT_SONG, [target]);
			askAgainUnlessAnswered();
		}
		return;
	}
	setlist.armed = delta;
	armedAt = now;
	if (armTimer) clearTimeout(armTimer);
	armTimer = setTimeout(disarm, DOUBLE_TAP_MS);
}

/** Starts asking; returns the stop. */
export function startSetlist(): () => void {
	addOscMessageListener(onMessage);
	send(GET);
	pollTimer = setInterval(() => {
		if (Date.now() - lastReply > STALE_MS) setlist.live = false;
		send(GET);
	}, POLL_MS);
	return () => {
		removeOscMessageListener(onMessage);
		if (pollTimer) clearInterval(pollTimer);
		if (retryTimer) clearTimeout(retryTimer);
		if (armTimer) clearTimeout(armTimer);
		pollTimer = retryTimer = armTimer = null;
		for (const write of writes.values()) if (write.timer) clearTimeout(write.timer);
		writes.clear();
		heldUntil.clear();
		disarm();
	};
}
