/**
 * A small Live index (`Live-files-12300.db`) in the shape the rig's has: the
 * tables `indexScan` and `categoryScan` read, a filesystem tree under `/`,
 * `places` naming the User Library and the Packs, and `vfolders` naming
 * Sounds' and Drum Hits' sub-folders by folder name. Ids are handed out in
 * order; `add` writes a file or folder and every ancestor pair.
 */
import { DatabaseSync } from 'node:sqlite';

const four = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
export const FOLDER = four('fldr');

export interface LiveIndexFixture {
	db: DatabaseSync;
	/** A folder chain from `/` (`['Users', 'me', 'Packs', 'Drum Booth']`), made as needed; its id. */
	folder(segments: string[]): number;
	/** A file in the folder `segments`; its id. */
	file(segments: string[], name: string, over?: { device_id?: string; device_type?: number; subtype?: number; mod_date?: number; file_size?: number }): number;
	/** A row in `places`. */
	place(segments: string[], name: string, kind: number): void;
	/** A `vfolders` sub-folder of `group` and the folder names that fall in it. */
	vfolder(group: number, name: string, patterns: string[]): void;
}

export function liveIndexFixture(file = ':memory:'): LiveIndexFixture {
	const db = new DatabaseSync(file);
	db.exec(`CREATE TABLE version (schema INTEGER, platform INTEGER); INSERT INTO version VALUES (12300, 2);
		CREATE TABLE files (file_id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT, file_type INTEGER, subtype INTEGER, device_type INTEGER, device_id TEXT, mod_date INTEGER, file_size INTEGER);
		CREATE TABLE ancestors (file_id INTEGER, ancestor_id INTEGER);
		CREATE TABLE places (file_id INTEGER, folder_kind INTEGER, level INTEGER, name TEXT);
		CREATE TABLE metadata (file_id INTEGER, key INTEGER, value_id INTEGER);
		CREATE TABLE metadata_values (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT);
		CREATE TABLE vfolders (vfolder_id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, name TEXT);
		CREATE TABLE vfolder_patterns (vfolder_id INTEGER, name TEXT);
		INSERT INTO files VALUES (1, 0, '/', ${FOLDER}, 0, 0, NULL, 0, 0);`);
	const insert = db.prepare('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
	const child = db.prepare('SELECT file_id FROM files WHERE parent_id = ? AND name = ?');
	const parentOf = db.prepare('SELECT parent_id FROM files WHERE file_id = ?');
	const ancestor = db.prepare('INSERT INTO ancestors VALUES (?, ?)');
	let next = 2;
	const link = (id: number, parent: number) => {
		for (let up = parent; up; up = (parentOf.get(up) as { parent_id: number }).parent_id) ancestor.run(id, up);
	};
	const folder = (segments: string[]): number => {
		let id = 1;
		for (const seg of segments) {
			const have = child.get(id, seg) as { file_id: number } | undefined;
			if (have) {
				id = have.file_id;
				continue;
			}
			const made = next++;
			insert.run(made, id, seg, FOLDER, 0, 0, null, 0, 0);
			link(made, id);
			id = made;
		}
		return id;
	};
	return {
		db,
		folder,
		file(segments, name, over = {}) {
			const parent = folder(segments);
			const id = next++;
			insert.run(id, parent, name, four('file'), over.subtype ?? 0, over.device_type ?? 0, over.device_id ?? null, over.mod_date ?? 100, over.file_size ?? 10);
			link(id, parent);
			return id;
		},
		place(segments, name, kind) {
			db.prepare('INSERT INTO places VALUES (?, ?, 0, ?)').run(folder(segments), kind, name);
		},
		vfolder(group, name, patterns) {
			const { lastInsertRowid } = db.prepare('INSERT INTO vfolders (group_id, name) VALUES (?, ?)').run(group, name);
			for (const p of patterns) db.prepare('INSERT INTO vfolder_patterns VALUES (?, ?)').run(lastInsertRowid, p);
		}
	};
}
