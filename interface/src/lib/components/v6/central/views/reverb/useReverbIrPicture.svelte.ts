/**
 * What the IR picture (`ReverbIrDisplay`) needs, read off a Hybrid Reverb's
 * properties: the loaded IR's waveform and its Attack, Decay, Size and
 * shaping. The Reverb tile draws it behind its pad while the reverb runs an
 * IR (ADR-477). The properties are subscribed only while `active()` holds:
 * Live's IR name lists are long, and an algorithm's tile has no use for them.
 */
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { useReverbIr } from './useReverbIr.svelte';

const PROPERTIES = [
	'ir_category_index',
	'ir_file_index',
	'ir_attack_time',
	'ir_decay_time',
	'ir_size_factor',
	'ir_time_shaping_on',
	'ir_category_list',
	'ir_file_list'
];

export function useReverbIrPicture(devicePath: () => string | undefined, active: () => boolean) {
	$effect(() => {
		const path = devicePath();
		if (!path || !active()) return;
		const releases = PROPERTIES.map((name) => selectedTrackStore.subscribeProperty(path, name));
		return () => releases.forEach((release) => release());
	});

	function property(name: string): unknown {
		const path = devicePath();
		return path && active() ? selectedTrackStore.propertyValue(path, name) : undefined;
	}
	const number = (name: string, atRest: number) => (property(name) as number | undefined) ?? atRest;
	/** A JSON-string property (Live's IR name lists) as an array of names. */
	function nameList(name: string): string[] {
		const value = property(name);
		if (Array.isArray(value)) return value as string[];
		if (typeof value !== 'string') return [];
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	const category = $derived(nameList('ir_category_list')[number('ir_category_index', 0)] ?? '');
	const file = $derived(nameList('ir_file_list')[number('ir_file_index', 0)] ?? '');
	const ir = useReverbIr(() => ({ category, file }));

	return {
		get wave() {
			return ir.wave;
		},
		get status() {
			return ir.status;
		},
		get category() {
			return category;
		},
		get attack() {
			return number('ir_attack_time', 0);
		},
		get decay() {
			return number('ir_decay_time', 0.02);
		},
		get size() {
			return number('ir_size_factor', 1);
		},
		// Unknown (a surface from before 2026-10-02): shaping on, Live's default.
		get shaping() {
			return number('ir_time_shaping_on', 1) !== 0;
		}
	};
}
