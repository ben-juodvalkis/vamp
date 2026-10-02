/**
 * Which file on disk is the impulse response a Hybrid Reverb has loaded.
 *
 * Live names an IR by category and file (`ir_category_list[i]`,
 * `ir_file_list[j]`) and keeps its own in one folder per app,
 * `Builtin/Samples/Hybrid/ImpulseResponses`, as
 * `Hybrid_<Category>_<Name>.<ext>`. Measured on the rig, 2026-10-02: the
 * categories read exactly as the folder spells them (`Early_Reflections`,
 * `Chambers_and_Large_Rooms`, …); a stereo IR is listed once as
 * `<Name> LR` and stored as `<Name> L.<ext>` and `<Name> R.<ext>`; a mono
 * one is `<Name>` and one file. The tenth category, `User`, lists the IRs
 * a user dragged in — files elsewhere, which this does not find (and lists
 * `<empty>` when there are none).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeConstants } from './runtimeConfig';
import { hybridIrFolder, liveApps } from './sampleRoots';

export interface IrFile {
	/** `mono`, or one side of a stereo pair. */
	channel: 'mono' | 'L' | 'R';
	path: string;
}

const AUDIO = /\.(wav|wave|aif|aiff)$/i;

/** The IR folders to look in: the configured Live app's first, then every other one. */
export function irFolders(appsDir = '/Applications'): string[] {
	const configured = (runtimeConstants() as { paths?: { abletonApp?: unknown } }).paths?.abletonApp;
	const apps = typeof configured === 'string' && configured ? [configured] : [];
	return [...new Set([...apps, ...liveApps(appsDir)])].map(hybridIrFolder);
}

/**
 * The file(s) of the IR Live names `category` / `name`, from the first
 * folder that has them all; empty when none does (a User IR, `<empty>`).
 */
export function resolveIr(
	category: string,
	name: string,
	folders: readonly string[] = irFolders(),
	list: (folder: string) => string[] = (folder) => readdirSync(folder)
): IrFile[] {
	if (!category || !name || name === '<empty>') return [];
	const stereo = name.endsWith(' LR');
	const base = `Hybrid_${category}_${stereo ? name.slice(0, -3) : name}`.toLowerCase();
	const wanted: [IrFile['channel'], string][] = stereo
		? [['L', `${base} l`], ['R', `${base} r`]]
		: [['mono', base]];
	for (const folder of folders) {
		let entries: string[];
		try {
			entries = list(folder);
		} catch {
			continue;
		}
		const byStem = new Map<string, string>();
		for (const entry of entries) {
			if (AUDIO.test(entry)) byStem.set(entry.replace(AUDIO, '').toLowerCase(), entry);
		}
		const found = wanted.map(([channel, stem]) => {
			const entry = byStem.get(stem);
			return entry ? { channel, path: join(folder, entry) } : null;
		});
		if (found.every((f) => f !== null)) return found as IrFile[];
	}
	return [];
}
