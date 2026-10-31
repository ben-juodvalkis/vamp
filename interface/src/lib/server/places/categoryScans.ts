/**
 * When and where the Places service reads Live's categories and the Packs
 * button out of Live's index (`categoryScan.ts`, ADR-493): the stamp that
 * says whether anything under the roots changed, the trees of the last
 * scan, and the scan itself — in a low-priority child
 * (`scripts/scan-categories.ts`) for the server, on the caller's thread for
 * tests and tools, or when the child cannot run.
 *
 * Moved out of `service.ts` unchanged in behavior (2026-10-31). The service
 * keeps what it does with the trees: the tuning, the catalog's stamp, its
 * cache and its shaping.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import { logger } from '$lib/utils/logger';
import { repoRoot } from '../runtimeConfig';
import { categoryRoots, categoryStamp, scanCategories, scanPacks, type CategoryScanResult } from './categoryScan';
import type { AuComponent, KindCache, PlaceFolder } from './diskScan';
import type { IndexHandle } from './indexScan';

/**
 * How often an index write may make the categories look at their roots
 * (`categoryStamp`, 82 ms on the rig). A build is ~4 s cold, so it runs only
 * when that stamp moved, and the look itself waits this long between turns.
 */
const CATEGORY_STAMP_MS = 30_000;

export interface PacksScan {
	tree: PlaceFolder;
	/** The Packs' folders: what a preset read may open. */
	roots: string[];
}

export interface CategoryScansOptions {
	cacheDir: string;
	/** The AU component folders (`installedAuComponents`); the system's when undefined. */
	auDirs?: string[];
	/** Scan on the caller's thread (tests and tools), never in a child. */
	inline: boolean;
	/** The card palette the child tints items with. */
	colors: () => Record<string, string | undefined>;
	/** Whether the Packs button is ticked: only then is the Packs scan worth its 60,000 rows. */
	packsWanted: () => boolean;
	/** A scan landed from the child (or the child failed and the next build runs inline): rebuild the ticked categories. */
	onLanded: (why: string) => void;
}

export class CategoryScans {
	private stampRead: { at: number; stamp: string } | null = null;
	private categories: { stamp: string; result: CategoryScanResult } | null = null;
	private packs: { stamp: string; scan: PacksScan } | null = null;
	private child: ChildProcess | null = null;
	private rescan = false;
	/** The child could not run (no tsx, a crash): scan on the caller's thread from now on. */
	private childFailed = false;
	/** Set when the child added to the kind cache on disk: the service's copy is stale. */
	kindCacheStale = false;

	constructor(private readonly opts: CategoryScansOptions) {}

	/** The roots' stamp, read at most every `CATEGORY_STAMP_MS`. */
	stamp(index: IndexHandle): string {
		const now = Date.now();
		if (!this.stampRead || now - this.stampRead.at >= CATEGORY_STAMP_MS) {
			this.stampRead = { at: now, stamp: categoryStamp(index, categoryRoots(index)) };
		}
		return this.stampRead.stamp;
	}

	/**
	 * The trees of a scan at `indexStamp`: the categories', or the Packs' when
	 * `packs`. Null while a child builds them; `here` says the scan just ran
	 * on this thread (the kind cache learned something).
	 */
	trees(
		index: IndexHandle,
		indexStamp: string,
		packs: boolean,
		ctx: { au: Map<string, AuComponent>; colors: Record<string, string | undefined>; kindCache: KindCache }
	): { categories?: CategoryScanResult; packs?: PacksScan; here: boolean } | null {
		const ready = packs ? this.packs?.stamp === indexStamp : this.categories?.stamp === indexStamp;
		let here = false;
		if (!ready) {
			if (!this.opts.inline && !this.childFailed) {
				this.scanInChild(indexStamp, index.file);
				return null;
			}
			this.scanHere(index, indexStamp, packs, ctx);
			here = true;
		}
		return packs ? { packs: this.packs!.scan, here } : { categories: this.categories!.result, here };
	}

	/** Forget every scan (a forced rebuild). */
	reset(): void {
		this.stampRead = null;
		this.categories = null;
		this.packs = null;
		this.stop();
	}

