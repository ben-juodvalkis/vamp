/**
 * The record of the one-time Places copy: every old path and the path it was
 * copied to (`Sidebar/.looping-places-manifest.json.gz`).
 *
 * The copy itself (`places-copy.ts`, browser-places plan §3) ran on 2026-09-24
 * and was removed at the cutover, with the old folders it read. This record
 * stays because paths the old layout gave out outlive it: saved sets'
 * `looping.preset` records, Recent, the swap pill's reference — the Places
 * catalog turns it into the alias map (old path → new path) the app reads them
 * through (`presetPath.aliasPresetPath`).
 *
 * Read-only here; nothing writes it any more.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export const MANIFEST_NAME = '.looping-places-manifest.json.gz';

/** One copied source tree: `root` (old) went to `dest` (new). */
export interface Source {
	/** `Ableton`, `NI`, `Omni` … or `Audio Samples`. */
	origin: string;
	/** The Place (the type folder's name). */
	place: string;
	root: string;
	dest: string;
}

/** One entry the copy made (the fields the alias map reads, plus what the file carries). */
export interface ManifestEntry {
	/** d = folder, c = clone, l = link */
	a: 'd' | 'c' | 'l';
	/** kind: dir, preset, clip, sample, analysis, other */
	k: string;
	/** source (old path), absolute */
	s: string;
	/** destination (new path), absolute */
	d: string;
	/** clone source when not `s` */
	f?: string;
	/** link target */
	t?: string;
	/** source size and mtime when planned */
	z?: number;
	m?: number;
	/** folder created by the copy */
	n?: 1;
	/** clip verdict */
	v?: string;
	/** renamed from */
	r?: string;
	/** origin, Place */
	o: string;
	p: string;
}

export interface Manifest {
	version: 1;
	createdAt: string;
	sidebarRoot: string;
	sources: Source[];
	entries: ManifestEntry[];
	skipped: Array<{ source: string; why: string }>;
	collisions: Array<{ dest: string; sources: string[]; renamedTo: string[] }>;
	freeBytesBefore?: number;
	freeBytesAfter?: number;
	materializedAt?: string;
}

export function readManifest(sidebarRoot: string): Manifest {
	return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(sidebarRoot, MANIFEST_NAME))).toString('utf8'));
}
