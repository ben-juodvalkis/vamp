/**
 * Effect presence per pad (issue #491, 2026-09-10) — the surface's
 * `vm.padFx` row: which devices sit on each populated pad's chain, class
 * and name only, so the FX grid can flip a tile to ghost or active at
 * touch-down without waiting for the pad's records to land. Emitted from
 * the chains' own `devices` listeners, a few hundred bytes for a kit.
 *
 * ```json
 * {"pads":{"38":[{"index":0,"class":"OriginalSimpler","name":"Snare","type":1},
 *                {"index":1,"class":"Hybrid","name":"Reverb","type":2}]}}
 * ```
 *
 * `index` is the device's position on the chain — its `devices/<index>`
 * segment under the pad path — and `type` is Live's `Device.type` (1
 * instrument, 2 audio effect, 4 MIDI effect), `null` when unread. The
 * instrument is listed too: it is the device an audio effect lands after.
 *
 * The records themselves (parameters, values) ride a pad-scoped
 * `state/full/tree` once a pad is subscribed (`vm.padChain.<note>`); this
 * row only says what is there.
 */

export interface PadFxDevice {
	/** The device's index on the pad's chain (`.../pads/<note>/devices/<index>`). */
	index: number;
	className: string;
	name: string;
	/** Live's `Device.type`: 1 instrument, 2 audio effect, 4 MIDI effect; `null` when unread. */
	type: number | null;
}

/** note → the devices on that pad's chain, in chain order. */
export type PadFxMap = ReadonlyMap<number, readonly PadFxDevice[]>;

export const VM_PAD_FX = 'vm.padFx';

/** The per-pad chain subscription row (`vm.padChain.<note>`): the pad's records, kept fresh while subscribed. */
export const VM_PAD_CHAIN_PREFIX = 'vm.padChain.';

export function vmPadChainProperty(note: number): string {
	return `${VM_PAD_CHAIN_PREFIX}${note}`;
}

/** Live's `Device.type` for an instrument — the one value this module tests (2 is an audio effect, 4 a MIDI effect). */
export const DEVICE_TYPE_INSTRUMENT = 1;

/**
 * Parse a `vm.padFx` value. Anything unreadable is `null` — "not told
 * yet", which every consumer treats as "no effects known", never as a
 * reason to hide a tile.
 */
export function parseVmPadFx(raw: unknown): PadFxMap | null {
	if (typeof raw !== 'string' || raw === '') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const pads = (parsed as Record<string, unknown>).pads;
	if (!pads || typeof pads !== 'object' || Array.isArray(pads)) return null;
	const out = new Map<number, PadFxDevice[]>();
	for (const [noteText, list] of Object.entries(pads as Record<string, unknown>)) {
		if (!/^(0|[1-9]\d*)$/.test(noteText)) continue;
		const note = Number(noteText);
		if (note > 127 || !Array.isArray(list)) continue;
		const devices: PadFxDevice[] = [];
		for (const entry of list as unknown[]) {
			if (!entry || typeof entry !== 'object') continue;
			const e = entry as Record<string, unknown>;
			const index = typeof e.index === 'number' && Number.isInteger(e.index) && e.index >= 0 ? e.index : NaN;
			if (Number.isNaN(index)) continue;
			devices.push({
				index,
				className: typeof e.class === 'string' ? e.class : '',
				name: typeof e.name === 'string' ? e.name : '',
				type: typeof e.type === 'number' && Number.isInteger(e.type) ? e.type : null
			});
		}
		devices.sort((a, b) => a.index - b.index);
		out.set(note, devices);
	}
	return out;
}

/** The effects on `note`'s chain — everything but the instrument. */
export function padChainEffects(padFx: PadFxMap | null | undefined, note: number): PadFxDevice[] {
	return (padFx?.get(note) ?? []).filter((d) => d.type !== DEVICE_TYPE_INSTRUMENT);
}

/**
 * Stand-in device records for a pad whose bundle has not landed yet
 * (issue #491): the presence row already says which devices the pad's
 * chain carries, so the FX grid can show a tile ACTIVE the instant the
 * pad is touched and even write to it — a parameter path composed from
 * the pad path and the device's chain index is a valid write target on
 * the surface, records or no records. The params map is empty, so a
 * control shows its rest value until the pad's records arrive; the
 * instrument is left out (its parameters are the virtual-macro layer's).
 * Shaped like a `DeviceRecord` without importing the store.
 */
export function padDeviceStubs(
	padFx: PadFxMap | null | undefined,
	padPath: string,
	note: number
): { devicePath: string; name: string; className: string; params: Map<string, never>; properties: Map<string, never> }[] {
	return padChainEffects(padFx, note).map((d) => ({
		devicePath: `${padPath}/devices/${d.index}`,
		name: d.name,
		className: d.className,
		params: new Map<string, never>(),
		properties: new Map<string, never>()
	}));
}
