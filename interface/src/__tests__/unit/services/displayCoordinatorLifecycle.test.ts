/**
 * Display coordinators — `destroy()` must actually stop the effect.
 *
 * Both coordinators stand their watcher up inside `$effect.root(...)` and
 * **threw the disposer away**. An effect root is deliberately outside every
 * component tree — nothing else can ever collect it — so the returned function
 * is the only handle on it. `destroy()` cleared a couple of scalar fields and
 * left the effect running; `serviceCleanup.destroyAllServices()` then reported
 * "✓ destroyed" for a coordinator that was still writing to
 * `centralDisplayStore` on every focus change.
 *
 * `instrumentDisplayCoordinator` additionally carried a `private unsubscribers`
 * array that nothing ever pushed to, which is what made the teardown *look*
 * implemented.
 *
 * Both tests here fail against the pre-fix coordinators.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

// `browser` is FALSE under vitest — SvelteKit's `$app/environment` resolves to
// the server build here — and both coordinators open with `if (!browser)
// return`. Without this mock `initialize()` is a no-op and a lifecycle test
// passes by never having started anything.
vi.mock('$app/environment', () => ({ browser: true, dev: true, building: false, version: 'test' }));

import { tick } from 'svelte';
import { clipDisplayCoordinator } from '$lib/services/clipDisplayCoordinator.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { handleFocusedClipPath } from '$lib/stores/session.svelte';

function focus(track: number, scene: number) {
	handleFocusedClipPath(`tracks/${track}/slots/${scene}/clip`);
}

/**
 * The coordinator's own record of what it last saw, written at the top of
 * `handleDetailClipChange` before it reads anything reactive. Asserting on
 * this rather than on `centralDisplayStore` keeps the test clear of a
 * SEPARATE, pre-existing hazard in the same function — see the note at the
 * foot of this file.
 */
function seen() {
	return clipDisplayCoordinator.getCurrentClipIndices();
}

describe('clipDisplayCoordinator lifecycle', () => {
	beforeEach(() => {
		handleFocusedClipPath('');
		centralDisplayStore.setView('system');
	});

	afterEach(() => {
		clipDisplayCoordinator.destroy();
		handleFocusedClipPath('');
	});

	it('follows the focused clip while initialized', async () => {
		clipDisplayCoordinator.initialize();
		await tick();

		focus(2, 5);
		await tick();

		expect(seen()).toEqual({ track: 2, scene: 5 });
	});

	it('stops following after destroy()', async () => {
		clipDisplayCoordinator.initialize();
		await tick();
		focus(2, 5);
		await tick();
		expect(seen()).toEqual({ track: 2, scene: 5 });

		clipDisplayCoordinator.destroy();
		expect(seen()).toBeNull();

		focus(4, 1);
		await tick();

		// Pre-fix this read {track: 4, scene: 1}: the effect root outlived
		// destroy() and went on handling every focus change.
		expect(seen()).toBeNull();
	});

	it('a second initialize() does not stand up a second watcher', async () => {
		clipDisplayCoordinator.initialize();
		clipDisplayCoordinator.initialize();
		clipDisplayCoordinator.initialize();
		await tick();

		focus(1, 1);
		await tick();
		expect(seen()).toEqual({ track: 1, scene: 1 });

		// One destroy() is enough, because there is only ever one root. Pre-fix
		// there was no guard at all, so three roots ran and none could be stopped.
		clipDisplayCoordinator.destroy();
		focus(6, 6);
		await tick();
		expect(seen()).toBeNull();
	});

	it('re-initializes cleanly after a destroy', async () => {
		clipDisplayCoordinator.initialize();
		await tick();
		clipDisplayCoordinator.destroy();

		clipDisplayCoordinator.initialize();
		await tick();
		focus(3, 3);
		await tick();

		expect(seen()).toEqual({ track: 3, scene: 3 });
	});
});

/**
 * NOT tested here, deliberately, and NOT introduced by the teardown fix:
 * `handleDetailClipChange` READS `centralDisplayStore.view` and, when that
 * view is a clip view, WRITES it with a freshly allocated object — inside the
 * tracked effect. Driven from a test that initializes while a clip view is
 * already up, that throws Svelte's `effect_update_depth_exceeded`. It
 * reproduces identically against the pre-fix coordinator, so it is a separate
 * finding; see the batch 8 entry in Looping's documentation/code-quality-audit.md.
 */
