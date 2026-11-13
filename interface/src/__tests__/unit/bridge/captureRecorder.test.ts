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
	DEVICE_REL,
	APP_DEVICES,
	APP_START,
	APP_STOP,
	SET_PATH_QUERY
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

describe('an input device Vamp for Mac records (ADR-533)', () => {
	type Msg = { address: string; args: unknown[] };
	const BABYFACE = { uid: 'AppleUSBAudioEngine:RME:Babyface Pro', name: 'Babyface Pro', inputs: 14 };

	function setup(recordings = '') {
		const features = createFeatureRegistry({}, { logger: quiet });
		const sent: Msg[] = [];
		const surface: Msg[] = [];
		const clients: Msg[] = [];
		const app: Msg[] = [];
		const recorder = createCaptureRecorder({
			features,
			logger: quiet,
			recordingsDir: recordings || join(tmpdir(), 'no-such-live-recordings-dir'),
			sendToDevice: (msg: Msg) => sent.push(msg),
			sendToSurface: (address: string, args: unknown[]) => surface.push({ address, args }),
			broadcast: (address: string, args: unknown[]) => clients.push({ address, args }),
			silenceMs: 3000,
			setPathTimeoutMs: 1000
		});
		const toApp = (address: string, args: unknown[]) => app.push({ address, args });
		const appHello = (devices: unknown[] = [BABYFACE]) =>
			recorder.onAppMessage(toApp, { address: '/capture/input/hello', args: [JSON.stringify(devices)] });
		return { sent, surface, clients, app, recorder, toApp, appHello };
	}
	const start = (channel: string, uid: string) => [3, 'input', channel, uid];

	it('offers the app\'s devices to every client when they change, and none once its hellos stop', () => {
		vi.useFakeTimers();
		const { clients, recorder, appHello } = setup();
		expect(appHello()).toBe(true);
		appHello();
		expect(clients).toEqual([{ address: APP_DEVICES, args: [JSON.stringify([BABYFACE])] }]);
		expect(recorder.inputDevices()).toEqual([BABYFACE]);
		vi.advanceTimersByTime(3000);
		expect(clients.at(-1)).toEqual({ address: APP_DEVICES, args: ['[]'] });
		expect(recorder.inputDevices()).toEqual([]);
		recorder.dispose();
	});

	it('drops a device the app describes badly', () => {
		const { recorder, appHello } = setup();
		appHello([BABYFACE, { uid: '', name: 'x', inputs: 2 }, { uid: 'y', name: 'y', inputs: 0 }, 'junk']);
		expect(recorder.inputDevices()).toEqual([BABYFACE]);
		recorder.dispose();
	});

	it('asks the surface where the set is and starts the app beside the saved set', () => {
		const { sent, surface, app, recorder, appHello } = setup();
		appHello();
		recorder.start(start('3/4', BABYFACE.uid));
		expect(surface).toEqual([{ address: SET_PATH_QUERY, args: [] }]);
		expect(app).toEqual([]);
		expect(recorder.onSurfaceMessage({ address: SET_PATH_QUERY, args: [{ type: 's', value: '/Sets/Song Project/Song.als' }] })).toBe(true);
		expect(app).toEqual([{ address: APP_START, args: ['/Sets/Song Project', BABYFACE.uid, '3/4'] }]);
		// Live gets nothing loaded onto the track, and the Max device hears nothing.
		expect(sent).toEqual([]);
		expect(surface).toHaveLength(1);
		recorder.dispose();
	});

	it('records an unsaved set, or one whose surface does not answer, into Live\'s newest temp project', () => {
		vi.useFakeTimers();
		const dir = mkdtempSync(join(tmpdir(), 'live-recordings-'));
		dirs.push(dir);
		mkdirSync(join(dir, '2026-11-13 070000 Temp Project', 'Ableton Project Info'), { recursive: true });
		const { app, recorder, appHello } = setup(dir);
		appHello();
		recorder.start(start('5', BABYFACE.uid));
		recorder.onSurfaceMessage({ address: SET_PATH_QUERY, args: [''] });
		recorder.start(start('6', BABYFACE.uid));
		vi.advanceTimersByTime(1000);
		const folder = join(dir, '2026-11-13 070000 Temp Project');
		expect(app).toEqual([
			{ address: APP_START, args: [folder, BABYFACE.uid, '5'] },
			{ address: APP_START, args: [folder, BABYFACE.uid, '6'] }
		]);
		recorder.dispose();
	});

	it('refuses a device the app is not offering, and says so to every client', () => {
		const { clients, app, recorder, appHello } = setup();
		recorder.start(start('1/2', BABYFACE.uid));
		appHello();
		recorder.start(start('1/2', 'some-other-device'));
		const errors = clients.filter((m) => m.address === '/capture/error');
		expect(errors.map((m) => m.args[0])).toEqual(['no-input-device', 'no-input-device']);
		expect(app).toEqual([]);
		recorder.dispose();
	});

	it('relays the app\'s state, meter, file and error as the device\'s own', () => {
		const { clients, recorder, toApp } = setup();
		recorder.onAppMessage(toApp, { address: '/capture/input/state', args: ['recording'] });
		recorder.onAppMessage(toApp, { address: '/capture/input/meter', args: [0.5] });
		recorder.onAppMessage(toApp, { address: '/capture/input/file', args: ['/x/LOOPING_CAPTURE_1.wav'] });
		recorder.onAppMessage(toApp, { address: '/capture/input/error', args: ['mic-denied', 'no'] });
		expect(clients).toEqual([
			{ address: '/capture/state', args: ['recording'] },
			{ address: '/capture/meter', args: [0.5] },
			{ address: '/capture/file', args: ['/x/LOOPING_CAPTURE_1.wav'] },
			{ address: '/capture/error', args: ['mic-denied', 'no'] }
		]);
		expect(recorder.onAppMessage(toApp, { address: '/capture/state', args: [] })).toBe(false);
		recorder.dispose();
	});

	it('stops the app as well as the device, and a stop drops a start still waiting on the surface', () => {
		const { sent, app, recorder, appHello } = setup();
		appHello();
		recorder.start(start('1/2', BABYFACE.uid));
		recorder.stop();
		recorder.onSurfaceMessage({ address: SET_PATH_QUERY, args: ['/Sets/A/A.als'] });
		expect(app).toEqual([{ address: APP_STOP, args: [] }]);
		expect(sent.map((m) => m.address)).toEqual(['/capture/stop']);
		recorder.dispose();
	});

	it('still records Live\'s Ext. In through Vamp-Capture when no device is named', () => {
		const { surface, app, recorder, appHello } = setup();
		appHello();
		recorder.start([3, 'input', '1/2']);
		expect(surface[0].address).toBe(DEVICE_LOAD_ADDRESS);
		expect(app).toEqual([]);
		recorder.dispose();
	});
});
