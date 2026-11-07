/**
 * One cycle of a Wavetable oscillator's wave as it plays: the table from the
 * device's `oscillator_N_*` properties, the frame at its Wave Position from
 * `wavetableShapes` (rendered off Live, keyed by category and table name),
 * and the oscillator effect from `wavetableEffects`. Shared by the Wavetable
 * view's Osc pad and the chain cell's face, so both draw the same wave. A
 * table the bundle lacks (a user table) draws none.
 *
 * Call from a component's script: it subscribes the properties and loads the
 * bundle for as long as the component is mounted.
 */
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { loadFactoryWavetables, tableFrames, cycleAt, type WavetableBundle } from '$lib/utils/wavetableShapes';
import { applyOscEffect, effectModeFromLive, type WavetableEffectMode } from '$lib/utils/wavetableEffects';

const OSC_PROPERTIES = [1, 2]
	.flatMap((n) => [
		`oscillator_${n}_wavetable_category`,
		`oscillator_${n}_wavetable_index`,
		`oscillator_${n}_wavetables`,
		`oscillator_${n}_effect_mode`
	])
	.concat('oscillator_wavetable_categories');

export function useOscWave(devicePath: () => string | undefined) {
	$effect(() => {
		const path = devicePath();
		if (!path) return;
		const releases = OSC_PROPERTIES.map((name) => selectedTrackStore.subscribeProperty(path, name));
		return () => releases.forEach((release) => release());
	});

	let shapes = $state<WavetableBundle | null>(null);
	$effect(() => {
		if (!devicePath() || shapes) return;
		let live = true;
		loadFactoryWavetables().then((bundle) => {
			if (live) shapes = bundle;
		});
		return () => {
			live = false;
		};
	});

	function property(name: string): unknown {
		const path = devicePath();
		return path ? selectedTrackStore.propertyValue(path, name) : undefined;
	}

	/** A JSON-string property (Live's name lists) as an array of names. */
	function nameList(name: string): string[] {
		const value = property(name);
		if (typeof value !== 'string') return [];
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	/** Oscillator `n`'s effect mode. */
	function effectMode(n: 1 | 2): WavetableEffectMode {
		return effectModeFromLive(Number(property(`oscillator_${n}_effect_mode`) ?? 0));
	}

	/** One cycle of oscillator `n` as it plays, or null when its table has no render. */
	function wave(n: 1 | 2, position: number, effect1: number, effect2: number): Float32Array | null {
		if (!shapes) return null;
		const category = nameList('oscillator_wavetable_categories')[Number(property(`oscillator_${n}_wavetable_category`))];
		const table = nameList(`oscillator_${n}_wavetables`)[Number(property(`oscillator_${n}_wavetable_index`))];
		if (!category || !table) return null;
		const cycle = cycleAt(tableFrames(shapes, category, table), position);
		if (!cycle) return null;
		const mode = effectMode(n);
		return mode === 'none' ? cycle : applyOscEffect(cycle, mode, effect1, effect2);
	}

	/**
	 * Oscillator `n`'s table as two choices: Live's categories and the
	 * tables of the one it is in, each with the index it is on (-1 unknown).
	 */
	function tableChoice(n: 1 | 2) {
		const at = (name: string) => {
			const v = property(name);
			return typeof v === 'number' || (typeof v === 'string' && v !== '') ? Number(v) : -1;
		};
		return {
			categories: nameList('oscillator_wavetable_categories'),
			category: at(`oscillator_${n}_wavetable_category`),
			tables: nameList(`oscillator_${n}_wavetables`),
			table: at(`oscillator_${n}_wavetable_index`)
		};
	}

	/** Picks oscillator `n`'s category; Live then puts it on that category's first table. */
	function setCategory(n: 1 | 2, index: number) {
		const path = devicePath();
		if (path) selectedTrackStore.setPropertyValue(path, `oscillator_${n}_wavetable_category`, index);
	}

	/** Picks oscillator `n`'s table within its category. */
	function setTable(n: 1 | 2, index: number) {
		const path = devicePath();
		if (path) selectedTrackStore.setPropertyValue(path, `oscillator_${n}_wavetable_index`, index);
	}

	return { wave, effectMode, tableChoice, setCategory, setTable };
}
