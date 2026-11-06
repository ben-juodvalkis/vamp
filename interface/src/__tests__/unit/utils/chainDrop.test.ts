import { describe, expect, it } from 'vitest';
import {
	arrange,
	clampChainIndex,
	liveChainIndex,
	moved,
	planReorder,
	REORDER_IDLE,
	sameDevices,
	type ChainEntry,
	type ReorderState, recentLayout, chainUnitLayout, chainIndexAt } from '$lib/utils/chainDrop';

describe('clampChainIndex', () => {
	it('lands where the finger is', () => {
		expect(clampChainIndex({ from: 3, to: 1, count: 5, instrument: null })).toBe(1);
		expect(clampChainIndex({ from: 1, to: 3, count: 5, instrument: null })).toBe(3);
	});
	it('clamps to the chain', () => {
		expect(clampChainIndex({ from: 0, to: 9, count: 5, instrument: null })).toBe(4);
	});
	it('never moves the instrument', () => {
		expect(clampChainIndex({ from: 1, to: 4, count: 5, instrument: 1 })).toBeNull();
	});
	it('keeps an audio effect after the instrument', () => {
		expect(clampChainIndex({ from: 4, to: 0, count: 5, instrument: 1 })).toBe(2);
	});
	it('keeps a MIDI effect before the instrument', () => {
		expect(clampChainIndex({ from: 0, to: 4, count: 5, instrument: 2 })).toBe(1);
	});
});

