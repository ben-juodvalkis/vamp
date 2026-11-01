/**
 * The capture recorder's bridge-side facts (handlers/captureRecorder.js):
 * which tracks have a recorder, from each copy's once-a-second hello; load,
 * then record, on a track without one; and which folder an unsaved set
 * records into, from Live's newest temp project.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'module';

const nodeRequire = createRequire(import.meta.url);
const {
	createCaptureRecorder,
	newestTempProject,
	DEVICE_LOAD_ADDRESS,
	DEVICE_DELETE_ADDRESS,
	DEVICE_SOURCE,
	DEVICE_REL
} = nodeRequire('../../../../bridge/handlers/captureRecorder.js');
const { createFeatureRegistry } = nodeRequire('../../../../bridge/utils/features.js');

const quiet = { info: () => {}, warn: () => {} };

function recordingsDir(projects: Array<{ name: string; marker?: boolean }>): string {
	const dir = mkdtempSync(join(tmpdir(), 'live-recordings-'));
	for (const { name, marker = true } of projects) {
		mkdirSync(join(dir, name));
		if (marker) mkdirSync(join(dir, name, 'Ableton Project Info'));
	}
	return dir;
}

const dirs: string[] = [];
afterEach(() => {
	vi.useRealTimers();
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('newestTempProject', () => {
	it('picks the newest by the name Live gives it, not by mtime', () => {
		const dir = recordingsDir([
			{ name: '2026-09-24 171506 Temp Project' },
			{ name: '2026-09-27 120922 Temp Project' },
			{ name: '2026-09-25 090000 Temp Project' }
		]);
		dirs.push(dir);
		expect(newestTempProject(dir)).toBe(join(dir, '2026-09-27 120922 Temp Project'));
	});

	it('skips a folder that is not a Live project, and anything not a temp project', () => {
		const dir = recordingsDir([
			{ name: '2026-09-26 100000 Temp Project' },
			{ name: '2026-09-27 120922 Temp Project', marker: false },
			{ name: 'zzz Project' }
		]);
		dirs.push(dir);
		expect(newestTempProject(dir)).toBe(join(dir, '2026-09-26 100000 Temp Project'));
	});

	it('answers empty for a missing folder', () => {
		expect(newestTempProject(join(tmpdir(), 'no-such-live-recordings-dir'))).toBe('');
	});
});

describe('createCaptureRecorder', () => {
	type Msg = { address: string; args: unknown[] };
	function setup(recordings = '') {
		const features = createFeatureRegistry({}, { logger: quiet });
		const sent: Msg[] = [];
		const surface: Msg[] = [];
		const clients: Msg[] = [];
		const recorder = createCaptureRecorder({
			features,
			logger: quiet,
			recordingsDir: recordings || join(tmpdir(), 'no-such-live-recordings-dir'),
			sendToDevice: (msg: Msg) => sent.push(msg),
			sendToSurface: (address: string, args: unknown[]) => surface.push({ address, args }),
			broadcast: (address: string, args: unknown[]) => clients.push({ address, args }),
			silenceMs: 3000,
			loadTimeoutMs: 8000,
			deleteAfterMs: 500
		});
		return { features, sent, surface, clients, recorder };
	}
	const hello = (track?: number) => ({ address: '/capture/hello', args: track === undefined ? [] : [{ type: 'i', value: track }] });
	const addresses = (msgs: Msg[]) => msgs.map((m) => m.address);
	const startArgs = (track: number, ...rest: string[]) => [{ type: 'i', value: track }, ...rest.map((value) => ({ type: 's', value }))];

	it('is available from the start: REC can always load a recorder', () => {
		const { features, recorder } = setup();
		expect(features.isAvailable('captureRecorder')).toBe(true);
		recorder.dispose();
	});

	it('consumes hellos and byes, and passes state, file, meter and error on', () => {
		const { recorder } = setup();
		expect(recorder.onDeviceMessage(hello(2))).toBe(true);
		expect(recorder.onDeviceMessage(hello())).toBe(true);
		expect(recorder.onDeviceMessage({ address: '/capture/bye', args: [] })).toBe(true);
		for (const address of ['/capture/state', '/capture/file', '/capture/meter', '/capture/error']) {
			expect(recorder.onDeviceMessage({ address, args: [] })).toBe(false);
		}
	});

	it('knows a track has a recorder while its hellos arrive, and ignores the old recorder\'s', () => {
		vi.useFakeTimers();
		const { recorder } = setup();
		recorder.onDeviceMessage(hello(2));
		recorder.onDeviceMessage(hello(0));
		recorder.onDeviceMessage(hello());
		recorder.onDeviceMessage({ address: '/capture/hello', args: [-1] });
		expect(recorder.tracksWithRecorder()).toEqual([0, 2]);
		vi.advanceTimersByTime(2000);
		recorder.onDeviceMessage(hello(2));
		vi.advanceTimersByTime(1500);
		expect(recorder.tracksWithRecorder()).toEqual([2]);
	});

	it('starts at once on a track that has a recorder: the folder first, then the start for that track', () => {
		const { sent, surface, recorder } = setup();
		recorder.onDeviceMessage(hello(3));
		recorder.start([{ type: 'i', value: 3 }, { type: 's', value: 'input' }, { type: 's', value: '1/2' }]);
		expect(surface).toEqual([]);
		expect(addresses(sent)).toEqual(['/capture/folder', '/capture/start']);
		expect(sent[1].args).toEqual(startArgs(3, 'input', '1/2'));
	});

	it('loads a recorder onto a track without one, and starts it on that copy\'s first hello', () => {
		vi.useFakeTimers();
		const { sent, surface, clients, recorder } = setup();
		recorder.start([1]);
		expect(surface).toEqual([{ address: DEVICE_LOAD_ADDRESS, args: ['tracks/1', '', '', DEVICE_SOURCE, DEVICE_REL] }]);
		expect(sent).toEqual([]);
		recorder.onDeviceMessage(hello(0));
		expect(sent).toEqual([]);
		vi.advanceTimersByTime(400);
		recorder.onDeviceMessage(hello(1));
		expect(addresses(sent)).toEqual(['/capture/folder', '/capture/start']);
		expect(sent[1].args).toEqual(startArgs(1));
		vi.advanceTimersByTime(10000);
		expect(clients).toEqual([]);
	});

	it('loads one recorder however many starts come while it loads', () => {
		vi.useFakeTimers();
		const { sent, surface, recorder } = setup();
		recorder.start([2]);
		recorder.start([2, 'input', '3']);
		expect(surface).toHaveLength(1);
		recorder.onDeviceMessage(hello(2));
		expect(addresses(sent)).toEqual(['/capture/folder', '/capture/start']);
		expect(sent[1].args).toEqual(startArgs(2, 'input', '3'));
	});

	it('says so when the recorder never loads, and lets REC go back to idle', () => {
		vi.useFakeTimers();
		const { sent, clients, recorder } = setup();
		recorder.start([4]);
		vi.advanceTimersByTime(8000);
		expect(addresses(clients)).toEqual(['/capture/error', '/capture/state']);
		expect(clients[0].args[0]).toBe('recorder-not-loaded');
		expect(clients[1].args).toEqual(['idle']);
		recorder.onDeviceMessage(hello(4));
		expect(sent).toEqual([]);
	});

	it('drops a start still waiting for its recorder when stop comes first', () => {
		vi.useFakeTimers();
		const { sent, clients, recorder } = setup();
		recorder.start([2]);
		recorder.stop();
		recorder.onDeviceMessage(hello(2));
		expect(addresses(sent)).toEqual(['/capture/stop']);
		vi.advanceTimersByTime(10000);
		expect(clients).toEqual([]);
	});

	it('deletes the recorder half a second after its take, and the next start loads a fresh one', () => {
		vi.useFakeTimers();
		const { sent, surface, recorder } = setup();
		recorder.onDeviceMessage(hello(2));
		const file = { address: '/capture/file', args: [{ type: 's', value: '/x/LOOPING_CAPTURE_1.wav' }, { type: 's', value: 'tracks/2/devices/3' }] };
		expect(recorder.onDeviceMessage(file)).toBe(false);
		expect(surface).toEqual([]);
		vi.advanceTimersByTime(500);
		expect(surface).toEqual([{ address: DEVICE_DELETE_ADDRESS, args: ['tracks/2/devices/3'] }]);
		recorder.start([2]);
		expect(surface[1].address).toBe(DEVICE_LOAD_ADDRESS);
		expect(sent).toEqual([]);
	});

	it('deletes nothing for a file that names no device (the old recorder)', () => {
		vi.useFakeTimers();
		const { surface, recorder } = setup();
		recorder.onDeviceMessage({ address: '/capture/file', args: ['/x/a.wav'] });
		recorder.onDeviceMessage({ address: '/capture/file', args: ['/x/a.wav', 'master'] });
		vi.advanceTimersByTime(1000);
		expect(surface).toEqual([]);
	});

	it('refuses a start with no track', () => {
		const { sent, surface, clients, recorder } = setup();
		recorder.start([]);
		recorder.start([-1]);
		expect(sent).toEqual([]);
		expect(surface).toEqual([]);
		expect(clients.filter((m) => m.address === '/capture/error').map((m) => m.args[0])).toEqual(['no-track', 'no-track']);
	});

	it('sends the newest temp project as /capture/folder', () => {
		const dir = recordingsDir([
			{ name: '2026-09-24 171506 Temp Project' },
			{ name: '2026-09-27 120922 Temp Project' }
		]);
		dirs.push(dir);
		const { sent, recorder } = setup(dir);
		recorder.sendProjectFolder();
		expect(sent).toEqual([
			{ address: '/capture/folder', args: [{ type: 's', value: join(dir, '2026-09-27 120922 Temp Project') }] }
		]);
	});

	it('sends an empty folder when there is no temp project, so the device refuses and says why', () => {
		const { sent, recorder } = setup();
		recorder.sendProjectFolder();
		expect(sent).toEqual([{ address: '/capture/folder', args: [{ type: 's', value: '' }] }]);
	});
});
