/**
 * What a chain cell's device IS, under its name (2026-11-08): the caption
 * on the cell's header bar. A device is named after its preset ("Wobble",
 * "Dub Space", "Grit"), and the name alone says nothing about what it does;
 * Live's own class name does, read through this table into the word Live's
 * browser uses for it.
 *
 * Only where it adds a word: a device named for its class ("Auto Filter",
 * "Echo", "Drum-Rack") has no caption, and so does one whose name already
 * carries the class's word ("Auto Pan Legacy" → Auto Pan). A class the
 * table does not know draws none rather than a guess.
 */

const CLASS_LABELS: Record<string, string> = {
	// Audio effects, as Live 12 reports them (the Live 12 rewrites carry a 2
	// or New; the app's presets load these classes, `devicePresets.ts`).
	AutoFilter: 'Auto Filter',
	AutoFilter2: 'Auto Filter',
	AutoPan: 'Auto Pan',
	AutoPan2: 'Auto Pan-Tremolo',
	BeatRepeat: 'Beat Repeat',
	Cabinet: 'Cabinet',
	ChannelEq: 'Channel EQ',
	Chorus: 'Chorus',
	Chorus2: 'Chorus-Ensemble',
	Compressor: 'Compressor',
	Compressor2: 'Compressor',
	Corpus: 'Corpus',
	Delay: 'Delay',
	DrumBuss: 'Drum Buss',
	Echo: 'Echo',
	Eq8: 'EQ Eight',
	Erosion: 'Erosion',
	FilterDelay: 'Filter Delay',
	Flanger: 'Flanger',
	FrequencyShifter: 'Frequency Shifter',
	Gate: 'Gate',
	GlueCompressor: 'Glue Compressor',
	GrainDelay: 'Grain Delay',
	Hybrid: 'Hybrid Reverb',
	Limiter: 'Limiter',
	Looper: 'Looper',
	MultibandDynamics: 'Multiband Dynamics',
	Overdrive: 'Overdrive',
	Pedal: 'Pedal',
	Phaser: 'Phaser',
	PhaserNew: 'Phaser-Flanger',
	Redux: 'Redux',
	Resonator: 'Resonators',
	Reverb: 'Reverb',
	Roar: 'Roar',
	Saturator: 'Saturator',
	Shifter: 'Shifter',
	Spectrum: 'Spectrum',
	SpectralResonator: 'Spectral Resonator',
	SpectralTime: 'Spectral Time',
	StereoGain: 'Utility',
	Tuner: 'Tuner',
	Vinyl: 'Vinyl Distortion',
	Vocoder: 'Vocoder',
	// MIDI effects.
	MidiArpeggiator: 'Arpeggiator',
	MidiChord: 'Chord',
	MidiNoteLength: 'Note Length',
	MidiPitcher: 'Pitch',
	MidiRandom: 'Random',
	MidiScale: 'Scale',
	MidiVelocity: 'Velocity',
	// Racks, instruments and hosts.
	AudioEffectGroupDevice: 'Audio Effect Rack',
	MidiEffectGroupDevice: 'MIDI Effect Rack',
	InstrumentGroupDevice: 'Instrument Rack',
	DrumGroupDevice: 'Drum Rack',
	InstrumentVector: 'Wavetable',
	UltraAnalog: 'Analog',
	Operator: 'Operator',
	Drift: 'Drift',
	Collision: 'Collision',
	LoungeLizard: 'Electric',
	InstrumentMeld: 'Meld',
	MultiSampler: 'Sampler',
	OriginalSimpler: 'Simpler',
	DrumCell: 'Drum Sampler',
	InstrumentImpulse: 'Impulse',
	StringStudio: 'Tension',
	AuPluginDevice: 'Audio Unit',
	PluginDevice: 'VST',
	MxDeviceAudioEffect: 'Max for Live',
	MxDeviceMidiEffect: 'Max for Live',
	MxDeviceInstrument: 'Max for Live'
};

/** Letters and digits alone, lower-cased: "Drum-Rack" is "Drum Rack". */
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The caption under a cell's name, or null where the name already says it (or the class is unknown). */
export function deviceTypeLabel(className: string, name: string): string | null {
	const label = CLASS_LABELS[className];
	if (!label) return null;
	const a = fold(name);
	const b = fold(label);
	if (!a || a.includes(b) || b.includes(a)) return null;
	return label;
}
