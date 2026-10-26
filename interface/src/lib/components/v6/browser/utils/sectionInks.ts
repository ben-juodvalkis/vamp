/**
 * A color per folder of the effects Place (user, 2026-10-26: "color coding
 * by parent folder"). A folder takes the device family its name says
 * (ADR-400's eight: Distortion the distortion ink, Time the time-and-space
 * one, Tone the filter one, "Midi Effect" the note-machinery one…), so a
 * section wears the ink its devices wear on the grid; a folder whose name
 * says none takes the next family no folder has claimed, in folder order,
 * so no two sections share a color while families last. Pure.
 */
import { DEVICE_FAMILY_INKS, type DeviceFamily } from '$lib/config/devicePresets';

/** The words in a folder name that say a family, first match wins. */
const FAMILY_WORDS: ReadonlyArray<[DeviceFamily, RegExp]> = [
	['pitchSeq', /midi|pitch|arp|seq|note|chord/i],
	['timeSpace', /time|delay|echo|reverb|space|loop/i],
	['filter', /tone|filter|eq\b|wah/i],
	['dynamics', /dynamic|compress|gate|level/i],
	['distortion', /distort|drive|satur|amp\b|crush/i],
	['modulation', /mod|chorus|trem|phase|flang/i],
	['rackVoice', /rack|voice|vocal/i],
	['utility', /util|gain|mix|rout/i]
];

const FAMILY_ORDER = Object.keys(DEVICE_FAMILY_INKS) as DeviceFamily[];

/** Each folder's ink, keyed by its name lower-cased. */
export function sectionInks(folders: readonly string[]): Map<string, string> {
	const family = new Map<string, DeviceFamily>();
	const taken = new Set<DeviceFamily>();
	for (const folder of folders) {
		const named = FAMILY_WORDS.find(([, words]) => words.test(folder))?.[0];
		if (named) {
			family.set(folder.toLowerCase(), named);
			taken.add(named);
		}
	}
	let next = 0;
	for (const folder of folders) {
		if (family.has(folder.toLowerCase())) continue;
		while (next < FAMILY_ORDER.length && taken.has(FAMILY_ORDER[next])) next++;
		const f = FAMILY_ORDER[next % FAMILY_ORDER.length] ?? 'utility';
		family.set(folder.toLowerCase(), f);
		taken.add(f);
		next++;
	}
	return new Map([...family].map(([k, f]) => [k, DEVICE_FAMILY_INKS[f].primary]));
}
