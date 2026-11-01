/**
 * The effects folder chosen in Settings (ADR-498): the sidebar Place + Effect
 * opens and the app's own effects are found in, saved on the Mac in
 * `<repo>/logs/effects.json` as the ticks are in `logs/places.json`. `''` is
 * Live's Audio Effects category. Nothing saved: `catalog.effectsPlace` decides.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface EffectsChoiceFile {
	version: 1;
	/** A Place's sidebar name, or '' for Live's Audio Effects. */
	place: string;
	savedAt: string;
}

/** The saved choice, or null when none was ever saved (or it cannot be read). */
export function readEffectsChoice(file: string): string | null {
	try {
		if (!existsSync(file)) return null;
		const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<EffectsChoiceFile>;
		return typeof raw.place === 'string' ? raw.place : null;
	} catch {
		return null;
	}
}

export function writeEffectsChoice(file: string, place: string): EffectsChoiceFile {
	const data: EffectsChoiceFile = { version: 1, place, savedAt: new Date().toISOString() };
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
	renameSync(tmp, file);
	return data;
}
