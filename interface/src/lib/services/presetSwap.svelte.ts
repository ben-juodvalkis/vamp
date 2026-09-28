/**
 * Folder-next — the swap pill on instruments with no similarity vector
 * (ADR-439 phase 2): Omnisphere patches and every plug-in or rack preset, and
 * a Drum Rack of Samplers, whose multisample pads Live's similar swap cannot step.
 *
 * A step loads the neighbor of the track's recorded preset in its catalog
 * folder, through the browser's own replace path (`loadPresetWithVariant`
 * pinned to the track: replace-instrument mode, the instrument swapped in
 * place with clips / Permute / FX kept, the track named and colored as a
 * browser pick would be). The list is computed once from the recorded preset
 * and wraps at its ends. One load at a time per track: an AU patch takes
 * 1.5–3 s, and the pill shows it working meanwhile.
 *
 * The folder follows the track. The surface records `looping.preset` on every
 * prepare load (`TrackRecord.preset`), so a pick made in the browser moves it;
 * the record our own step produces is recognized as ours and looks nothing up
 * again. A track with no recorded preset — loaded before protocol 3.9.0, or
 * outside `prepare_for_preset` — cannot step, and says so. Nor can a track
 * whose instrument is no longer the one that load left (Live's undo, a
 * hot-swap): the surface reports `''` for it too, and the folder goes.
 */

import { SvelteMap } from 'svelte/reactivity';
import { holdSwapError, dropSwapError } from './swapErrors';
import { logger } from '$lib/utils/logger';
import type { Preset } from './adapters/browserAdapter';
import { presetSiblings, type PresetSiblings } from './presetSwapCatalog';

export type PresetSwapStatus = 'no-preset' | 'loading' | 'ready' | 'not-in-catalog';

export interface PresetSwapState {
	status: PresetSwapStatus;
	presets: Preset[];
	index: number;
	working: boolean;
	error: string | null;
}

type Loader = (preset: Preset, trackPath: string) => Promise<void>;
type Finder = (fullPath: string) => Promise<PresetSiblings | null>;

const defaultLoader: Loader = async (preset, trackPath) => {
	const { loadPresetWithVariant } = await import('$lib/components/v6/browser/utils/presetLoader');
	await loadPresetWithVariant(preset, undefined, undefined, trackPath);
};

class PresetSwapStore {
	#states = new SvelteMap<string, PresetSwapState>();
	/** trackPath → the fullPath our own step is loading, so its record is not looked up again. */
	#expected = new Map<string, string>();
	#tokens = new Map<string, number>();
	#load: Loader = defaultLoader;
	#find: Finder = presetSiblings;

	state(trackPath: string): PresetSwapState | undefined {
		return this.#states.get(trackPath);
	}

	/** Follow the track's recorded preset. Cheap when nothing changed. */
	async sync(trackPath: string, presetPath: string): Promise<void> {
		const current = this.#states.get(trackPath);
		if (current?.status === 'ready') {
			if (this.#expected.get(trackPath) === presetPath) return;
			if (current.presets[current.index]?.fullPath === presetPath) return;
		}
		const token = (this.#tokens.get(trackPath) ?? 0) + 1;
		this.#tokens.set(trackPath, token);
		this.#expected.delete(trackPath);
		if (!presetPath) {
			this.#put(trackPath, 'no-preset');
			return;
		}
		if (current?.status !== 'loading') this.#put(trackPath, 'loading');
		let found: PresetSiblings | null = null;
		try {
			found = await this.#find(presetPath);
		} catch (err) {
			logger.warn('Preset swap: catalog lookup failed', { component: 'presetSwap', presetPath, err: String(err) });
		}
		if (this.#tokens.get(trackPath) !== token) return;
		if (!found) {
			this.#put(trackPath, 'not-in-catalog');
			return;
		}
		this.#states.set(trackPath, {
			status: 'ready',
			presets: found.presets,
			index: found.index,
			working: false,
			error: null
		});
	}

	async step(trackPath: string, delta: 1 | -1): Promise<void> {
		const s = this.#states.get(trackPath);
		if (!s || s.status !== 'ready' || s.working || s.presets.length < 2) return;
		const n = s.presets.length;
		const target = (s.index + delta + n) % n;
		const preset = s.presets[target];
		dropSwapError(trackPath);
		this.#states.set(trackPath, { ...s, working: true, error: null });
		this.#expected.set(trackPath, preset.fullPath);
		try {
			await this.#load(preset, trackPath);
			const now = this.#states.get(trackPath);
			if (now) this.#states.set(trackPath, { ...now, index: target, working: false });
		} catch (err) {
			this.#expected.delete(trackPath);
			const now = this.#states.get(trackPath);
			const message = err instanceof Error ? err.message : String(err);
			logger.warn('Preset swap: load failed', { component: 'presetSwap', trackPath, preset: preset.fullPath, message });
			if (now) {
				this.#states.set(trackPath, { ...now, working: false, error: message });
				// Transient, as on the drum rack's pill (see `swapErrors`).
				holdSwapError(trackPath, () => {
					const held = this.#states.get(trackPath);
					if (held?.error) this.#states.set(trackPath, { ...held, error: null });
				});
			}
		}
	}

	#put(trackPath: string, status: PresetSwapStatus): void {
		this.#states.set(trackPath, { status, presets: [], index: -1, working: false, error: null });
	}

	_setForTests(deps: { load?: Loader; find?: Finder }): void {
		if (deps.load) this.#load = deps.load;
		if (deps.find) this.#find = deps.find;
	}

	_resetForTests(): void {
		this.#states.clear();
		this.#expected.clear();
		this.#tokens.clear();
		this.#load = defaultLoader;
		this.#find = presetSiblings;
	}
}

export const presetSwap = new PresetSwapStore();
