/**
 * The tail picture's input (`tailPortrait.ts`), read off the Hybrid Reverb's
 * parameters, and where a drag on the picture lands. The Reverb tile on the
 * FX grid draws the picture behind its pad once a reverb is loaded (ADR-477);
 * until then it was the Reverb view's own picture, a second copy of the
 * tile's two axes.
 */
import {
	HYBRID,
	algoDelaySeconds,
	algorithmFor,
	bassMult,
	bassXHz,
	decaySeconds,
	decayValue,
	feedbackGain,
	hzLabel,
	predelaySeconds,
	prismMult,
	prismXOverHz,
	shimmerSemitones,
	tidesRateBeats
} from '$lib/components/v6/device-panel/hybridReverbParams';
import { eqBands, wetLevelDb } from './reverbEq';
import { xToTime, type TailInput } from './tailPortrait';

export interface ReverbTail {
	input: TailInput;
	/** The band split's name and frequency, on the algorithms that have one. */
	crossoverLabel?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** `raw(index)` is a parameter's raw value; `tempo` the song's, for synced Predelay. */
export function reverbTail(raw: (index: number) => number, tempo: number): ReverbTail {
	const on = (index: number) => raw(index) >= 0.5;
	const algorithm = algorithmFor(raw(HYBRID.algoType));
	const synced = on(HYBRID.predelaySync);
	// A sixteenth at the song's tempo, seconds.
	const sixteenth = 15 / (tempo > 0 ? tempo : 120);
	const predelay = synced ? raw(HYBRID.predelay16th) * sixteenth : predelaySeconds(raw(HYBRID.predelay));
	// Live keeps one Feedback per Predelay mode.
	const feedbackIndex = synced ? HYBRID.predelayFb16th : HYBRID.predelayFb;
	const algoDelay = algoDelaySeconds(raw(HYBRID.algoDelay));
	const eq = eqBands(raw);
	const input: TailInput = {
		algo: algorithm.key,
		decay: decaySeconds(raw(HYBRID.decay)),
		onset: predelay + algoDelay,
		echoSpacing: predelay,
		feedback: feedbackGain(raw(feedbackIndex)),
		size: raw(HYBRID.size),
		damping: raw(HYBRID.damping),
		diffusion: raw(HYBRID.diffusion),
		mod: raw(HYBRID.mod),
		shape: raw(HYBRID.hallShape),
		bassMult: bassMult(raw(HYBRID.hallBassMult)),
		bassX: bassXHz(raw(HYBRID.hallBassX)),
		lowDamp: raw(HYBRID.quartzLowDamp),
		distance: raw(HYBRID.quartzDistance),
		shimmer: raw(HYBRID.shimmer),
		pitch: shimmerSemitones(raw(HYBRID.shimmerPitch)),
		tide: raw(HYBRID.tide),
		tidePeriod: tidesRateBeats(raw(HYBRID.tidesRate)) * 4 * sixteenth,
		wave: raw(HYBRID.tidesWave),
		lowMult: prismMult(raw(HYBRID.prismLowMult)),
		highMult: prismMult(raw(HYBRID.prismHighMult)),
		xOver: prismXOverHz(raw(HYBRID.prismXOver)),
		freeze: on(HYBRID.freeze),
		wet: clamp01(raw(HYBRID.dryWet)),
		levelDb: wetLevelDb(eq, on(HYBRID.eqOn), clamp01(raw(HYBRID.sendGain))),
		vintage: Math.round(raw(HYBRID.vintage))
	};
	const crossoverLabel =
		algorithm.key === 'darkHall'
			? `Bass X ${hzLabel(input.bassX)}`
			: algorithm.key === 'prism'
				? `X-Over ${hzLabel(input.xOver)}`
				: undefined;
	return { input, crossoverLabel };
}

/** The picture's X is where the tail ends, so Decay is that time less the onset. */
export function decayAtTailX(x: number, onset: number): number {
	return decayValue(xToTime(x) - onset);
}
