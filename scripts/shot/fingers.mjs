/**
 * CDP touch contacts, shared by the multitouch harness (`multitouch.mjs`)
 * and the demo runner (`scripts/demo/`). Fingers dispatched through
 * `Input.dispatchTouchEvent` enter Chromium's own input pipeline: real
 * hit-testing, real pointer ids, real `touch-action` arbitration.
 */

/**
 * One finger, from touchdown to lift.
 *
 * CDP wants the FULL set of live contacts on every event, so the driver
 * owns that set and each finger only says where it is. That is also the
 * shape of the bug this harness exists to catch: a handler that reads
 * "the first contact" instead of "my contact" is wrong exactly when this
 * set has more than one entry in it.
 */
export class Fingers {
	constructor(cdp) {
		this.cdp = cdp;
		/** id → {x, y} for every contact currently on the glass. */
		this.points = new Map();
		this.nextId = 1;
	}

	#payload() {
		return [...this.points.entries()].map(([id, p]) => ({
			x: p.x,
			y: p.y,
			id,
			radiusX: 12,
			radiusY: 12,
			force: 1
		}));
	}

	async #dispatch(type, changed) {
		await this.cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchEnd' ? changed : this.#payload(),
			modifiers: 0
		});
	}

	/** Put a new finger down at (x, y). Returns its id. */
	async down(x, y) {
		const id = this.nextId++;
		this.points.set(id, { x, y });
		await this.#dispatch('touchStart');
		return id;
	}

	/** Move one finger. Every other contact stays where it is. */
	async move(id, x, y) {
		if (!this.points.has(id)) throw new Error(`finger ${id} is not down`);
		this.points.set(id, { x, y });
		await this.#dispatch('touchMove');
	}

	/** Lift one finger; the rest stay down. */
	async up(id) {
		const p = this.points.get(id);
		if (!p) throw new Error(`finger ${id} is not down`);
		this.points.delete(id);
		await this.#dispatch('touchEnd', [
			{ x: p.x, y: p.y, id, radiusX: 12, radiusY: 12, force: 0 }
		]);
	}

	/** Down and straight back up, with no other contact involved. */
	async tap(x, y) {
		const id = await this.down(x, y);
		await this.up(id);
	}

	/** Drop every remaining contact — scenario hygiene between runs. */
	async release() {
		for (const id of [...this.points.keys()]) await this.up(id);
	}
}
