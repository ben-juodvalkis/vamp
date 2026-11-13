/**
 * The external input the sidebar's REC records (ADR-533). The clip view's
 * REC records the selected track and reads nothing here: the two are separate
 * recorders since 2026-11-13. Settings → Recording sets it.
 *
 * An input is a device and a channel on it, mono or a stereo pair. The
 * device is either one Vamp for Mac offers (it records that device itself,
 * ADR-533), named by its Core Audio UID, or none (`''`): Live's own audio
 * input, Ext. In, which the track's Vamp-Capture records.
 *
 * The input belongs to the rig (which jack the mic is in), not to a track
 * or a take, so it is one setting, kept in this screen's localStorage with
 * the same guarded read/write as uiPrefsStore. The device's name and input
 * count are kept beside its UID, so the choice still reads right while Vamp
 * for Mac is not offering it.
 */

export type ChannelMode = 'stereo' | 'mono';

/** One input device Vamp for Mac offers (`/capture/input/devices`). */
export interface InputDevice {
	uid: string;
	name: string;
	/** Its input channels, across all its input streams. */
	inputs: number;
}

/** How many inputs Live's Ext. In is offered with when no device is picked. */
export const LIVE_INPUTS = 8;

/**
 * The channels a device with `inputs` inputs offers, as Live names them:
 * stereo pairs `1/2`, `3/4`, … (an odd last input has none), or each input
 * alone.
 */
export function channelsFor(inputs: number, mode: ChannelMode): string[] {
	const n = Math.max(0, Math.floor(inputs));
	if (mode === 'mono') return Array.from({ length: n }, (_, i) => String(i + 1));
	return Array.from({ length: Math.floor(n / 2) }, (_, i) => `${2 * i + 1}/${2 * i + 2}`);
}

/** A channel name's mode: a pair has a slash. */
export function modeOf(channel: string): ChannelMode {
	return channel.includes('/') ? 'stereo' : 'mono';
}

/**
 * The channel to land on when the mode flips: the pair's first input going
 * mono, the pair an input belongs to going stereo, each kept inside `inputs`.
 */
export function switchMode(channel: string, mode: ChannelMode, inputs: number): string {
	const options = channelsFor(inputs, mode);
	const first = Number.parseInt(channel, 10);
	const want =
		mode === 'mono'
			? String(Number.isFinite(first) ? first : 1)
			: Number.isFinite(first)
				? `${first % 2 === 1 ? first : first - 1}/${first % 2 === 1 ? first + 1 : first}`
				: '1/2';
	return options.includes(want) ? want : (options[0] ?? '');
}

const CHANNEL_KEY = 'captureSettings.channel';
const DEVICE_KEY = 'captureSettings.device';

function read(key: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private mode or a full store: the setting lasts this session.
	}
}

function readDevice(): InputDevice | null {
	try {
		const d = JSON.parse(read(DEVICE_KEY) || 'null');
		return d && typeof d.uid === 'string' && d.uid && typeof d.name === 'string' && Number.isInteger(d.inputs)
			? { uid: d.uid, name: d.name, inputs: d.inputs }
			: null;
	} catch {
		return null;
	}
}

let channel = $state<string>(read(CHANNEL_KEY) || '1/2');
let device = $state<InputDevice | null>(readDevice());

export const captureSettings = {
	get channel(): string {
		return channel;
	},
	/** The picked device, or null for Live's own input (Ext. In). */
	get device(): InputDevice | null {
		return device;
	},
	/** The UID REC sends: '' for Live's own input. */
	get deviceUid(): string {
		return device?.uid ?? '';
	},
	/** How many inputs the picked device has to choose from. */
	get inputs(): number {
		return device?.inputs ?? LIVE_INPUTS;
	},
	get mode(): ChannelMode {
		return modeOf(channel);
	},
	setChannel(next: string): void {
		channel = next;
		write(CHANNEL_KEY, next);
	},
	setMode(next: ChannelMode): void {
		if (next === modeOf(channel)) return;
		captureSettings.setChannel(switchMode(channel, next, captureSettings.inputs));
	},
	/** Pick a device (null: Live's input). A channel it lacks moves to its first. */
	setDevice(next: InputDevice | null): void {
		device = next;
		write(DEVICE_KEY, JSON.stringify(next));
		const options = channelsFor(captureSettings.inputs, modeOf(channel));
		if (!options.includes(channel)) {
			const fallback = options[0] ?? channelsFor(captureSettings.inputs, 'mono')[0] ?? '1';
			captureSettings.setChannel(fallback);
		}
	}
};
