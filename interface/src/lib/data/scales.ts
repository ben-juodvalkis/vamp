/**
 * Scale and Root Note Data
 * Maps indices to display names for Live's scale system
 * Based on Live Object Model (LOM) scale_name and root_note properties
 */

/**
 * Root notes (0-11)
 * Chromatic scale starting from C
 */
import { logger } from '$lib/utils/logger';
export const ROOT_NOTES = [
	'C',
	'C#',
	'D',
	'D#',
	'E',
	'F',
	'F#',
	'G',
	'G#',
	'A',
	'A#',
	'B'
] as const;

/**
 * Scale names (0-34) — Live's 35, in Live's own order.
 * Must equal the surface's `key_detect.LIVE_SCALE_NAMES`, which refuses any
 * other name (ADR-446); `tests/test_key_detect.py` compares the two lists.
 */
export const SCALE_NAMES = [
	'Major',
	'Minor',
	'Dorian',
	'Mixolydian',
	'Lydian',
	'Phrygian',
	'Locrian',
	'Whole Tone',
	'Half-whole Dim.',
	'Whole-half Dim.',
	'Minor Blues',
	'Minor Pentatonic',
	'Major Pentatonic',
	'Harmonic Minor',
	'Harmonic Major',
	'Dorian #4',
	'Phrygian Dominant',
	'Melodic Minor',
	'Lydian Augmented',
	'Lydian Dominant',
	'Super Locrian',
	'8-Tone Spanish',
	'Bhairav',
	'Hungarian Minor',
	'Hirajoshi',
	'In-Sen',
	'Iwato',
	'Kumoi',
	'Pelog Selisir',
	'Pelog Tembung',
	'Messiaen 3',
	'Messiaen 4',
	'Messiaen 5',
	'Messiaen 6',
	'Messiaen 7'
] as const;

/**
 * Get root note name by index
 */
export function getRootNoteName(index: number): string {
	if (index < 0 || index >= ROOT_NOTES.length) {
		logger.warn(`Invalid root note index: ${index}`, { component: 'scales' });
		return 'C'; // Default fallback
	}
	return ROOT_NOTES[index];
}

/**
 * Get scale name by index
 */
export function getScaleName(index: number): string {
	if (index < 0 || index >= SCALE_NAMES.length) {
		logger.warn(`Invalid scale index: ${index}`, { component: 'scales' });
		return 'Major'; // Default fallback
	}
	return SCALE_NAMES[index];
}

/**
 * Get root note index by name
 */
export function getRootNoteIndex(name: string): number {
	// Cast to readonly string[] to allow indexOf with any string
	const index = (ROOT_NOTES as readonly string[]).indexOf(name);
	return index >= 0 ? index : 0; // Default to C
}

/**
 * Get scale index by name
 */
export function getScaleIndex(name: string): number {
	// Cast to readonly string[] to allow indexOf with any string
	const index = (SCALE_NAMES as readonly string[]).indexOf(name);
	return index >= 0 ? index : 0; // Default to Major
}
