/**
 * The bridge's similar-sound swap orchestration (ADR-439 phase 3), against a
 * fake AX helper and a fake surface that answers the way DrumSwapComponent
 * does: show the rack (and select the pad), read names, press once — Swap All
 * for a kit, its swap bar turned on first; for a pad its Drum Sampler's own
 * button, found by title and hovered first — read names, follow the chain
 * names and close Live's undo step, one swap at a time across every rack.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as mod from '../../../../bridge/handlers/drumSwapSimilar.js';

type Args = Array<string | number>;
type Swap = {
	handleClientRequest(ws: { readyState: number; send: (s: string) => void }, message: { args: unknown[] }): Promise<void>;
	onSurfaceMessage(message: { address: string; args: unknown[] }): boolean;
};

const { createDrumSwapSimilar, SHOW_ACK_ADDRESS, NAMES_REPLY_ADDRESS, FINISH_ACK_ADDRESS, REPLY_ADDRESS } = mod as unknown as {
	createDrumSwapSimilar: (deps: Record<string, unknown>) => Swap;
	SHOW_ACK_ADDRESS: string;
	NAMES_REPLY_ADDRESS: string;
	FINISH_ACK_ADDRESS: string;
	REPLY_ADDRESS: string;
};

const RACK = 'tracks/1/devices/0';
const OTHER_RACK = 'tracks/4/devices/0';
const SHOW = '/looping/v3/drum/show_for_swap';
const NAMES = '/looping/v3/drum/pad_names';
const FINISH = '/looping/v3/drum/finish_swap';
const silent = { info() {}, warn() {}, error() {}, debug() {} };

interface Rig {
	swap: Swap;
	helperCalls: Array<[string, Record<string, unknown>, Record<string, unknown> | undefined]>;
	surfaceCalls: Args[];
	replies: unknown[][];
	names: Map<number, string>;
	barOn: { value: number };
	ws: { readyState: number; send: (s: string) => void };
	warns: Array<[string, Record<string, unknown>]>;
}

interface RigOptions {
	ready?: boolean;
	/** the helper's socket; `state` can still read `ready` for 1.5 s after it drops */
	connected?: boolean;
	showOk?: boolean;
	renamed?: number[];
	/** `finish_swap` answers `ok=1` with `{"open": false}` — expired or superseded */
	finishNotOpen?: boolean;
	/** the AX messaging timeout the bridge hands the helper for one press */
	pressTimeoutS?: number;
	/** an injectable `now()`, so a test can run the clock past the M5 deadline */
	now?: () => number;
	/** `finish_swap` answers `ok=0` */
	finishError?: { code: string; detail: string };
	pressError?: { code: string; detail: string };
	hoverError?: { code: string; detail: string };
	/** each pad's first instrument class; a Drum Sampler (`DrumCell`) when absent */
	classes?: Record<number, string>;
	/** where the selected pad's Drum Sampler sits among its chain's devices */
	samplerChain?: number;
	/** the title Live's device view gives the Drum Sampler it shows */
	samplerTitle?: string;
	/**
	 * Live greys its own swap button out: `true` for both directions (nothing
	 * in its index to rank), or one direction's name for a kit sitting at the
	 * end of the walk that way.
	 */
	disabled?: boolean | 'next' | 'prev';
	/** pressing the swap bar OFF fails */
	hideError?: { code: string; detail: string };
}

const named = (code: string, detail = '') => Object.assign(new Error(detail || code), { code, detail });

