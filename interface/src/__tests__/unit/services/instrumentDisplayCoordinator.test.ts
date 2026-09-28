/**
 * instrumentDisplayCoordinator.test.ts — the view-switch decision.
 *
 * Covers `requestInstrumentView()`, the request a preset load arms before its
 * wire round trip so the central display lands on the instrument once Live
 * answers. The interesting part is that the request must survive the
 * device-list update that arrives with the track but WITHOUT the instrument —
 * that intermediate update is exactly where the plain auto-switch loses the
 * thread, since by the next one the track is no longer new.
 *
 * `handleTrackChange` is what the store `$effect` calls; the test drives it
 * directly rather than staging a reactive selectedTrackStore, so each update
 * is one explicit line.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('$lib/stores/v6/selectedTrackStore.svelte', () => ({
	selectedTrackStore: {
		get devicesByPath() { return []; },
		get trackIndex() { return 0; },
		get trackType() { return 'midi' as const; }
	}
}));

vi.mock('$lib/stores/v6/captureStore.svelte', () => ({
	captureStore: { get isActive() { return false; } }
}));

vi.mock('$lib/stores/v6/currentInstrumentStore.svelte', () => ({
	currentInstrumentStore: { setInstrument: vi.fn(), clear: vi.fn() }
}));

vi.mock('$lib/stores/v6/centralDisplayStore.svelte', () => {
	let view: { type: string; subType?: string } = { type: 'system' };
	return {
		centralDisplayStore: {
			get view() { return view; },
			setView: vi.fn((type: string, subType?: string) => {
				view = { type, subType };
			}),
			__setViewDirect: (v: { type: string; subType?: string }) => { view = v; }
		}
	};
});

vi.mock('$lib/services/instrumentService', () => ({
	instrumentService: {
		findInstrumentInDeviceList: vi.fn(),
		identifyInstrumentTypeAsync: vi.fn()
	}
}));

import { instrumentDisplayCoordinator } from '$lib/services/instrumentDisplayCoordinator.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { instrumentService } from '$lib/services/instrumentService';

const setView = centralDisplayStore.setView as unknown as ReturnType<typeof vi.fn>;
const setViewDirect = (centralDisplayStore as unknown as {
	__setViewDirect: (v: { type: string; subType?: string }) => void;
}).__setViewDirect;
const findInstrument = instrumentService.findInstrumentInDeviceList as unknown as ReturnType<typeof vi.fn>;
const identifyType = instrumentService.identifyInstrumentTypeAsync as unknown as ReturnType<typeof vi.fn>;

const INSTRUMENT = { name: 'Wavetable', className: 'InstrumentVector' };
// The coordinator only counts devices and hands them to instrumentService,
// which is mocked — so a placeholder is enough to make a list non-empty.
const DEVICES = [INSTRUMENT] as never[];

/** Drive one device-list update, the way the store `$effect` does. */
function update(
	trackIndex: number,
	trackType: 'midi' | 'audio' | null,
	devices: never[]
): Promise<void> {
	return (
		instrumentDisplayCoordinator as unknown as {
			handleTrackChange: (
				i: number,
				t: 'midi' | 'audio' | null,
				d: never[],
				c?: boolean
			) => Promise<void>;
		}
	).handleTrackChange(trackIndex, trackType, devices, false);
}

/** Put the coordinator on a known track with a known view, request cleared. */
async function settleOn(trackIndex: number, view: { type: string; subType?: string }) {
	findInstrument.mockReturnValue(null);
	await update(trackIndex, 'midi', [] as never[]);
	setViewDirect(view);
	setView.mockClear();
}

