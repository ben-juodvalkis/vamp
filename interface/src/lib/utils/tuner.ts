/**
 * The tuner's reading of a pitch (ADR-539): the nearest equal-tempered note
 * at A = 440 Hz and how far off it is, in cents. Sharps, as a guitar tuner
 * names them.
 */
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Within this many cents the tuner reads in tune. */
export const IN_TUNE_CENTS = 3;

export interface TunerNote {
	/** The note's name, `A` or `C♯`. */
	name: string;
	octave: number;
	/** −50 (flat) to +50 (sharp). */
	cents: number;
	midi: number;
}

export function noteOf(hz: number): TunerNote | null {
	if (!Number.isFinite(hz) || hz <= 0) return null;
	const exact = 69 + 12 * Math.log2(hz / 440);
	const midi = Math.round(exact);
	return {
		name: NAMES[((midi % 12) + 12) % 12],
		octave: Math.floor(midi / 12) - 1,
		cents: Math.max(-50, Math.min(50, (exact - midi) * 100)),
		midi
	};
}
