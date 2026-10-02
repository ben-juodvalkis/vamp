/**
 * The waveform of the impulse response a Hybrid Reverb has loaded: Live's
 * names for it (`category`, `file`) to its file(s) through `/api/reverb-ir`,
 * then their peaks through the shared waveform service (one cache with every
 * other waveform in the app). A stereo IR is two files, L and R.
 *
 * `status` says why there is no picture: `none` (no names yet), `loading`,
 * `missing` (a User IR, `<empty>`, or a file the server could not read).
 */
import { getPeaks } from '$lib/services/clipWaveformService';
import { logger } from '$lib/utils/logger';

/** Fine enough that the start, which the log axis spreads out, is not blocky. */
export const IR_BINS = 2048;

export interface IrWave {
	channels: { channel: 'mono' | 'L' | 'R'; peaks: [number, number][] }[];
	/** The file's length, seconds. */
	seconds: number;
}

export type IrStatus = 'none' | 'loading' | 'ready' | 'missing';

export function useReverbIr(names: () => { category: string; file: string }) {
	let wave = $state<IrWave | null>(null);
	let status = $state<IrStatus>('none');

	$effect(() => {
		const { category, file } = names();
		if (!category || !file) {
			wave = null;
			status = 'none';
			return;
		}
		let cancelled = false;
		status = 'loading';
		(async () => {
			let files: { channel: 'mono' | 'L' | 'R'; path: string }[] = [];
			try {
				const res = await fetch(
					`/api/reverb-ir?category=${encodeURIComponent(category)}&file=${encodeURIComponent(file)}`
				);
				if (res.ok) files = ((await res.json()) as { files: typeof files }).files;
			} catch (err) {
				logger.debug('useReverbIr: lookup failed', { category, file, err: String(err) });
			}
			if (cancelled) return;
			if (!files.length) {
				wave = null;
				status = 'missing';
				return;
			}
			const loaded = await Promise.all(files.map((f) => getPeaks(f.path, IR_BINS)));
			if (cancelled) return;
			if (loaded.some((d) => !d || !d.peaks.length)) {
				wave = null;
				status = 'missing';
				return;
			}
			wave = {
				channels: files.map((f, i) => ({ channel: f.channel, peaks: loaded[i]!.peaks })),
				seconds: Math.max(...loaded.map((d) => d!.seconds ?? 0))
			};
			status = 'ready';
		})();
		return () => {
			cancelled = true;
		};
	});

	return {
		get wave() {
			return wave;
		},
		get status() {
			return status;
		}
	};
}
