/**
 * Where a device dragged in the chain overview lands, the order the
 * overview shows while it is in flight, and the moves that take Live there.
 *
 * `to` is the index the device ends up at, in the chain as it is after
 * the move — the cell position under the finger in the previewed order.
 *
 * The instrument stays put and nothing crosses it: Live keeps MIDI
 * effects before the instrument and audio effects after it, so a position
 * on the far side clamps to the instrument's near edge.
 */
export function clampChainIndex(input: {
	from: number;
	to: number;
	count: number;
	/** The instrument's index on a MIDI track (or a pad), or null. */
	instrument: number | null;
}): number | null {
	const { from, count, instrument } = input;
	if (from === instrument) return null;
	let to = Math.max(0, Math.min(count - 1, input.to));
	if (instrument !== null) {
		// Before the instrument it shifts left by one once the device leaves.
		to = from < instrument ? Math.min(to, instrument - 1) : Math.max(to, instrument + 1);
	}
	return to;
}

/**
 * The chain index Live should move a device to, for a drop at `to` in the
 * chain as drawn. The drawn chain leaves some devices out (`hiddenDevices`),
 * so a drawn position is not Live's index once one sits ahead of it: the
 * device drawn at `to` now is where the moved one lands, so its own index
 * is the answer. Read off its path (`…/devices/<N>`).
 */
export function liveChainIndex(drawn: readonly { path: string }[], to: number): number {
	const m = /\/devices\/(\d+)$/.exec(drawn[to]?.path ?? '');
	return m ? Number(m[1]) : to;
}

/** `items` with the one at `from` moved to `to`. */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
	const out = items.slice();
	const [item] = out.splice(from, 1);
	out.splice(to, 0, item);
	return out;
}

/**
 * A device in the overview's order: `key` names its cell, `sig` says what
 * it is (class and name — two Auto Filters of one name share it), `path`
 * is where Live has it now.
 */
export interface ChainEntry {
	key: string;
	sig: string;
	path: string;
}

/**
 * A reorder in progress (2026-10-26). `desired` is the order the user
 * dropped, held on screen until Live reports it. One move is on the wire
 * at a time: `inflight` is the order (as sigs) Live should report once it
 * lands, and when to give up on it. Another drop while one is in flight
 * replaces `desired` and waits its turn, so every move is sent against the
 * paths Live last reported — never a path a pending move has shifted.
 */
export interface ReorderState {
	desired: { key: string; sig: string }[] | null;
	inflight: { expect: string[]; until: number } | null;
}

export const REORDER_IDLE: ReorderState = { desired: null, inflight: null };

/** True when two orders hold the same devices, in any order. */
export function sameDevices(a: readonly { sig: string }[], b: readonly { sig: string }[]): boolean {
	if (a.length !== b.length) return false;
	const count = new Map<string, number>();
	for (const { sig } of a) count.set(sig, (count.get(sig) ?? 0) + 1);
	for (const { sig } of b) {
		const n = count.get(sig);
		if (!n) return false;
		count.set(sig, n - 1);
	}
	return true;
}

/**
 * `entries` in the order `order` names: by key, then by sig for a key
 * Live's renumbering has moved to another device of the same name. Null
 * when the two do not hold the same devices.
 */
export function arrange<T extends { key: string; sig: string }>(
	entries: readonly T[],
	order: readonly { key: string; sig: string }[]
): T[] | null {
	if (entries.length !== order.length) return null;
	const byKey = new Map(entries.map((e) => [e.key, e]));
	const used = new Set<T>();
	const out: (T | null)[] = order.map((o) => {
		const e = byKey.get(o.key);
		if (!e || e.sig !== o.sig || used.has(e)) return null;
		used.add(e);
		return e;
	});
	for (let i = 0; i < out.length; i++) {
		if (out[i]) continue;
		const e = entries.find((x) => !used.has(x) && x.sig === order[i].sig);
		if (!e) return null;
		used.add(e);
		out[i] = e;
	}
	return out as T[];
}

/**
 * The next step of a reorder against the chain Live reports (`natural`):
 * the state to hold and the move to send, if any. A landed move clears
 * `inflight`; one Live has not shown by its deadline drops the whole
 * reorder (Live refused, and its order stands); a chain that gained or
 * lost a device drops it too. Otherwise the next move goes out: the one
 * move that finishes it when there is one (every single drop), else the
 * first device out of place moved left into its place (drops queued
 * behind a move in flight). Neither crosses the instrument, since
 * `desired` keeps it where it is.
 */
