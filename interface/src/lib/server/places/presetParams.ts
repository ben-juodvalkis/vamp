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
/**
 * A Max device saved as an `.adv` (Pitch Hack) keeps each Live parameter as
 * `<MxDIntParameter>` / `<MxDFloatParameter>` / `<MxDEnumParameter>`: its
 * `ShortName` (the name Live gives it, as `parseAmxd` keys) and, under
 * `<Timeable>`, the `Manual` value it opens at.
 */
const MXD_PARAM = /<MxD\w+Parameter Id="\d+">[\s\S]*?<ShortName Value="([^"]*)"[\s\S]*?<Timeable>\s*<LomId Value="-?\d+"\s*\/>\s*<Manual Value="([^"]*)"/g;
/** A rack preset (`.adg`) wraps its device in `<GroupDevicePreset>`; the class is the first rack inside. */
const RACK = /<(AudioEffectGroupDevice|MidiEffectGroupDevice|InstrumentGroupDevice|DrumGroupDevice)\b/;

export function parsePresetXml(xml: string): PresetParams {
	const root = /<Ableton\b[^>]*>\s*<(\w+)/.exec(xml);
	const className = root?.[1] === 'GroupDevicePreset' ? (RACK.exec(xml)?.[1] ?? '') : (root?.[1] ?? '');
	const params: Record<string, number> = {};
	const labels: Record<string, string> = {};
	for (const m of xml.matchAll(LABEL)) if (!(m[1] in labels)) labels[m[1]] = m[2];
	for (const m of [...xml.matchAll(MXD_PARAM), ...xml.matchAll(PARAM)]) {
		const [, name, raw] = m;
		if (name in params) continue;
		const value = raw === 'true' ? 1 : raw === 'false' ? 0 : Number(raw);
		if (Number.isFinite(value)) params[name] = value;
	}
	return { className, params, labels };
}

const cache = new Map<string, { mtimeMs: number; value: PresetParams }>();
const CACHE_MAX = 512;

/** A Max device's class, by the type code in its `.amxd` header (`ampf`, then `aaaa` audio, `mmmm` MIDI, `iiii` instrument). */
const MAX_CLASSES: Record<string, string> = { aaaa: 'MxDeviceAudioEffect', mmmm: 'MxDeviceMidiEffect', iiii: 'MxDeviceInstrument' };

/** Every `{"patcher": …}` object in a buffer: one in a plain `.amxd`, several in a frozen one (`mx@c`, its patchers embedded among its files). */
function* patcherJson(text: string): Generator<unknown> {
	const start = /\{\s*"patcher"\s*:/g;
	for (let m = start.exec(text); m; m = start.exec(text)) {
		let depth = 0;
		let inString = false;
		for (let i = m.index; i < text.length; i++) {
			const c = text[i];
			if (inString) {
				if (c === '\\') i++;
				else if (c === '"') inString = false;
			} else if (c === '"') inString = true;
			else if (c === '{') depth++;
			else if (c === '}' && --depth === 0) {
				try {
					yield JSON.parse(text.slice(m.index, i + 1));
				} catch {
					// Not JSON after all; the scan moves on.
				}
				start.lastIndex = i + 1;
				break;
			}
		}
	}
}

interface MaxBox {
	box?: { patcher?: { boxes?: MaxBox[] }; saved_attribute_attributes?: { valueof?: Record<string, unknown> } };
}

/**
 * A Max device's saved values (2026-10-26, ADR-479): each Live parameter
 * (a `live.*` box) by the name Live gives it, its `parameter_shortname`
 * (measured: Blur's "Loop Rate" is Live's "Rate", GlitchLoop's "DryWet"
 * its "Dry/Wet"), at its `parameter_initial`, the value Live opens it at
 * (measured on Octave, Comb, Blur, GlitchLoop and Note Chance). A name
 * starting with `_` is the device's own plumbing.
 */
export function parseAmxd(bytes: Buffer): PresetParams {
	const className = bytes.subarray(0, 4).toString('latin1') === 'ampf' ? (MAX_CLASSES[bytes.subarray(8, 12).toString('latin1')] ?? '') : '';
	const params: Record<string, number> = {};
	const walk = (boxes: MaxBox[] | undefined) => {
		for (const { box } of boxes ?? []) {
			if (!box) continue;
			const v = box.saved_attribute_attributes?.valueof;
			const name = (v?.parameter_shortname || v?.parameter_longname) as string | undefined;
			const initial = Array.isArray(v?.parameter_initial) ? Number(v.parameter_initial[0]) : NaN;
			if (name && !name.startsWith('_') && v?.parameter_initial_enable && Number.isFinite(initial) && !(name in params)) params[name] = initial;
			walk(box.patcher?.boxes);
		}
	};
	for (const p of patcherJson(bytes.toString('utf8'))) walk((p as { patcher?: { boxes?: MaxBox[] } }).patcher?.boxes);
	return { className, params, labels: {} };
}

/** The saved values of the preset at `path` (a gzipped `.adv` or `.adg`, or an `.amxd`), cached until the file changes. */
export async function readPresetParams(path: string): Promise<PresetParams> {
	const info = await stat(path);
	const hit = cache.get(path);
	if (hit && hit.mtimeMs === info.mtimeMs) return hit.value;
	if (info.size > MAX_PRESET_BYTES) return { className: '', params: {}, labels: {} };
	const bytes = await readFile(path);
	const value = path.toLowerCase().endsWith('.amxd') ? parseAmxd(bytes) : parsePresetXml(gunzipSync(bytes).toString('utf8'));
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(path, { mtimeMs: info.mtimeMs, value });
	return value;
}
