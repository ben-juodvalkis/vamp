/**
 * Prefix-match unit tests for messageRouter.
 *
 * Gate 5 extended `backendScope.pythonSurface` from exact-match-only
 * to "exact address OR prefix glob ending in `*`". The scope-partition
 * test exercises the production address catalogue end-to-end; this
 * file pins the primitive behaviour of the prefix matcher so a
 * regression there fails with a focused, readable diagnostic instead
 * of showing up as scope-partition fallout.
 *
 * Loads the live constants.json. A deliberately unknown-but-prefixed
 * address (`/looping/v2/__probe__`) is the smoke test: the scope-
 * partition catalogue can't list it because it's not a spec address,
 * but the prefix rule *must* still match it.
 *
 * @see interface/bridge/routing/messageRouter.js
 */

import { describe, it, expect } from 'vitest';
import { getRoutingTarget } from '../../../../bridge/routing/messageRouter.js';

describe('messageRouter prefix matching (backendScope glob)', () => {
	it('routes an unknown /looping/v2/* address to pythonSurface via the prefix glob', () => {
		// This address is deliberately not in any spec catalogue. The
		// prefix rule `/looping/v2/*` in constants.json must still match
		// it, otherwise accidentally-untested v2 addresses are dropped as
		// unroutable ('none').
		expect(getRoutingTarget('/looping/v2/__probe__/never/matches/a/handler')).toBe('pythonSurface');
	});

	it('routes every v2 sub-family to pythonSurface', () => {
		// One per §3.x group from 04-wire-protocol.md — not exhaustive,
		// just broad enough that a routing regression is visible.
		const samples = [
			'/looping/v2/session/set/anything',
			'/looping/v2/track/set/anything',
			'/looping/v2/devices/anything',
			'/looping/v2/device/anything',
			'/looping/v2/param/anything',
			'/looping/v2/slot/anything',
			'/looping/v2/clip/anything',
			'/looping/v2/scale/anything',
			'/looping/v2/capture/anything',
			'/looping/v2/master/anything',
			'/looping/v2/live_api/anything',
			'/looping/v2/debug/anything'
		];
		for (const addr of samples) {
			expect(getRoutingTarget(addr), addr).toBe('pythonSurface');
		}
	});

	it('exact-match entries still win over prefix fall-through', () => {
		// /looping/protocol/version is an exact-match entry; it must
		// route to pythonSurface even though there is no /looping/*
		// prefix rule (and the address has no /v2/ segment).
		expect(getRoutingTarget('/looping/protocol/version')).toBe('pythonSurface');
	});

	it('addresses outside the prefix are not captured by it', () => {
		// /looping/devices/complete_state is a long-retired M4L address
		// (04 §5.1). The /looping/v2/* prefix must not accidentally
		// capture it — different path shape, the glob must be anchored.
		// Its old owner, the Max observer, was removed 2026-09-23, so it
		// now routes nowhere: WebSocketServer logs and drops it.
		expect(getRoutingTarget('/looping/devices/complete_state')).toBe('none');
	});

	it('routes /looping/v3/* to pythonSurface via the prefix glob', () => {
		// Added in Phase-1 Commit B of the m4l-to-python-v3 migration
		// (see `config/constants.json` backendScope.pythonSurface). The
		// v3 address family is parallel to v2 during Phases 1–3; both
		// route to the Python surface. This test was a "no v3 scope
		// yet" canary under the original spec and now pins the shipped
		// behavior — the matcher still works alongside /v2/*.
		expect(getRoutingTarget('/looping/v3/foo')).toBe('pythonSurface');
		expect(getRoutingTarget('/looping/v3/state/full/tree')).toBe('pythonSurface');
		expect(getRoutingTarget('/looping/v3/param/set')).toBe('pythonSurface');
	});
});
