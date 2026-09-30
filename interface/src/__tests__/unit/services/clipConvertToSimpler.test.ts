/**
 * Convert an audio clip to a Simpler, and the capture flow beside it.
 *
 * Both gestures end with a sample on a Simpler the UI did not place and
 * cannot address: the convert flow never sees `clip.file_path` (it lives
 * server-side) and neither flow is told which device slot the Simpler
 * landed in. Since 2026-09-17 the surface says so directly, on
 * `/looping/v3/simpler/replaced`, and that ack is what drives the Recent
 * entry and the auto-trim write.
 *
 * What these cover: the tile appears on the tap rather than after the
 * round trip; the ack addresses the right device even when the new
 * track's insert shifted an existing device onto that same path (the
 * case the old "a devicePath that didn't exist when we armed" guess got
 * backwards); two flows in flight don't cross-resolve; and the capture
 * flow still trims when its ack goes missing on the UDP leg.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn(),
	sendClipDuplicateRegion: vi.fn()
}));
vi.mock('$lib/api/handlers/v3Clip', () => ({
	V3_CLIP_SET_LOOP_END_ADDRESS: '/looping/v3/clip/set_loop_end'
}));
vi.mock('$lib/stores/v3/normalized.svelte', () => ({
	applyPropertyValue: vi.fn(() => true)
}));
vi.mock('$lib/stores/session.svelte', () => ({
	requireFocusedClip: vi.fn(() => 'tracks/0/slots/0/clip')
}));
vi.mock('$lib/stores/v6/clipPropertiesStore.svelte', () => ({ clipPropertiesStore: {} }));
vi.mock('$lib/stores/clipReverse.svelte', () => ({
	clipReverseStore: { begin: vi.fn(), isReversing: false }
}));
vi.mock('$lib/services/clipContext', () => ({ getClipContext: vi.fn() }));
vi.mock('$lib/services/clipTranspose', () => ({
	transposeClip: vi.fn(),
	transposeClipUp: vi.fn(),
	transposeClipDown: vi.fn(),
	transposeDevice: vi.fn(),
	transposeDeviceUp: vi.fn(),
	transposeDeviceDown: vi.fn(),
	setAudioClipPitch: vi.fn()
}));
vi.mock('$lib/services/trackPreparation', () => ({
	prepareForPreset: vi.fn(async () => ({ trackPath: 'tracks/1', wasCreated: true }))
}));
vi.mock('$lib/stores/v6/recentInstrumentsStore.svelte', () => ({
	recentInstrumentsStore: { addSample: vi.fn() }
}));
vi.mock('$lib/services/clipSampleService', () => ({ requestSample: vi.fn() }));
vi.mock('$lib/stores/v6/selectedTrackStore.svelte', () => ({
	selectedTrackStore: {
		subscribeProperty: vi.fn(),
		propertyValue: vi.fn(),
		setParamValue: vi.fn(),
		setPropertyValue: vi.fn(),
		paramPath: vi.fn()
	}
}));

vi.mock('$lib/services/instrumentDisplayCoordinator.svelte', () => ({
	instrumentDisplayCoordinator: { requestInstrumentView: vi.fn() }
}));
vi.mock('$lib/components/v6/tracks/composables/useTrackData.svelte', () => ({
	selectTrackByIndex: vi.fn(async () => {})
}));

import { send } from '$lib/api/simpleClient';
import { instrumentDisplayCoordinator } from '$lib/services/instrumentDisplayCoordinator.svelte';
import { selectTrackByIndex } from '$lib/components/v6/tracks/composables/useTrackData.svelte';
import { recentInstrumentsStore } from '$lib/stores/v6/recentInstrumentsStore.svelte';
import { requestSample } from '$lib/services/clipSampleService';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { handleV3SimplerReplaced } from '$lib/api/handlers/v3SimplerReplaced';
import { handleV3PropertyValue } from '$lib/api/handlers/v3Property';
import { sampleClipToSimpler, loadCaptureIntoSimpler } from '$lib/services/clipOperations';

const CLIP = 'tracks/0/slots/0/clip';
const CONVERT = '/looping/v3/simpler/replace_sample';
const CAPTURE = '/looping/v3/simpler/replace_sample_onto_track';
const WAV = '/Users/Shared/Music/loops/Take 1.wav';

/** devicePath|propertyName → value, what the store would have cached. */
let props: Map<string, unknown>;
/** Every `(devicePath, propertyName)` the flow subscribed to itself. */
let subscribed: string[];

