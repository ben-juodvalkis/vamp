/**
 * Client-declared ETag (protocol 3.5.0) — UI half.
 *
 * The surface used to decide whether to re-ship the tree from what
 * *it* last sent. That is the wrong question on a reconnect (this
 * client may have dropped state) and wrong again with two UIs
 * connected. So the client declares what it holds.
 *
 * Three things must hold, in descending order of how badly they hurt
 * when broken:
 *
 * 1. **Never claim a tree you don't have.** The surface would confirm
 *    it and the UI would sit empty with no error and no retry. Hence
 *    "record only after a clean apply" and "dropping the tree drops
 *    the claim".
 * 2. **Never apply another client's marker.** Every emit fans out to
 *    every UI, so a marker minted for the Mac also lands on the iPad.
 *    Acting on it would advance `generation` over a stale tree.
 * 3. Declaring nothing must behave exactly as it did before 3.5.0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	ETAG_PREFIX,
	MAX_HELD_ETAGS,
	clearHeldEtags,
	formatEtag,
	getHeldEtag,
	heldEtagCount,
	heldEtagToken,
	recordAppliedEtag
} from '$lib/api/handlers/stateFullEtagStore';
import {
	V3_STATE_FULL_UNCHANGED_ADDRESS,
	handleV3StateFullUnchanged
} from '$lib/api/handlers/v3StateFull';
import {
	_resetForTests,
	replaceTree,
	setHandshake,
	v3Store
} from '$lib/stores/v3/normalized.svelte';

beforeEach(() => {
	_resetForTests();
	clearHeldEtags();
});

// --- the store -------------------------------------------------------------

describe('held-ETag store', () => {
	it('formats a checksum the way the wire carries it', () => {
		expect(formatEtag(0x0f6edcf5)).toBe('0x0f6edcf5');
	});

	it('pads short checksums to eight hex digits', () => {
		// The surface formats with "0x%08x"; an unpadded value would
		// never compare equal.
		expect(formatEtag(0x1)).toBe('0x00000001');
	});

	it('renders a signed int32 as unsigned', () => {
		// A checksum that arrived through a signed path must not render
		// with a minus sign.
		expect(formatEtag(-1)).toBe('0xffffffff');
	});

	it('holds nothing before anything is applied', () => {
		expect(getHeldEtag()).toBeNull();
		expect(heldEtagToken()).toBeNull();
	});

	it('records and returns the whole-song ETag', () => {
		recordAppliedEtag(null, 0x0f6edcf5);
		expect(getHeldEtag()).toBe('0x0f6edcf5');
		expect(heldEtagToken()).toBe(`${ETAG_PREFIX}0x0f6edcf5`);
	});

	it('keeps scopes independent', () => {
		recordAppliedEtag(null, 0x11111111);
		recordAppliedEtag('tracks/0', 0x22222222);
		expect(getHeldEtag()).toBe('0x11111111');
		expect(getHeldEtag('tracks/0')).toBe('0x22222222');
	});

	it('treats undefined scope as whole-song', () => {
		recordAppliedEtag(undefined, 0x33333333);
		expect(getHeldEtag(null)).toBe('0x33333333');
	});

	it('overwrites on re-record rather than accumulating', () => {
		recordAppliedEtag(null, 0x1);
		recordAppliedEtag(null, 0x2);
		expect(getHeldEtag()).toBe('0x00000002');
		expect(heldEtagCount()).toBe(1);
	});

	it('is bounded', () => {
		for (let i = 0; i < MAX_HELD_ETAGS + 10; i++) {
			recordAppliedEtag(`tracks/${i}`, i);
		}
		expect(heldEtagCount()).toBe(MAX_HELD_ETAGS);
		expect(getHeldEtag('tracks/0')).toBeNull();
		expect(getHeldEtag(`tracks/${MAX_HELD_ETAGS + 9}`)).not.toBeNull();
	});

	it('refreshes recency on read so a hot scope survives churn', () => {
		recordAppliedEtag(null, 0xaaaaaaaa);
		for (let i = 0; i < MAX_HELD_ETAGS - 1; i++) {
			recordAppliedEtag(`tracks/${i}`, i);
		}
		// Touch the whole-song entry, then push past the cap.
		expect(getHeldEtag()).toBe('0xaaaaaaaa');
		recordAppliedEtag('tracks/999', 1);
		expect(getHeldEtag()).toBe('0xaaaaaaaa');
	});

	it('clears everything on demand', () => {
		recordAppliedEtag(null, 0x1);
		clearHeldEtags();
		expect(getHeldEtag()).toBeNull();
	});
});

// --- hazard 1: never claim a tree you no longer hold ------------------------

describe('dropping the tree drops the claim', () => {
	it('resetForSurfaceRestart clears the held ETag', async () => {
		const { resetForSurfaceRestart } = await import(
			'$lib/stores/v3/normalized.svelte'
		);
		recordAppliedEtag(null, 0x0f6edcf5);
		resetForSurfaceRestart();

		// If this leaked, the immediately-following hello would declare
		// a tree we just deleted, the surface would answer "unchanged",
		// and the UI would sit empty forever with no error and no retry.
		expect(getHeldEtag()).toBeNull();
		expect(heldEtagToken()).toBeNull();
	});

	it('resetTree clears the held ETag', async () => {
		const { resetTree } = await import('$lib/stores/v3/normalized.svelte');
		recordAppliedEtag(null, 0x0f6edcf5);
		resetTree();
		expect(getHeldEtag()).toBeNull();
	});
});

// --- hazard 2: never apply another client's marker --------------------------

describe('handleV3StateFullUnchanged', () => {
	function marker(sessionId: string, generation = 42) {
		return ['accept', generation, sessionId, '0x0f6edcf5'];
	}

	it('stamps the generation when the marker is ours', () => {
		setHandshake('sess-mine', 1);
		replaceTree(1, []);
		handleV3StateFullUnchanged(marker('sess-mine', 42));
		expect(v3Store.generation).toBe(42);
	});

	it('ignores a marker minted for another client', () => {
		// The Mac and the iPad both receive every emit. Acting on the
		// other client's marker would advance our generation over a
		// tree that may be older — silent corruption.
		setHandshake('sess-mine', 7);
		handleV3StateFullUnchanged(marker('sess-theirs', 42));
		expect(v3Store.generation).toBe(7);
	});

	it('ignores a marker with no session id', () => {
		setHandshake('sess-mine', 7);
		handleV3StateFullUnchanged(marker('', 42));
		expect(v3Store.generation).toBe(7);
	});

	it('ignores a marker when we have no session', () => {
		_resetForTests();
		handleV3StateFullUnchanged(marker('sess-any', 42));
		expect(v3Store.generation).not.toBe(42);
	});

	it('leaves the tree untouched', () => {
		setHandshake('sess-mine', 1);
		replaceTree(1, [
			{
				trackPath: 'tracks/0',
				name: 'Drums',
				color: 0,
				mute: false,
				solo: false,
				arm: false,
				hasMidiInput: false,
				hasAudioInput: false,
				hasArrangementClips: false,
				volume: 0.85,
				isFoldable: false,
				foldState: 0,
				groupTrackIndex: -1,
				devices: new Map(),
				slots: new Map()
			} as never
		]);
		const before = v3Store.tracks.get('tracks/0');

		handleV3StateFullUnchanged(marker('sess-mine', 99));

		expect(v3Store.tracks.get('tracks/0')).toBe(before);
		expect(v3Store.generation).toBe(99);
	});

	it('refuses an unusable generation rather than corrupting the stamp', () => {
		// `toNumber` coerces garbage to 0, which is UNSET_GENERATION.
		// Stamping it would reset us to "no generation yet" and every
		// outbound param/set would then be rejected as stale.
		setHandshake('sess-mine', 7);
		handleV3StateFullUnchanged(['accept', 'not-a-number', 'sess-mine', '0x1']);
		expect(v3Store.generation).toBe(7);
	});

	it('refuses an explicit generation of 0', () => {
		setHandshake('sess-mine', 7);
		handleV3StateFullUnchanged(['accept', 0, 'sess-mine', '0x1']);
		expect(v3Store.generation).toBe(7);
	});

	it('refuses a negative generation', () => {
		setHandshake('sess-mine', 7);
		handleV3StateFullUnchanged(['accept', -3, 'sess-mine', '0x1']);
		expect(v3Store.generation).toBe(7);
	});

	it('is registered on the documented address', () => {
		expect(V3_STATE_FULL_UNCHANGED_ADDRESS).toBe(
			'/looping/v3/state/full/unchanged'
		);
	});
});

// --- declaring the ETag on the wire ----------------------------------------

describe('declaring the held ETag', () => {
	type Emission = { address: string; args: unknown[] };
	let emissions: Emission[] = [];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let handshake: any;

	beforeEach(async () => {
		emissions = [];
		handshake = await import('$lib/api/handlers/v3Handshake');
		handshake.setSender((address: string, args: unknown[]) =>
			emissions.push({ address, args })
		);
	});

	afterEach(() => {
		handshake.__clearHelloRetryForTests();
	});

	it('omits the ETag on a cold start', () => {
		// Claiming nothing is what makes the surface send the whole
		// tree, which is the only correct answer when we have none.
		handshake.sendHandshakeHello();
		expect(emissions[0].args).toEqual([...handshake.UI_SUPPORTED_VERSIONS]);
	});

	it('appends the ETag once a bundle has been applied', () => {
		recordAppliedEtag(null, 0x0f6edcf5);
		handshake.sendHandshakeHello();
		expect(emissions[0].args).toEqual([
			...handshake.UI_SUPPORTED_VERSIONS,
			'etag:0x0f6edcf5'
		]);
	});

	it('puts the ETag last so version negotiation is unaffected', () => {
		// A 3.4.0 surface intersects the whole list against its own
		// version tuple; the token simply fails to match. That is what
		// makes this bump safe without a fallback.
		recordAppliedEtag(null, 0x1);
		handshake.sendHandshakeHello();
		const args = emissions[0].args as string[];
		expect(args.at(-1)).toBe('etag:0x00000001');
		expect(args.slice(0, -1)).toEqual([...handshake.UI_SUPPORTED_VERSIONS]);
	});

	it('resync carries the session id and the ETag', () => {
		setHandshake('sess-mine', 3);
		recordAppliedEtag(null, 0x0f6edcf5);
		handshake.sendStateResync();
		expect(emissions[0].args).toEqual(['sess-mine', 'etag:0x0f6edcf5']);
	});

	it('resync omits the ETag when nothing is held', () => {
		setHandshake('sess-mine', 3);
		handshake.sendStateResync();
		expect(emissions[0].args).toEqual(['sess-mine']);
	});

	it('a surface restart makes the next hello cold again', async () => {
		// The full hazard-1 path end to end: apply, then lose the tree,
		// then re-hello. Declaring here would have the surface confirm a
		// tree we no longer hold and leave the UI empty.
		const { resetForSurfaceRestart } = await import(
			'$lib/stores/v3/normalized.svelte'
		);
		recordAppliedEtag(null, 0x0f6edcf5);
		resetForSurfaceRestart();
		handshake.sendHandshakeHello();
		expect(emissions[0].args).toEqual([...handshake.UI_SUPPORTED_VERSIONS]);
	});
});
