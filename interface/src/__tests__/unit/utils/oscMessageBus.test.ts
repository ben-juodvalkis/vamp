/**
 * oscMessageBus — the inbound "every message" channel.
 *
 * It replaced a `CustomEvent` dispatched on `window` once per inbound message,
 * batch disassembly included. The steady-state listener count on that channel
 * is ZERO: both real consumers (`trackPreparation`, `trackOperations`) register
 * inside a per-request Promise and remove on settle. So meters, playheads and
 * song_time — the frames that make up almost all inbound traffic — were each
 * paying for an allocation and a dispatch with nobody on the other end.
 *
 * `dispatchOscMessage` returns whether it delivered, which is what lets the
 * short-circuit be asserted rather than assumed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	addOscMessageListener,
	removeOscMessageListener,
	dispatchOscMessage,
	oscMessageListenerCount,
	resetOscMessageBusForTests
} from '$lib/api/connection/oscMessageBus';

const METER = { address: '/looping/v3/track/meter', args: ['tracks/0', 0.4] };

describe('oscMessageBus', () => {
	beforeEach(() => resetOscMessageBusForTests());
	afterEach(() => resetOscMessageBusForTests());

	it('short-circuits when nobody is listening', () => {
		expect(oscMessageListenerCount()).toBe(0);
		expect(dispatchOscMessage(METER)).toBe(false);
	});

	it('delivers the message itself, not an event to unwrap', () => {
		const seen: unknown[] = [];
		addOscMessageListener((m) => seen.push(m));

		expect(dispatchOscMessage(METER)).toBe(true);
		expect(seen).toEqual([METER]);
	});

	it('stops delivering once the listener is removed', () => {
		const fn = vi.fn();
		addOscMessageListener(fn);
		dispatchOscMessage(METER);
		expect(fn).toHaveBeenCalledTimes(1);

		removeOscMessageListener(fn);
		expect(oscMessageListenerCount()).toBe(0);
		expect(dispatchOscMessage(METER)).toBe(false);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('registering the same function twice adds one listener, not two', () => {
		const fn = vi.fn();
		addOscMessageListener(fn);
		addOscMessageListener(fn);

		expect(oscMessageListenerCount()).toBe(1);
		dispatchOscMessage(METER);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('a listener that removes itself mid-dispatch does not skip its neighbours', () => {
		// Exactly what both real consumers do: settle() removes the handler
		// from inside the handler. Iterating the live Set would skip whoever
		// came after it.
		const after = vi.fn();
		const selfRemoving = vi.fn(() => removeOscMessageListener(selfRemoving));
		addOscMessageListener(selfRemoving);
		addOscMessageListener(after);

		dispatchOscMessage(METER);

		expect(selfRemoving).toHaveBeenCalledTimes(1);
		expect(after).toHaveBeenCalledTimes(1);
		expect(oscMessageListenerCount()).toBe(1);
	});

	it('a throwing listener does not take the others down with it', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const survivor = vi.fn();
		addOscMessageListener(() => { throw new Error('boom'); });
		addOscMessageListener(survivor);

		expect(() => dispatchOscMessage(METER)).not.toThrow();
		expect(survivor).toHaveBeenCalledTimes(1);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('removing a listener that was never added is a no-op', () => {
		expect(() => removeOscMessageListener(vi.fn())).not.toThrow();
		expect(oscMessageListenerCount()).toBe(0);
	});
});
