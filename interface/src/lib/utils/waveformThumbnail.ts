/**
 * Waveform thumbnail codec (ADR-401).
 *
 * A *thumbnail* is a low-resolution `[min, max][]` peak envelope for a
 * sample, small enough to bake into a Place's samples catalog JSON so a
 * browser preset tile can paint a waveform with **zero** network round
 * trips. The full-resolution render (track strip @256, Simpler/editor
 * @1024) still comes from the live `/api/sample-peaks` endpoint via
 * `clipWaveformService` — this is deliberately the coarse tier.
 *
 * Format (v2): the `THUMB_BINS` value pairs are quantised to signed
 * 8-bit (`round(value * 127)`, clamped to ±127) and packed
 * interleaved `[lo0, hi0, lo1, hi1, …]` into a `2 * THUMB_BINS`
 * byte buffer, then base64-encoded. 256 bins → 512 bytes → ~684 base64
 * chars per sample — still compact enough that even a multi-thousand-sample
 * folder file stays lean (the catalogs are split per top-level folder
 * and lazy-loaded, LRU 3).
 *
 * Each pair is `[lo, hi]`: for `.asd`-sourced bins (min/max only) it's the
 * true `[min, max]` peak; for decoded PCM (Paths A/B) the bake stores a
 * symmetric RMS pair `[-rms, +rms]` so busy loops read as energy density
 * instead of spiky per-bin peaks. The tile collapses either to
 * `max(|lo|,|hi|)`, so it doesn't care which a given bin is. The layout is
 * unchanged from v1 — v2 is a bin-count bump (64→256) that must invalidate
 * every stale cache entry, hence the version bump.
 *
 * This module is **isomorphic on purpose**: the generator (Node, via
 * `tsx`) calls `encodeThumbnailPeaks`, the browser tile
 * (`BrowserPresetWaveform.svelte`) calls `decodeThumbnailPeaks`, and
 * both must agree on the byte layout. Keeping them in one file makes
 * that a single source of truth. base64 goes through `Buffer` under
 * Node and `btoa`/`atob` in the browser — each runtime only ever hits
 * the branch that exists for it.
 */

/**
 * Peak resolution baked per sample. Browser sample tiles are wide (~450 device
 * px), so 64 bins undersampled busy loops into a spiky picket fence; 256 bins
 * resolves the actual envelope shape while staying tiny (512 bytes/sample).
 */
export const THUMB_BINS = 256;

/**
 * Bump when the byte layout or bin count changes so the generator's
 * stat-based cache invalidates every stale entry without a manual purge.
 * v2: 64→256 bins + decoded-PCM bins store symmetric RMS pairs.
 */
export const THUMB_VERSION = 2;

/** Audio file extensions we can render a waveform for. */
const AUDIO_THUMBNAIL_EXTENSIONS = new Set([
	'.wav',
	'.aif',
	'.aiff',
	'.mp3',
	'.flac',
	'.m4a',
	'.ogg',
	'.alc'
]);

/**
 * True when `type` (a file extension incl. the dot, e.g. `.wav`) is an
 * audio format a waveform can be rendered for. Instrument-preset tiles
 * (`.adg`/`.adv`/`.aupreset`) return false — they carry a `fullPath`
 * too but aren't decodable audio.
 */
export function isAudioThumbnailType(type: string | undefined | null): boolean {
	if (!type) return false;
	return AUDIO_THUMBNAIL_EXTENSIONS.has(type.toLowerCase());
}

function clampInt8(value: number): number {
	// round-to-nearest then clamp to the signed-8-bit range. NaN → 0.
	const scaled = Math.round((Number.isFinite(value) ? value : 0) * 127);
	if (scaled < -127) return -127;
	if (scaled > 127) return 127;
	return scaled;
}

/**
 * Encode `[min, max][]` peaks (~[-1, 1]) to a base64 thumbnail string.
 * Extra bins beyond `THUMB_BINS` are ignored and short arrays are
 * zero-padded, so callers don't have to pre-size exactly.
 */
export function encodeThumbnailPeaks(peaks: ReadonlyArray<readonly [number, number]>): string {
	const bytes = new Int8Array(THUMB_BINS * 2);
	const n = Math.min(peaks.length, THUMB_BINS);
	for (let i = 0; i < n; i++) {
		const pair = peaks[i];
		bytes[i * 2] = clampInt8(pair[0]);
		bytes[i * 2 + 1] = clampInt8(pair[1]);
	}
	return bytesToBase64(new Uint8Array(bytes.buffer));
}

/**
 * Decode a base64 thumbnail back to `[min, max][]` floats in [-1, 1].
 * Returns `null` for empty/garbage input so callers can fall back to a
 * live fetch (or render nothing) rather than crash.
 */
export function decodeThumbnailPeaks(b64: string | undefined | null): [number, number][] | null {
	if (!b64) return null;
	let bytes: Uint8Array;
	try {
		bytes = base64ToBytes(b64);
	} catch {
		return null;
	}
	if (bytes.length < 2) return null;
	const view = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const pairs = Math.floor(view.length / 2);
	const peaks: [number, number][] = new Array(pairs);
	for (let i = 0; i < pairs; i++) {
		peaks[i] = [view[i * 2] / 127, view[i * 2 + 1] / 127];
	}
	return peaks;
}

function bytesToBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
	if (typeof atob !== 'undefined') {
		const binary = atob(b64);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	}
	const buf = Buffer.from(b64, 'base64');
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
