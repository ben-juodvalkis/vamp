/**
 * Pad-chain paths (issue #491, protocol 3.8.0) — pure string helpers,
 * shared by the v3 store, the FX-grid slot machinery and the views.
 *
 * The grammar adds one note-keyed segment under a Drum Rack:
 *
 *   padRef    := deviceRef "/pads/" note              // 0..127, the DrumPad's MIDI note
 *   deviceRef := padRef "/devices/" index             // drum_pads[note].chains[0].devices[index]
 *   paramRef  := deviceRef "/params/" index
 *
 * `tracks/1/devices/0/pads/38/devices/1/params/4` is pad 38's second
 * device's fifth parameter. Note-keyed rather than the reserved
 * `chains/<index>`, because a rack's flat chain list re-indexes whenever
 * a pad gains a chain, while every per-pad row already keys on the note.
 */

const PAD_SEGMENT = '/pads/';

/** `tracks/1/devices/0` + 38 → `tracks/1/devices/0/pads/38`. */
export function padPathOf(rackPath: string, note: number): string {
	return `${rackPath}${PAD_SEGMENT}${note}`;
}

/**
 * The pad a nested path sits under — `{ rackPath, note, padPath }` — or
 * `null` for a top-level path. Works on a pad path itself, a device
 * inside it and a parameter of that device.
 */
export function parsePadPath(path: string): { rackPath: string; note: number; padPath: string } | null {
	const at = path.indexOf(PAD_SEGMENT);
	if (at <= 0) return null;
	const rackPath = path.slice(0, at);
	const rest = path.slice(at + PAD_SEGMENT.length);
	const slash = rest.indexOf('/');
	const noteText = slash === -1 ? rest : rest.slice(0, slash);
	if (!/^(0|[1-9]\d*)$/.test(noteText)) return null;
	const note = Number(noteText);
	if (note > 127) return null;
	return { rackPath, note, padPath: `${rackPath}${PAD_SEGMENT}${noteText}` };
}

/**
 * The scope key the FX-grid slot tables use: the pad path for a pad-chain
 * device, the empty string for a track-level one.
 */
export function scopeKeyOf(devicePath: string): string {
	return parsePadPath(devicePath)?.padPath ?? '';
}
