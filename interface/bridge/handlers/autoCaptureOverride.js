/**
 * Auto-capture override memory (bridge-lifetime). ADR-405.
 *
 * `auto_capture` gates the performance-capture behaviors (auto-record on
 * play + save-as on stop, wire-protocol §2.14) and lives in the Python
 * surface — which Live tears down and rebuilds on every set load. The
 * rebuilt surface deliberately re-seeds the toggle from the launch mode on
 * the first heartbeat (ipad→on, dev→off), so a user override used to last
 * only until the next set load: the running bridge's heartbeat re-seeded
 * the default within ~2s of every load.
 *
 * The contract users actually expect: an override persists across set
 * loads (and Live restarts) and resets to the mode default only when the
 * dev/ipad script is restarted. This bridge process IS that lifetime, so
 * it remembers the last client write and replays it whenever the surface's
 * emitted state disagrees:
 *
 * - `recordClientWrite(args)` — call for every WS→surface write on
 *   `/looping/v3/session/auto_capture`; remembers the last valid 0/1.
 * - `onSurfaceEmit(args, replay)` — call for every surface→bridge emit on
 *   the same address; when the emitted value differs from the remembered
 *   override, invokes `replay(override)` to write it back.
 *
 * Loop-safety: a replay produces exactly one surface echo, which then
 * equals the override, so the mismatch path cannot oscillate. The replay
 * arrives as a normal user write surface-side, committing the toggle so
 * the mode seed can't clobber it for the rest of that surface's life.
 *
 * No override recorded (null) → the module never interferes and the
 * surface's own seed/persistence rules apply untouched.
 */

const AUTO_CAPTURE_ADDRESS = '/looping/v3/session/auto_capture';

/**
 * Parse a wire args array as a 0/1 toggle value.
 * Mirrors the surface's strict bool01 discipline at the value level (the
 * int-vs-float OSC tag is handled by encodeOutboundArgs on the way out).
 * @param {Array} args
 * @returns {0|1|null} null when the args don't carry a valid toggle value
 */
function parseBool01(args) {
    if (!Array.isArray(args) || args.length === 0) return null;
    const raw = args[0];
    if (raw === true || raw === false) return raw ? 1 : 0;
    if (raw === 0 || raw === 1) return raw;
    return null;
}

/**
 * @param {Object} [deps]
 * @param {{ info?: Function }} [deps.logger] - optional logger for override
 *   lifecycle lines (recorded / replayed)
 */
function createAutoCaptureOverride({ logger } = {}) {
    /** @type {0|1|null} last client-written value this bridge run */
    let override = null;

    return {
        /**
         * Record a WS-client write to the auto_capture set address.
         * Invalid args are ignored (the surface would reject them too).
         * @param {Array} args - wire args, e.g. `[0]`
         */
        recordClientWrite(args) {
            const value = parseBool01(args);
            if (value === null) return;
            if (override !== value) {
                logger?.info?.('auto_capture override recorded for this bridge run', { value });
            }
            override = value;
        },

        /**
         * Inspect a surface emit of auto_capture; replay the remembered
         * override when the surface disagrees (fresh surface after a set
         * load re-seeded the mode default over the user's choice).
         * @param {Array} args - emitted wire args, e.g. `[1]`
         * @param {(value: 0|1) => void} replay - sends the override back to
         *   the surface as a normal set write
         */
        onSurfaceEmit(args, replay) {
            if (override === null) return;
            const emitted = parseBool01(args);
            if (emitted === null || emitted === override) return;
            logger?.info?.('Replaying auto_capture override over surface re-seed', {
                override,
                surfaceEmitted: emitted
            });
            replay(override);
        },

        /** Current override (0|1) or null when no client write happened yet. */
        get override() {
            return override;
        }
    };
}

module.exports = { AUTO_CAPTURE_ADDRESS, createAutoCaptureOverride };
