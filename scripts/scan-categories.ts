#!/usr/bin/env tsx
/**
 * Build Live's categories, and the Packs button when asked, in a process of
 * its own, for the Places service (interface/src/lib/server/places/service.ts,
 * ADR-493). A build reads about 116,000 index rows for the categories and
 * 60,000 for the Packs, ~4–6 s on the rig; on the server's one thread that
 * stalled every iPad request for as long. Here it runs at low priority and
 * writes the trees to a file; the server reads them back and keeps serving
 * the catalogs it had until then.
 *
 *   tsx --tsconfig interface/tsconfig.json scripts/scan-categories.ts <job.json>
 *
 * The job: { dbFile, kindCacheFile, auDirs, colors, packs, outFile }. Writes
 * `outFile` as { categories, packs?, rows } and prints { rows, ms } as one
 * JSON line. It reads and saves the shared kind cache itself.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { installedAuComponents, loadKindCache, saveKindCache } from '../interface/src/lib/server/places/diskScan';
import { openIndex } from '../interface/src/lib/server/places/indexScan';
import { categoryRoots, scanCategories, scanPacks } from '../interface/src/lib/server/places/categoryScan';

// The server holds this process's stdin open; when the server goes, so does this.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();

interface Job {
	dbFile: string;
	kindCacheFile: string;
	auDirs?: string[];
	colors: Record<string, string | undefined>;
	packs: boolean;
	outFile: string;
}

function main(): number {
	const t0 = Date.now();
	const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Job;
	const h = openIndex(job.dbFile);
	try {
		const kindCache = loadKindCache(job.kindCacheFile);
		const opts = { au: installedAuComponents(job.auDirs), colors: job.colors, kindCache };
		const roots = categoryRoots(h);
		const scanned = scanCategories(h, opts, roots);
		const packs = job.packs ? scanPacks(h, opts, roots) : null;
		saveKindCache(job.kindCacheFile, kindCache);
		const out = {
			categories: Object.fromEntries(scanned.trees),
			roots: scanned.roots,
			packs: packs && { tree: packs.tree, roots: roots.filter((r) => r.source.startsWith('pack:')).map((r) => r.path) },
			rows: scanned.rows + (packs?.rows ?? 0)
		};
		writeFileSync(`${job.outFile}.tmp`, JSON.stringify(out));
		renameSync(`${job.outFile}.tmp`, job.outFile);
		process.stdout.write(`${JSON.stringify({ rows: out.rows, ms: Date.now() - t0 })}\n`);
		return 0;
	} finally {
		h.db.close();
	}
}

try {
	process.exit(main());
} catch (err) {
	process.stderr.write(`${String(err)}\n`);
	process.exit(1);
}
