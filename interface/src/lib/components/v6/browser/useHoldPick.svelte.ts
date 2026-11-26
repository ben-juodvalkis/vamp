/**
 * Hold a folder tile or a section header → load a random preset from it.
 *
 * Both run on `use:press` (ADR-427): `onDown` rolls the pick and mounts the
 * charge, `onHold` (at `HOLD_MS`) fires the load, and a release before the
 * hold is an abort — on a folder tile a tap also drills in, on a header it
 * does nothing. A pan the browser claims or 12px of travel aborts without a
 * tap.
 *
 * Two pieces of feedback hang off this. At 500ms the hold is long enough to
 * be read as a gauge, so it wears the same rising fill as ClipCentralView's
 * 800ms gates:
 *
 *   charge — `chargingFolder` marks the tile under an active press, which
 *            mounts a `.hold-fill` that climbs it over exactly `HOLD_MS` and
 *            lands full at the instant the hold fires. The class stays on
 *            past the fire (the fill is `forwards`) so the tile holds the
 *            filled look through the async pick rather than dropping back for
 *            a frame. Past the fire the charge outlives the finger: releasing
 *            the moment the fill tops out is the NORMAL way to use the
 *            gesture, and the pick may still be awaiting a cold catalog. A
 *            finger drifting off mid-hold is not an abort either.
 *   pick   — `pickedFolder`/`pickedName` turn the held tile into the reveal
 *            surface for `revealMs`: it takes the preset grammar and its label
 *            becomes the preset that actually got loaded. This is the payoff
 *            of the whole gesture — a random pick is the one choice you can't
 *            know in advance.
 *
 * The pick is rolled at press-down so its name can show WHILE the bar is
 * climbing (after `PICK_SHOW_AFTER_MS`, so a tap that drills in never
 * flashes a name). The fire commits that exact preset; it never re-rolls.
 *
 * `token` (bumped on every press) guards a late resolution: hold A past the
 * fire, release, press B, and A's pick resolving afterwards must not wipe
 * B's charge or label B's screen. The host's load gates its visual writes on
 * `owns(token)`; the load itself goes through either way.
 */
import { HOLD_MS } from '$lib/actions/pressMachine';
import type { PressOptions } from '$lib/actions';
import { canLoad } from '$lib/utils/placeKinds';
import type { Preset } from '$lib/services/adapters';

export { HOLD_MS };

/** How long a hold runs before the speculative pick's name shows. */
export const PICK_SHOW_AFTER_MS = 250;

export interface HoldPickDeps {
	/** A folder's random pick: the adapter's, over its whole subtree. Null with no adapter. */
	rollFolder(folderName: string): Promise<Preset | null> | null;
	/** The hold fired: load `pick`, owning the tile while `owns(token)`. */
	fire(folderName: string, token: number, pick: Promise<Preset | null>): void;
	/** A folder tile tapped (released before the hold): drill in. */
	enter(folderName: string): void;
	/** How long the reveal shows the loaded preset's name. */
	revealMs: number;
}

export class HoldPick {
	chargingFolder = $state<string | null>(null);
	/**
	 * The speculative pick's name, shown on the tile while the bar climbs.
	 * Null until the pick resolves — on a cold catalog that can be after the
	 * fire, in which case the tile simply goes straight to `.picked`.
	 */
	private chargingName = $state<string | null>(null);
	/**
	 * The speculative pick's TILE, for a section-header press: the tiles are
	 * on screen under the header, so the pick lights its own tile while the
	 * bar climbs (the finger on the header covers its label). A folder-tile
	 * press never sets it.
	 */
	private chargingPresetPath = $state<string | null>(null);
	/** False until the hold passes PICK_SHOW_AFTER_MS; gates both of the above. */
	private pickShowDue = $state(false);
	pickedFolder = $state<string | null>(null);
	pickedName = $state<string | null>(null);

	readonly shownChargingName = $derived(this.pickShowDue ? this.chargingName : null);
	readonly shownChargingPresetPath = $derived(this.pickShowDue ? this.chargingPresetPath : null);

	private token = 0;
	private pickShowTimer: ReturnType<typeof setTimeout> | null = null;
	private pickRevealTimer: ReturnType<typeof setTimeout> | null = null;
	/** Handle for the re-arm frame in `armCharge`, so teardown can drop it. */
	private chargeRaf = 0;
	/** The pick each held press is carrying, from its `onDown` to its `onHold`. */
	private picks = new Map<string, { token: number; pick: Promise<Preset | null> }>();

	constructor(private deps: HoldPickDeps) {}

	/** Whether `token` is still the newest press. */
	owns(token: number): boolean {
		return token === this.token;
	}

	/** What a held tile or header reads: the reveal, then the pick mid-climb, else null. */
	labelFor(key: string): string | null {
		if (this.pickedFolder === key && this.pickedName) return this.pickedName;
		if (this.chargingFolder === key && this.shownChargingName) return this.shownChargingName;
		return null;
	}

	/** Retire the charge — the fill unmounts and the tile takes its own name back. */
	clearCharge() {
		this.chargingFolder = null;
		this.chargingName = null;
		this.chargingPresetPath = null;
		this.clearPickShow();
	}

