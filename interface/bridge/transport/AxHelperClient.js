/**
 * The bridge's end of the Looping AX Helper socket (ADR-439).
 *
 * The helper (`owner/ax-helper`, installed by `npm run install-ax-helper`) is
 * the one process trusted with macOS Accessibility. Trust belongs to the
 * launcher's responsible process, so the bridge never touches AX itself: a
 * bridge started from an untrusted shell drives Live's UI through this socket
 * exactly as well as one started from Terminal.
 *
 * Wire: a Unix socket (`axHelper.socketPath`), one JSON object per line each
 * way — `{id, verb, args}` out, `{id, ok, result | error: {code, detail}}` in.
 * The helper runs verbs serially, so a request can wait behind a slow one (a
 * cold kit swap takes ~5 s); `status` is answered out of band.
 *
 * State, published by the bridge as `/bridge/ax_helper [state, detail]`:
 *   ready            connected and trusted
 *   ax-untrusted     connected, but the app has no Accessibility grant
 *   ax-helper-down   no connection: not installed, not running, restarting
 *
 * Every request settles with a named `code`, never a silent no-op:
 * `ax-helper-down` without a connection (or when it drops mid-request),
 * `ax-timeout` when no reply arrives in time, else the helper's own code
 * (`ax-untrusted`, `ax-control-missing`, `ax-control-disabled`, ...).
 */

const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { logger: defaultLogger } = require('../utils/logger');

const AX_READY = 'ready';
const AX_UNTRUSTED = 'ax-untrusted';
const AX_HELPER_DOWN = 'ax-helper-down';
const AX_TIMEOUT = 'ax-timeout';

const STATUS_TIMEOUT_MS = 3000;
const MAX_BUFFER_CHARS = 4 * 1024 * 1024;

class AxHelperError extends Error {
    /**
     * @param {string} code
     * @param {string} [detail]
     * @param {Record<string, unknown>} [extra]
     */
    constructor(code, detail = '', extra = {}) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'AxHelperError';
        this.code = code;
        this.detail = detail;
        this.extra = extra;
    }
}

