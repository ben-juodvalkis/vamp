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
const STATE = '/looping/v3/setlist/state';

const POLL_MS = 3000;
const RETRY_MS = 500;
const STALE_MS = 8000;
/** A song change takes two taps this close, as the rig's old remote did: one
 * stray touch must not end the sound mid-song. */
export const DOUBLE_TAP_MS = 500;

export const setlist = $state({
	/** False until the surface has answered. */
	live: false,
	found: false,
	songs: [] as string[],
	song: -1,
	sounds: [] as string[],
	sound: -1,
	armed: 0
});

let lastReply = 0;
let answered = true;
let armedAt = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let armTimer: ReturnType<typeof setTimeout> | null = null;

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
		disarm();
	};
}
