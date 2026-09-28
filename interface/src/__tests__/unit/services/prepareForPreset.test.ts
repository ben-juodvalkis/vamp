/**
 * Regression tests for the atomic /looping/v3/track/prepare_for_preset
 * client in trackPreparation.ts.
 *
 * These cover the three pathologies the redesign was built to prevent:
 *
 * 1. Rapid double-tap → exactly one prepare round-trip (per-trackType
 *    single-flight queue).
 * 2. Acks correlate by request_id, not by "next of this type" — a
 *    delayed ack for an earlier request must not satisfy a later one.
 * 3. Server-side LRU is the source of truth for retransmit
 *    idempotency; the client just needs to mint unique IDs and trust
 *    Python's reply.
 *
 * The Python LRU itself is exercised in
 * ``surface/tests/test_track_prepare_component.py`` —
 * here we focus on the UI-side queue and request_id correlation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks must be hoisted before the SUT import.
vi.mock('$lib/api/simpleClient', () => ({
    send: vi.fn(),
}));
vi.mock('$lib/utils/logger', () => ({
    logger: {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    },
}));

import { send } from '$lib/api/simpleClient';
import { prepareForPreset, prepareTrack } from '$lib/services/trackPreparation';
import {
    dispatchOscMessage,
    oscMessageListenerCount,
    resetOscMessageBusForTests
} from '$lib/api/connection/oscMessageBus';

// The inbound channel is `oscMessageBus`, not a window CustomEvent, so
// synthetic acks go straight through `dispatchOscMessage` and the
// "did it clean up?" assertion reads a real count instead of a
// monkeypatched `window.addEventListener`.

beforeEach(() => {
    vi.clearAllMocks();
    resetOscMessageBusForTests();
});

afterEach(() => {
    vi.restoreAllMocks();
    resetOscMessageBusForTests();
});

function emitAck(requestId: string, trackPath: string, wasCreated: boolean) {
    dispatchOscMessage({
        address: '/looping/v3/track/prepare_for_preset/ack',
        args: [requestId, trackPath, wasCreated ? 1 : 0],
    });
}

function emitNack(requestId: string, code: string, detail: string) {
    dispatchOscMessage({
        address: '/looping/v3/track/prepare_for_preset/nack',
        args: [requestId, code, detail],
    });
}

/**
 * Flush enough microtasks for prepareForPreset's queue chain to land
 * its synchronous send() call. The queue uses `Promise.resolve().then(...)`
 * to chain prior requests, so the first send is exactly one microtask
 * after the prepareForPreset call.
 */
async function flushQueue(): Promise<void> {
    // Two ticks covers `.catch().then(doPrepareForPreset)` chain length.
    await Promise.resolve();
    await Promise.resolve();
}

function nthRequestId(n: number): string {
    const sendMock = send as unknown as ReturnType<typeof vi.fn>;
    const call = sendMock.mock.calls[n];
    if (!call) throw new Error(`no send call #${n}`);
    const [address, args] = call as [string, unknown[]];
    expect(address).toBe('/looping/v3/track/prepare_for_preset');
    return String((args as unknown[])[0]);
}

