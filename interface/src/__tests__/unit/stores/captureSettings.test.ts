/**
 * Settings → Capture's input choice (ADR-533): the channels a device offers,
 * mono or stereo, and where the channel lands when the mode or device moves.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	captureSettings,
	channelsFor,
	switchMode,
	modeOf,
	LIVE_INPUTS
} from '$lib/stores/v6/captureSettingsStore.svelte';

describe('channelsFor', () => {
	it('names stereo pairs and mono inputs as Live does', () => {
		expect(channelsFor(4, 'stereo')).toEqual(['1/2', '3/4']);
		expect(channelsFor(4, 'mono')).toEqual(['1', '2', '3', '4']);
	});

	it('gives an odd last input no pair, and a mono device no pair at all', () => {
		expect(channelsFor(3, 'stereo')).toEqual(['1/2']);
		expect(channelsFor(1, 'stereo')).toEqual([]);
		expect(channelsFor(1, 'mono')).toEqual(['1']);
	});

	it('offers Live\'s Ext. In its eight inputs, as before', () => {
		expect(channelsFor(LIVE_INPUTS, 'stereo')).toEqual(['1/2', '3/4', '5/6', '7/8']);
		expect(channelsFor(LIVE_INPUTS, 'mono')).toHaveLength(8);
	});
});

describe('switchMode', () => {
	it('takes a pair\'s first input going mono, and an input\'s pair going stereo', () => {
		expect(switchMode('3/4', 'mono', 8)).toBe('3');
		expect(switchMode('3', 'stereo', 8)).toBe('3/4');
		expect(switchMode('4', 'stereo', 8)).toBe('3/4');
	});

	it('falls back to the first channel when the pair is not on the device', () => {
		expect(switchMode('3', 'stereo', 3)).toBe('1/2');
		expect(modeOf('1/2')).toBe('stereo');
		expect(modeOf('7')).toBe('mono');
	});
});

describe('captureSettings', () => {
	beforeEach(() => {
		captureSettings.setDevice(null);
		captureSettings.setChannel('1/2');
	});

	it('sends no device for Live\'s own input', () => {
		expect(captureSettings.deviceUid).toBe('');
		expect(captureSettings.inputs).toBe(LIVE_INPUTS);
	});

	it('moves a channel the new device lacks to its first, keeping the mode', () => {
		captureSettings.setChannel('7/8');
		captureSettings.setDevice({ uid: 'mic', name: 'USB Mic', inputs: 2 });
		expect(captureSettings.deviceUid).toBe('mic');
		expect(captureSettings.channel).toBe('1/2');
		captureSettings.setMode('mono');
		expect(captureSettings.channel).toBe('1');
	});

	it('lands a mono-only device on its one input', () => {
		captureSettings.setDevice({ uid: 'one', name: 'Mono Mic', inputs: 1 });
		expect(captureSettings.channel).toBe('1');
	});
});