function rig(opts: RigOptions = {}): Rig {
	const names = new Map([[36, 'Kick-A'], [38, 'Snare-A']]);
	const barOn = { value: 1 };
	const helperCalls: Rig['helperCalls'] = [];
	const surfaceCalls: Args[] = [];
	const replies: unknown[][] = [];
	let selected: number | null = null;
	let swap: Swap;
	const axHelper = {
		state: opts.ready === false ? { state: 'ax-untrusted', detail: 'switch it on' } : { state: 'ready', detail: '' },
		// The socket, which unlike `state` has no grace window (M6).
		connected: opts.connected !== false,
		request: vi.fn(async (verb: string, args: Record<string, unknown>, options?: Record<string, unknown>) => {
			helperCalls.push([verb, args, options]);
			const target = String(args.target);
			if (verb === 'read' && target === 'device.show_swap_bar') return { value: barOn.value };
			// The read before the press: Live's own enabled flag on the button.
			if (verb === 'read' && /^(kit|sampler)\.swap_/.test(target)) {
				const greyed = opts.disabled === true || (typeof opts.disabled === 'string' && target.endsWith(`_${opts.disabled}`));
				return { enabled: !greyed };
			}
			if (verb === 'read' && target === 'sampler.device') {
				// Live's device view shows the selected pad's chain: an effect, then its Drum Sampler.
				const chain = (args.params as { chain: number }).chain;
				const at = opts.samplerChain ?? 0;
				if (chain > at) throw named('ax-control-missing', `TrackView.Device[0].Device[${chain}] is not in Live's window`);
				if (chain < at) return { title: 'Random, Random' };
				return { title: opts.samplerTitle ?? `${names.get(selected!)}, Drum Sampler` };
			}
			if (verb === 'hover') {
				if (opts.hoverError) throw named(opts.hoverError.code, opts.hoverError.detail);
				return { point: [734, 870], until: { exists: true }, ms: 210 };
			}
			if (target === 'device.show_swap_bar') {
				if (opts.hideError && barOn.value === 1) throw named(opts.hideError.code, opts.hideError.detail);
				barOn.value = barOn.value === 1 ? 0 : 1;
				return { pressMs: 5 };
			}
			if (opts.pressError) throw named(opts.pressError.code, opts.pressError.detail);
			// Live's swap: every pad in scope moves on (Next) or back (Prev).
			const step = target.endsWith('next') ? 'B' : 'A';
			if (target.startsWith('kit')) {
				for (const note of names.keys()) names.set(note, names.get(note)!.replace(/-[AB]$/, `-${step}`));
			} else {
				names.set(selected!, names.get(selected!)!.replace(/-[AB]$/, `-${step}`));
			}
			return { pressMs: target.startsWith('kit') ? 480 : 29 };
		})
	};
	const sendToSurface = (address: string, args: Args) => {
		surfaceCalls.push([address, ...args]);
		const [id] = args;
		queueMicrotask(() => {
			if (address === SHOW) {
				if (opts.showOk !== false && Number(args[2]) >= 0) selected = Number(args[2]);
				swap.onSurfaceMessage({
					address: SHOW_ACK_ADDRESS,
					args: opts.showOk === false
						? [id, 0, 'not-a-drum-rack', 'tracks/1/devices/0 is a Operator', '', -1, -1, -1]
						: [id, 1, '', '', 'tracks/1', 0, 9, Number(args[2]) === -1 ? -1 : 14]
				});
			} else if (address === FINISH) {
				if (opts.finishError) {
					const { code, detail } = opts.finishError;
					swap.onSurfaceMessage({ address: FINISH_ACK_ADDRESS, args: [id, 0, code, detail, ''] });
					return;
				}
				// `open` is the surface saying it still had THIS rack's swap.
				// `finishNotOpen` is the expired/superseded case: `ok=1` and a
				// payload that renamed nothing.
				const open = opts.showOk !== false && opts.finishNotOpen !== true;
				const payload = { open, renamed: open ? (opts.renamed ?? []) : [], kept: [] };
				swap.onSurfaceMessage({ address: FINISH_ACK_ADDRESS, args: [id, 1, '', '', JSON.stringify(payload)] });
			} else {
				const wanted = args[2] === '*' ? [...names.keys()] : String(args[2]).split(',').map(Number);
				const pads = wanted.map((note) => ({
					note,
					name: names.get(note),
					class: opts.classes?.[note] ?? 'DrumCell',
					ptr: 1000 + note
				}));
				swap.onSurfaceMessage({ address: NAMES_REPLY_ADDRESS, args: [id, 1, '', '', JSON.stringify({ pads })] });
			}
		});
	};
	const warns: Rig['warns'] = [];
	const logger = { ...silent, warn: (message: string, context: Record<string, unknown>) => warns.push([message, context]) };
	swap = createDrumSwapSimilar({
		axHelper,
		sendToSurface,
		logger,
		...(opts.pressTimeoutS === undefined ? {} : { pressTimeoutS: opts.pressTimeoutS }),
		...(opts.now === undefined ? {} : { now: opts.now })
	});
	const ws = { readyState: 1, send: (s: string) => replies.push(JSON.parse(s).args) };
	return { swap, helperCalls, surfaceCalls, replies, names, barOn, ws, warns };
}

