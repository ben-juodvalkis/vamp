/**
 * The performer's phrases: what the demo "plays" into the Vamp Demo MIDI
 * port. Each is `[beat, lengthBeats, notes, velocity]`, two bars of 4/4,
 * so every loop is 8 beats long. D minor: Dm7 · B♭maj7 · C6, a key Live's
 * default C major does not fit, so Key Follow has something to change.
 *
 * Drums use the General MIDI map Live's Drum Racks follow (C1 = 36 kick,
 * D1 = 38 snare, F#1 = 42 closed hat, A#1 = 46 open hat, D#1 = 39 clap).
 */

const KICK = 36;
const SNARE = 38;
const CLAP = 39;
const HAT = 42;
const OPEN = 46;

const hats = [];
for (let i = 0; i < 16; i++) {
	const beat = i / 2;
	if (beat === 7.5) continue;
	hats.push([beat, 0.25, [HAT], i % 2 ? 58 : 84]);
}

export const DRUMS = [
	[0, 0.5, [KICK], 112],
	[1.5, 0.5, [KICK], 96],
	[2.5, 0.5, [KICK], 104],
	[4, 0.5, [KICK], 112],
	[5.5, 0.5, [KICK], 96],
	[6.75, 0.25, [KICK], 90],
	[1, 0.5, [SNARE], 108],
	[3, 0.5, [SNARE], 108],
	[5, 0.5, [SNARE], 108],
	[7, 0.5, [SNARE, CLAP], 112],
	[7.5, 0.5, [OPEN], 80],
	...hats
];

export const BASS = [
	[0, 1.25, [38], 104],
	[1.5, 0.5, [38], 84],
	[2.5, 0.5, [45], 92],
	[3, 0.75, [48], 92],
	[4, 1.25, [46], 104],
	[5.5, 0.5, [46], 84],
	[6.5, 0.5, [48], 96],
	[7, 0.75, [40], 92]
];

const Dm7 = [62, 65, 69, 72];
const Bbmaj7 = [58, 62, 65, 69];
const C6 = [60, 64, 67, 69];

export const KEYS = [
	[0, 1.4, Dm7, 90],
	[1.5, 0.45, Dm7, 66],
	[2.5, 1.2, Dm7, 80],
	[4, 1.4, Bbmaj7, 90],
	[5.5, 0.45, Bbmaj7, 66],
	[6.5, 1.2, C6, 80]
];

export const LEAD = [
	[0.5, 0.5, [81], 88],
	[1, 0.5, [79], 80],
	[1.5, 1.25, [77], 92],
	[3, 0.5, [74], 80],
	[3.5, 0.5, [77], 84],
	[4.5, 0.5, [81], 88],
	[5, 0.5, [84], 92],
	[5.5, 1.5, [81], 90],
	[7.25, 0.5, [79], 80]
];
