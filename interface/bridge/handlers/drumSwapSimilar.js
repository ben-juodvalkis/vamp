/**
 * Similar-sound swap for a Drum Rack kit or one pad (ADR-439 phase 3).
 *
 *   UI → bridge   /looping/v3/drum/swap_similar [requestId, rackPath, scope, direction]
 *                 scope: 'kit' | 'pad:<note>'; direction: 'next' | 'prev'
 *   bridge → UI   /looping/v3/drum/swap_similar/reply [requestId, ok, code, detail, resultJson]
 *                 (to the requesting client only)
 *
 * The bridge orchestrates because nothing else can. The surface runs on Live's
 * main thread, which is where Live services an Accessibility press, so a
 * surface handler must never wait for one; the AX helper, for its part, can
 * neither select a track nor read a pad's instrument. One swap is four hops,
 * each answered before the next goes out:
 *
 *   1. surface  /looping/v3/drum/show_for_swap — select the rack's track and
 *      device and, for a pad, the pad; open Live's undo step for the swap;
 *      acked with where the rack sits in TrackView.Device[N].
 *   2. helper   for a kit, read TrackView.Device[N].TitleBar.ShowSwapBar and
 *      press it when it is off, then press Live's own Swap All Next/Previous.
 *      The swap ends with the bar pressed off again, whatever happened.
 *      For a pad, find its Drum Sampler in the device view — the
 *      TrackView.Device[N].Device[K] titled with the pad's instrument name,
 *      which is also the proof that the view shows this pad — hover its
 *      waveform, where Live draws the sampler's swap buttons only under a
 *      pointer, and press its own Next/Previous. Never the rack grid's pad
 *      buttons: Live plays the pad when those are pressed, and the Drum
 *      Sampler's own swap without a sound (heard on the rig, 2026-09-15).
 *   3. surface  /looping/v3/drum/pad_names — the affected pads' instrument
 *      names and classes, before the press and after it, so the reply says
 *      what changed. A neighbor with the same file stem reads unchanged:
 *      reported, not an error.
 *   4. surface  /looping/v3/drum/finish_swap — rename the chains that were
 *      named after their sample, and close the undo step, so the swap and the
 *      renames undo as one. Sent whatever happened once step 1 went out: a
 *      failed press must not leave Live's undo step open. Its `open` flag is
 *      the surface saying whether it still had this rack's swap; `false` means
 *      the renames were dropped, and the reply's `detail` says so.
 *
 * One request is one press of Live's button, and Live keeps the reference its
 * ranking starts from. Candidate scope is Live's own — everything indexed.
 * Swaps run one at a time across every rack: each selects its own rack's
 * track, so two at once would press each other's buttons.
 */

const { helperReadiness } = require('../transport/AxHelperClient');

const SWAP_ADDRESS = '/looping/v3/drum/swap_similar';
const REPLY_ADDRESS = '/looping/v3/drum/swap_similar/reply';
const SHOW_ADDRESS = '/looping/v3/drum/show_for_swap';
const SHOW_ACK_ADDRESS = '/looping/v3/drum/show_for_swap/ack';
const NAMES_ADDRESS = '/looping/v3/drum/pad_names';
const NAMES_REPLY_ADDRESS = '/looping/v3/drum/pad_names/reply';
const FINISH_ADDRESS = '/looping/v3/drum/finish_swap';
const FINISH_ACK_ADDRESS = '/looping/v3/drum/finish_swap/ack';
const SURFACE_REPLIES = new Set([SHOW_ACK_ADDRESS, NAMES_REPLY_ADDRESS, FINISH_ACK_ADDRESS]);

