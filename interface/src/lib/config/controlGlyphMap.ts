/**
 * Control glyphs — the names `ControlGlyph.svelte` draws, and the guess a
 * control whose name comes from a preset (a rack macro, a plug-in
 * parameter) makes from that name.
 *
 * A control the app names itself picks its glyph at the call site; this
 * file only answers for names the app does not choose.
 */

export const CONTROL_GLYPHS = [
	'tremolo',
	'rate',
	'depth',
	'drive',
	'dirty',
	'clean',
	'redux',
	'blur',
	'comb',
	'phaser',
	'feedback',
	'mix',
	'output',
	'pedal',
	'amp',
	'wah',
	'spring',
	'room',
	'reverb',
	'ringmod',
	'pitchhack',
	'tune',
	'tone',
	'envelope',
	'attack',
	'decay',
	'sustain',
	'release',
	'filter',
	'cutoff',
	'resonance',
	'highpass',
	'low',
	'high',
	'lowshelf',
	'lowbell',
	'highbell',
	'highshelf',
	'q',
	'crossover',
	'morph',
	'lfo',
	'phase',
	'waves',
	'fm',
	'gain',
	'width',
	'size',
	'delay',
	'predelay',
	'diffusion',
	'shimmer',
	'vintage',
	'threshold',
	'gate',
	'compress',
	'oscillator',
	'noise',
	'shape',
	'unison',
	'glide',
	'pitchdrop',
	'drift',
	'crunch',
	'boom',
	'punch',
	'stretch',
	'loop',
	'wavetable',
	'resonator',
	'hammer',
	'dice',
	'chance',
	'randvel',
	'velocity',
	'swing',
	'notelength',
	'temperature',
	'start',
	'slice',
	'fade',
	'transpose',
	'select',
	'macro',
] as const;

export type ControlGlyphName = (typeof CONTROL_GLYPHS)[number];

/**
 * Keyword → glyph, first match wins, so the more specific words come
 * first ("filter env" is an envelope stage's job before a filter's,
 * "pitch env" a pitch before an envelope).
 */
const NAME_RULES: readonly [RegExp, ControlGlyphName][] = [
	[/\batt(ack)?\b|\batk\b/, 'attack'],
	[/\bdec(ay)?\b|\bdcy\b/, 'decay'],
	[/\bsus(tain)?\b/, 'sustain'],
	[/\brel(ease)?\b/, 'release'],
	[/\bres(o|onance)?\b|\bq\b/, 'resonance'],
	[/cut ?off|\bfilter\b|\bfreq\b|\blp\b|\bhp\b|\bdamp/, 'cutoff'],
	[/pitch|tune|trans|semi|octave|\boct\b|coarse|\bfine\b/, 'transpose'],
	[/glide|porta/, 'glide'],
	[/rev(erb)?\b|verb|space|room|hall|ambien/, 'reverb'],
	[/delay|echo/, 'delay'],
	[/feedback|\bfb\b|regen/, 'feedback'],
	[/drive|dist|satur|overdrive|fuzz|grit/, 'drive'],
	[/crush|bit|redux|lo-?fi|decimat/, 'redux'],
	[/chorus|ensemble/, 'blur'],
	[/phaser/, 'phaser'],
	[/flang/, 'comb'],
	[/trem/, 'tremolo'],
	[/\blfo\b|\bmod\b|vibrato|wobble/, 'lfo'],
	[/\brate\b|speed/, 'rate'],
	[/depth|amount|\bamt\b|intensity/, 'depth'],
	[/dry|wet|\bmix\b|blend/, 'mix'],
	[/width|stereo|spread|\bpan/, 'width'],
	[/unison|detune|voices/, 'unison'],
	[/noise|air|breath/, 'noise'],
	[/shape|wave|morph|timbre|warp/, 'shape'],
	[/position|\bpos\b|table/, 'wavetable'],
	[/random|\brand\b|chaos/, 'dice'],
	[/chance|prob/, 'chance'],
	[/velo/, 'velocity'],
	[/swing|groove|shuffle/, 'swing'],
	[/sub|boom|bass/, 'boom'],
	[/punch|transient|snap|click/, 'punch'],
	[/comp|squash|glue/, 'compress'],
	[/gate/, 'gate'],
	[/tone|color|colour|bright|dark|warm|timbre|tilt/, 'tone'],
	[/\bsize\b|length/, 'size'],
	[/time|env/, 'envelope'],
	[/vol|gain|level|out(put)?\b|\bamp\b|loud/, 'gain'],
	[/macro/, 'macro']
];

/** The glyph a preset-named control draws, or none when its name says nothing. */
export function glyphForName(name: string | null | undefined): ControlGlyphName | undefined {
	if (!name) return undefined;
	const n = name.toLowerCase();
	for (const [rule, glyph] of NAME_RULES) if (rule.test(n)) return glyph;
	return undefined;
}

/**
 * A device's own mark in the chain overview (2026-10-25): the glyph that
 * draws what the device does, by the class Live reports. A device's class
 * says what it is, whatever its preset named it (type first, as the tiles
 * match). Anything unlisted guesses from its name (`glyphForName`).
 */
export const DEVICE_CLASS_GLYPHS: Readonly<Record<string, ControlGlyphName>> = {
	AutoFilter2: 'filter',
	AutoFilter: 'filter',
	Eq8: 'tone',
	ChannelEq: 'tone',
	FilterEQ3: 'tone',
	Echo: 'feedback',
	Delay: 'delay',
	PingPongDelay: 'delay',
	FilterDelay: 'delay',
	GrainDelay: 'pitchhack',
	Hybrid: 'reverb',
	Reverb: 'reverb',
	Saturator: 'drive',
	Roar: 'drive',
	Overdrive: 'dirty',
	Pedal: 'pedal',
	Amp: 'amp',
	Cabinet: 'amp',
	GlueCompressor: 'compress',
	Compressor2: 'compress',
	Limiter: 'threshold',
	MultibandDynamics: 'crossover',
	Gate: 'gate',
	DrumBuss: 'punch',
	StereoGain: 'gain',
	Chorus2: 'unison',
	PhaserNew: 'phaser',
	AutoPan: 'tremolo',
	AutoPan2: 'tremolo',
	Tuner: 'tune',
	Shifter: 'transpose',
	FrequencyShifter: 'ringmod',
	Redux2: 'redux',
	Erosion: 'noise',
	Vinyl: 'vintage',
	Corpus: 'resonator',
	Resonator: 'resonator',
	BeatRepeat: 'loop',
	Looper: 'loop',
	MidiRandom: 'dice',
	MidiPitcher: 'transpose',
	MidiArpeggiator: 'rate',
	MidiNoteLength: 'notelength',
	MidiVelocity: 'velocity',
	MidiScale: 'tune',
	AudioEffectGroupDevice: 'select',
	MidiEffectGroupDevice: 'select'
};

/** The app's own Max devices, by their `DEVICE_PRESETS` key: their class (a Max device) says nothing. */
export const DEVICE_KEY_GLYPHS: Readonly<Record<string, ControlGlyphName>> = {
	sequencer: 'swing',
	glitchLoop: 'pitchhack',
	pitchHack: 'pitchhack'
};