describe('moved', () => {
	it('moves one item and keeps the rest in order', () => {
		expect(moved(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
		expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
	});
});

/** A chain as Live reports it: each sig at its path, keyed as the overview keys it. */
function chain(...sigs: string[]): ChainEntry[] {
	return sigs.map((sig, i) => ({
		key: `${sig}|${sigs.slice(0, i).filter((s) => s === sig).length}`,
		sig,
		path: `tracks/0/devices/${i}`
	}));
}
const order = (c: ChainEntry[]) => c.map(({ key, sig }) => ({ key, sig }));

describe('sameDevices', () => {
	it('compares devices, not their order', () => {
		expect(sameDevices(chain('a', 'b', 'a'), chain('a', 'a', 'b'))).toBe(true);
		expect(sameDevices(chain('a', 'b'), chain('a', 'a'))).toBe(false);
		expect(sameDevices(chain('a'), chain('a', 'b'))).toBe(false);
	});
});

describe('arrange', () => {
	it('puts the cells in the order named', () => {
		const c = chain('a', 'b', 'c');
		expect(arrange(c, order(moved(c, 2, 0)))?.map((e) => e.sig)).toEqual(['c', 'a', 'b']);
	});
	it('keeps a cell its own key when two share a name', () => {
		const c = chain('x', 'a', 'a');
		const out = arrange(c, order(moved(c, 2, 0)));
		expect(out?.map((e) => e.key)).toEqual(['a|1', 'x|0', 'a|0']);
	});
	it('matches by name once Live has renumbered the keys', () => {
		const c = chain('a', 'b');
		expect(arrange(c, [{ key: 'gone', sig: 'b' }, { key: 'a|0', sig: 'a' }])?.map((e) => e.sig)).toEqual([
			'b',
			'a'
		]);
	});
	it('is null for another set of devices', () => {
		expect(arrange(chain('a', 'b'), order(chain('a', 'c')))).toBeNull();
	});
});

describe('planReorder', () => {
	const T = 2000;
	const drop = (to: ChainEntry[]): ReorderState => ({ desired: order(to), inflight: null });

	it('sends one move and waits for Live to show it', () => {
		const live = chain('a', 'b', 'c', 'd');
		const step = planReorder(drop(moved(live, 3, 1)), live, 0, T);
		expect(step.send).toEqual({ path: 'tracks/0/devices/3', to: 1 });
		expect(step.state.inflight?.expect).toEqual(['a', 'd', 'b', 'c']);
		// Live has not reported yet: nothing more goes out.
		expect(planReorder(step.state, live, 100, T)).toEqual({ state: step.state, send: null });
		// Live shows it: done.
		expect(planReorder(step.state, chain('a', 'd', 'b', 'c'), 200, T)).toEqual({ state: REORDER_IDLE, send: null });
	});

	it('a drop to the right is one move: one undo step in Live', () => {
		const live = chain('a', 'b', 'c', 'd');
		const step = planReorder(drop(moved(live, 0, 2)), live, 0, T);
		expect(step.send).toEqual({ path: 'tracks/0/devices/0', to: 2 });
		expect(planReorder(step.state, chain('b', 'c', 'a', 'd'), 20, T).state).toBe(REORDER_IDLE);
	});

	it('two drops queued behind a move go out one at a time until Live has them', () => {
		const live = chain('a', 'b', 'c', 'd');
		// a → end, then c → front: no single move gets there.
		const want = moved(moved(order(live), 0, 3), 1, 0);
		let state: ReorderState = { desired: want, inflight: null };
		let now = live;
		let sent = 0;
		for (let t = 0; t < 10 && state.desired; t++) {
			const step = planReorder(state, now, t, T);
			state = step.state;
			if (!step.send) break;
			sent++;
			const from = Number(step.send.path.split('/').pop());
			now = chain(...moved(now.map((e) => e.sig), from, step.send.to));
		}
		expect(now.map((e) => e.sig)).toEqual(want.map((d) => d.sig));
		expect(sent).toBe(2);
	});

	it('a second drop waits for the first to land, then goes out on fresh paths', () => {
		const live = chain('a', 'b', 'c', 'd');
		const first = planReorder(drop(moved(live, 3, 0)), live, 0, T);
		expect(first.send).toEqual({ path: 'tracks/0/devices/3', to: 0 });
		// Dropped again on the order shown (d a b c), before Live answered.
		const shown = moved(order(live), 3, 0);
		const again: ReorderState = { desired: moved(shown, 3, 1), inflight: first.state.inflight };
		expect(planReorder(again, live, 50, T).send).toBeNull();
		const landed = planReorder(again, chain('d', 'a', 'b', 'c'), 60, T);
		expect(landed.send).toEqual({ path: 'tracks/0/devices/3', to: 1 });
	});

	it('gives up on a move Live never shows', () => {
		const live = chain('a', 'b', 'c');
		const step = planReorder(drop(moved(live, 2, 0)), live, 0, T);
		expect(planReorder(step.state, live, T, T)).toEqual({ state: REORDER_IDLE, send: null });
	});

	it('drops the reorder when the chain gains or loses a device', () => {
		const live = chain('a', 'b', 'c');
		const step = planReorder(drop(moved(live, 2, 0)), live, 0, T);
		expect(planReorder(step.state, chain('a', 'b'), 10, T)).toEqual({ state: REORDER_IDLE, send: null });
	});

	it('sends nothing for an order Live already has', () => {
		const live = chain('a', 'b');
		expect(planReorder(drop(live), live, 0, T)).toEqual({ state: REORDER_IDLE, send: null });
	});

	it('never moves a device across the instrument', () => {
		// MIDI effects m1 m2, instrument I, audio effects e1 e2.
		const live = chain('m1', 'm2', 'I', 'e1', 'e2');
		const want = order(chain('m2', 'm1', 'I', 'e2', 'e1'));
		let state: ReorderState = { desired: want, inflight: null };
		let now = live;
		for (let t = 0; t < 10 && state.desired; t++) {
			const step = planReorder(state, now, t, T);
			state = step.state;
			if (!step.send) break;
			const from = Number(step.send.path.split('/').pop());
			const crossed = (from < 2) !== (step.send.to < 2) || from === 2;
			expect(crossed).toBe(false);
			now = chain(...moved(now.map((e) => e.sig), from, step.send.to));
		}
		expect(now.map((e) => e.sig)).toEqual(['m2', 'm1', 'I', 'e2', 'e1']);
	});
});

describe('the Recent block (ADR-484)', () => {
	it('is four columns of four on one row, six of two on two rows, + Effect the last tile', () => {
		expect(recentLayout(1)).toEqual({ columns: 4, rows: 4, shown: 15 });
		expect(recentLayout(2)).toEqual({ columns: 6, rows: 2, shown: 11 });
	});
});


describe('liveChainIndex', () => {
	const at = (...idx: number[]) => idx.map((n) => ({ path: `tracks/0/devices/${n}` }));
	it('is the drawn position while nothing is hidden', () => {
		expect(liveChainIndex(at(0, 1, 2, 3), 2)).toBe(2);
	});
	it('skips a hidden device ahead of the drop', () => {
		// Live's chain 0 1 [2 hidden] 3 4, drawn as 0 1 3 4: a drop at drawn 2 is Live's 3.
		expect(liveChainIndex(at(0, 1, 3, 4), 2)).toBe(3);
		expect(liveChainIndex(at(0, 1, 3, 4), 1)).toBe(1);
	});
	it('reads a pad chain\'s own index', () => {
		expect(liveChainIndex([{ path: 'tracks/0/devices/0/pads/36/devices/0' }, { path: 'tracks/0/devices/0/pads/36/devices/2' }], 1)).toBe(2);
	});
});

describe('chainUnitLayout: sliders one unit, pads two, the ghost section four', () => {
	it('keeps a chain that fits twelve units on one row, the ghost last', () => {
		const l = chainUnitLayout([2, 1, 2, 1, 2], 4, 12);
		expect(l.rows).toBe(1);
		expect(l.cols).toBe(12);
		expect(l.places.map((p) => p.col)).toEqual([0, 2, 3, 5, 6]);
		expect(l.ghost).toEqual({ row: 0, col: 8, span: 4 });
	});

	it('splits a longer chain over two rows with no hole: a cell that does not fit starts the next row, the one before widens', () => {
		const l = chainUnitLayout([2, 2, 2, 2, 1, 2, 2], 4, 12);
		expect(l.rows).toBe(2);
		for (const row of [0, 1]) {
			const used = [...l.places, l.ghost].filter((p) => p.row === row).reduce((a, p) => a + p.span, 0);
			expect(used, `row ${row}`).toBe(l.cols);
		}
		expect(l.ghost.row).toBe(1);
		expect(l.ghost.span).toBeGreaterThanOrEqual(4);
	});

	it('finds the landing index under a point, and past a row\'s last cell', () => {
		const l = chainUnitLayout([2, 1, 2], 4, 12);
		expect(chainIndexAt(l.places, 0, 0)).toBe(0);
		expect(chainIndexAt(l.places, 0, 2)).toBe(1);
		expect(chainIndexAt(l.places, 0, 4)).toBe(2);
		expect(chainIndexAt(l.places, 0, 9)).toBe(3);
	});
});