describe('instrumentDisplayCoordinator — instrument view request', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		identifyType.mockResolvedValue('wavetable');
		setViewDirect({ type: 'system' });
		// Reset the private state the singleton carries between tests.
		Object.assign(instrumentDisplayCoordinator, {
			currentInstrument: null,
			lastProcessedTrackIndex: null,
			skipNextAutoViewSwitch: false,
			instrumentViewRequestedAt: null
		});
	});

	it('switches to the instrument view when a load lands on the SAME track', async () => {
		// Replace mode, or Python reusing the track already selected: the track
		// never changes, so nothing here is "new".
		await settleOn(3, { type: 'clip' });

		instrumentDisplayCoordinator.requestInstrumentView();
		findInstrument.mockReturnValue(INSTRUMENT);
		await update(3, 'midi', DEVICES);

		expect(setView).toHaveBeenCalledWith('instrument', 'wavetable', { instrument: INSTRUMENT });
	});

	it('survives the empty-device update that precedes the instrument', async () => {
		await settleOn(3, { type: 'clip' });

		instrumentDisplayCoordinator.requestInstrumentView();

		// The track answers first, with no devices on it yet.
		findInstrument.mockReturnValue(null);
		await update(3, 'midi', [] as never[]);
		expect(setView).not.toHaveBeenCalled();

		// Then the device list arrives.
		findInstrument.mockReturnValue(INSTRUMENT);
		await update(3, 'midi', DEVICES);
		expect(setView).toHaveBeenCalledWith('instrument', 'wavetable', { instrument: INSTRUMENT });
	});

	it('is consumed once — a later instrument update does not re-hijack the view', async () => {
		await settleOn(3, { type: 'clip' });

		instrumentDisplayCoordinator.requestInstrumentView();
		findInstrument.mockReturnValue(INSTRUMENT);
		await update(3, 'midi', DEVICES);

		// User moves to the device view; the next device update must leave it.
		setViewDirect({ type: 'device', subType: 'reverb' });
		setView.mockClear();
		await update(3, 'midi', DEVICES);
		expect(setView).not.toHaveBeenCalled();
	});

	it('retires on an audio track — a sample loaded as a clip has no instrument', async () => {
		await settleOn(3, { type: 'system' });

		instrumentDisplayCoordinator.requestInstrumentView();
		await update(4, 'audio', [] as never[]);
		expect(setView).toHaveBeenCalledWith('clip', undefined, null, 'Clip');

		// Request gone: a later instrument on a settled MIDI track must not fire it.
		setViewDirect({ type: 'clip' });
		setView.mockClear();
		findInstrument.mockReturnValue(null);
		await update(5, 'midi', [] as never[]); // settle on 5 (new track → clip view)
		setViewDirect({ type: 'clip' });
		setView.mockClear();
		findInstrument.mockReturnValue(INSTRUMENT);
		await update(5, 'midi', DEVICES);
		expect(setView).not.toHaveBeenCalled();
	});

	it('expires rather than hijacking a much later selection', async () => {
		await settleOn(3, { type: 'clip' });

		instrumentDisplayCoordinator.requestInstrumentView();
		// 15s window; walk the clock past it.
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);

		findInstrument.mockReturnValue(INSTRUMENT);
		await update(3, 'midi', DEVICES);
		expect(setView).not.toHaveBeenCalled();

		vi.mocked(Date.now).mockRestore();
	});

	it('newest gesture wins between suppress and request', async () => {
		await settleOn(3, { type: 'clip' });

		// Request, then an explicit view choice: the choice is newer.
		instrumentDisplayCoordinator.requestInstrumentView();
		instrumentDisplayCoordinator.suppressAutoViewSwitch();
		findInstrument.mockReturnValue(INSTRUMENT);
		await update(3, 'midi', DEVICES);
		expect(setView).not.toHaveBeenCalled();

		// Suppress, then a load: the load is newer.
		instrumentDisplayCoordinator.suppressAutoViewSwitch();
		instrumentDisplayCoordinator.requestInstrumentView();
		await update(3, 'midi', DEVICES);
		expect(setView).toHaveBeenCalledWith('instrument', 'wavetable', { instrument: INSTRUMENT });
	});
});