describe('prepareForPreset', () => {
    it('sends one wire message per call carrying the request_id', async () => {
        const sendMock = send as unknown as ReturnType<typeof vi.fn>;
        const promise = prepareForPreset('midi', '/x.adv');
        await flushQueue();
        expect(sendMock).toHaveBeenCalledTimes(1);
        const [address, args] = sendMock.mock.calls[0] as [string, unknown[]];
        expect(address).toBe('/looping/v3/track/prepare_for_preset');
        // [request_id, track_type, preset_path, target_track_path].
        // The 4th arg is always sent (empty = auto reuse-vs-create).
        expect(args).toHaveLength(4);
        const [rid, type, path, target] = args as [string, string, string, string];
        expect(rid).toBeTruthy();
        expect(type).toBe('midi');
        expect(path).toBe('/x.adv');
        expect(target).toBe('');

        emitAck(rid, 'tracks/3', true);
        const result = await promise;
        expect(result).toEqual({ trackPath: 'tracks/3', trackIndex: 3, wasCreated: true });
    });

    it('sends the target_track_path when replace-instrument mode pins a track', async () => {
        const sendMock = send as unknown as ReturnType<typeof vi.fn>;
        const promise = prepareForPreset('midi', '/x.adv', 'tracks/3');
        await flushQueue();
        const [, args] = sendMock.mock.calls[0] as [string, unknown[]];
        const [rid, type, path, target] = args as [string, string, string, string];
        expect(type).toBe('midi');
        expect(path).toBe('/x.adv');
        expect(target).toBe('tracks/3');

        // Replace acks with was_created=0 — instrument swapped in place.
        emitAck(rid, 'tracks/3', false);
        const result = await promise;
        expect(result).toEqual({ trackPath: 'tracks/3', trackIndex: 3, wasCreated: false });
    });

    it('rejects on nack', async () => {
        const promise = prepareForPreset('midi', '/missing.adv');
        await flushQueue();
        const rid = nthRequestId(0);
        emitNack(rid, 'load-failed', 'path-not-found');
        await expect(promise).rejects.toThrow(/load-failed/);
    });

    it('ignores acks with mismatched request_id', async () => {
        const promise = prepareForPreset('midi', '/x.adv');
        await flushQueue();
        // Wrong id arrives first — must not satisfy our promise.
        emitAck('some-other-id', 'tracks/99', true);

        let settled = false;
        promise.then(() => { settled = true; }, () => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        // Correct id arrives — now we resolve.
        const rid = nthRequestId(0);
        emitAck(rid, 'tracks/3', false);
        const result = await promise;
        expect(result.trackPath).toBe('tracks/3');
    });

    it('serializes rapid same-type calls so the second sends only after the first acks', async () => {
        // Tap 1: prepares MIDI (no preset).
        const p1 = prepareForPreset('midi', '');
        // Tap 2: same type, fired immediately — should be queued.
        const p2 = prepareForPreset('midi', '/x.adv');

        await flushQueue();
        const sendMock = send as unknown as ReturnType<typeof vi.fn>;
        // Only the first call has been sent so far; the second is
        // waiting for the first to settle.
        expect(sendMock).toHaveBeenCalledTimes(1);

        const rid1 = nthRequestId(0);
        emitAck(rid1, 'tracks/2', true);
        await p1;

        // Now the second call gets sent — and Python's reuse decision
        // sees the empty track from tap 1 and reuses it.
        await flushQueue();
        expect(sendMock).toHaveBeenCalledTimes(2);
        const rid2 = nthRequestId(1);
        expect(rid2).not.toBe(rid1);

        emitAck(rid2, 'tracks/2', false);  // reuse
        const result2 = await p2;
        expect(result2).toEqual({ trackPath: 'tracks/2', trackIndex: 2, wasCreated: false });
    });

    it('runs distinct trackTypes concurrently (not serialized)', async () => {
        const pa = prepareForPreset('audio', '');
        const pm = prepareForPreset('midi', '');

        await flushQueue();
        const sendMock = send as unknown as ReturnType<typeof vi.fn>;
        // Both wires fire immediately — no cross-type queueing.
        expect(sendMock).toHaveBeenCalledTimes(2);
        const ridA = nthRequestId(0);
        const ridM = nthRequestId(1);

        emitAck(ridM, 'tracks/4', true);
        emitAck(ridA, 'tracks/3', true);

        const [resultA, resultM] = await Promise.all([pa, pm]);
        expect(resultA.trackPath).toBe('tracks/3');
        expect(resultM.trackPath).toBe('tracks/4');
    });

    it('a previous failure does not block subsequent same-type calls', async () => {
        const p1 = prepareForPreset('midi', '/missing.adv');
        await flushQueue();
        const rid1 = nthRequestId(0);
        emitNack(rid1, 'load-failed', 'path-not-found');
        await expect(p1).rejects.toThrow();

        // Subsequent call must still proceed.
        const p2 = prepareForPreset('midi', '/x.adv');
        await flushQueue();
        const sendMock = send as unknown as ReturnType<typeof vi.fn>;
        expect(sendMock).toHaveBeenCalledTimes(2);
        const rid2 = nthRequestId(1);
        emitAck(rid2, 'tracks/3', true);
        await expect(p2).resolves.toMatchObject({ trackPath: 'tracks/3' });
    });

    it('removes its osc-message listener after settling', async () => {
        const p = prepareForPreset('midi', '');
        await flushQueue();
        expect(oscMessageListenerCount()).toBe(1);
        const rid = nthRequestId(0);
        emitAck(rid, 'tracks/1', true);
        await p;
        expect(oscMessageListenerCount()).toBe(0);
    });
});

describe('prepareTrack (compat wrapper)', () => {
    it('returns the trackIndex on success', async () => {
        const p = prepareTrack('midi');
        await flushQueue();
        const rid = nthRequestId(0);
        emitAck(rid, 'tracks/5', true);
        await expect(p).resolves.toBe(5);
    });

    it('returns undefined on failure (does not throw)', async () => {
        const p = prepareTrack('midi');
        await flushQueue();
        const rid = nthRequestId(0);
        emitNack(rid, 'create-failed', 'something broke');
        await expect(p).resolves.toBeUndefined();
    });
});
