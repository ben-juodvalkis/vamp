#!/usr/bin/env tsx
/**
 * Warm the Places catalog by hand.
 *
 *   npm run generate-places            (FORCE=1 to build every ticked Place again)
 *
 * Since 2026-09-26 the catalog is built by the Places service inside the
 * interface server, at runtime, for the Places ticked in Settings, and served
 * over `/api/places/*` (`interface/src/lib/server/places/service.ts`). Nothing
 * needs this script any more: `npm run dev` and `npm run ipad` no longer run
 * it, and the iPad build has no catalog in it. It remains for two uses:
 *
 * - a prebuild before a session, so the server's first answer is instant
 *   (the service reads `scripts/.cache/places/` on start);
 * - a report of what the service would build, with timings, without a server.
 *
 * It runs under `tsx --tsconfig interface/tsconfig.json`, which resolves the
 * server modules' `$lib` imports (see package.json).
 */
import { placesService } from '../interface/src/lib/server/places/service';

async function main(): Promise<void> {
	const t0 = Date.now();
	const service = placesService();
	if (process.env.FORCE === '1') service.rebuild();
	const listing = service.listing();
	const ticked = listing.sources.filter((s) => s.ticked);
	console.log(
		`📍 ${listing.sources.length} folders in Live's library (${listing.libraryCfg ?? 'no Library.cfg'}); ${ticked.length} ticked${listing.firstRun ? ' (first run: nothing saved, seeded from paths.sidebarRoot)' : ''}`
	);
	console.log(`   source: ${listing.source}${listing.source === 'index' ? (listing.indexState.ok ? ` (${listing.indexState.file})` : ` — index unavailable: ${listing.indexState.note}; the disk scan answered`) : ''}`);
	for (const [, c] of service.built) {
		console.log(`   ✓ ${c.name}: ${c.totalItems} items from the ${c.source} (${c.ms} ms)${c.baked ? '' : ', thumbnails pending'}`);
	}
	console.log(`✅ Places catalog: ${service.built.size} Places in ${((Date.now() - t0) / 1000).toFixed(1)} s → scripts/.cache/places/`);
	// The thumbnail bake runs in the background; give it a moment when it
	// has work, then stop the service's poll so the process ends.
	await new Promise((r) => setTimeout(r, 200));
	service.stop();
	process.exit(0);
}

main().catch((err) => {
	console.error('❌ Places catalog failed:', err);
	process.exit(1);
});
