/**
 * Resolve an Ableton Live Clip (`.alc`) to the audio file it references.
 *
 * Node mirror of the Python `components/alc_resolver.py`. An `.alc` is a
 * gzipped XML clip file that carries a *reference* to an underlying audio
 * sample (`.wav`/`.aif`) rather than the audio bytes. The waveform endpoint
 * (`/api/sample-peaks`) can't decode the XML directly, so we resolve to the
 * real sample and render that.
 *
 * Resolution mirrors the Python logic exactly:
 *   1. Trust an absolute `<Path Value>` if it exists on disk.
 *   2. Otherwise upward-walk `<ancestor>/<rel dirs>/<name>` from the `.alc`'s
 *      own directory toward the filesystem root; first hit wins. The walk
 *      starts from the `.alc`'s *real* (symlink-resolved) directory, because
 *      library clips are symlinks into an installed Pack and the referenced
 *      sample lives under the Pack's tree, not the symlink's.
 *
 *   3. A pack clip that no longer sits inside its pack — the browser's Places
 *      are clones (2026-09-24) — resolves against its installed copy,
 *      `<packs root>/<LivePackName>/<rel dirs>/<name>`, under each of the
 *      caller's `packRoots` (`paths.abletonPacksBase`). Measured over the
 *      Places' 1,099 clips: 908 resolve only this way.
 *
 * Factory-pack clips store no absolute path — only a leaf `Name` and a
 * `RelativePath` whose leading run is the real relative path and whose tail
 * is a dead authoring path (`private/tmp/trunk/...`), which we drop.
 */
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

const gunzipAsync = promisify(gunzip);

// Directory names marking the start of a pack's dead absolute authoring path
// stored as relative elements. Everything from the first onward is dropped.
const ABS_FALLBACK_ANCHORS = new Set(['private', 'tmp', 'trunk', 'Users', 'Volumes']);

// Bound the upward walk so a pathological input can't spin to `/`.
const MAX_CLIMB = 24;

export function isAlc(p: string): boolean {
	return p.toLowerCase().endsWith('.alc');
}

async function readXmlText(alcPath: string, raw: Buffer): Promise<string> {
	// `.alc` is gzip-compressed. Some hand-edited clips are plain XML;
	// fall back to a raw decode if gunzip fails.
	try {
		const out = await gunzipAsync(raw);
		return out.toString('utf-8');
	} catch {
		return raw.toString('utf-8');
	}
}

/**
 * Decode the XML entities Ableton's `.alc` XML encodes in attribute values.
 * The Python mirror uses ElementTree, which unescapes these automatically;
 * this regex parser must do it explicitly so a sample named `Rock &amp;
 * Roll.wav` resolves to `Rock & Roll.wav` (else `isFile` fails → waveform
 * 404s). `&amp;` is decoded last so it can't double-decode a `&lt;` etc.
 */
function decodeXmlEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&amp;/g, '&');
}

/** Read a `<Tag Value="..."/>` attribute for the first matching tag. */
function tagValue(xml: string, tag: string): string | null {
	const m = new RegExp(`<${tag}\\s+Value="([^"]*)"`, 'i').exec(xml);
	return m && m[1] ? decodeXmlEntities(m[1]) : null;
}

/** Extract the first `<FileRef>...</FileRef>` block that exists under a
 * `<SampleRef>`; fall through to later `SampleRef`s if an earlier one has
 * no `FileRef`, then to any `FileRef` anywhere (mirrors Python's
 * `_first_fileref`). */
function fileRefBlock(xml: string): string | null {
	const sampleRefRe = /<SampleRef>([\s\S]*?)<\/SampleRef>/gi;
	let sr: RegExpExecArray | null;
	while ((sr = sampleRefRe.exec(xml)) !== null) {
		const fr = /<FileRef>([\s\S]*?)<\/FileRef>/i.exec(sr[1]);
		if (fr) return fr[1];
	}
	// Fallback: any FileRef anywhere.
	const any = /<FileRef>([\s\S]*?)<\/FileRef>/i.exec(xml);
	return any ? any[1] : null;
}

/** Leading RelativePathElement dirs, dropping the absolute-authoring tail. */
function relativeDirs(fileRef: string): string[] {
	const rel = /<RelativePath>([\s\S]*?)<\/RelativePath>/i.exec(fileRef);
	if (!rel) return [];
	const dirs: string[] = [];
	// Match `Dir="..."` anywhere in the element, not only immediately after the
	// tag: pack clips emit `<RelativePathElement Id="4" Dir="Samples" />` (Id
	// before Dir), which a `\s+Dir=` anchor misses — collapsing the relative
	// path to a bare filename and defeating the walk.
	const re = /<RelativePathElement\b[^>]*?\bDir="([^"]*)"/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(rel[1])) !== null) {
		const name = m[1] ? decodeXmlEntities(m[1]) : '';
		if (!name) continue;
		if (ABS_FALLBACK_ANCHORS.has(name)) break;
		dirs.push(name);
	}
	return dirs;
}

async function isFile(p: string): Promise<boolean> {
	try {
		const st = await stat(p);
		return st.isFile();
	} catch {
		return false;
	}
}

/**
 * Resolve an `.alc` to the absolute path of its audio sample, verified to
 * exist on disk, or `null` if it can't be parsed / located. `packRoots` are
 * the installed Packs folders a pack clip is looked for in when the walk
 * cannot reach its pack.
 */
export async function resolveAlc(
	alcPath: string,
	raw: Buffer,
	packRoots: readonly string[] = []
): Promise<string | null> {
	const xml = await readXmlText(alcPath, raw);
	if (!xml) return null;

	const fileRef = fileRefBlock(xml);
	if (!fileRef) return null;

	const name = tagValue(fileRef, 'Name');
	if (!name) return null;

	// 1) Trust an absolute path if present and real.
	const absPath = tagValue(fileRef, 'Path');
	if (absPath && path.isAbsolute(absPath) && (await isFile(absPath))) {
		return absPath;
	}

	// 2) Upward walk of the relative tail.
	const relDirs = relativeDirs(fileRef);
	const relTail = relDirs.length ? path.join(...relDirs, name) : name;

	// Walk from the `.alc`'s REAL directory: library clips are symlinks into an
	// installed Pack (`User Library/.../X.alc` → `Packs/.../X.alc`), and the
	// sample lives under the Pack's tree, not the symlink's. Resolving the
	// symlink first makes the walk climb the Pack (where `Samples/...` sits)
	// instead of the User Library (where it never will). Falls back to the
	// literal path if realpath fails (broken symlink / already a real file).
	let base: string;
	try {
		base = path.dirname(await realpath(alcPath));
	} catch {
		base = path.dirname(path.resolve(alcPath));
	}
	for (let i = 0; i < MAX_CLIMB; i++) {
		const candidate = path.normalize(path.join(base, relTail));
		if (await isFile(candidate)) return candidate;
		const parent = path.dirname(base);
		if (parent === base) break; // filesystem root
		base = parent;
	}

	// 3) A pack clip copied out of its pack: its installed copy. The pack name
	//    is a folder name, never a path.
	const pack = tagValue(fileRef, 'LivePackName');
	if (pack && pack !== '.' && pack !== '..' && !pack.includes('/') && !pack.includes(path.sep)) {
		for (const root of packRoots) {
			if (!root) continue;
			const candidate = path.normalize(path.join(root, pack, relTail));
			if (await isFile(candidate)) return candidate;
		}
	}

	return null;
}
