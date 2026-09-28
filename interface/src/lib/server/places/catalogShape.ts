/**
 * Folder shaping for the Places catalog (`generate-places-catalog.ts`): cap
 * nesting at a depth, flatten listed folders, keep listed ones fully nested.
 *
 * Moved out of the retired type-catalog builder (`generate-type-first-json.ts`,
 * removed at the browser-places cutover, 2026-09-24) unchanged in behavior —
 * the Places trees were proven to match that builder's shaping exactly
 * (Looping's `documentation/browser-places.plan.md`, Phase 3). Every setting is an
 * explicit argument: the caller reads the per-Place `catalog.places.<Name>`
 * tuning, each defaulting to the global `catalog.*`.
 *
 * - **Depth cap** (`catalog.maxFolderDepth`): a folder at the cap keeps its own
 *   items, pulls up every item from its subfolders and de-dupes them by name.
 * - **`flattenFolders`** (ADR-408): a listed folder — and everything under it —
 *   collapses the same way whatever its depth. Exact-or-prefix match on `/`
 *   boundaries (`A/B` matches `A/B/C`, never `A/Bass`).
 * - **`keepNestingFolders`** (ADR-420): the inverse — a listed folder and all of
 *   its descendants keep full nesting. Entries are `/`-separated label chains
 *   matched as a run of whole segments anywhere in a node's path, so the chain
 *   read off the breadcrumb works. A keep entry wins over a flatten entry and
 *   over the cap. The Places catalog keeps each Place's `Samples` this way.
 */

/** The fields shaping reads; a node's other fields are not carried through. */
/**
 * Where the shaping's `[KeepNesting]` / `[FlattenFolder]` / `[DepthCap]` lines
 * go: nowhere by default (the server shapes on every rebuild), the console
 * when a script asks (`setShapeLog(console.log)`).
 */
let shapeLog: (line: string) => void = () => {};
export function setShapeLog(log: ((line: string) => void) | null): void {
	shapeLog = log ?? (() => {});
}

export interface ShapeItem {
	name: string;
	path?: string;
}
export interface ShapeNode<I extends ShapeItem = ShapeItem> {
	name: string;
	path: string;
	folders: Record<string, ShapeNode<I>>;
	presets: I[];
	vendorColor?: string | null;
}

/** True when `nodePath` is one of `flattenFolders` or sits under one (boundary-safe). */
export function isForcedFlattenNode(nodePath: string, flattenFolders: string[]): boolean {
	return flattenFolders.some((f) => nodePath === f || nodePath.startsWith(`${f}/`));
}

/**
 * True when `chain` occurs in `nodePath` as a run of whole `/`-separated
 * segments — the node itself or any descendant. Boundary-safe: `Prod/NI
 * Acoustic` never matches `Prod/NI AcousticX`.
 */
function pathContainsChain(nodePath: string, chain: string): boolean {
	return (
		nodePath === chain ||
		nodePath.endsWith(`/${chain}`) ||
		nodePath.startsWith(`${chain}/`) ||
		nodePath.includes(`/${chain}/`)
	);
}

/** The `keepNestingFolders` entry naming THIS node (not an ancestor), or null. */
export function keepNestingEntryFor(nodePath: string, keepNesting: string[]): string | null {
	return keepNesting.find((c) => nodePath === c || nodePath.endsWith(`/${c}`)) ?? null;
}

/** True when `nodePath` is a `keepNestingFolders` entry or sits under one. */
export function isKeepNestingNode(nodePath: string, keepNesting: string[]): boolean {
	return keepNesting.some((c) => pathContainsChain(nodePath, c));
}

/**
 * Entries covered by a broader entry in the same list — a shorter chain covers
 * a longer one ending with it — so they can never record a hit. Redundant
 * authoring, reported apart from the unmatched list.
 */
export function redundantKeepNestingEntries(keepNesting: string[]): string[] {
	return keepNesting.filter((c) =>
		isKeepNestingNode(
			c,
			keepNesting.filter((other) => other !== c)
		)
	);
}

/** Entries that named no folder (likely typos), less the redundant ones. */
export function unmatchedKeepNestingEntries(keepNesting: string[], hits: Set<string>): string[] {
	const redundant = new Set(redundantKeepNestingEntries(keepNesting));
	return keepNesting.filter((c) => !hits.has(c) && !redundant.has(c));
}

function collectDeep<I extends ShapeItem>(node: ShapeNode<I>): I[] {
	const out: I[] = [...node.presets];
	for (const child of Object.values(node.folders)) out.push(...collectDeep(child));
	return out;
}

/** First occurrence of each name wins: flattened sub-genres repeat curated names. */
function dedupeByName<I extends ShapeItem>(items: I[]): I[] {
	const seen = new Set<string>();
	const out: I[] = [];
	for (const p of items) {
		const key = p.name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(p);
	}
	return out;
}

function rollUp<I extends ShapeItem>(node: ShapeNode<I>): I[] {
	const collected = dedupeByName([...node.presets, ...Object.values(node.folders).flatMap(collectDeep)]);
	collected.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
	return collected;
}

function capNode<I extends ShapeItem>(
	node: ShapeNode<I>,
	depth: number,
	maxDepth: number,
	flattenFolders: string[],
	keepNesting: string[],
	hits: Set<string>
): ShapeNode<I> {
	// A keep entry exempts the whole subtree (the recursion never reaches it),
	// checked first so it wins over a contradictory flatten entry and the cap.
	if (isKeepNestingNode(node.path, keepNesting)) {
		const entry = keepNestingEntryFor(node.path, keepNesting);
		if (entry !== null) {
			hits.add(entry);
			shapeLog(`   [KeepNesting] Preserving "${node.name}" (full nesting) at path: ${node.path}`);
		}
		return node;
	}
	const hasFolders = Object.keys(node.folders).length > 0;
	if (hasFolders && isForcedFlattenNode(node.path, flattenFolders)) {
		const collected = rollUp(node);
		shapeLog(`   [FlattenFolder] Collapsing "${node.name}" (${collected.length} presets) at path: ${node.path}`);
		return { name: node.name, path: node.path, folders: {}, presets: collected, vendorColor: node.vendorColor };
	}
	if (hasFolders && depth >= maxDepth) {
		const collected = rollUp(node);
		shapeLog(`   [DepthCap] Collapsing "${node.name}" (${collected.length} presets) at path: ${node.path}`);
		return { name: node.name, path: node.path, folders: {}, presets: collected, vendorColor: node.vendorColor };
	}
	const folders: Record<string, ShapeNode<I>> = {};
	for (const [name, child] of Object.entries(node.folders)) {
		folders[name] = capNode(child, depth + 1, maxDepth, flattenFolders, keepNesting, hits);
	}
	return { name: node.name, path: node.path, folders, presets: node.presets, vendorColor: node.vendorColor };
}

/** Apply the cap and the two overrides to a tree. Root folders are depth 1. */
export function capFolderDepth<I extends ShapeItem>(
	tree: { folders: Record<string, ShapeNode<I>>; presets: I[] },
	maxDepth: number,
	flattenFolders: string[] = [],
	keepNesting: string[] = [],
	hits: Set<string> = new Set()
): { folders: Record<string, ShapeNode<I>>; presets: I[] } {
	const folders: Record<string, ShapeNode<I>> = {};
	for (const [name, folder] of Object.entries(tree.folders)) {
		folders[name] = capNode(folder, 1, maxDepth, flattenFolders, keepNesting, hits);
	}
	return { folders, presets: tree.presets };
}