const DIRECTIONS = new Set(['next', 'prev']);
const SWAP_BAR_TIMEOUT_MS = 2000;
// The Drum Sampler's buttons were in the tree 0.4 s after the hover on the rig;
// the helper posts the move once more before a miss is an error.
const HOVER_TIMEOUT_MS = 1000;
// Where a pad's Drum Sampler may sit among its chain's devices: first, or
// behind the MIDI effects Live keeps at the head of a chain.
const MAX_CHAIN_DEVICES = 4;
const DRUM_SAMPLER_CLASS = 'DrumCell';
// pad_names reads an instrument's name to this many characters.
const NAME_LIMIT = 64;
// Only for a caller that passes no `pressTimeoutS` — a test, or a config with
// no `axHelper` block. The bridge passes `constants.axHelper.messagingTimeoutS`.
const FALLBACK_PRESS_TIMEOUT_S = 15;
// What `finish_swap` answering `ok=1, {"open": false}` means: the surface had
// no swap open for this rack, so it renamed nothing and closed nothing.
// M5: one deadline over the whole swap, comfortably under the 60 s at which
// `DrumSwapComponent` expires the undo step `show_for_swap` opened. Every step
// after that point would be renaming chains inside a step Live has already
// closed, and the performer's own edits fold into `Undo Next Similar` for as
// long as it stays open (M3). Before this the hops only had their own
// timeouts: 4 surface hops at 3 s, a 7 s hover and a 20 s press add to ~36 s
// of nominal open step, and the audit's worst case was 119 s.
const SWAP_DEADLINE_MS = 45000;
// M3/M5: a helper `read` is a tree walk that answers in milliseconds. Without
// an explicit timeout each one inherits the client's `requestTimeoutMs`
// (`constants.axHelper.requestTimeoutMs`, 20 s), and this path can do three
// of them — 60 s of undo step in reads alone.
const READ_TIMEOUT_MS = 3000;
const FINISH_NOT_OPEN =
    'chain names not followed: the surface had no swap open for this rack (expired after 60 s, or superseded by another swap)';

class SwapError extends Error {
    /** @param {string} code @param {string} [detail] */
    constructor(code, detail = '') {
        super(detail ? `${code}: ${detail}` : code);
        this.code = code;
        this.detail = detail;
    }
}

/** An OSC arg as a plain value (osc.js hands either values or {type, value}). */
function plain(arg) {
    return arg && typeof arg === 'object' && 'value' in arg ? arg.value : arg;
}

/** @param {string} scope @returns {number | null} the pad's note, or null for the kit */
function parseScope(scope) {
    if (scope === 'kit') return null;
    const match = /^pad:(\d{1,3})$/.exec(String(scope));
    if (!match || Number(match[1]) > 127) {
        throw new SwapError('swap-bad-request', `scope must be 'kit' or 'pad:<note>', got ${JSON.stringify(scope)}`);
    }
    return Number(match[1]);
}

/** @param {string} json @returns {Map<number, {name: string, cls: string | null, ptr: number | null}>} */
function parseNames(json) {
    const out = new Map();
    try {
        for (const pad of JSON.parse(json).pads || []) {
            out.set(pad.note, { name: pad.name, cls: pad.class ?? null, ptr: pad.ptr ?? null });
        }
    } catch {
        throw new SwapError('swap-bad-reply', 'pad_names reply was not JSON');
    }
    return out;
}

/**
 * Whether Live's title for a device ("Snap PrimeOne, Drum Sampler") names the
 * instrument pad_names read, which stops at NAME_LIMIT characters.
 * @param {unknown} title @param {string} name
 */
function titleNames(title, name) {
    const text = String(title ?? '');
    const cut = text.lastIndexOf(', ');
    const deviceName = (cut < 0 ? text : text.slice(0, cut)).trim();
    return Boolean(name) && (deviceName === name || (name.length >= NAME_LIMIT && deviceName.startsWith(name)));
}

/**
 * @param {object} deps
 * @param {{state: {state: string, detail: string}, connected: boolean, request: Function}} deps.axHelper
 * @param {(address: string, args: Array<string|number>) => void} deps.sendToSurface
 * @param {object} deps.logger
 * @param {() => number} [deps.now]
 * @param {number} [deps.surfaceTimeoutMs]
 * @param {number} [deps.pressTimeoutS] - AX messaging timeout for one press (a cold kit pass
 *   takes ~5 s). **Production passes `constants.axHelper.messagingTimeoutS`**; the fallback
 *   below is for a caller with no config (tests) only. It is sent as a per-request `timeoutS`,
 *   which `verbs.py::_timeout` lets win over the helper's configured value — so a second copy
 *   of the number here is a copy that silently outranks the knob.
 */
