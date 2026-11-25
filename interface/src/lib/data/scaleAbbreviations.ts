/**
 * Short names for Live's scales (`scales.ts`), for the master strip's key
 * band, where a name like "Half-whole Dim." does not fit. A name with no
 * entry is shown as it is.
 */
export const SCALE_ABBREVIATIONS: Readonly<Record<string, string>> = {
	Major: 'Maj',
	Minor: 'Min',
	Dorian: 'Dor',
	Mixolydian: 'Mix',
	Lydian: 'Lyd',
	Phrygian: 'Phr',
	Locrian: 'Loc',
	'Whole Tone': 'WT',
	'Half-whole Dim.': 'HW Dim',
	'Whole-half Dim.': 'WH Dim',
	'Minor Blues': 'Min Bl',
	'Minor Pentatonic': 'Min Pent',
	'Major Pentatonic': 'Maj Pent',
	'Harmonic Minor': 'Harm Min',
	'Harmonic Major': 'Harm Maj',
	'Dorian #4': 'Dor #4',
	'Phrygian Dominant': 'Phr Dom',
	'Melodic Minor': 'Mel Min',
	'Lydian Augmented': 'Lyd Aug',
	'Lydian Dominant': 'Lyd Dom',
	'Super Locrian': 'Sup Loc',
	'8-Tone Spanish': '8T Span',
	Bhairav: 'Bhai',
	'Hungarian Minor': 'Hung',
	Hirajoshi: 'Hira',
	'In-Sen': 'InSen',
	Iwato: 'Iwato',
	Kumoi: 'Kumoi',
	'Pelog Selisir': 'Pelog S',
	'Pelog Tembung': 'Pelog T',
	'Messiaen 3': 'Mes 3',
	'Messiaen 4': 'Mes 4',
	'Messiaen 5': 'Mes 5',
	'Messiaen 6': 'Mes 6',
	'Messiaen 7': 'Mes 7'
};

/** The short name for a scale, or the name itself when it has none. */
export function abbreviateScale(name: string): string {
	return SCALE_ABBREVIATIONS[name] || name;
}
