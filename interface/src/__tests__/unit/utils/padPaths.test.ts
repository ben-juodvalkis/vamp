import { describe, it, expect } from 'vitest';
import { padPathOf, parsePadPath, scopeKeyOf } from '$lib/utils/padPaths';

describe('padPaths — the note-keyed pad segment (issue #491, 3.8.0)', () => {
	it('composes and parses a pad path', () => {
		expect(padPathOf('tracks/1/devices/0', 38)).toBe('tracks/1/devices/0/pads/38');
		expect(parsePadPath('tracks/1/devices/0/pads/38')).toEqual({ rackPath: 'tracks/1/devices/0', note: 38, padPath: 'tracks/1/devices/0/pads/38' });
		expect(parsePadPath('tracks/1/devices/0/pads/38/devices/1/params/4')).toEqual({ rackPath: 'tracks/1/devices/0', note: 38, padPath: 'tracks/1/devices/0/pads/38' });
	});

	it('refuses what is not a pad path', () => {
		expect(parsePadPath('tracks/1/devices/0')).toBeNull();
		expect(parsePadPath('tracks/1/devices/0/pads/x')).toBeNull();
		expect(parsePadPath('tracks/1/devices/0/pads/128')).toBeNull();
		expect(parsePadPath('tracks/1/devices/0/pads/038')).toBeNull();
		expect(parsePadPath('/pads/3')).toBeNull();
	});

	it('names the scope a device path lives in', () => {
		expect(scopeKeyOf('tracks/1/devices/0/pads/38/devices/1')).toBe('tracks/1/devices/0/pads/38');
		expect(scopeKeyOf('tracks/1/devices/1')).toBe('');
	});
});