async function request(r: Rig, scope: string, direction: string, id = 'r1', rackPath = RACK) {
	await r.swap.handleClientRequest(r.ws, { args: [id, rackPath, scope, direction] });
	const reply = r.replies.at(-1)!;
	return { reply, result: reply[1] === 1 ? JSON.parse(String(reply[4])) : null };
}

const calls = (r: Rig) => r.helperCalls.map(([v, a]) => `${v}:${a.target}`);

describe('drum/swap_similar', () => {
	it('swaps the kit through Live\'s Swap All and reports what changed', async () => {
		const r = rig();
		const { reply, result } = await request(r, 'kit', 'next');
		expect(reply.slice(0, 4)).toEqual(['r1', 1, '', '']);
		expect(r.surfaceCalls.map((c) => c[0])).toEqual([SHOW, NAMES, NAMES, FINISH]);
		expect(r.surfaceCalls[0].slice(2)).toEqual([RACK, -1]);
		expect(calls(r)).toEqual([
			'read:device.show_swap_bar',
			'read:kit.swap_next',
			'press:kit.swap_next',
			'press:device.show_swap_bar'
		]);
		expect(r.barOn.value).toBe(0);
		expect(result.changed).toBe(2);
		expect(result.chain).toBeNull();
		expect(result.pads[0]).toEqual({ note: 36, before: 'Kick-A', after: 'Kick-B', changed: true, sameDevice: true });
		expect(result.timings.pressMs).toBe(480);
		expect(result).not.toHaveProperty('steps');
	});

	it('follows the chain names and closes Live\'s undo step after the press', async () => {
		const r = rig({ renamed: [36, 38] });
		const { reply, result } = await request(r, 'kit', 'next');
		expect(r.surfaceCalls.at(-1)).toEqual([FINISH, expect.any(String), RACK]);
		expect(result.renamed).toEqual([36, 38]);
		expect(result.finishDetail).toBe('');
		expect(reply[3]).toBe('');
		expect(r.warns).toEqual([]);
	});

	/*
	 * `finish_swap` answering `ok=1` with `{"open": false}` is the surface
	 * saying it no longer had this rack's swap — expired after 60 s, or
	 * superseded — so it renamed nothing and closed nothing. Unread, that
	 * arrives as `renamed: []`, which is exactly what a kit needing no renames
	 * looks like: on the Plymouth kit that is 29 chain names lost silently.
	 */
	it('reports a finish that answered ok but had no swap open', async () => {
		const r = rig({ finishNotOpen: true, renamed: [36, 38] });
		const { reply, result } = await request(r, 'kit', 'next');
		expect(reply[1]).toBe(1); // the swap itself happened
		expect(result.changed).toBe(2);
		expect(result.renamed).toEqual([]);
		expect(result.finishDetail).toContain('no swap open');
		expect(reply[3]).toBe(result.finishDetail);
		expect(r.warns.map(([m]) => m)).toContain('Similar swap: chain names not followed');
		expect(r.warns.at(-1)![1]).toMatchObject({ rackPath: RACK, scope: 'kit', open: false });
	});

	it('reports a finish that answered ok=0 on the same field', async () => {
		const r = rig({ finishError: { code: 'write-refused', detail: 'Chain.name raised' } });
		const { reply, result } = await request(r, 'kit', 'next');
		expect(reply[1]).toBe(1);
		expect(result.finishDetail).toContain('swap-write-refused');
		expect(result.finishDetail).toContain('Chain.name raised');
		expect(reply[3]).toBe(result.finishDetail);
		expect(r.warns.at(-1)![1]).toMatchObject({ code: 'swap-write-refused' });
	});

	it('closes Live\'s undo step even when the press fails', async () => {
		const r = rig({ pressError: { code: 'ax-control-disabled', detail: 'sampler.swap_next is disabled in Live\'s UI' } });
		const { reply } = await request(r, 'pad:38', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'ax-control-disabled']);
		expect(r.surfaceCalls.map((c) => c[0])).toEqual([SHOW, NAMES, FINISH]);
	});

	it('turns the swap bar on first when it is off, and off again after the swap', async () => {
		const r = rig();
		r.barOn.value = 0;
		const { result } = await request(r, 'kit', 'next');
		expect(result.barPressed).toBe(true);
		const barPresses = r.helperCalls.filter(([v, a]) => v === 'press' && a.target === 'device.show_swap_bar');
		expect(barPresses).toHaveLength(2);
		expect(barPresses[0][1].until).toMatchObject({ target: 'kit.swap_next', exists: true });
		expect(barPresses[1][1].until).toMatchObject({ target: 'kit.swap_next', exists: false });
		expect(calls(r).at(-1)).toBe('press:device.show_swap_bar');
		expect(r.barOn.value).toBe(0);
	});

	it('hides a swap bar it found on after the swap too', async () => {
		// An earlier swap — or one made before bars were hidden — left it on.
		const r = rig();
		r.barOn.value = 1;
		const { reply, result } = await request(r, 'kit', 'next');
		expect(reply[1]).toBe(1);
		expect(result.barPressed).toBe(false);
		expect(r.barOn.value).toBe(0);
	});

	it('still answers ok when the bar will not hide, with a warning', async () => {
		const r = rig({ hideError: { code: 'ax-control-missing', detail: 'ShowSwapBar is not in Live\'s window' } });
		const { reply, result } = await request(r, 'kit', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 1, '']);
		expect(result.changed).toBe(2);
		expect(r.warns.at(-1)).toEqual([
			"Similar swap: could not hide Live's swap bar",
			expect.objectContaining({ rackPath: RACK, code: 'ax-control-missing' })
		]);
	});

	it('swaps one pad through its Drum Sampler\'s own button, hovered first, never the rack\'s pad buttons', async () => {
		const r = rig();
		const { result } = await request(r, 'pad:38', 'next');
		expect(r.surfaceCalls[0].slice(2)).toEqual([RACK, 38]);
		expect(r.surfaceCalls[1].slice(2)).toEqual([RACK, '38']);
		expect(calls(r)).toEqual([
			'read:sampler.device',
			'hover:sampler.device',
			'read:sampler.swap_next',
			'press:sampler.swap_next'
		]);
		const sampler = { device: 0, chain: 0 };
		expect(r.helperCalls[1][1]).toMatchObject({
			params: sampler,
			until: { target: 'sampler.swap_next', params: sampler, exists: true }
		});
		expect(r.helperCalls[3][1]).toMatchObject({ target: 'sampler.swap_next', params: sampler });
		expect(result).toMatchObject({ barPressed: false, device: 0, chain: 0, changed: 1 });
		expect(result).not.toHaveProperty('gridIndex');
		expect(result.timings.hoverMs).toBe(210);
		expect(result.pads).toEqual([{ note: 38, before: 'Snare-A', after: 'Snare-B', changed: true, sameDevice: true }]);
	});

	it('finds the Drum Sampler behind an effect at the head of the pad\'s chain', async () => {
		const r = rig({ samplerChain: 1 });
		const { result } = await request(r, 'pad:38', 'prev');
		const reads = r.helperCalls
			.filter(([v, a]) => v === 'read' && a.target === 'sampler.device')
			.map(([, a]) => (a.params as { chain: number }).chain);
		expect(reads).toEqual([0, 1]);
		expect(r.helperCalls.at(-1)![1]).toMatchObject({ target: 'sampler.swap_prev', params: { device: 0, chain: 1 } });
		expect(result.chain).toBe(1);
	});

	it('is a named error, pressing nothing, when Live shows another pad\'s instrument', async () => {
		const r = rig({ samplerTitle: 'Kick-A, Drum Sampler' });
		const { reply } = await request(r, 'pad:38', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'swap-sampler-not-in-view']);
		expect(calls(r)).toEqual(['read:sampler.device', 'read:sampler.device']);
		expect(r.surfaceCalls.map((c) => c[0])).toEqual([SHOW, NAMES, FINISH]);
	});

	it('refuses a greyed-out button with a reason, pressing nothing', async () => {
		// Live greys both directions when its index has no embedding for the
		// samples on those pads — a Place still being indexed, or never added
		// (measured on the rig 2026-09-15). Reading the control first turns
		// that into a reason a performer can act on.
		const r = rig({ disabled: true });
		const { reply } = await request(r, 'kit', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'swap-not-rankable']);
		expect(String(reply[3])).toMatch(/index has not featured them/);
		// Both directions read: the second is what rules out "end of the walk".
		expect(calls(r)).toEqual([
			'read:device.show_swap_bar',
			'read:kit.swap_next',
			'read:kit.swap_prev',
			'press:device.show_swap_bar'
		]);
		expect(r.surfaceCalls.map((c) => c[0])).toEqual([SHOW, NAMES, FINISH]);
	});

	it('tells the end of the walk apart from nothing to rank, by the other direction', async () => {
		// A freshly loaded kit sits ON its reference sample, so Live disables
		// Previous and leaves Next alone — measured on the rig 2026-09-15,
		// which is what made every first press of the pill's top half read as
		// "not rankable".
		const r = rig({ disabled: 'prev' });
		const { reply } = await request(r, 'kit', 'prev');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'swap-at-the-end']);
		expect(String(reply[3])).toMatch(/nothing before this kit's samples — next still steps/);
		expect(calls(r)).toEqual([
			'read:device.show_swap_bar',
			'read:kit.swap_prev',
			'read:kit.swap_next',
			'press:device.show_swap_bar'
		]);

		// The direction that still steps is not refused.
		const r2 = rig({ disabled: 'prev' });
		const { reply: ok } = await request(r2, 'kit', 'next');
		expect(ok.slice(0, 2)).toEqual(['r1', 1]);
	});

	it('puts a swap bar it turned on back when the swap does not happen', async () => {
		const r = rig({ disabled: true });
		r.barOn.value = 0;
		await request(r, 'kit', 'next');
		const barPresses = r.helperCalls.filter(([v, a]) => v === 'press' && a.target === 'device.show_swap_bar');
		expect(barPresses).toHaveLength(2); // on for the read, off again after the refusal
	});

	it('hides a swap bar it found on when the swap does not happen', async () => {
		const r = rig({ disabled: true });
		r.barOn.value = 1;
		await request(r, 'kit', 'next');
		expect(r.helperCalls.filter(([v, a]) => v === 'press' && a.target === 'device.show_swap_bar')).toHaveLength(1);
		expect(r.barOn.value).toBe(0);
	});

	it('never touches the swap bar for a pad', async () => {
		const r = rig();
		await request(r, 'pad:38', 'next');
		expect(r.helperCalls.filter(([, a]) => a.target === 'device.show_swap_bar')).toEqual([]);
	});

	it('refuses a pad that is not a Drum Sampler without touching Live\'s buttons', async () => {
		const r = rig({ classes: { 38: 'OriginalSimpler' } });
		const { reply } = await request(r, 'pad:38', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'swap-not-a-drum-sampler']);
		expect(r.helperCalls).toEqual([]);
		expect(r.surfaceCalls.map((c) => c[0])).toEqual([SHOW, NAMES, FINISH]);
	});

	it('passes a hover that revealed no buttons on as the helper\'s named error', async () => {
		const r = rig({ hoverError: { code: 'ax-wait-timeout', detail: '\'sampler.swap_next\' not as wanted within 1000 ms' } });
		const { reply } = await request(r, 'pad:38', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'ax-wait-timeout']);
		expect(r.helperCalls.some(([v]) => v === 'press')).toBe(false);
	});

	it('matches a long sample name against the 64 characters the surface reads', async () => {
		const long = 'Snare-' + 'x'.repeat(58);
		const r = rig({ samplerTitle: `${long}-and-more, Drum Sampler` });
		r.names.set(38, long);
		const { reply } = await request(r, 'pad:38', 'next');
		expect(reply.slice(0, 2)).toEqual(['r1', 1]);
	});

	it('takes next or prev, one press each; anything else touches nothing', async () => {
		const r = rig();
		for (const direction of ['return', 'commit', 'sideways']) {
			expect((await request(r, 'kit', direction)).reply.slice(1, 3)).toEqual([0, 'swap-bad-request']);
		}
		expect((await request(r, 'pad:kick', 'next')).reply[2]).toBe('swap-bad-request');
		expect(r.surfaceCalls).toEqual([]);
		expect(r.helperCalls).toEqual([]);
	});

	it('is a named error, touching nothing, when the helper is not ready', async () => {
		const r = rig({ ready: false });
		const { reply } = await request(r, 'kit', 'next');
		expect(reply).toEqual(['r1', 0, 'ax-untrusted', 'switch it on', '']);
		expect(r.surfaceCalls).toEqual([]);
	});

	/*
	 * The client holds `state` at `ready` for `downGraceMs` (1.5 s) after the
	 * socket drops, so `state` alone says go while nothing can be pressed —
	 * and step 1 is `show_for_swap`, which selects the rack's track and pad,
	 * scrolls Live's grid and opens an undo step. Moving the performer's view
	 * for a swap that cannot happen is the cost this refusal avoids (M6).
	 */
	it('refuses inside the down grace window, where state still reads ready', async () => {
		const r = rig({ connected: false });
		const { reply } = await request(r, 'kit', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'ax-helper-down']);
		expect(r.surfaceCalls).toEqual([]);
		expect(r.helperCalls).toEqual([]);
	});

	it('passes the surface\'s refusal on as a named error', async () => {
		const r = rig({ showOk: false });
		const { reply } = await request(r, 'kit', 'next');
		expect(reply.slice(0, 3)).toEqual(['r1', 0, 'swap-not-a-drum-rack']);
		expect(r.helperCalls).toEqual([]);
	});

	/**
	 * M8. This used to assert that both swaps ran, one after the other — the
	 * behaviour the audit is about. The queue is global, so the second does not
	 * race the first; it waits and then presses again on whatever the first
	 * left selected, which is a second swap nobody asked for. The UI's guard
	 * key is `rackPath|scope`, so a pad press during an in-flight kit swap
	 * changes the key, re-enables both halves and queues it.
	 */
	it('refuses a second swap on a rack that already has one in flight', async () => {
		const r = rig();
		await Promise.all([
			r.swap.handleClientRequest(r.ws, { args: ['a', RACK, 'kit', 'next'] }),
			r.swap.handleClientRequest(r.ws, { args: ['b', RACK, 'pad:36', 'next'] })
		]);
		// The refusal is synchronous, so it answers before the swap it refused
		// — which is the point: the pill re-enables immediately with a reason.
		const byId = Object.fromEntries(r.replies.map((rep) => [rep[0], rep.slice(0, 3)]));
		expect(byId.b).toEqual(['b', 0, 'swap-busy']);
		expect(byId.a).toEqual(['a', 1, '']);
		// The refusal costs Live nothing: one show_for_swap, one swap press
		// (and the first swap's own bar hide).
		expect(r.surfaceCalls.filter((c) => c[0] === SHOW)).toHaveLength(1);
		expect(r.helperCalls.filter(([v]) => v === 'press').map(([, a]) => a.target)).toEqual([
			'kit.swap_next',
			'device.show_swap_bar'
		]);
	});

	/**
	 * M5. The surface expires the undo step `show_for_swap` opened at 60 s, so
	 * every step after that is renaming chains inside a step Live has already
	 * closed — and for as long as it stays open the performer's own edits fold
	 * into `Undo Next Similar` (M3). One 45 s deadline covers the whole swap.
	 */
	it('gives up at its own deadline rather than running into Live\'s 60 s expiry', async () => {
		// Every fake in this rig answers synchronously, so the clock has to
		// advance itself: 10 s per reading is a swap that takes a minute.
		let t = 0;
		const r = rig({ now: () => (t += 10_000) });
		await r.swap.handleClientRequest(r.ws, { args: ['slow', RACK, 'kit', 'next'] });
		const reply = r.replies.at(-1)!;
		expect(reply[1]).toBe(0);
		expect(reply[2]).toBe('swap-timeout');
		expect(String(reply[3])).toContain('45 s deadline');
		// The undo step still closes: finish_swap goes out from the finally.
		expect(r.surfaceCalls.map((c) => c[0])).toContain(FINISH);
	});

	it('gives every helper read a short explicit timeout, not the client default', async () => {
		const r = rig();
		await request(r, 'kit', 'next');
		const reads = r.helperCalls.filter(([verb]) => verb === 'read');
		expect(reads.length).toBeGreaterThan(0);
		for (const [, , options] of reads) {
			// M3: without this each read inherits `axHelper.requestTimeoutMs`
			// (20 s), and this path can do three of them.
			expect(options).toBeDefined();
			expect(Number((options as { timeoutMs: number }).timeoutMs)).toBeLessThanOrEqual(3000);
		}
	});

	it('takes a second swap on the same rack once the first has finished', async () => {
		const r = rig();
		await r.swap.handleClientRequest(r.ws, { args: ['a', RACK, 'kit', 'next'] });
		await r.swap.handleClientRequest(r.ws, { args: ['b', RACK, 'kit', 'next'] });
		expect(r.replies.map((rep) => rep.slice(0, 3))).toEqual([
			['a', 1, ''],
			['b', 1, '']
		]);
		// Each swap shows the bar it needs and hides it again: the first found
		// it on, the second found it off.
		expect(r.helperCalls.filter(([v]) => v === 'press').map(([, a]) => a.target)).toEqual([
			'kit.swap_next',
			'device.show_swap_bar',
			'device.show_swap_bar',
			'kit.swap_next',
			'device.show_swap_bar'
		]);
	});

	it('runs swaps on two racks one at a time too: each selects its own track', async () => {
		const r = rig();
		await Promise.all([
			r.swap.handleClientRequest(r.ws, { args: ['a', RACK, 'kit', 'next'] }),
			r.swap.handleClientRequest(r.ws, { args: ['b', OTHER_RACK, 'kit', 'next'] })
		]);
		expect(r.surfaceCalls.map((c) => c[2])).toEqual([RACK, RACK, RACK, RACK, OTHER_RACK, OTHER_RACK, OTHER_RACK, OTHER_RACK]);
		expect(r.replies.map((rep) => rep[0])).toEqual(['a', 'b']);
	});

	/*
	 * The press carries `timeoutS`, and `verbs.py::_timeout` lets a
	 * per-request value WIN over the helper's configured
	 * `axHelper.messagingTimeoutS` — so a second copy of the number in the
	 * bridge silently outranks the knob, and the bridge's own ceiling
	 * (`timeoutS + 5` s) is derived from it: raise the constant past 20 with a
	 * literal here and the bridge gives up, runs its `finally` and closes
	 * Live's undo step while the helper is still pressing.
	 */
	it('sends the configured messaging timeout on the press and derives its own ceiling from it', async () => {
		const r = rig({ pressTimeoutS: 22 });
		await request(r, 'kit', 'next');
		const [, args, options] = r.helperCalls.find(([v, a]) => v === 'press' && a.target === 'kit.swap_next')!;
		expect(args.timeoutS).toBe(22);
		expect(options).toEqual({ timeoutMs: 27_000 });
	});

	it('the bridge passes that constant rather than a literal', () => {
		const source = readFileSync(join(__dirname, '../../../../bridge/enhanced-osc-bridge.js'), 'utf8');
		const construction = source.slice(
			source.indexOf('createDrumSwapSimilar({'),
			source.indexOf('const { httpServer, wss }')
		);
		expect(construction, 'createDrumSwapSimilar is not constructed in enhanced-osc-bridge.js').toContain(
			'pressTimeoutS'
		);
		expect(construction).toMatch(/pressTimeoutS:\s*\(?constants\.axHelper/);
	});

	it('consumes its own surface replies and nothing else', () => {
		const r = rig();
		expect(r.swap.onSurfaceMessage({ address: SHOW_ACK_ADDRESS, args: ['stray', 1] })).toBe(true);
		expect(r.swap.onSurfaceMessage({ address: FINISH_ACK_ADDRESS, args: ['stray', 1] })).toBe(true);
		expect(r.swap.onSurfaceMessage({ address: '/looping/v3/track/name', args: [] })).toBe(false);
		expect(REPLY_ADDRESS).toBe('/looping/v3/drum/swap_similar/reply');
	});
});
