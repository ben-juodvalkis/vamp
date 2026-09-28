/**
 * Tests for the v3 Property Subscription Manager — PR-3.5.7-impl.
 *
 * Covers refcount lifecycle and the four reset/release variants:
 * - acquire: 0→1 fires subscribe, ≥1→N+1 does not.
 * - release: 1→0 fires unsubscribe, N→N-1 does not.
 * - releaseAll(devicePath): drops keys for that exact path, no wire.
 * - releaseUnderPath(path): drops keys for that path *or* anything
 *   beneath ${path}/, no wire.
 * - resetAll: empties the table, no wire.
 * - release on an unknown key: debug-no-op, no wire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import {
	acquire,
	release,
	releaseAll,
	releaseUnderPath,
	resetAll,
	setPropertySender,
	_refcountForTest,
	_allKeysForTest,
	V3_PROPERTY_SUBSCRIBE_ADDRESS,
	V3_PROPERTY_UNSUBSCRIBE_ADDRESS
} from '$lib/stores/v3/propertySubscriptions.svelte';

let sent: Array<{ address: string; args: unknown[] }>;

function captureSender() {
	sent = [];
	setPropertySender((address, args) => {
		sent.push({ address, args: args ?? [] });
	});
}

describe('propertySubscriptions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAll();
		captureSender();
	});

	describe('acquire / release refcount', () => {
		it('fires subscribe on 0 → 1 transition only', () => {
			expect(acquire('tracks/0/devices/0', 'playback_mode')).toBe(1);
			expect(acquire('tracks/0/devices/0', 'playback_mode')).toBe(2);
			expect(acquire('tracks/0/devices/0', 'playback_mode')).toBe(3);

			const subs = sent.filter((m) => m.address === V3_PROPERTY_SUBSCRIBE_ADDRESS);
			expect(subs).toHaveLength(1);
			expect(subs[0].args).toEqual(['tracks/0/devices/0', 'playback_mode']);
		});

		it('fires unsubscribe on 1 → 0 transition only', () => {
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/0', 'playback_mode');

			expect(release('tracks/0/devices/0', 'playback_mode')).toBe(2);
			expect(release('tracks/0/devices/0', 'playback_mode')).toBe(1);
			expect(release('tracks/0/devices/0', 'playback_mode')).toBe(0);

			const unsubs = sent.filter((m) => m.address === V3_PROPERTY_UNSUBSCRIBE_ADDRESS);
			expect(unsubs).toHaveLength(1);
			expect(unsubs[0].args).toEqual(['tracks/0/devices/0', 'playback_mode']);
		});

		it('refcounts (devicePath, propertyName) pairs independently', () => {
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/0', 'sample.gain');
			acquire('tracks/0/devices/1', 'playback_mode');

			expect(_refcountForTest('tracks/0/devices/0', 'playback_mode')).toBe(1);
			expect(_refcountForTest('tracks/0/devices/0', 'sample.gain')).toBe(1);
			expect(_refcountForTest('tracks/0/devices/1', 'playback_mode')).toBe(1);

			const subs = sent.filter((m) => m.address === V3_PROPERTY_SUBSCRIBE_ADDRESS);
			expect(subs).toHaveLength(3);
		});

		it('release on an unknown key is a no-op (no wire, no throw)', () => {
			expect(release('tracks/0/devices/0', 'never_acquired')).toBe(0);
			expect(sent).toHaveLength(0);
		});
	});

	describe('releaseAll(devicePath)', () => {
		it('drops every key for the exact devicePath without sending', () => {
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/0', 'sample.gain');
			acquire('tracks/0/devices/1', 'playback_mode');
			sent = [];

			expect(releaseAll('tracks/0/devices/0')).toBe(2);

			expect(sent).toHaveLength(0);
			expect(_refcountForTest('tracks/0/devices/0', 'playback_mode')).toBe(0);
			expect(_refcountForTest('tracks/0/devices/0', 'sample.gain')).toBe(0);
			expect(_refcountForTest('tracks/0/devices/1', 'playback_mode')).toBe(1);
		});

		it('does NOT drop keys belonging to a different device with the same prefix substring', () => {
			// Confirms releaseAll uses the exact `${devicePath}\u0000` prefix —
			// not a string startsWith on the path alone.
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/00', 'playback_mode'); // distinct device, NOT a child
			sent = [];

			releaseAll('tracks/0/devices/0');

			expect(_refcountForTest('tracks/0/devices/00', 'playback_mode')).toBe(1);
		});
	});

	describe('releaseUnderPath(path)', () => {
		it('drops keys whose devicePath equals path', () => {
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/1', 'playback_mode');
			sent = [];

			expect(releaseUnderPath('tracks/0/devices/0')).toBe(1);

			expect(sent).toHaveLength(0);
			expect(_refcountForTest('tracks/0/devices/0', 'playback_mode')).toBe(0);
			expect(_refcountForTest('tracks/0/devices/1', 'playback_mode')).toBe(1);
		});

		it('drops keys whose devicePath starts with `${path}/` (subtree)', () => {
			// Invalidate-by-track: path names a track, all device subs under
			// that track must drop.
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/1', 'sample.gain');
			acquire('tracks/1/devices/0', 'playback_mode');
			sent = [];

			expect(releaseUnderPath('tracks/0')).toBe(2);

			expect(_refcountForTest('tracks/0/devices/0', 'playback_mode')).toBe(0);
			expect(_refcountForTest('tracks/0/devices/1', 'sample.gain')).toBe(0);
			expect(_refcountForTest('tracks/1/devices/0', 'playback_mode')).toBe(1);
		});

		it('does not drop sibling paths that share a name prefix but no slash boundary', () => {
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/00/devices/0', 'playback_mode'); // sibling, NOT a child of tracks/0
			sent = [];

			releaseUnderPath('tracks/0');

			expect(_refcountForTest('tracks/00/devices/0', 'playback_mode')).toBe(1);
		});
	});

	describe('resetAll', () => {
		it('empties the refcount table without sending unsubscribes', () => {
			acquire('tracks/0/devices/0', 'playback_mode');
			acquire('tracks/0/devices/1', 'sample.gain');
			sent = [];

			resetAll();

			expect(sent).toHaveLength(0);
			expect(_allKeysForTest()).toEqual([]);
		});
	});
});
