/**
 * swapHost — who draws the swap pill (ADR-439), `CentralDisplay` or the view.
 *
 * `CentralDisplay` owns the pill's model (`useInstrumentSwap` / `useClipSwap`)
 * and, by default, stands it on its end down the left of the view. A view
 * that has a place for it — above a group of its own controls, lying flat
 * (2026-09-16, the user's layout pass: the rack's wheels, Omnisphere's ORB,
 * a kit's pads, Drift's oscillator, Operator's envelope, Meld's and
 * Wavetable's lead pad) — mounts `HostedSwapPill` there instead. The hosted
 * pill CLAIMS the host for as long as it is mounted, and `CentralDisplay`
 * draws its column only while nothing holds a claim, so a view that places
 * the pill on one profile and not another (the Drum Rack) gets the column
 * back on the others without saying so.
 *
 * The claim is taken while the view initializes, in the same flush that
 * mounts it, so the column and the hosted pill never paint together.
 */

import { getContext, onDestroy, setContext } from 'svelte';
import type { SwapViewModel } from './useInstrumentSwap.svelte';
import type { SwapDirection } from '$lib/services/similarSwap.svelte';

export interface SwapPill {
	/** An instrument's model or an audio clip's — the pill draws either the same way. */
	model: Omit<SwapViewModel, 'kind'> | null;
	act: (direction: SwapDirection) => void;
	/**
	 * Open the browser to pick a replacement (ADR-442) — a tap on the pill's
	 * name. Null where the pill has nothing to open onto, which leaves the
	 * name a plain label on a pill that cannot answer for a track.
	 */
	open: (() => void) | null;
	/** The pill's ink — the focused track's. */
	ink: string | null;
}

const KEY = Symbol('central-swap-host');

export class SwapHost {
	// The count lives in a plain field and is only WRITTEN into `$state`,
	// never read back from it. A view change mounts the new view's pill (claim)
	// and then tears down the old one's (release) in one flush, and Svelte
	// hands a teardown the value a signal had before that flush: `claims -= 1`
	// read the pre-claim 1 and wrote 0, so the column stood beside the flat
	// pill after every tap from one hosting view to another (2026-09-16).
	#held = 0;
	#claims = $state(0);
	readonly #pill: () => SwapPill | null;

	constructor(pill: () => SwapPill | null) {
		this.#pill = pill;
	}

	get pill(): SwapPill | null {
		return this.#pill();
	}

	/** A view has placed the pill, so the column stays down. */
	get claimed(): boolean {
		return this.#claims > 0;
	}

	/** The pill has something to show — a view that lays out a row for it asks this. */
	get present(): boolean {
		return !!this.#pill()?.model;
	}

	claim(): () => void {
		this.#claims = ++this.#held;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#claims = --this.#held;
		};
	}
}

/** `CentralDisplay`, during init. */
export function provideSwapHost(pill: () => SwapPill | null): SwapHost {
	const host = new SwapHost(pill);
	setContext(KEY, host);
	return host;
}

/** A view, during init: the host, or null outside `CentralDisplay` (a pane, a test). */
export function useSwapHost(): SwapHost | null {
	return getContext<SwapHost | undefined>(KEY) ?? null;
}

/** `HostedSwapPill`, during init: take the pill for as long as this component is mounted. */
export function claimSwapHost(): SwapHost | null {
	const host = useSwapHost();
	if (host) onDestroy(host.claim());
	return host;
}
