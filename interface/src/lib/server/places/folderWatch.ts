/**
 * Keeping a disk-built Place current (2026-11-20).
 *
 * A disk build used to be stamped with its root folder's mtime alone, and
 * rebuilt only when Live's index was written. A preset moved two folders
 * down changes neither: the root's mtime stays, and Live may not index the
 * move for a long time (measured 2026-11-20: after a reorganization, Live
 * 13's index lacked 15,568 of Synth's 19,338 items and had not been written
 * for minutes). So a disk build now carries `folderTreeStamp`, which any
 * add, remove or rename anywhere in the Place moves, and `FolderWatch` asks
 * macOS (FSEvents, through `fs.watch` with `recursive`) to say when to
 * recompute it, so nothing walks the folders while they are still.
 *
 * Walking the rig's seven ticked Places (7,151 folders) took 0.2 s.
 */
import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The newest mtime of `root` and of every folder under it, with their
 * count: a folder's mtime moves when an entry in it is added, removed or
 * renamed, so this moves for any of those anywhere in the tree. Symlinked
 * folders are not followed. `'missing'` when the root cannot be read.
 */
export function folderTreeStamp(root: string): string {
	let newest = 0;
	let count = 0;
	const stack = [root];
	while (stack.length) {
		const dir = stack.pop()!;
		let mtimeMs: number;
		try {
			mtimeMs = statSync(dir).mtimeMs;
		} catch {
			if (dir === root) return 'missing';
			continue;
		}
		count += 1;
		if (mtimeMs > newest) newest = mtimeMs;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) if (e.isDirectory()) stack.push(join(dir, e.name));
	}
	return `${newest}:${count}`;
}

/** Finder's view state: written when a window is merely looked at. */
const IGNORED = new Set(['.DS_Store']);

/**
 * Watches a set of folders, recursively, and reports which changed once
 * they have been quiet for `settleMs` (a copy of a thousand presets is one
 * report, not a thousand).
 */
export class FolderWatch {
	private watchers = new Map<string, FSWatcher>();
	private dirty = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly onChange: (roots: string[]) => void,
		private readonly settleMs = 1500
	) {}

	/** Watch exactly these folders: new ones start, dropped ones stop. */
	set(roots: readonly string[]): void {
		for (const [root, w] of this.watchers) {
			if (!roots.includes(root)) {
				w.close();
				this.watchers.delete(root);
			}
		}
		for (const root of roots) {
			if (this.watchers.has(root)) continue;
			try {
				const w = watch(root, { recursive: true, persistent: false }, (_event, file) => {
					if (file && IGNORED.has(basename(String(file)))) return;
					this.touched(root);
				});
				// A folder deleted or unmounted under the watch: stop, and let
				// the next `set` start it again if it comes back.
				w.on('error', () => {
					w.close();
					this.watchers.delete(root);
				});
				this.watchers.set(root, w);
			} catch {
				// Not there (yet): the next `set` tries again.
			}
		}
	}

	/** The folders being watched now. */
	get watching(): string[] {
		return [...this.watchers.keys()];
	}

	close(): void {
		for (const w of this.watchers.values()) w.close();
		this.watchers.clear();
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.dirty.clear();
	}

	private touched(root: string): void {
		this.dirty.add(root);
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			const roots = [...this.dirty];
			this.dirty.clear();
			this.onChange(roots);
		}, this.settleMs);
		(this.timer as { unref?: () => void }).unref?.();
	}
}
