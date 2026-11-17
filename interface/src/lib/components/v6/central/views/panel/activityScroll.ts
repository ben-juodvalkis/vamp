/**
 * How the Compressor's activity view scrolls on the page (ADR-543): pure, so
 * the tests can drive it.
 *
 * Live scrolls its display in steps, a column or none per reading, at odd
 * moments; drawn as it arrives the picture jerks. `ActivityScroll` keeps the
 * columns in one running history, finds how far each reading has scrolled
 * since the last (`shiftBetween`), measures the rate, and gives the drawing
 * a head that moves on at that rate between readings, so the page scrolls
 * at Live's speed without its steps.
 */

/** The furthest one reading is looked for to have scrolled, in columns. */
export const MAX_SHIFT = 6;
/** The head stays this far behind the newest column, so it never runs out. */
export const LAG_COLUMNS = 3;
const HISTORY = 1024;

/**
 * How many columns `next` has scrolled past `prev`: the shift (0..`MAX_SHIFT`)
 * that lines their overlap up best. Small shifts only: a drum loop repeats,
 * and a long shift would line up with the previous hit.
 */
export function shiftBetween(prev: readonly number[], next: readonly number[]): number {
	const n = Math.min(prev.length, next.length);
	let best = 0;
	let bestCost = Infinity;
	for (let s = 0; s <= Math.min(MAX_SHIFT, n - 1); s++) {
		let cost = 0;
		for (let i = 0; i < n - s; i++) cost += Math.abs(prev[i + s] - next[i]);
		cost /= n - s;
		// Ties go to the smaller shift: a still picture is not a scroll.
		if (cost < bestCost - 1e-6) {
			bestCost = cost;
			best = s;
		}
	}
	return best;
}

/** A line with Live's gaps (a column it drew no line in) filled from the columns either side. */
export function fillGaps(line: ReadonlyArray<number | null>): number[] {
	const out = line.map((v) => (v === null ? NaN : v));
	for (let i = 0; i < out.length; i++) {
		if (!Number.isNaN(out[i])) continue;
		let a = i - 1;
		while (a >= 0 && Number.isNaN(out[a])) a--;
		let b = i + 1;
		while (b < out.length && Number.isNaN(out[b])) b++;
		const left = a >= 0 ? out[a] : undefined;
		const right = b < out.length ? out[b] : undefined;
		out[i] = left !== undefined && right !== undefined ? left + ((right - left) * (i - a)) / (b - a) : (left ?? right ?? 0);
	}
	return out;
}

export class ActivityScroll {
	fill: number[] = [];
	line: number[] = [];
	/** Columns ever taken in: the newest column's index plus one. */
	total = 0;
	/** The drawing's head, in columns on the same count as `total`. */
	head = 0;
	/** Columns a second, measured. */
	rate = 0;
	private lastAt = 0;
	private lastFill: number[] = [];
	private rateFrom: { at: number; total: number } | null = null;

	/** Take a reading at `now` (ms). */
	push(fill: readonly number[], line: readonly number[], now: number): void {
		if (this.lastFill.length !== fill.length) {
			this.fill = [...fill];
			this.line = [...line];
			this.total = fill.length;
			this.head = this.total - LAG_COLUMNS;
			this.rateFrom = { at: now, total: this.total };
		} else {
			const s = shiftBetween(this.lastFill, fill);
			// The overlap takes the newest reading's values; the new columns go on the end.
			const keep = this.fill.length - (fill.length - s);
			this.fill = [...this.fill.slice(0, keep), ...fill];
			this.line = [...this.line.slice(0, keep), ...line];
			this.total += s;
			if (this.fill.length > HISTORY) {
				this.fill = this.fill.slice(-HISTORY);
				this.line = this.line.slice(-HISTORY);
			}
			const from = this.rateFrom;
			if (from && now - from.at >= 1000) {
				const measured = ((this.total - from.total) * 1000) / (now - from.at);
				this.rate = this.rate === 0 ? measured : this.rate * 0.6 + measured * 0.4;
				this.rateFrom = { at: now, total: this.total };
			}
		}
		this.lastFill = [...fill];
		this.lastAt = now;
	}

	/**
	 * Move the head on `dt` seconds at the measured rate, never past the
	 * newest column less the lag, and catching up if it fell far behind.
	 */
	advance(dt: number): void {
		const newest = this.total - LAG_COLUMNS;
		this.head = Math.min(newest, this.head + this.rate * dt);
		if (newest - this.head > 8) this.head = newest - 8;
	}

	/** The value at column `c` (on `total`'s count) of `series`, or undefined outside the history. */
	at(series: number[], c: number): number | undefined {
		const i = series.length - (this.total - c);
		return i >= 0 && i < series.length ? series[i] : undefined;
	}

	/** The time since the last reading, in ms. */
	since(now: number): number {
		return now - this.lastAt;
	}
}