/** Let queued microtasks and the awaited peaks fetch settle. */
const settle = async () => {
	for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Stand in for the surface's `sample.length` echo landing. */
const echo = (devicePath: string, propertyName: string, value: unknown) => {
	props.set(`${devicePath}|${propertyName}`, value);
	handleV3PropertyValue([devicePath, propertyName, value as never]);
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ shouldAdvanceTime: true });
	props = new Map();
	subscribed = [];

	vi.mocked(selectedTrackStore.subscribeProperty).mockImplementation(
		(devicePath: string, propertyName: string) => {
			subscribed.push(`${devicePath}|${propertyName}`);
			return () => {};
		}
	);
	vi.mocked(selectedTrackStore.propertyValue).mockImplementation(
		(devicePath: string, propertyName: string) =>
			props.get(`${devicePath}|${propertyName}`) as never
	);
	vi.mocked(selectedTrackStore.paramPath).mockImplementation(
		(devicePath: unknown, index: number) => `${String(devicePath)}/params/${index}`
	);
	vi.mocked(requestSample).mockResolvedValue({
		isAudioClip: true,
		filePath: WAV,
		fileStartBeats: 0,
		fileEndBeats: 0
	});

	// The peaks endpoint: first transient at frame 4410 of a 44100-frame
	// sample, i.e. a tenth of the way in.
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => ({ firstTransientFrame: 4410 }) }))
	);
});

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('sampleClipToSimpler — the clip view convert', () => {
	it('sends the clip path and nothing else', async () => {
		await sampleClipToSimpler();
		expect(send).toHaveBeenCalledWith(CONVERT, [CLIP]);
	});

	it('adds the clip to Recent without waiting for the load', async () => {
		await sampleClipToSimpler();
		await settle();

		// No ack yet — this entry is the optimistic one.
		expect(recentInstrumentsStore.addSample).toHaveBeenCalledWith('Take 1', WAV, 'convert');
	});

	it('re-adds with the path the surface actually loaded', async () => {
		await sampleClipToSimpler();
		await settle();
		vi.mocked(recentInstrumentsStore.addSample).mockClear();

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', '/tmp/surface-chose-this.wav']);

		expect(recentInstrumentsStore.addSample).toHaveBeenCalledWith(
			'surface-chose-this',
			'/tmp/surface-chose-this.wav',
			'convert'
		);
	});

	it('still lands a Recent entry when the clip has no cached path', async () => {
		vi.mocked(requestSample).mockRejectedValue(new Error('timed out'));

		await sampleClipToSimpler();
		await settle();
		expect(recentInstrumentsStore.addSample).not.toHaveBeenCalled();

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', WAV]);
		expect(recentInstrumentsStore.addSample).toHaveBeenCalledWith('Take 1', WAV, 'convert');
	});

	it('auto-trims the Simpler the ack names, on a path that already existed', async () => {
		// The regression this ack was added for: converting a clip on
		// track 0 inserts a MIDI track at index 1, shifting whatever was
		// at 1 down to 2 — so the new Simpler takes `tracks/1/devices/0`,
		// a path some other device occupied a moment ago.
		await sampleClipToSimpler();
		await settle();

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', WAV]);
		echo('tracks/1/devices/0', 'sample.length', 44100);
		await settle();

		expect(selectedTrackStore.setParamValue).toHaveBeenCalledWith(
			'tracks/1/devices/0/params/3',
			0.1
		);
	});

	it('trims the Simpler behind Random Start, never Random Start itself', async () => {
		// A fresh track's real shape once the prepend lands: Random Start at
		// devices/0, the Simpler at devices/1. The surface holds its ack
		// until then (measured 2026-09-27: it used to name devices/0), and
		// everything here follows the path it names.
		await sampleClipToSimpler();
		await settle();

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/1', WAV]);
		echo('tracks/1/devices/1', 'sample.length', 44100);
		await settle();

		expect(subscribed).toEqual([
			'tracks/1/devices/1|sample.length',
			'tracks/1/devices/1|sample.start_marker'
		]);
		expect(vi.mocked(selectedTrackStore.setParamValue).mock.calls).toEqual([
			['tracks/1/devices/1/params/3', 0.1]
		]);
	});

	it('subscribes to what the write needs, so no view has to be mounted', async () => {
		await sampleClipToSimpler();
		await settle();
		expect(subscribed).toEqual([]);

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', WAV]);

		expect(subscribed).toEqual([
			'tracks/1/devices/0|sample.length',
			'tracks/1/devices/0|sample.start_marker'
		]);
	});

	it('ignores an ack from the capture flow', async () => {
		await sampleClipToSimpler();
		await settle();

		handleV3SimplerReplaced([CAPTURE, 'tracks/9/devices/0', '/tmp/other.wav']);
		echo('tracks/9/devices/0', 'sample.length', 44100);
		await settle();

		expect(selectedTrackStore.setParamValue).not.toHaveBeenCalled();
	});

	it('writes nothing when the brace moved first', async () => {
		await sampleClipToSimpler();
		await settle();

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', WAV]);
		// The user grabs the brace before our write lands.
		echo('tracks/1/devices/0', 'sample.start_marker', 12000);
		echo('tracks/1/devices/0', 'sample.length', 44100);
		await settle();

		expect(selectedTrackStore.setParamValue).not.toHaveBeenCalled();
	});

	it('writes nothing when sample.length never lands', async () => {
		await sampleClipToSimpler();
		await settle();

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', WAV]);
		await settle();

		expect(selectedTrackStore.setParamValue).not.toHaveBeenCalled();
	});
});

