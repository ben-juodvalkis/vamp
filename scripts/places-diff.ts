#!/usr/bin/env tsx
/**
 * The index-versus-disk diff (onboarding.plan.md §10): build every ticked
 * Place twice, from Live's index and from the disk scan, shape both the same
 * way, and report every item the two disagree on — present on one side only,
 * or a different kind, plug-in, maker, installed flag or tint.
 *
 *   npm run places:diff                 the ticked Places (or, on a first run, the seed)
 *   npm run places:diff -- --all        every folder Live's library lists that exists here
 *   npm run places:diff -- --name Drum  one folder by name
 *
 * Exit 0 when every Place matches, 1 on any difference, 2 when the index
 * cannot be read. Runs under `tsx --tsconfig interface/tsconfig.json`.
 */
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { configPath, configSection, repoRoot } from '../interface/src/lib/server/runtimeConfig';
import { librarySources, readLiveLibrary } from '../interface/src/lib/server/places/liveLibrary';
import { readTicks, seedTicks } from '../interface/src/lib/server/places/ticks';
import {
	installedAuComponents,
	loadKindCache,
	scanPlace,
	shapePlace,
	type PlaceFolder,
	type PlaceItem,
	type PlaceTuning
} from '../interface/src/lib/server/places/diskScan';
import { findLiveDatabase, openIndex, placeFileId, scanIndexPlace } from '../interface/src/lib/server/places/indexScan';

const COMPARED: Array<keyof PlaceItem> = ['kind', 'plugin', 'maker', 'installed', 'vendorColor', 'patch'];

function items(tree: PlaceFolder, out: Map<string, PlaceItem>, folders: Set<string>, prefix = ''): void {
	for (const p of tree.presets) out.set(p.fullPath, p);
	for (const [name, f] of Object.entries(tree.folders)) {
		folders.add(`${prefix}${name}`);
		items(f, out, folders, `${prefix}${name}/`);
	}
}

function main(): number {
	const args = process.argv.slice(2);
	const all = args.includes('--all');
	const nameAt = args.indexOf('--name');
	const only = nameAt >= 0 ? args[nameAt + 1] : null;

	const lib = readLiveLibrary();
	const sources = librarySources(lib);
	const ticks = readTicks(join(repoRoot(), 'logs', 'places.json'));
	const ticked = ticks.firstRun ? seedTicks(sources, configPath('sidebarRoot')) : ticks.ticked;
	const chosen = sources.filter((s) => s.present && (only ? s.name === only : all || ticked.has(s.key)));
	if (!chosen.length) {
		console.log('nothing to compare: no ticked Place exists here (tick some in Settings, or pass --all / --name)');
		return 0;
	}

	const dir = configPath('liveDatabaseDir') ?? '';
	const dbDir = dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir;
	const db = findLiveDatabase(dbDir);
	if (!db) {
		console.log(`no Live-files-*.db in ${dbDir}`);
		return 2;
	}
	let index;
	try {
		index = openIndex(db.file);
	} catch (err) {
		console.log(`index unreadable: ${String(err)}`);
		return 2;
	}
	console.log(`index: ${db.file}`);

	const au = installedAuComponents();
	const brands = (configSection<Record<string, { color?: string }>>('vendors').brands ?? {}) as Record<string, { color?: string }>;
	const colors = Object.fromEntries(Object.entries(brands).map(([k, v]) => [k, v?.color]));
	const catalog = configSection<{ maxFolderDepth?: number; places?: Record<string, PlaceTuning> }>('catalog');
	const kindCache = loadKindCache(join(repoRoot(), 'scripts', '.cache', 'places-kind-cache.json'));

	let differences = 0;
	let totalIndexMs = 0;
	let totalDiskMs = 0;
	for (const s of chosen) {
		const t = catalog.places?.[s.name] ?? {};
		const tuning = { maxFolderDepth: t.maxFolderDepth ?? catalog.maxFolderDepth ?? 2, flattenFolders: t.flattenFolders ?? [], keepNestingFolders: t.keepNestingFolders ?? [] };
		const rootId = placeFileId(index, s.path);
		if (rootId === null) {
			console.log(`\n${s.name}: not in the index (${s.path})`);
			differences++;
			continue;
		}
		const ti = Date.now();
		const fromIndex = shapePlace(scanIndexPlace(index, rootId, s.path, s.name, { au, colors, kindCache }).tree, tuning);
		const indexMs = Date.now() - ti;
		const td = Date.now();
		const fromDisk = shapePlace(scanPlace(s.path, s.name, { kindCache, newKindCache: kindCache, au, colors, stats: { read: 0, reused: 0 } }), tuning);
		const diskMs = Date.now() - td;
		totalIndexMs += indexMs;
		totalDiskMs += diskMs;

		const ia = new Map<string, PlaceItem>();
		const ib = new Map<string, PlaceItem>();
		const fa = new Set<string>();
		const fb = new Set<string>();
		items(fromIndex, ia, fa);
		items(fromDisk, ib, fb);
		const lines: string[] = [];
		for (const k of ib.keys()) if (!ia.has(k)) lines.push(`  disk only:  ${k}`);
		for (const k of ia.keys()) if (!ib.has(k)) lines.push(`  index only: ${k}`);
		for (const [k, a] of ia) {
			const b = ib.get(k);
			if (!b) continue;
			for (const f of COMPARED) {
				if ((a[f] ?? null) !== (b[f] ?? null)) lines.push(`  ${f}: ${k}  index=${String(a[f])} disk=${String(b[f])}`);
			}
		}
		for (const f of fb) if (!fa.has(f)) lines.push(`  folder disk only:  ${f}`);
		for (const f of fa) if (!fb.has(f)) lines.push(`  folder index only: ${f}`);
		const kinds = (n: PlaceFolder) => JSON.stringify(n.kinds ?? {});
		if (kinds(fromIndex) !== kinds(fromDisk)) lines.push(`  kinds: index=${kinds(fromIndex)} disk=${kinds(fromDisk)}`);
		console.log(`\n${s.name} (${basename(s.path)}): index ${ia.size} items in ${indexMs} ms, disk ${ib.size} items in ${diskMs} ms — ${lines.length ? `${lines.length} difference(s)` : 'identical'}`);
		for (const l of lines.slice(0, 200)) console.log(l);
		if (lines.length > 200) console.log(`  … ${lines.length - 200} more`);
		differences += lines.length;
	}
	index.db.close();
	console.log(`\n${chosen.length} Place(s): index ${totalIndexMs} ms, disk ${totalDiskMs} ms (kind cache warm), ${differences} difference(s)`);
	return differences ? 1 : 0;
}

process.exit(main());