function createDrumSwapSimilar({
    axHelper,
    sendToSurface,
    logger,
    now = Date.now,
    surfaceTimeoutMs = 3000,
    pressTimeoutS = FALLBACK_PRESS_TIMEOUT_S
}) {
    const pending = new Map();
    let queue = Promise.resolve();
    let seq = 0;
    // M8: the racks with a swap queued or running. The UI's own guard key is
    // `rackPath|scope`, so pressing a pad during an in-flight kit swap on the
    // same rack changed the key, re-enabled both halves and queued a second
    // swap behind the first — two `show_for_swap`s and two presses for one
    // intent, the second landing on whatever the first left selected.
    const inFlight = new Set();

    /**
     * M5: the one clock over a swap. `check` throws `swap-timeout` once the
     * deadline has passed, and returns the milliseconds left so a step can cap
     * its own timeout by what remains rather than adding to it.
     */
    function deadline(startedAt) {
        const at = startedAt + SWAP_DEADLINE_MS;
        return {
            left: () => at - now(),
            check(step) {
                const left = at - now();
                if (left <= 0) {
                    throw new SwapError(
                        'swap-timeout',
                        `no reply by the ${SWAP_DEADLINE_MS / 1000} s deadline (at ${step}); Live's own undo step expires at 60 s`
                    );
                }
                return left;
            },
            /** `ms`, or what is left of the deadline when that is less. */
            cap(ms, step) {
                return Math.max(1, Math.min(ms, this.check(step)));
            }
        };
    }

    /** Surface → bridge. True when the message was one of ours (never relayed to the UI). */
    function onSurfaceMessage(message) {
        if (!SURFACE_REPLIES.has(message.address)) return false;
        const args = (message.args || []).map(plain);
        const waiter = pending.get(String(args[0]));
        if (waiter && waiter.replyAddress === message.address) {
            pending.delete(String(args[0]));
            clearTimeout(waiter.timer);
            waiter.resolve(args);
        }
        return true;
    }

    function askSurface(address, replyAddress, args, timeoutMs = surfaceTimeoutMs) {
        seq += 1;
        const id = `swap-${process.pid}-${seq}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new SwapError('swap-surface-timeout', `no ${replyAddress} within ${timeoutMs} ms`));
            }, timeoutMs);
            pending.set(id, { resolve, timer, replyAddress });
            try {
                sendToSurface(address, [id, ...args]);
            } catch (err) {
                clearTimeout(timer);
                pending.delete(id);
                reject(new SwapError('swap-surface-unreachable', err.message));
            }
        });
    }

    async function readNames(rackPath, note, clock = null) {
        const [, ok, code, detail, json] = await askSurface(
            NAMES_ADDRESS,
            NAMES_REPLY_ADDRESS,
            [rackPath, note === null ? '*' : String(note)],
            clock ? clock.cap(surfaceTimeoutMs, 'pad_names') : surfaceTimeoutMs
        );
        if (Number(ok) !== 1) throw new SwapError(`swap-${code}`, detail);
        return parseNames(json);
    }

    /**
     * Step 4: the chain names follow and Live's undo step closes. Never throws:
     * a finish that fails must not mask the swap's own outcome, and the surface
     * closes an abandoned undo step on its own.
     */
    async function finishSwap(rackPath) {
        try {
            const [, ok, code, detail, json] = await askSurface(FINISH_ADDRESS, FINISH_ACK_ADDRESS, [rackPath]);
            if (Number(ok) !== 1) return { open: false, code: `swap-${code}`, detail, renamed: [], kept: [] };
            const parsed = JSON.parse(String(json));
            // `open` is the surface saying whether it still had THIS rack's
            // swap when the finish arrived. `false` is an ok reply that did
            // nothing — the step had already expired (60 s) or been superseded
            // — so the chain renames were never made. Unread, that arrives as
            // `renamed: []`, indistinguishable from "nothing needed renaming",
            // and 29 chain names go missing without a trace.
            return { open: parsed.open === true, renamed: parsed.renamed ?? [], kept: parsed.kept ?? [] };
        } catch (err) {
            return {
                open: false,
                code: err.code || 'swap-bad-reply',
                detail: err.detail || err.message,
                renamed: [],
                kept: []
            };
        }
    }

    /** What the reply's `detail` says about step 4, or `''` when it did its job. */
    function describeFinish(finished) {
        if (finished.code) {
            return `chain names not followed (${finished.code}${finished.detail ? `: ${finished.detail}` : ''})`;
        }
        if (!finished.open) return FINISH_NOT_OPEN;
        return '';
    }

    /**
     * K in TrackView.Device[N].Device[K]: the device of the selected pad's chain
     * that Live's device view titles with the pad's instrument name. The title
     * is also the check that the view shows this pad and not another.
     */
    async function findSampler(device, note, name) {
        for (let chain = 0; chain < MAX_CHAIN_DEVICES; chain += 1) {
            let view;
            try {
                view = await axHelper.request('read', { target: 'sampler.device', params: { device, chain } });
            } catch (err) {
                if (err.code === 'ax-control-missing') break;
                throw err;
            }
            if (titleNames(view.title, name)) return chain;
        }
        throw new SwapError('swap-sampler-not-in-view', `Live's device view does not show pad ${note}'s Drum Sampler (${name})`);
    }

    async function swap(rackPath, scope, direction) {
        if (typeof rackPath !== 'string' || !rackPath) throw new SwapError('swap-bad-request', 'rackPath is required');
        if (!DIRECTIONS.has(direction)) {
            throw new SwapError('swap-bad-request', `direction must be next or prev, got ${JSON.stringify(direction)}`);
        }
        const note = parseScope(scope);
        // `connected && ready`, not `state` alone: the client holds the
        // published state at `ready` for its 1.5 s grace window after a drop,
        // and a swap that starts there sends `show_for_swap` first — which
        // moves Live's selected track, device and pad and scrolls the grid,
        // for a press that cannot happen.
        const helper = helperReadiness(axHelper);
        if (!helper.ok) throw new SwapError(helper.code, helper.detail);

        const started = now();
        const clock = deadline(started);
        let finished = null;
        // The finally needs these: a kit swap that got Live's swap bar showing
        // hides it again (see below).
        let barPressed = false;
        let barShown = false;
        let device = null;
        try {
            const [, ok, code, detail, , deviceIndex] = await askSurface(
                SHOW_ADDRESS,
                SHOW_ACK_ADDRESS,
                [rackPath, note === null ? -1 : note],
                clock.cap(surfaceTimeoutMs, 'show_for_swap')
            );
            if (Number(ok) !== 1) throw new SwapError(`swap-${code}`, detail);
            device = Number(deviceIndex);
            const shown = now();
            const namesBefore = await readNames(rackPath, note, clock);

            let chain = null;
            let hoverMs = null;
            let target;
            let params;
            if (note === null) {
                const bar = await axHelper.request(
                    'read',
                    { target: 'device.show_swap_bar', params: { device } },
                    { timeoutMs: clock.cap(READ_TIMEOUT_MS, 'read show_swap_bar') }
                );
                if (Number(bar.value) !== 1) {
                    await axHelper.request(
                        'press',
                        {
                            target: 'device.show_swap_bar',
                            params: { device },
                            until: { target: 'kit.swap_next', params: { device }, exists: true, timeoutMs: SWAP_BAR_TIMEOUT_MS }
                        },
                        { timeoutMs: clock.cap(SWAP_BAR_TIMEOUT_MS + 3000, 'press show_swap_bar') }
                    );
                    barPressed = true;
                }
                barShown = true;
                target = `kit.swap_${direction}`;
                params = { device };
            } else {
                const pad = namesBefore.get(note);
                if (!pad || pad.cls !== DRUM_SAMPLER_CLASS) {
                    throw new SwapError(
                        'swap-not-a-drum-sampler',
                        `pad ${note} holds ${(pad && pad.cls) || 'no instrument'}; one pad swaps through a Drum Sampler's own buttons`
                    );
                }
                chain = await findSampler(device, note, pad.name);
                target = `sampler.swap_${direction}`;
                params = { device, chain };
                const hovered = await axHelper.request(
                    'hover',
                    { target: 'sampler.device', params, until: { target, params, exists: true, timeoutMs: HOVER_TIMEOUT_MS } },
                    { timeoutMs: clock.cap(2 * HOVER_TIMEOUT_MS + 5000, 'hover') }
                );
                hoverMs = hovered.ms ?? null;
            }

            // Live greys its own swap buttons out when it has nothing to rank
            // — no similarity embedding for the samples on those pads. Read
            // the control before pressing it, so that answers as a named
            // refusal with a reason a performer can act on, rather than as an
            // `ax-control-disabled` from a press that was never going to
            // land. Measured 2026-09-15: a kit whose samples Live's index has
            // not featured (`files.fe_version` 0, no `fe_values` row) greys
            // BOTH directions with the swap bar on.
            const control = await axHelper.request('read', { target, params }, { timeoutMs: clock.cap(READ_TIMEOUT_MS, 'read swap control') });
            if (control.enabled === false) {
                // TWO different refusals wear the same greyed button, and the
                // other direction tells them apart (measured on the rig
                // 2026-09-15). A kit sitting on its reference sample has
                // nothing BEHIND it, so Live disables Previous and leaves Next
                // alone — the state every freshly loaded kit is in, which read
                // as "not rankable" until this branch existed. Both disabled
                // is the real thing: no embedding for these samples at all.
                const other = target.replace(/_(next|prev)$/, direction === 'next' ? '_prev' : '_next');
                let otherEnabled = null;
                try {
                    otherEnabled = (
                        await axHelper.request('read', { target: other, params }, { timeoutMs: clock.cap(READ_TIMEOUT_MS, 'read other direction') })
                    ).enabled !== false;
                } catch (err) {
                    logger.debug('Similar swap: could not read the other direction', { target: other, code: err.code || '' });
                }
                if (otherEnabled) {
                    throw new SwapError(
                        'swap-at-the-end',
                        `Live's ranking has nothing ${direction === 'next' ? 'after' : 'before'} ` +
                            `${note === null ? "this kit's samples" : `pad ${note}'s sample`} — ` +
                            `${direction === 'next' ? 'previous' : 'next'} still steps`
                    );
                }
                throw new SwapError(
                    'swap-not-rankable',
                    note === null
                        ? "Live has no similar-sample ranking for this kit's samples — its index has not featured them (a folder added to Places is still being indexed, or was never added)"
                        : `Live has no similar-sample ranking for pad ${note}'s sample — its index has not featured it`
                );
            }

            const { pressMs } = await axHelper.request(
                'press',
                { target, params, timeoutS: pressTimeoutS },
                { timeoutMs: clock.cap((pressTimeoutS + 5) * 1000, 'press') }
            );
            const pressed = now();
            const namesAfter = await readNames(rackPath, note, clock);
            finished = await finishSwap(rackPath);
            const finishDetail = describeFinish(finished);
            if (finishDetail) {
                logger.warn('Similar swap: chain names not followed', {
                    rackPath, scope, open: finished.open, code: finished.code || null, detail: finished.detail || finishDetail
                });
            }

            const pads = [...new Set([...namesBefore.keys(), ...namesAfter.keys()])]
                .sort((a, b) => a - b)
                .map((padNote) => {
                    const was = namesBefore.get(padNote) || { name: '', ptr: null };
                    const is = namesAfter.get(padNote) || { name: '', ptr: null };
                    return {
                        note: padNote,
                        before: was.name,
                        after: is.name,
                        changed: was.name !== is.name,
                        sameDevice: was.ptr !== null && was.ptr === is.ptr
                    };
                });
            const result = {
                scope,
                direction,
                barPressed,
                device,
                chain,
                changed: pads.filter((p) => p.changed).length,
                unchanged: pads.filter((p) => !p.changed).length,
                renamed: finished.renamed,
                // Step 4's own outcome: `''` when the chain names followed,
                // else why they did not. `renamed: []` beside a non-empty
                // string is "the renames were dropped", not "none were
                // needed". It is also the reply's `detail`.
                finishDetail,
                pads,
                timings: {
                    showMs: shown - started,
                    hoverMs,
                    pressMs,
                    pressTotalMs: pressed - shown,
                    totalMs: now() - started
                }
            };
            logger.info('Similar swap', {
                rackPath, scope, direction, changed: result.changed,
                unchanged: result.unchanged, renamed: result.renamed.length, totalMs: result.timings.totalMs
            });
            return result;
        } finally {
            if (finished === null) await finishSwap(rackPath);
            // Every kit swap ends with Live's swap bar hidden — swapped,
            // refused or failed, and whether this swap turned it on or found
            // it on (the user's call, 2026-09-16: the bar is the swap's
            // scaffolding, not something the performer asked to see, and a
            // bar left on by an earlier swap would otherwise stay on for
            // good). Hiding costs Live nothing it needs: measured on the rig
            // the same day, a bar pressed off and on again kept both
            // directions enabled — Live keeps its reference sample — and the
            // next Swap All took 338 ms, a warm press.
            if (barShown && device !== null) {
                try {
                    await axHelper.request(
                        'press',
                        {
                            target: 'device.show_swap_bar',
                            params: { device },
                            until: { target: 'kit.swap_next', params: { device }, exists: false, timeoutMs: SWAP_BAR_TIMEOUT_MS }
                        },
                        { timeoutMs: SWAP_BAR_TIMEOUT_MS + 3000 }
                    );
                } catch (err) {
                    logger.warn("Similar swap: could not hide Live's swap bar", {
                        rackPath, code: err.code || '', detail: err.detail || err.message || String(err)
                    });
                }
            }
        }
    }

    /**
     * One swap at a time, whatever the rack: Live's press blocks anyway, and
     * each swap selects its own rack's track.
     */
    function enqueue(job) {
        const run = queue.then(job);
        queue = run.catch(() => undefined);
        return run;
    }

    /**
     * WS handler for SWAP_ADDRESS.
     * @param {{readyState: number, send: Function}} ws
     * @param {{args?: Array<unknown>}} message
     * @param {number} [openState] - WebSocket.OPEN, injectable for tests
     */
    function handleClientRequest(ws, message, openState = 1) {
        const [requestId, rackPath, scope, direction] = (message.args || []).map(plain);
        const reply = (args) => {
            if (ws.readyState === openState) ws.send(JSON.stringify({ address: REPLY_ADDRESS, args }));
        };
        // M8: one swap per rack in flight. The queue is global (Live's press
        // blocks anyway), so a second request for the same rack does not race
        // — it waits, then presses again on whatever the first left selected,
        // which is a second swap the performer did not ask for. Refused up
        // front, before `show_for_swap` moves Live's view.
        const rackKey = String(rackPath);
        if (inFlight.has(rackKey)) {
            logger.warn('Similar swap refused: already in flight', { rackPath: rackKey, scope, direction });
            reply([
                String(requestId),
                0,
                'swap-busy',
                'a swap is already running for this rack — wait for it to finish',
                ''
            ]);
            return Promise.resolve();
        }
        inFlight.add(rackKey);
        return enqueue(() => swap(rackPath, scope, direction))
            // An `ok=1` whose `detail` is non-empty is a swap that happened
            // with something to say about it — today, chain renames that did
            // not land (`finishDetail`), the same shape `clip/swap_file` uses
            // for a setting Live refused.
            .then((result) => reply([String(requestId), 1, '', result.finishDetail || '', JSON.stringify(result)]))
            .catch((err) => {
                const code = err.code || 'swap-failed';
                const detail = err.detail || err.message || String(err);
                logger.warn('Similar swap failed', { rackPath, scope, direction, code, detail });
                reply([String(requestId), 0, code, detail, '']);
            })
            .finally(() => inFlight.delete(rackKey));
    }

    return { handleClientRequest, onSurfaceMessage, swap };
}

module.exports = {
    createDrumSwapSimilar,
    SwapError,
    SWAP_ADDRESS,
    REPLY_ADDRESS,
    SHOW_ADDRESS,
    SHOW_ACK_ADDRESS,
    NAMES_ADDRESS,
    NAMES_REPLY_ADDRESS,
    FINISH_ADDRESS,
    FINISH_ACK_ADDRESS
};