/** @param {string} p */
function expandHome(p) {
    if (p === '~') return os.homedir();
    return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** @param {NodeJS.ErrnoException | null} err */
function describeDialError(err) {
    if (!err) return 'not connected';
    if (err.code === 'ENOENT') return 'helper not running (no socket; npm run install-ax-helper)';
    if (err.code === 'ECONNREFUSED') return 'helper not listening (stale socket)';
    return `${err.code || 'error'}: ${err.message}`;
}

class AxHelperClient extends EventEmitter {
    /**
     * @param {object} options
     * @param {string} options.socketPath - `axHelper.socketPath`; a leading `~` is expanded
     * @param {string} [options.appName] - named in the untrusted detail
     * @param {number} [options.requestTimeoutMs]
     * @param {number} [options.statusIntervalMs]
     * @param {number} [options.reconnectBaseMs]
     * @param {number} [options.reconnectMaxMs]
     * @param {number} [options.downGraceMs] - a helper restart shorter than this never reads as down
     * @param {object} [options.logger]
     * @param {Function} [options.connect] - `net.createConnection`, injectable for tests
     */
    constructor(options) {
        super();
        this._socketPath = expandHome(options.socketPath);
        this._appName = options.appName || 'Looping AX Helper';
        this._requestTimeoutMs = options.requestTimeoutMs ?? 20000;
        this._statusIntervalMs = options.statusIntervalMs ?? 5000;
        this._reconnectBaseMs = options.reconnectBaseMs ?? 500;
        this._reconnectMaxMs = options.reconnectMaxMs ?? 10000;
        this._downGraceMs = options.downGraceMs ?? 1500;
        this._logger = options.logger || defaultLogger;
        this._connect = options.connect || net.createConnection;

        this._running = false;
        this._socket = null;
        this._connected = false;
        this._buffer = '';
        /** @type {Map<number, {verb: string, resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
        this._pending = new Map();
        this._nextId = 1;
        this._attempt = 0;
        this._lastDialError = null;
        this._lastStatus = null;
        this._state = { state: AX_HELPER_DOWN, detail: 'not connected yet' };
        this._statusTimer = null;
        this._reconnectTimer = null;
        this._downTimer = null;
    }

    /** @returns {{state: string, detail: string}} */
    get state() {
        return { ...this._state };
    }

    /** The helper's last `status` result (trusted, bundle, live pid, smoke report). */
    get lastStatus() {
        return this._lastStatus;
    }

    /** True while the socket is up. `state` can still read ready for the grace window after a drop. */
    get connected() {
        return this._connected;
    }

    start() {
        if (this._running) return this;
        this._running = true;
        this._dial();
        this._statusTimer = setInterval(() => this._refreshStatus(), this._statusIntervalMs);
        if (this._statusTimer.unref) this._statusTimer.unref();
        return this;
    }

    stop() {
        this._running = false;
        clearInterval(this._statusTimer);
        clearTimeout(this._reconnectTimer);
        clearTimeout(this._downTimer);
        this._statusTimer = this._reconnectTimer = this._downTimer = null;
        const socket = this._socket;
        this._socket = null;
        this._connected = false;
        if (socket) socket.destroy();
        this._failPending('AX helper client stopped');
    }

    /**
     * Send one verb; resolves with the helper's result plus `helperMs` /
     * `queuedMs`, rejects with an AxHelperError.
     * @param {string} verb
     * @param {object} [args]
     * @param {{timeoutMs?: number}} [options]
     */
    request(verb, args = {}, { timeoutMs } = {}) {
        if (!this._connected || !this._socket) {
            const detail = this._state.state === AX_HELPER_DOWN ? this._state.detail : 'helper not connected';
            return Promise.reject(new AxHelperError(AX_HELPER_DOWN, detail));
        }
        const id = this._nextId++;
        const limit = timeoutMs ?? this._requestTimeoutMs;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this._pending.delete(id)) {
                    reject(new AxHelperError(AX_TIMEOUT, `no reply to ${verb} within ${limit} ms`));
                }
            }, limit);
            this._pending.set(id, { verb, resolve, reject, timer });
            try {
                this._socket.write(`${JSON.stringify({ id, verb, args })}\n`);
            } catch (err) {
                clearTimeout(timer);
                this._pending.delete(id);
                reject(new AxHelperError(AX_HELPER_DOWN, err.message));
            }
        });
    }

    _dial() {
        if (!this._running) return;
        let socket;
        try {
            socket = this._connect({ path: this._socketPath });
        } catch (err) {
            this._lastDialError = err;
            this._setState(AX_HELPER_DOWN, describeDialError(err));
            this._scheduleReconnect(false);
            return;
        }
        this._socket = socket;
        socket.setEncoding('utf8');
        socket.on('connect', () => {
            if (socket !== this._socket) return;
            this._connected = true;
            this._attempt = 0;
            this._lastDialError = null;
            clearTimeout(this._downTimer);
            this._downTimer = null;
            this._logger.info('AX helper connected', { socketPath: this._socketPath });
            this._refreshStatus();
        });
        socket.on('data', (chunk) => {
            if (socket === this._socket) this._onData(chunk);
        });
        socket.on('error', (err) => {
            this._lastDialError = err;
        });
        socket.on('close', () => this._onClose(socket));
    }

    _onClose(socket) {
        if (socket !== this._socket) return;
        const wasConnected = this._connected;
        this._socket = null;
        this._connected = false;
        this._buffer = '';
        this._failPending(wasConnected ? 'connection to the helper closed' : describeDialError(this._lastDialError));
        if (wasConnected) {
            // The helper re-executes itself when a grant lands and launchd
            // restarts it after a crash: give it a moment before calling it down.
            this._logger.info('AX helper connection closed', { socketPath: this._socketPath });
            clearTimeout(this._downTimer);
            this._downTimer = setTimeout(() => {
                this._downTimer = null;
                if (!this._connected) this._setState(AX_HELPER_DOWN, 'connection to the helper closed');
            }, this._downGraceMs);
            if (this._downTimer.unref) this._downTimer.unref();
        } else if (!this._downTimer) {
            this._setState(AX_HELPER_DOWN, describeDialError(this._lastDialError));
        }
        this._scheduleReconnect(wasConnected);
    }

    _scheduleReconnect(soon) {
        if (!this._running) return;
        const delay = soon
            ? this._reconnectBaseMs
            : Math.min(this._reconnectMaxMs, this._reconnectBaseMs * 2 ** this._attempt);
        this._attempt = Math.min(this._attempt + 1, 16);
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._dial();
        }, delay);
        if (this._reconnectTimer.unref) this._reconnectTimer.unref();
    }

    _failPending(detail) {
        for (const pending of this._pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new AxHelperError(AX_HELPER_DOWN, `${detail} (during ${pending.verb})`));
        }
        this._pending.clear();
    }

    _onData(chunk) {
        this._buffer += chunk;
        if (this._buffer.length > MAX_BUFFER_CHARS) {
            this._logger.error('AX helper sent an unterminated reply; dropping the connection');
            if (this._socket) this._socket.destroy();
            return;
        }
        let newline = this._buffer.indexOf('\n');
        while (newline !== -1) {
            const line = this._buffer.slice(0, newline);
            this._buffer = this._buffer.slice(newline + 1);
            if (line.trim()) this._onReply(line);
            newline = this._buffer.indexOf('\n');
        }
    }

    _onReply(line) {
        let reply;
        try {
            reply = JSON.parse(line);
        } catch {
            this._logger.warn('AX helper sent a line that is not JSON', { line: line.slice(0, 200) });
            return;
        }
        const pending = this._pending.get(reply.id);
        if (!pending) {
            this._logger.warn('AX helper reply matches no request', { id: reply.id, error: reply.error });
            return;
        }
        this._pending.delete(reply.id);
        clearTimeout(pending.timer);
        if (reply.ok) {
            pending.resolve({ ...(reply.result || {}), helperMs: reply.ms, queuedMs: reply.queuedMs });
            return;
        }
        const { code = 'ax-action-failed', detail = '', ...extra } = reply.error || {};
        if (code === AX_UNTRUSTED) this._setState(AX_UNTRUSTED, detail);
        pending.reject(new AxHelperError(code, detail, { ...extra, helperMs: reply.ms }));
    }

    _refreshStatus() {
        if (!this._connected) return;
        this.request('status', {}, { timeoutMs: STATUS_TIMEOUT_MS })
            .then((status) => {
                this._lastStatus = status;
                if (status.trusted) {
                    this._setState(AX_READY, '');
                } else {
                    this._setState(
                        AX_UNTRUSTED,
                        `System Settings > Privacy & Security > Accessibility: switch on "${this._appName}"`
                    );
                }
            })
            .catch((err) => {
                if (err.code === AX_TIMEOUT) this._setState(AX_HELPER_DOWN, 'helper not answering status');
            });
    }

    _setState(state, detail) {
        if (this._state.state === state && this._state.detail === detail) return;
        const previous = this._state.state;
        this._state = { state, detail };
        const level = state === AX_READY ? 'info' : 'warn';
        this._logger[level]('AX helper state', { state, detail, previous });
        this.emit('state', this.state);
    }
}

