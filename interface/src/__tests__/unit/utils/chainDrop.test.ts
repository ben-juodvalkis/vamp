import { describe, expect, it } from 'vitest';
import {
	arrange,
	chainGrid,
	clampChainIndex,
	moved,
	planReorder,
	REORDER_IDLE,
	sameDevices,
	type ChainEntry,
	type ReorderState, recentLayout, ghostSpan } from '$lib/utils/chainDrop';

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

describe('chainGrid', () => {
	it('keeps a short chain on one row, the + cell included', () => {
		expect(chainGrid(2, 4)).toEqual({ cols: 3, rows: 1 });
		expect(chainGrid(4, 4)).toEqual({ cols: 5, rows: 1 });
	});
	it('splits a longer chain evenly over two rows', () => {
		expect(chainGrid(5, 4)).toEqual({ cols: 3, rows: 2 });
		expect(chainGrid(8, 4)).toEqual({ cols: 5, rows: 2 });
		expect(chainGrid(12, 4)).toEqual({ cols: 7, rows: 2 });
	});
	it('an empty chain is the + cell alone', () => {
		expect(chainGrid(0, 4)).toEqual({ cols: 1, rows: 1 });
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
	it('is three columns of four on one row, five of two on two rows (+ Effect the last column)', () => {
		expect(recentLayout(1)).toEqual({ columns: 3, rows: 4, shown: 12 });
		expect(recentLayout(2)).toEqual({ columns: 5, rows: 2, shown: 10 });
	});
});

describe('the ghost section fills an uneven wrap (ADR-484)', () => {
	it('spans the empty cells its row would leave', () => {
		// 5 devices + the two-cell section on 4 x 2: one cell left over, beside it.
		expect(ghostSpan(5, 2, chainGrid(6, 4))).toBe(3);
		// + Effect alone after 6 devices on 4 x 2: one cell left over.
		expect(ghostSpan(6, 1, chainGrid(6, 4))).toBe(2);
		// A full row leaves nothing.
		expect(ghostSpan(6, 2, chainGrid(7, 4))).toBe(2);
		expect(ghostSpan(3, 2, chainGrid(4, 4))).toBe(2);
	});
});
