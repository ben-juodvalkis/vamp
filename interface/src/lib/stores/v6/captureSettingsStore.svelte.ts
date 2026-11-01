/**
 * What REC records (capture.plan.md, issue #9): the selected track, or the
 * audio interface's input on one of its channels. Settings → Capture sets
 * it; REC sends it with every start, and the track's Vamp-Capture routes
 * its extra input to that Ext. In channel.
 *
 * The input belongs to the rig (which jack the mic is in), not to a track
 * or a take, so it is one setting, kept in this screen's localStorage with
 * the same guarded read/write as uiPrefsStore.
 */

export type CaptureSource = 'track' | 'input';

/** The channel names Live gives Ext. In: stereo pairs, then each mono input. */
export const CAPTURE_CHANNELS = ['1/2', '3/4', '5/6', '7/8', '1', '2', '3', '4', '5', '6', '7', '8'] as const;

const SOURCE_KEY = 'captureSettings.source';
const CHANNEL_KEY = 'captureSettings.channel';

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

let source = $state<CaptureSource>(read(SOURCE_KEY) === 'input' ? 'input' : 'track');
let channel = $state<string>(read(CHANNEL_KEY) || '1/2');

export const captureSettings = {
	get source(): CaptureSource {
		return source;
	},
	get channel(): string {
		return channel;
	},
	setSource(next: CaptureSource): void {
		source = next;
		write(SOURCE_KEY, next);
	},
	setChannel(next: string): void {
		channel = next;
		write(CHANNEL_KEY, next);
	}
};
