/**
 * The demo runner's line to Live: the surface's LOM probes
 * (`/looping/probe/*`, surface/CLAUDE.md "LOM probes") over one UDP socket
 * held for the whole run, rather than a `lom_probe_driver.js` process per
 * read. Requests go one at a time: the surface answers on the request's
 * own address, so only one may be in flight.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { REPO_ROOT } from '../shot/stack.mjs';

const require = createRequire(import.meta.url);
const osc = require(join(REPO_ROOT, 'node_modules', 'osc'));
const { loadConstants } = require(join(REPO_ROOT, 'interface', 'bridge', 'utils', 'constants.js'));

export const constants = loadConstants();

const ADDRESS = {
	introspect: '/looping/probe/lom_introspect',
	invoke: '/looping/probe/lom_invoke',
	set: '/looping/probe/lom_set'
};

const str = (value) => ({ type: 's', value: String(value) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Python `repr` of a scalar or a flat list, as the probes return values. */
export function fromRepr(repr) {
	if (repr === 'True') return true;
	if (repr === 'False') return false;
	if (repr === 'None') return null;
	if (/^-?\d+(\.\d+)?$/.test(repr)) return Number(repr);
	if (/^\[.*\]$/.test(repr)) {
		const json = repr.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null').replace(/'/g, '"');
		try {
			return JSON.parse(json);
		} catch {
			return repr;
		}
	}
	return repr.replace(/^'(.*)'$/, '$1');
}

export class Live {
	#port;
	#pending = null;
	#queue = Promise.resolve();

	async open() {
		const { host, remotePort } = constants.osc.pythonSurface;
		this.#port = new osc.UDPPort({
			localAddress: '127.0.0.1',
			localPort: 0,
			remoteAddress: host,
			remotePort
		});
		this.#port.on('message', (m) => {
			if (!m.address.startsWith('/looping/probe/') || !this.#pending) return;
			const raw = (m.args ?? []).map((a) => (a && typeof a === 'object' && 'value' in a ? a.value : a))[0];
			const { resolve } = this.#pending;
			this.#pending = null;
			try {
				resolve(JSON.parse(raw));
			} catch {
				resolve({ raw });
			}
		});
		await new Promise((resolve, reject) => {
			this.#port.once('ready', resolve);
			this.#port.once('error', reject);
			this.#port.open();
		});
	}

	close() {
		this.#port?.close();
	}

	#request(address, args, timeoutMs = 4000) {
		const run = () =>
			new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					this.#pending = null;
					reject(new Error(`no reply from the surface on ${address} (is Live running with the surface?)`));
				}, timeoutMs);
				this.#pending = {
					resolve: (v) => {
						clearTimeout(timer);
						resolve(v);
					}
				};
				this.#port.send({ address, args });
			});
		const next = this.#queue.then(run, run);
		this.#queue = next.catch(() => {});
		return next;
	}

	/** Read attribute chains; returns `{chain: value}` parsed from Python repr. */
	async read(path, chains) {
		const reply = await this.#request(ADDRESS.introspect, [str(path), str(chains.join(',')), str('')]);
		if (reply.resolve_error) throw new Error(`${path}: ${reply.resolve_error}`);
		const out = {};
		for (const a of reply.attrs ?? []) {
			if (a.error || !a.exists) throw new Error(`${path}.${a.name}: ${a.error || 'no such attribute'}`);
			out[a.name] = fromRepr(a.value_repr);
		}
		return out;
	}

	/** Call a method; throws on the surface's invoke error. */
	async invoke(path, method, args = []) {
		const reply = await this.#request(ADDRESS.invoke, [
			str(path),
			str(method),
			str(''),
			str(args.length ? JSON.stringify(args) : '')
		]);
		if (reply.resolve_error || reply.invoke_error) {
			throw new Error(`${path}.${method}(${JSON.stringify(args)}): ${reply.resolve_error || reply.invoke_error}`);
		}
		return reply.returned;
	}

	/** Assign `[chain, value]` pairs in one control tick. */
	async set(path, sets) {
		const reply = await this.#request(ADDRESS.set, [str(path), str(JSON.stringify(sets)), { type: 'i', value: 0 }]);
		if (reply.resolve_error) throw new Error(`${path}: ${reply.resolve_error}`);
		for (const w of reply.writes ?? reply.results ?? []) {
			if (w.error) throw new Error(`${path}.${w.chain ?? w.name}: ${w.error}`);
		}
		return reply;
	}

	/** Poll a read until `test` passes. A timeout is a failed take. */
	async until(what, read, test, { timeoutMs = 10_000, everyMs = 100 } = {}) {
		const deadline = Date.now() + timeoutMs;
		let last;
		while (Date.now() < deadline) {
			last = await read();
			if (test(last)) return last;
			await wait(everyMs);
		}
		throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
	}
}
