/**
 * `config/constants.json` with this Mac's `config/constants.local.json` laid
 * over it, read from disk when the server runs — never compiled into the
 * build (onboarding.plan.md §3, the runtime rule: the build holds code only;
 * everything about the machine comes from the Mac while it runs). Server
 * modules import this instead of `$config/constants.json`, so a preview build
 * serves the Mac it runs on, not the Mac it was built on.
 *
 * The repo root is found by walking up from the process's working directory
 * (`interface/` under `npm run dev` and `vite preview`, the root under the
 * gate) to the first folder holding `config/constants.json`. Both files are
 * re-read when either's mtime changes, so an edit lands on the next request.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

let repoRootCache: string | null = null;

/** The checkout's root: the nearest ancestor of cwd with `config/constants.json`. */
export function repoRoot(): string {
	if (repoRootCache) return repoRootCache;
	let dir = resolve(process.cwd());
	for (let i = 0; i < 8; i++) {
		if (existsSync(join(dir, 'config', 'constants.json'))) {
			repoRootCache = dir;
			return dir;
		}
		const up = dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	throw new Error(`config/constants.json not found above ${process.cwd()}`);
}

export function constantsPath(): string {
	return join(repoRoot(), 'config', 'constants.json');
}

/** This Mac's differences, gitignored (general-release plan.md §3). */
export function localConstantsPath(): string {
	return join(repoRoot(), 'config', 'constants.local.json');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * `base` with `local` laid over it: objects merge key by key, anything else
 * replaces. The same merge as the bridge's `interface/bridge/utils/constants.js`
 * and the surface's `config_loader.py`.
 */
export function mergeConstants(base: unknown, local: unknown): unknown {
	if (!isPlainObject(base) || !isPlainObject(local)) return local;
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(local)) {
		out[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeConstants(base[key], value) : value;
	}
	return out;
}

function mtimeOrNull(file: string): number | null {
	try {
		return statSync(file).mtimeMs;
	} catch {
		return null;
	}
}

let cached: { key: string; value: Record<string, unknown> } | null = null;

/** The constants with this Mac's local file laid over them, re-read when either changes. */
export function runtimeConstants(): Record<string, unknown> {
	const file = constantsPath();
	const local = localConstantsPath();
	const localMtime = mtimeOrNull(local);
	const key = `${statSync(file).mtimeMs}:${localMtime}`;
	if (cached && cached.key === key) return cached.value;
	const base = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	const value = (localMtime === null
		? base
		: mergeConstants(base, JSON.parse(readFileSync(local, 'utf8')))) as Record<string, unknown>;
	cached = { key, value };
	return value;
}

/** `paths.<key>` as a string, or undefined. */
export function configPath(key: string): string | undefined {
	const paths = runtimeConstants().paths;
	const v = paths && typeof paths === 'object' ? (paths as Record<string, unknown>)[key] : undefined;
	return typeof v === 'string' && v ? v : undefined;
}

/** A section of the constants (`catalog`, `vendors`, …), or an empty object. */
export function configSection<T = Record<string, unknown>>(key: string): T {
	const v = runtimeConstants()[key];
	return (v && typeof v === 'object' ? v : {}) as T;
}

/** For tests: forget the cached file and root. */
export function _resetRuntimeConfigForTests(): void {
	cached = null;
	repoRootCache = null;
}