describe('the new Simpler on screen', () => {
	it('selects the converted track and asks for its instrument view', async () => {
		await sampleClipToSimpler();
		await settle();
		expect(selectTrackByIndex).not.toHaveBeenCalled();

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', WAV]);

		expect(instrumentDisplayCoordinator.requestInstrumentView).toHaveBeenCalledTimes(1);
		expect(selectTrackByIndex).toHaveBeenCalledWith(1);
	});

	it('selects the capture track once its Simpler is loaded', async () => {
		await loadCaptureIntoSimpler(WAV);
		await settle();
		expect(selectTrackByIndex).not.toHaveBeenCalled();

		handleV3SimplerReplaced([CAPTURE, 'tracks/3/devices/1', WAV]);

		expect(instrumentDisplayCoordinator.requestInstrumentView).toHaveBeenCalledTimes(1);
		expect(selectTrackByIndex).toHaveBeenCalledWith(3);
	});
});

describe('loadCaptureIntoSimpler — the capture flow', () => {
	it('auto-trims off its own ack', async () => {
		await loadCaptureIntoSimpler(WAV);
		await settle();

		handleV3SimplerReplaced([CAPTURE, 'tracks/1/devices/1', WAV]);
		echo('tracks/1/devices/1', 'sample.length', 44100);
		await settle();

		expect(selectedTrackStore.setParamValue).toHaveBeenCalledWith(
			'tracks/1/devices/1/params/3',
			0.1
		);
		expect(recentInstrumentsStore.addSample).toHaveBeenCalledWith('Take 1', WAV, 'capture');
	});

	it('falls back to the file_path echo when the ack goes missing', async () => {
		await loadCaptureIntoSimpler(WAV);
		await settle();

		// No ack — just the property echo a mounted view would produce.
		echo('tracks/1/devices/1', 'sample.file_path', WAV);
		echo('tracks/1/devices/1', 'sample.length', 44100);
		await settle();

		expect(selectedTrackStore.setParamValue).toHaveBeenCalledWith(
			'tracks/1/devices/1/params/3',
			0.1
		);
	});

	it('ignores an echo for a different capture', async () => {
		await loadCaptureIntoSimpler(WAV);
		await settle();

		echo('tracks/1/devices/1', 'sample.file_path', '/tmp/some-other-take.wav');
		echo('tracks/1/devices/1', 'sample.length', 44100);
		await settle();

		expect(selectedTrackStore.setParamValue).not.toHaveBeenCalled();
	});
});
