/**
 * Tests for captureStore - State management for Simpler-Record audio capture
 *
 * State machine: idle ↔ recording (no quantization, no beat sync).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing captureStore
vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

// Import after mocks are set up
import { captureStore, isCaptureState } from '$lib/stores/v6/captureStore.svelte';
import { send } from '$lib/api/simpleClient';
import { logger } from '$lib/utils/logger';

describe('captureStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isCaptureState type guard', () => {
		it('should return true for valid capture states', () => {
			expect(isCaptureState('idle')).toBe(true);
			expect(isCaptureState('recording')).toBe(true);
		});

		it('should return false for invalid strings', () => {
			expect(isCaptureState('pending')).toBe(false);
			expect(isCaptureState('stopping')).toBe(false);
			expect(isCaptureState('invalid')).toBe(false);
			expect(isCaptureState('IDLE')).toBe(false);
			expect(isCaptureState('Recording')).toBe(false);
			expect(isCaptureState('')).toBe(false);
		});

		it('should return false for non-string values', () => {
			expect(isCaptureState(null)).toBe(false);
			expect(isCaptureState(undefined)).toBe(false);
			expect(isCaptureState(0)).toBe(false);
			expect(isCaptureState(true)).toBe(false);
			expect(isCaptureState({})).toBe(false);
			expect(isCaptureState([])).toBe(false);
		});
	});

	describe('handleMessage - state updates', () => {
		it('should update state for valid capture state messages', () => {
			captureStore.handleMessage('/capture/state', ['recording']);
			expect(captureStore.state).toBe('recording');

			captureStore.handleMessage('/capture/state', ['idle']);
			expect(captureStore.state).toBe('idle');
		});

		it('should log warning for invalid state values', () => {
			captureStore.handleMessage('/capture/state', ['invalid_state']);
			expect(logger.warn).toHaveBeenCalledWith(
				'Unknown capture state received',
				{ state: 'invalid_state' }
			);
		});

		it('should not update state for invalid values', () => {
			captureStore.handleMessage('/capture/state', ['idle']);
			expect(captureStore.state).toBe('idle');

			captureStore.handleMessage('/capture/state', ['bogus']);
			expect(captureStore.state).toBe('idle');
		});
	});

	describe('handleMessage - file path updates', () => {
		it('should update lastFile for valid string values', () => {
			const filePath = '/project/Samples/Recorded/capture_20240115.wav';
			captureStore.handleMessage('/capture/file', [filePath]);
			expect(captureStore.lastFile).toBe(filePath);
			expect(logger.info).toHaveBeenCalledWith(
				'Capture file ready',
				{ path: filePath }
			);
		});

		it('should not update lastFile for non-string values', () => {
			captureStore.handleMessage('/capture/file', ['/some/path.wav']);
			expect(captureStore.lastFile).toBe('/some/path.wav');

			captureStore.handleMessage('/capture/file', [null]);
			expect(captureStore.lastFile).toBe('/some/path.wav');
		});
	});

	describe('OSC command senders', () => {
		it('start() should send /capture/start', () => {
			captureStore.start();
			expect(send).toHaveBeenCalledWith('/capture/start', []);
			expect(logger.info).toHaveBeenCalledWith('CAPTURE TX: start');
		});

		it('stop() should send /capture/stop', () => {
			captureStore.stop();
			expect(send).toHaveBeenCalledWith('/capture/stop', []);
			expect(logger.info).toHaveBeenCalledWith('CAPTURE TX: stop');
		});
	});

	describe('derived state', () => {
		it('isActive should be true only when recording', () => {
			captureStore.handleMessage('/capture/state', ['idle']);
			expect(captureStore.isActive).toBe(false);

			captureStore.handleMessage('/capture/state', ['recording']);
			expect(captureStore.isActive).toBe(true);
		});
	});

	describe('handleMessage - meter updates', () => {
		it('should update meterLevel for valid number values', () => {
			captureStore.handleMessage('/capture/meter', [0.5]);
			expect(captureStore.meterLevel).toBe(0.5);

			captureStore.handleMessage('/capture/meter', [0.75]);
			expect(captureStore.meterLevel).toBe(0.75);

			captureStore.handleMessage('/capture/meter', [0]);
			expect(captureStore.meterLevel).toBe(0);

			captureStore.handleMessage('/capture/meter', [1]);
			expect(captureStore.meterLevel).toBe(1);
		});

		it('should clamp meterLevel to maximum of 1', () => {
			captureStore.handleMessage('/capture/meter', [1.5]);
			expect(captureStore.meterLevel).toBe(1);

			captureStore.handleMessage('/capture/meter', [2.0]);
			expect(captureStore.meterLevel).toBe(1);
		});

		it('should clamp meterLevel to minimum of 0', () => {
			captureStore.handleMessage('/capture/meter', [-0.2]);
			expect(captureStore.meterLevel).toBe(0);

			captureStore.handleMessage('/capture/meter', [-1]);
			expect(captureStore.meterLevel).toBe(0);
		});

		it('should not update meterLevel for non-number values', () => {
			captureStore.handleMessage('/capture/meter', [0.5]);
			expect(captureStore.meterLevel).toBe(0.5);

			captureStore.handleMessage('/capture/meter', ['0.7']);
			expect(captureStore.meterLevel).toBe(0.5);

			captureStore.handleMessage('/capture/meter', [null]);
			expect(captureStore.meterLevel).toBe(0.5);

			captureStore.handleMessage('/capture/meter', [undefined]);
			expect(captureStore.meterLevel).toBe(0.5);
		});

		it('should log debug message on meter update', () => {
			captureStore.handleMessage('/capture/meter', [0.8]);
			expect(logger.debug).toHaveBeenCalledWith(
				'Capture meter updated',
				{ level: 0.8 }
			);
		});
	});

	describe('unhandled addresses', () => {
		it('should ignore unknown message addresses', () => {
			captureStore.handleMessage('/capture/unknown', ['data']);
			captureStore.handleMessage('/capture/quantization', ['1/4']);
			captureStore.handleMessage('/other/address', [1, 2, 3]);

			expect(logger.warn).not.toHaveBeenCalled();
		});
	});
});

describe('captureStore - the device answering a start', () => {
	it('is pending from the start until the device states anything', () => {
		captureStore.start();
		expect(captureStore.pending).toBe(true);
		captureStore.handleMessage('/capture/state', ['recording']);
		expect(captureStore.pending).toBe(false);
		captureStore.handleMessage('/capture/state', ['idle']);
	});

	it('lets a start go after two silent seconds, so it cannot latch forever', () => {
		vi.useFakeTimers();
		try {
			captureStore.start();
			vi.advanceTimersByTime(2000);
			expect(captureStore.pending).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ends the pending start and keeps the refusal on /capture/error', () => {
		captureStore.start();
		captureStore.handleMessage('/capture/error', ['no-project-folder', 'unsaved']);
		expect(captureStore.pending).toBe(false);
		expect(captureStore.lastError).toMatchObject({ code: 'no-project-folder', detail: 'unsaved' });
	});
});
