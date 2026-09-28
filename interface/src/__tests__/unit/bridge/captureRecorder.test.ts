/**
 * The capture recorder's two bridge-side facts (handlers/captureRecorder.js):
 * whether the device is there, from its once-a-second hello, and which folder
 * an unsaved set records into, from Live's newest temp project.
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
	REASON_WAITING,
	REASON_ABSENT
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
	function setup(recordings = '') {
		const features = createFeatureRegistry({}, { logger: quiet });
		const sent: Array<{ address: string; args: unknown[] }> = [];
		const recorder = createCaptureRecorder({
			features,
			logger: quiet,
			recordingsDir: recordings || join(tmpdir(), 'no-such-live-recordings-dir'),
			sendToDevice: (msg: { address: string; args: unknown[] }) => sent.push(msg),
			silenceMs: 3000
		});
		return { features, sent, recorder };
	}

	it('starts waiting, and says the device is missing after three silent seconds', () => {
		vi.useFakeTimers();
		const { features } = setup();
		expect(features.snapshot().captureRecorder).toEqual({ enabled: true, available: false, reason: REASON_WAITING });
		vi.advanceTimersByTime(3000);
		expect(features.snapshot().captureRecorder.reason).toBe(REASON_ABSENT);
	});

	it('is available while hellos arrive, and consumes them', () => {
		vi.useFakeTimers();
		const { features, recorder } = setup();
		for (let i = 0; i < 5; i++) {
			expect(recorder.onDeviceMessage({ address: '/capture/hello', args: [] })).toBe(true);
			vi.advanceTimersByTime(1000);
		}
		expect(features.isAvailable('captureRecorder')).toBe(true);
		vi.advanceTimersByTime(3000);
		expect(features.snapshot().captureRecorder).toEqual({ enabled: true, available: false, reason: REASON_ABSENT });
	});

	it('goes unavailable at once on bye', () => {
		vi.useFakeTimers();
		const { features, recorder } = setup();
		recorder.onDeviceMessage({ address: '/capture/hello', args: [] });
		expect(recorder.onDeviceMessage({ address: '/capture/bye', args: [] })).toBe(true);
		expect(features.snapshot().captureRecorder.reason).toBe(REASON_ABSENT);
	});

	it('passes state, file and error on to the clients', () => {
		vi.useFakeTimers();
		const { features, recorder } = setup();
		expect(recorder.onDeviceMessage({ address: '/capture/state', args: ['idle'] })).toBe(false);
		expect(recorder.onDeviceMessage({ address: '/capture/error', args: ['no-project-folder', ''] })).toBe(false);
		expect(features.isAvailable('captureRecorder')).toBe(true);
	});

	it('sends the newest temp project as /capture/folder', () => {
		const dir = recordingsDir([
			{ name: '2026-09-24 171506 Temp Project' },
			{ name: '2026-09-27 120922 Temp Project' }
		]);
		dirs.push(dir);
		const { sent, recorder } = setup(dir);
		recorder.sendProjectFolder();
		recorder.stop();
		expect(sent).toEqual([
			{ address: '/capture/folder', args: [{ type: 's', value: join(dir, '2026-09-27 120922 Temp Project') }] }
		]);
	});

	it('sends an empty folder when there is no temp project, so the device refuses and says why', () => {
		const { sent, recorder } = setup();
		recorder.sendProjectFolder();
		recorder.stop();
		expect(sent).toEqual([{ address: '/capture/folder', args: [{ type: 's', value: '' }] }]);
	});
});
