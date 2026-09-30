/**
 * Keep Live's "Auto Load Groove" off whenever Vamp adds a groove.
 *
 * Live ticks the Groove Pool's Auto Load Groove box on a groove loaded into
 * an empty pool, and every clip recorded after that takes the groove
 * (measured on the rig, 2026-09-29: the first groove Vamp minted for one
 * drum clip turned up on the next clip recorded on another track). Ben never
 * wants it on. The LOM cannot reach the box, so the surface announces each
 * groove it adds (`/looping/v3/groove/added`) and this presses every ticked
 * box off through the AX helper. AXPress on the box toggles it, read back
 * the same way (measured, 2026-09-29).
 *
 * The box is in Live's window only while the Browser shows (hidden, the
 * helper answers `ax-control-missing`), so a hidden Browser is shown for the
 * press and hidden again after, through the surface
 * (`/looping/v3/groove/browser`). Fire-and-forget: a failure is a warning,
 * never an error the performer sees. One at a time, so two adds in a row do
 * not both show and hide the Browser.
 */

const GROOVE_ADDED_ADDRESS = '/looping/v3/groove/added';
const GROOVE_BROWSER_ADDRESS = '/looping/v3/groove/browser';
const GROOVE_BROWSER_ACK_ADDRESS = '/looping/v3/groove/browser/ack';

const AUTO_LOAD_BOX = {
    role: 'AXCheckBox',
    identifier: 'GroovePool.GrooveView.DefaultGrooveCheckControl'
};

const READ_TIMEOUT_MS = 3000;

function createGrooveAutoLoadOff({
    axHelper,
    logger,
    sendToSurface,
    pollMs = 150,
    rowWaitMs = 5000,
    tickWaitMs = 600,
    surfaceTimeoutMs = 2000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
    let queue = Promise.resolve();
    let browserSeq = 0;
    const pendingBrowser = new Map();

    /** Each box's state in tree order, or null when none is in Live's window. */
    async function readBoxes() {
        try {
            const result = await axHelper.request(
                'list', { target: AUTO_LOAD_BOX, order: 'tree' }, { timeoutMs: READ_TIMEOUT_MS }
            );
            return (result.elements || []).map((el) => el.value === 1 || el.value === true);
        } catch (err) {
            if (err && err.code === 'ax-control-missing') return null;
            throw err;
        }
    }

    /** Show (1) or hide (0) the Browser; resolves with whether it was showing
     * (1 / 0), or null when the surface did not answer. */
    function setBrowser(visible) {
        browserSeq += 1;
        const id = `groove-browser-${process.pid}-${browserSeq}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingBrowser.delete(id);
                logger.warn('Auto Load Groove: the surface did not answer the browser request', { visible });
                resolve(null);
            }, surfaceTimeoutMs);
            pendingBrowser.set(id, { resolve, timer });
            try {
                sendToSurface(GROOVE_BROWSER_ADDRESS, [id, visible]);
            } catch (err) {
                clearTimeout(timer);
                pendingBrowser.delete(id);
                logger.warn('Auto Load Groove: browser request not sent', { error: err && err.message });
                resolve(null);
            }
        });
    }

    async function turnOff() {
        let boxes = await readBoxes();
        let shownBrowser = false;
        if (boxes === null) shownBrowser = (await setBrowser(1)) === 0;
        try {
            // Live draws a new row late: over 2 s for the first groove in an
            // empty pool (rig, 2026-09-29), and it may tick the box a moment
            // after the row appears. Poll for a row, then for a tick.
            for (let waited = 0; boxes === null && waited < rowWaitMs; waited += pollMs) {
                await sleep(pollMs);
                boxes = await readBoxes();
            }
            for (let waited = 0; boxes !== null && !boxes.includes(true) && waited < tickWaitMs; waited += pollMs) {
                await sleep(pollMs);
                boxes = (await readBoxes()) || [];
            }
            if (boxes === null) {
                logger.warn("Auto Load Groove: the Groove Pool is not in Live's window; left as it is");
                return;
            }
            const ticked = boxes.flatMap((on, index) => (on ? [index] : []));
            for (const index of ticked) {
                await axHelper.request('press', { target: AUTO_LOAD_BOX, index }, { timeoutMs: READ_TIMEOUT_MS });
            }
            if (ticked.length === 0) return;
            const after = (await readBoxes()) || [];
            if (after.includes(true)) {
                logger.warn('Auto Load Groove: still ticked after the press', { ticked, after });
            } else {
                logger.info('Auto Load Groove turned off', { rows: ticked });
            }
        } finally {
            if (shownBrowser) await setBrowser(0);
        }
    }

    /** True when the message was this module's (consumed, not relayed to the UI). */
    function onSurfaceMessage(message) {
        if (message.address === GROOVE_ADDED_ADDRESS) {
            queue = queue.then(turnOff).catch((err) => {
                logger.warn('Auto Load Groove: could not turn it off', {
                    code: err && err.code,
                    error: err && (err.detail || err.message)
                });
            });
            return true;
        }
        if (message.address === GROOVE_BROWSER_ACK_ADDRESS) {
            const args = message.args || [];
            const waiter = pendingBrowser.get(String(args[0]));
            if (waiter) {
                pendingBrowser.delete(String(args[0]));
                clearTimeout(waiter.timer);
                waiter.resolve(Number(args[1]));
            }
            return true;
        }
        return false;
    }

    /** Settles once every announced add has been handled (tests). */
    function idle() {
        return queue;
    }

    return { onSurfaceMessage, idle };
}

module.exports = {
    createGrooveAutoLoadOff,
    GROOVE_ADDED_ADDRESS,
    GROOVE_BROWSER_ADDRESS,
    GROOVE_BROWSER_ACK_ADDRESS,
    AUTO_LOAD_BOX
};
