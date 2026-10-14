/**
 * Track-scope keys for the FX-grid slot tables (track hold) — pure string
 * helpers, the track-level sibling of `padPaths.ts`. A slot table is keyed
 * `''` (the selected track), a pad path, or a held track's own path.
 */

/** A track-scope key: `tracks/<N>` or `master`, never a pad path. */
export function isTrackScopeKey(key: string): boolean {
	return key === 'master' || /^tracks\/\d+$/.test(key);
}

/** The track a top-level device path sits on (`tracks/3/devices/1` → `tracks/3`), or null for a pad's device. */
export function trackOfDevicePath(devicePath: string): string | null {
	const m = /^(tracks\/\d+|master)\/devices\/\d+$/.exec(devicePath);
	return m ? m[1] : null;
}
