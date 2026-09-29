/**
 * Clip Groove Store (PR-5e2)
 *
 * Scalar state for the focused clip's groove. Writes land via
 * [v3ClipGroove.ts](../../api/handlers/v3ClipGroove.ts), which gates on
 * `session.focusedClipPath` before touching this store — so every value
 * here belongs to the currently focused clip.
 *
 * `handleGrooveProperty(name, value)` dispatches the five property
 * names from `GrooveComponent`:
 *  - `base` → `baseGrid` (int ∈ {1,2,3})
 *  - `timing_amount` / `quantization_amount` / `random_amount` /
 *    `velocity_amount` → amount fields (float 0–100)
 *
 * `file` is the groove file the clip's groove holds (`Swing 16ths 57`), `""`
 * when none is known — the Groove view's lit tile. A tile tap sets it at
 * once (`chooseFile`) and the surface's echo confirms or corrects it.
 *
 * `hasGroove` flips on assignment and back off on unassign (either
 * pool-return-on-delete or the clip losing its groove in Live). The
 * focused-clipPath listener in [session.svelte.ts] calls `clearAll()`
 * on focus change so stale values don't bleed across clips.
 */

class ClipGrooveStore {
	// State
	private _hasGroove = $state<boolean>(false);
	private _baseGrid = $state<number>(1); // 1=1/8, 2=1/8T, 3=1/16
	private _timingAmount = $state<number>(0); // 0-100
	private _quantizationAmount = $state<number>(0);
	private _randomAmount = $state<number>(0);
	private _velocityAmount = $state<number>(0);
	private _file = $state<string>('');

	// Reactive getters
	get hasGroove(): boolean {
		return this._hasGroove;
	}
	get baseGrid(): number {
		return this._baseGrid;
	}
	get timingAmount(): number {
		return this._timingAmount;
	}
	get quantizationAmount(): number {
		return this._quantizationAmount;
	}
	get randomAmount(): number {
		return this._randomAmount;
	}
	get velocityAmount(): number {
		return this._velocityAmount;
	}
	get file(): string {
		return this._file;
	}

	// Derived
	get baseGridLabel(): string {
		const labels = ['1/8', '1/8T', '1/16'];
		const map = [1, 2, 3];
		const index = map.indexOf(this._baseGrid);
		return index >= 0 ? labels[index] : labels[0];
	}

	// Message handlers

	handleFile(name: string) {
		this._file = name;
	}

	/** A tile tap: shown at once, before the surface's echo. */
	chooseFile(name: string) {
		this._file = name;
	}

	handleHasGroove(value: boolean) {
		this._hasGroove = value;
	}

	handleGrooveProperty(name: string, value: number) {
		switch (name) {
			case 'base':
				this._baseGrid = value;
				return;
			case 'timing_amount':
				this._timingAmount = value;
				return;
			case 'quantization_amount':
				this._quantizationAmount = value;
				return;
			case 'random_amount':
				this._randomAmount = value;
				return;
			case 'velocity_amount':
				this._velocityAmount = value;
				return;
			default:
				// Unknown property name — silently ignore (handler already warns).
				return;
		}
	}

	// Clear all state on focus change. Mirrors clipPropertiesStore.clearAll().
	clearAll() {
		this._hasGroove = false;
		this._baseGrid = 1;
		this._timingAmount = 0;
		this._quantizationAmount = 0;
		this._randomAmount = 0;
		this._velocityAmount = 0;
		this._file = '';
	}
}

export const clipGrooveStore = new ClipGrooveStore();