	/** Retire the pick reveal — the tile goes back to being a folder. */
	clearPickReveal() {
		if (this.pickRevealTimer) {
			clearTimeout(this.pickRevealTimer);
			this.pickRevealTimer = null;
		}
		this.pickedFolder = null;
		this.pickedName = null;
	}

	/**
	 * Show `presetName` on `folder`'s tile for the reveal window. The revert
	 * runs even though an unlocked browser closes at the same moment: locked,
	 * nothing closes, and the tile would otherwise keep the name forever.
	 */
	showPickOn(folder: string, presetName: string) {
		if (this.pickRevealTimer) clearTimeout(this.pickRevealTimer);
		this.pickedFolder = folder;
		this.pickedName = presetName;
		this.pickRevealTimer = setTimeout(() => {
			// The charge outlives the finger and `.picked` has been covering
			// it; when the reveal goes, take it with us.
			this.clearCharge();
			this.clearPickReveal();
		}, this.deps.revealMs);
	}

	/** A folder tile's press: roll from the adapter, tap drills in. */
	folderPress(name: string): PressOptions {
		return {
			holdMs: HOLD_MS,
			onDown: () => {
				const token = this.begin();
				// Rolled here, committed at the fire — the name on the tile and
				// the preset that loads are the same object, never two rolls.
				// Speculative on every press, taps included: that costs one
				// catalog read, which a drill needs anyway.
				const pick = this.deps.rollFolder(name) ?? Promise.resolve(null);
				this.picks.set(name, { token, pick });
				// Label-only branch. Attaching a handler here also keeps an
				// aborted press (nothing awaits `pick`) from surfacing as an
				// unhandled rejection; the real error reaches the host's load.
				pick
					.then((preset) => {
						if (preset && this.owns(token) && this.chargingFolder === name) {
							this.chargingName = preset.name;
						}
					})
					.catch(() => {});
				this.armCharge(name, token);
			},
			onHold: () => this.fire(name),
			onPress: () => this.deps.enter(name),
			onRelease: (info) => this.end(name, info.held)
		};
	}

	/**
	 * A section header's press. The pick is rolled from the section's own
	 * presets, not the adapter: past the depth cap the section's folder is
	 * not a node in the catalog, and the adapter would fall back to the
	 * parent. In memory, so the roll is synchronous and never cold. A tap
	 * does nothing.
	 */
	sectionPress(folder: string, sectionPresets: Preset[]): PressOptions {
		return {
			holdMs: HOLD_MS,
			onDown: () => {
				// A Places section can hold greyed tiles (a plug-in not
				// installed, an effect) that a tap cannot load, so a roll
				// cannot land on one either.
				const pool = sectionPresets.filter((p) => canLoad(p.kind, p.installed));
				if (pool.length === 0) return;
				const preset = pool[Math.floor(Math.random() * pool.length)];
				const token = this.begin();
				this.picks.set(folder, { token, pick: Promise.resolve(preset) });
				this.chargingName = preset.name;
				this.chargingPresetPath = preset.path;
				this.armCharge(folder, token);
			},
			onHold: () => this.fire(folder),
			onRelease: (info) => this.end(folder, info.held)
		};
	}

	destroy() {
		if (this.pickRevealTimer) clearTimeout(this.pickRevealTimer);
		this.pickRevealTimer = null;
		if (this.chargeRaf) cancelAnimationFrame(this.chargeRaf);
		this.chargeRaf = 0;
		this.clearPickShow();
		this.picks.clear();
	}

	/** A new press: retire the last reveal (one tile at a time) and take the token. */
	private begin(): number {
		this.clearPickReveal();
		this.chargingName = null;
		this.chargingPresetPath = null;
		return ++this.token;
	}

	private fire(key: string) {
		const held = this.picks.get(key);
		if (!held) return;
		this.deps.fire(key, held.token, held.pick);
	}

	/**
	 * Every ending. Past the fire the charge outlives the finger — the
	 * reveal's own expiry retires it. Before the fire this is an abort, and
	 * the speculative pick is discarded unused.
	 */
	private end(key: string, held: boolean) {
		const press = this.picks.get(key);
		this.picks.delete(key);
		if (!held && press && this.owns(press.token)) this.clearCharge();
	}

	private clearPickShow() {
		if (this.pickShowTimer) {
			clearTimeout(this.pickShowTimer);
			this.pickShowTimer = null;
		}
		this.pickShowDue = false;
	}

	/** Mount the charge on `name`'s tile or header, for the press `token`. */
	private armCharge(name: string, token: number) {
		this.clearPickShow();
		this.pickShowTimer = setTimeout(() => {
			this.pickShowTimer = null;
			if (this.owns(token)) this.pickShowDue = true;
		}, PICK_SHOW_AFTER_MS);
		if (this.chargingFolder === name) {
			// Re-pressing a tile that is STILL charging — its previous press
			// fired and that pick is in flight or on screen. Assigning the value
			// it already holds toggles no class, and a `forwards` fill parked
			// at its end never replays. Drop it and re-arm on the next frame.
			// Only this path pays that frame.
			this.chargingFolder = null;
			cancelAnimationFrame(this.chargeRaf);
			this.chargeRaf = requestAnimationFrame(() => {
				this.chargeRaf = 0;
				if (this.owns(token)) this.chargingFolder = name;
			});
		} else {
			this.chargingFolder = name;
		}
	}
}
