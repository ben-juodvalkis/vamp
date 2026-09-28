import { describe, it, expect } from 'vitest';
import { formatPresetPath } from '$lib/utils/presetPathFormatter';

describe('formatPresetPath', () => {
	it('formats a typical Ableton preset path', () => {
		expect(formatPresetPath('Synths/Analog/Bass/MyPatch.adv')).toBe(
			'Synths › Analog › Bass › MyPatch'
		);
	});

	it('strips each extension in the allow-list', () => {
		expect(formatPresetPath('A/B.adv')).toBe('A › B');
		expect(formatPresetPath('A/B.adg')).toBe('A › B');
		expect(formatPresetPath('A/B.alp')).toBe('A › B');
		expect(formatPresetPath('A/B.als')).toBe('A › B');
		expect(formatPresetPath('A/B.wav')).toBe('A › B');
		expect(formatPresetPath('A/B.aif')).toBe('A › B');
		expect(formatPresetPath('A/B.aiff')).toBe('A › B');
		expect(formatPresetPath('A/B.mp3')).toBe('A › B');
	});

	it('strips extensions case-insensitively', () => {
		expect(formatPresetPath('Synths/Analog/Bass/MyPatch.ADV')).toBe(
			'Synths › Analog › Bass › MyPatch'
		);
		expect(formatPresetPath('Kicks/Hit.WAV')).toBe('Kicks › Hit');
	});

	it('does NOT strip an extension that is not on the allow-list', () => {
		// A filename with a dot that isn't in STRIPPABLE_EXTENSIONS must be preserved.
		expect(formatPresetPath('Synths/My.Custom/Pack.xyz')).toBe(
			'Synths › My.Custom › Pack.xyz'
		);
		expect(formatPresetPath('Foo/Bar.txt')).toBe('Foo › Bar.txt');
	});

	it('only strips a single trailing extension, leaving other dots intact', () => {
		// "Patch.v2.adv" → the .adv is stripped, the .v2 remains.
		expect(formatPresetPath('Synths/Patch.v2.adv')).toBe('Synths › Patch.v2');
	});

	it('returns empty string for empty input', () => {
		expect(formatPresetPath('')).toBe('');
	});

	it('handles a single-segment path', () => {
		expect(formatPresetPath('MyPatch.adv')).toBe('MyPatch');
		expect(formatPresetPath('SingleFolder')).toBe('SingleFolder');
	});

	it('drops empty segments from leading, trailing, and double slashes', () => {
		expect(formatPresetPath('/Synths/Bass/Patch.adv')).toBe('Synths › Bass › Patch');
		expect(formatPresetPath('Synths//Bass/Patch.adv')).toBe('Synths › Bass › Patch');
		expect(formatPresetPath('Synths/Bass/Patch.adv/')).toBe('Synths › Bass › Patch');
	});

	it('preserves paths with no extension at all', () => {
		expect(formatPresetPath('Synths/Analog/Bass/NoExtension')).toBe(
			'Synths › Analog › Bass › NoExtension'
		);
	});
});