/**
 * Whether a caller may commit a side effect on the helper's behalf, as
 * `{ok, code, detail}` — the code is what to reject with when it is not.
 *
 * `state` alone is not enough. `_onClose` holds the published state at `ready`
 * for `downGraceMs` (1.5 s) after a drop, because the helper re-executes itself
 * when a grant lands and a blink must not paint `ax-helper-down` on every
 * client. A caller reading `state` inside that window sees `ready` and spends
 * something it cannot get back: Save As burns a counter value before the verb
 * runs, and a swap's `show_for_swap` moves Live's selected track, device and
 * pad and scrolls the grid for a swap that cannot happen. `connected` is the
 * socket itself and has no grace, so the pair is the honest question.
 *
 * @param {{state?: {state: string, detail: string}, connected?: boolean, request?: Function}} [axHelper]
 */
function helperReadiness(axHelper) {
    if (!axHelper || typeof axHelper.request !== 'function') {
        return { ok: false, code: AX_HELPER_DOWN, detail: 'the bridge has no AX helper client' };
    }
    const state = axHelper.state || { state: AX_HELPER_DOWN, detail: 'the helper has no state' };
    if (state.state !== AX_READY) {
        return { ok: false, code: state.state, detail: state.detail || 'AX helper not ready' };
    }
    if (!axHelper.connected) {
        return {
            ok: false,
            code: AX_HELPER_DOWN,
            detail: 'the helper socket is down; its published state has not caught up yet'
        };
    }
    return { ok: true, code: '', detail: '' };
}

const NOT_CONFIGURED =
    'the config has no axHelper.socketPath (config/constants.json carries the axHelper block; npm run install-ax-helper)';

/**
 * The client's shape with no helper to dial: permanently `ax-helper-down`,
 * every request rejecting with that code. It exists because
 * `createAxHelperClient` is called at module top level — a throw there kills
 * the bridge before it opens a single port, so the documented fresh install
 * of the time (an example config with no axHelper block) cost the whole rig
 * rather than the one feature the missing key belongs to. Callers cannot
 * tell it from a client whose helper is not running, which is the point.
 */
class DisabledAxHelperClient extends EventEmitter {
    /** @param {string} detail @param {object} [logger] */
    constructor(detail, logger = defaultLogger) {
        super();
        this._state = { state: AX_HELPER_DOWN, detail };
        this._logger = logger;
    }

    /** @returns {{state: string, detail: string}} */
    get state() {
        return { ...this._state };
    }

    /** Never polled, so there is never a status to report. */
    get lastStatus() {
        return null;
    }

    get connected() {
        return false;
    }

    start() {
        this._logger.warn('AX helper disabled', { detail: this._state.detail });
        return this;
    }

    stop() {}

    /** @param {string} verb */
    request(verb) {
        return Promise.reject(new AxHelperError(AX_HELPER_DOWN, `${this._state.detail} (during ${verb})`));
    }
}

/**
 * A client for `constants.axHelper`. A config with no `socketPath` gets the
 * disabled stub above rather than a throw — see its docstring.
 * @param {object} constants - parsed config/constants.json
 * @param {{logger?: object, connect?: Function}} [options]
 */
function createAxHelperClient(constants, options = {}) {
    const config = constants.axHelper || {};
    if (!config.socketPath) return new DisabledAxHelperClient(NOT_CONFIGURED, options.logger);
    return new AxHelperClient({
        socketPath: config.socketPath,
        appName: config.appName,
        requestTimeoutMs: config.requestTimeoutMs,
        statusIntervalMs: config.statusIntervalMs,
        ...options
    });
}

module.exports = {
    AxHelperClient,
    AxHelperError,
    DisabledAxHelperClient,
    createAxHelperClient,
    helperReadiness,
    AX_READY,
    AX_UNTRUSTED,
    AX_HELPER_DOWN,
    AX_TIMEOUT
};