export function planReorder(
	state: ReorderState,
	natural: readonly ChainEntry[],
	now: number,
	timeoutMs: number
): { state: ReorderState; send: { path: string; to: number } | null } {
	const { desired } = state;
	if (!desired || !sameDevices(natural, desired)) return { state: REORDER_IDLE, send: null };
	const sigs = natural.map((e) => e.sig);
	if (state.inflight) {
		const landed = state.inflight.expect.every((s, i) => s === sigs[i]);
		if (!landed) {
			return now >= state.inflight.until ? { state: REORDER_IDLE, send: null } : { state, send: null };
		}
	}
	const want = desired.map((d) => d.sig);
	const i = want.findIndex((s, k) => s !== sigs[k]);
	if (i < 0) return { state: REORDER_IDLE, send: null };
	const step = singleMove(sigs, want) ?? firstFix(sigs, want, i);
	if (!step) return { state: REORDER_IDLE, send: null };
	return {
		state: { desired, inflight: { expect: moved(sigs, step.from, step.to), until: now + timeoutMs } },
		send: { path: natural[step.from].path, to: step.to }
	};
}

/** The one move that turns `sigs` into `want` — what a single drop is — or null. */
function singleMove(sigs: string[], want: string[]): { from: number; to: number } | null {
	const n = sigs.length;
	let lo = 0;
	while (lo < n && sigs[lo] === want[lo]) lo++;
	let hi = n - 1;
	while (hi > lo && sigs[hi] === want[hi]) hi--;
	// Within [lo, hi] the order differs by one device taken from one end and
	// put at the other.
	const same = (from: number, to: number) => moved(sigs, from, to).every((s, k) => s === want[k]);
	if (same(lo, hi)) return { from: lo, to: hi };
	if (same(hi, lo)) return { from: hi, to: lo };
	return null;
}

/** Several drops queued: the first device out of place, moved left into it. */
function firstFix(sigs: string[], want: string[], i: number): { from: number; to: number } | null {
	const j = sigs.findIndex((s, k) => k > i && s === want[i]);
	return j < 0 ? null : { from: j, to: i };
}

/**
 * The ghost section's tiles (ADR-484; the user, 2026-11-05): two cells
 * wide, four columns of four on a chain of one row, six columns of two
 * once the chain wraps to two rows. The last tile is + Effect; the
 * recents get the rest (`shown`).
 */
export function recentLayout(chainRows: number): { columns: number; rows: number; shown: number } {
	return chainRows > 1 ? { columns: 6, rows: 2, shown: 11 } : { columns: 4, rows: 4, shown: 15 };
}

/** Where one cell of the chain sits: its row, its first unit column and how many it spans. */
export interface ChainPlace {
	row: number;
	col: number;
	span: number;
}

/**
 * The chain overview's grid in width units (the user, 2026-11-05): a
 * device a slider draws takes one unit, one with a pad or a picture two,
 * and the ghost section `ghost` units at the end. Up to `rowUnits` the
 * whole chain is one row; past it two, as even as the cells allow. A cell
 * that would not fit at the end of a row starts the next one, and the cell
 * before it widens to the row's end, so no row has a hole; the ghost
 * section takes its row's rest. Never more than two rows: the FX section
 * is two tiles tall.
 */
export function chainUnitLayout(
	widths: readonly number[],
	ghost: number,
	rowUnits: number
): { cols: number; rows: number; places: ChainPlace[]; ghost: ChainPlace } {
	const total = widths.reduce((a, w) => a + w, 0) + ghost;
	if (total <= rowUnits) {
		let col = 0;
		const places = widths.map((span) => {
			const p = { row: 0, col, span };
			col += span;
			return p;
		});
		return { cols: total, rows: 1, places, ghost: { row: 0, col, span: ghost } };
	}
	for (let cols = Math.ceil(total / 2); ; cols++) {
		const laid = placeInRows(widths, ghost, cols);
		if (laid) return { cols, rows: 2, ...laid };
	}
}

function placeInRows(widths: readonly number[], ghost: number, cols: number): { places: ChainPlace[]; ghost: ChainPlace } | null {
	const places: ChainPlace[] = [];
	let row = 0;
	let col = 0;
	const wrap = () => {
		const last = places[places.length - 1];
		if (last && last.row === row) last.span += cols - col;
		row += 1;
		col = 0;
	};
	for (const w of widths) {
		const span = Math.min(w, cols);
		if (col + span > cols) wrap();
		if (row > 1) return null;
		places.push({ row, col, span });
		col += span;
	}
	if (col + ghost > cols) wrap();
	if (row > 1) return null;
	return { places, ghost: { row, col, span: cols - col } };
}

/**
 * The index a dragged cell lands at, for a point at unit column `col` on
 * `row` of a layout taken at lift: the cell under it, or past the last cell
 * of that row when the point is beyond them (the ghost section).
 */
export function chainIndexAt(places: readonly ChainPlace[], row: number, col: number): number {
	let after = -1;
	for (let i = 0; i < places.length; i++) {
		const p = places[i];
		if (p.row !== row) continue;
		if (col >= p.col && col < p.col + p.span) return i;
		if (p.col <= col) after = i;
	}
	if (after >= 0) return after + 1;
	const first = places.findIndex((p) => p.row === row);
	return first >= 0 ? first : places.length;
}
