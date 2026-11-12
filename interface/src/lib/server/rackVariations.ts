/**
 * A rack's macro variation names (ADR-531). Live's Python API counts a
 * rack's variations and recalls them but never names them; the names live
 * in the preset file the rack was loaded from (`<MacroSnapshot>`'s
 * `<SnapshotName>`). Live names a loaded preset's device after its file, so
 * the file is found by the rack's name in Live's own browser index, which
 * covers the Core Library, the Packs and every Place. A file is believed
 * only while it holds exactly as many variations as Live reports: a
 * variation stored or deleted in Live since, or a renamed rack, leaves the
 * variations unnamed rather than misnamed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findLiveDatabase, openIndex, type IndexHandle } from './places/indexScan';
import { defaultLiveDatabaseDir } from './places/service';

/** The variation names a preset file's XML holds, in order. */
export function variationNamesOf(xml: string): string[] {
	const block = /<MacroVariations>([\s\S]*?)<\/MacroVariations>/.exec(xml)?.[1] ?? '';
	const names: string[] = [];
	for (const snap of block.matchAll(/<MacroSnapshot\b[\s\S]*?<\/MacroSnapshot>/g)) {
		const name = /<SnapshotName Value="([^"]*)"/.exec(snap[0])?.[1] ?? '';
		names.push(unescapeXml(name));
	}
	return names;
}

function unescapeXml(s: string): string {
	return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Every path Live's index lists for a file named `fileName`. */
export function indexPathsNamed(h: IndexHandle, fileName: string): string[] {
	const rows = h.db.prepare('SELECT file_id FROM files WHERE name = ?').all(fileName) as Array<{ file_id: number }>;
	const up = h.db.prepare('SELECT name, parent_id FROM files WHERE file_id = ?');
	return rows.map(({ file_id }) => {
		const parts: string[] = [];
		let id = file_id;
		for (let guard = 0; id && guard < 64; guard++) {
			const row = up.get(id) as { name: string; parent_id: number } | undefined;
			if (!row) break;
			// The index writes a POSIX colon as a slash (`placeFileId`).
			if (row.name !== '/') parts.push(row.name.replace(/\//g, ':'));
			id = row.parent_id;
		}
		return '/' + parts.reverse().join('/');
	});
}

export interface RackVariationNames {
	/** One name per variation, in Live's order, or null when no file matches. */
	names: string[] | null;
	/** The file they came from. */
	path: string | null;
}

/**
 * The names of a rack's `count` variations, from the first `<rackName>.adg`
 * in Live's index that exists and holds exactly `count` of them.
 */
export function rackVariationNames(rackName: string, count: number, dbDir = defaultLiveDatabaseDir()): RackVariationNames {
	const none = { names: null, path: null };
	if (!rackName || !(count > 0) || !dbDir) return none;
	const db = findLiveDatabase(dbDir);
	if (!db) return none;
	let h: IndexHandle;
	try {
		h = openIndex(db.file);
	} catch {
		return none;
	}
	try {
		for (const path of indexPathsNamed(h, `${rackName}.adg`)) {
			if (!existsSync(path)) continue;
			let names: string[];
			try {
				names = variationNamesOf(gunzipSync(readFileSync(path)).toString('utf8'));
			} catch {
				continue;
			}
			if (names.length === count) return { names, path };
		}
		return none;
	} finally {
		h.db.close();
	}
}
