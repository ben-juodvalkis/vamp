/**
 * A device preset's saved values (2026-10-25, ADR-478): what an `.adv`
 * stores for each parameter, read so a browser tile can draw the preset's
 * own curve before anything is loaded.
 *
 * An `.adv` (or a rack's `.adg`) is gzipped XML (`<Ableton><AutoFilter2>…`); each parameter is
 * `<Name><LomId Value="0" /><Manual Value="…" />…`, `Manual` the value the
 * device opens at. Measured on the rig's Auto Filter presets (all 24 in
 * Audio-Midi Effects): `Filter_Frequency` is in Hz, `Filter_Resonance` and
 * `Filter_Type` in the units Live's LOM reports. The mapping from these
 * names onto LOM values is the device's own (`autoFilterParams.ts`); this
 * module only reads. The first occurrence of a name wins, which on a single
 * device's preset is the device's own.
 */
import { readFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export interface PresetParams {
	/** The device's class as the file names it (`AutoFilter2`, a rack's `AudioEffectGroupDevice`), or '' when unreadable. */
	className: string;
	/** Saved name → value; `true`/`false` read as 1/0. A rack's macros are `MacroControls.<n>`. */
	params: Record<string, number>;
	/** Saved names that carry text: a rack's `MacroDisplayNames.<n>`. */
	labels: Record<string, string>;
}

/** Larger than any single device's preset; a rack of samples is not one. */
const MAX_PRESET_BYTES = 4 * 1024 * 1024;
const PARAM = /<([\w.]+)>\s*<LomId Value="-?\d+"\s*\/>\s*<Manual Value="([^"]*)"/g;
const LABEL = /<(MacroDisplayNames\.\d+) Value="([^"]*)"/g;
/** A rack preset (`.adg`) wraps its device in `<GroupDevicePreset>`; the class is the first rack inside. */
const RACK = /<(AudioEffectGroupDevice|MidiEffectGroupDevice|InstrumentGroupDevice|DrumGroupDevice)\b/;

export function parsePresetXml(xml: string): PresetParams {
	const root = /<Ableton\b[^>]*>\s*<(\w+)/.exec(xml);
	const className = root?.[1] === 'GroupDevicePreset' ? (RACK.exec(xml)?.[1] ?? '') : (root?.[1] ?? '');
	const params: Record<string, number> = {};
	const labels: Record<string, string> = {};
	for (const m of xml.matchAll(LABEL)) if (!(m[1] in labels)) labels[m[1]] = m[2];
	for (const m of xml.matchAll(PARAM)) {
		const [, name, raw] = m;
		if (name in params) continue;
		const value = raw === 'true' ? 1 : raw === 'false' ? 0 : Number(raw);
		if (Number.isFinite(value)) params[name] = value;
	}
	return { className, params, labels };
}

const cache = new Map<string, { mtimeMs: number; value: PresetParams }>();
const CACHE_MAX = 512;

/** The saved values of the preset at `path` (a gzipped `.adv`), cached until the file changes. */
export async function readPresetParams(path: string): Promise<PresetParams> {
	const info = await stat(path);
	const hit = cache.get(path);
	if (hit && hit.mtimeMs === info.mtimeMs) return hit.value;
	if (info.size > MAX_PRESET_BYTES) return { className: '', params: {}, labels: {} };
	const value = parsePresetXml(gunzipSync(await readFile(path)).toString('utf8'));
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(path, { mtimeMs: info.mtimeMs, value });
	return value;
}
