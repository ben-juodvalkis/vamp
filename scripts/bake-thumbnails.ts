#!/usr/bin/env tsx
/**
 * Decode the browser's sample thumbnails in a process of its own, for the
 * Places service (interface/src/lib/server/places/service.ts). A cold bake
 * decodes every sample of every ticked Place: tens of thousands of files and
 * about 16 minutes on the rig. Inside the server that starved everything else
 * on its one thread, and a fresh start could not render the page for over a
 * minute. Here it runs at low priority and writes the shared peaks cache; the
 * server then reads each thumbnail back from the cache.
 *
 *   tsx --tsconfig interface/tsconfig.json scripts/bake-thumbnails.ts <job.json>
 *
 * The job: { cacheFile, failureLogFile, paths }. Prints the bake's stats as
 * one JSON line (without the per-file failure list).
 */
import { readFileSync } from 'node:fs';
import { bakeThumbnails } from '../interface/src/lib/server/places/audioThumbnailCache';

// The server holds this process's stdin open; when the server goes (killed,
// restarted), so does this, rather than decoding on and writing the cache
// under the next server's bake.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();

async function main(): Promise<number> {
	const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { cacheFile: string; failureLogFile?: string; paths: string[] };
	const items = job.paths.map((fullPath) => ({ fullPath, peaks: undefined as string | undefined }));
	const stats = await bakeThumbnails(items, job.cacheFile, job.failureLogFile, { log: () => {}, keepUnseen: true });
	const { failures: _failures, ...summary } = stats;
	process.stdout.write(`${JSON.stringify(summary)}\n`);
	return 0;
}

main().then(
	(code) => process.exit(code),
	(err) => {
		process.stderr.write(`${String(err)}\n`);
		process.exit(1);
	}
);