	stop(): void {
		this.child?.kill();
		this.child = null;
	}

	/** Every category's tree, and the Packs' when asked, on this thread. */
	private scanHere(index: IndexHandle, indexStamp: string, packs: boolean, ctx: { au: Map<string, AuComponent>; colors: Record<string, string | undefined>; kindCache: KindCache }): void {
		const t = Date.now();
		const roots = categoryRoots(index);
		if (packs) {
			const { tree, rows } = scanPacks(index, ctx, roots);
			this.packs = { stamp: indexStamp, scan: { tree, roots: roots.filter((r) => r.source.startsWith('pack:')).map((r) => r.path) } };
			logger.info('places: packs scanned', { component: 'places', rows, packs: this.packs.scan.roots.length, ms: Date.now() - t });
			return;
		}
		const result = scanCategories(index, ctx, roots);
		this.categories = { stamp: indexStamp, result };
		logger.info('places: categories scanned', { component: 'places', rows: result.rows, roots: result.roots.length, ms: Date.now() - t });
	}

	/**
	 * Every category's tree, and the Packs' when that button is ticked, built
	 * by `scripts/scan-categories.ts` at low priority. When it lands the ticked
	 * categories rebuild from it; one asked for meanwhile runs after it. If
	 * the child cannot run, the scans move to the caller's thread for good.
	 */
	private scanInChild(indexStamp: string, dbFile: string): void {
		if (this.child) {
			this.rescan = true;
			return;
		}
		const { cacheDir } = this.opts;
		const root = repoRoot();
		const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
		const script = join(root, 'scripts', 'scan-categories.ts');
		const fail = (why: string) => {
			logger.warn('places: the category build could not run in its own process; building here', { component: 'places', why });
			this.childFailed = true;
			setTimeout(() => this.opts.onLanded('categories: building here'), 0);
		};
		if (!existsSync(tsx) || !existsSync(script)) return fail('no tsx or script');
		const packs = this.opts.packsWanted();
		const job = join(cacheDir, 'places-category-job.json');
		const outFile = join(cacheDir, 'places-category-scan.json');
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(job, JSON.stringify({ dbFile, kindCacheFile: join(cacheDir, 'places-kind-cache.json'), auDirs: this.opts.auDirs, colors: this.opts.colors(), packs, outFile }));
		const t0 = Date.now();
		const child = spawn(process.execPath, [tsx, '--tsconfig', join(root, 'interface', 'tsconfig.json'), script, job], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
		this.child = child;
		try {
			if (child.pid) setPriority(child.pid, 10);
		} catch {
			/* runs at normal priority */
		}
		let err = '';
		child.stderr?.on('data', (d) => (err += d));
		child.on('error', (e) => {
			this.child = null;
			fail(String(e));
		});
		child.on('close', (code, signal) => {
			if (this.child !== child) return;
			this.child = null;
			if (signal) return; // stopped with the server
			if (code !== 0) return fail(err.slice(-500) || `exit ${code}`);
			try {
				const t1 = Date.now();
				const out = JSON.parse(readFileSync(outFile, 'utf8')) as {
					categories: Record<string, PlaceFolder>;
					roots: CategoryScanResult['roots'];
					packs: PacksScan | null;
					rows: number;
				};
				this.categories = { stamp: indexStamp, result: { trees: new Map(Object.entries(out.categories)) as CategoryScanResult['trees'], roots: out.roots, rows: out.rows } };
				if (out.packs) this.packs = { stamp: indexStamp, scan: out.packs };
				// The child added to the kind cache on disk: read it again rather than write the older copy over it.
				this.kindCacheStale = true;
				logger.info('places: categories built in their own process', { component: 'places', rows: out.rows, packs: !!out.packs, ms: t1 - t0, readMs: Date.now() - t1 });
			} catch (e) {
				return fail(String(e));
			}
			if (this.rescan) {
				this.rescan = false;
				this.stampRead = null;
			}
			this.opts.onLanded('categories scanned');
		});
	}
}

