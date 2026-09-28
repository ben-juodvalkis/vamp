/**
 * What an item in a Place is, read from the file itself when the Places
 * catalog is built (browser-places plan §2), and the header chip it files
 * under.
 *
 * **Dependency-free**: the builder (`scripts/generate-places-catalog.ts`)
 * imports it under `tsx`, and the browser reads the same table, so a kind the
 * builder writes is always one the header knows how to file.
 */

/**
 * The folder inside a Place that holds its audio — samples and clips — as the
 * Places are laid out (the one-time copy of 2026-09-24 put each type's
 * `Audio Samples` there) and the catalog builder splits it into its own file.
 * One constant, so the builder and the browser cannot disagree.
 */
export const PLACE_SAMPLES_FOLDER = 'Samples';

export type ItemKind =
	| 'drum-rack'
	| 'instrument-rack'
	| 'effect-rack'
	| 'midi-effect-rack'
	| 'instrument'
	| 'audio-effect'
	| 'midi-effect'
	| 'plugin-instrument'
	| 'plugin-effect'
	| 'max-instrument'
	| 'max-audio-effect'
	| 'max-midi-effect'
	| 'audio-clip'
	| 'midi-clip'
	| 'clip'
	| 'sample'
	| 'unknown';

/**
 * The groups the browse switch filters by. `clips` are audio clips (an
 * unreadable clip counts as one); a MIDI clip is its own group because it has
 * no audio for a Simpler to play, so only the switch's Clip half shows it.
 */
export type KindGroup = 'instruments' | 'kits' | 'samples' | 'clips' | 'midi-clips' | 'effects';

export const KIND_GROUPS: ReadonlyArray<{ id: KindGroup; label: string }> = [
	{ id: 'instruments', label: 'Instruments' },
	{ id: 'kits', label: 'Kits' },
	{ id: 'samples', label: 'Samples' },
	{ id: 'clips', label: 'Clips' },
	{ id: 'midi-clips', label: 'MIDI clips' },
	{ id: 'effects', label: 'Effects' }
];

const GROUP_OF: Record<ItemKind, KindGroup | null> = {
	'drum-rack': 'kits',
	'instrument-rack': 'instruments',
	instrument: 'instruments',
	'plugin-instrument': 'instruments',
	'max-instrument': 'instruments',
	'effect-rack': 'effects',
	'midi-effect-rack': 'effects',
	'audio-effect': 'effects',
	'midi-effect': 'effects',
	'plugin-effect': 'effects',
	'max-audio-effect': 'effects',
	'max-midi-effect': 'effects',
	'audio-clip': 'clips',
	'midi-clip': 'midi-clips',
	clip: 'clips',
	sample: 'samples',
	unknown: null
};

export function groupOfKind(kind: ItemKind | undefined): KindGroup | null {
	return kind ? (GROUP_OF[kind] ?? null) : null;
}

/**
 * Whether a tap may load the item onto a track the way an instrument preset
 * loads. An effect never does (plan §2: "an effect-kind preset never loads as
 * an instrument"); nothing in a Place is an effect today.
 */
export function loadsAsInstrument(kind: ItemKind | undefined): boolean {
	const group = groupOfKind(kind);
	return group === 'instruments' || group === 'kits';
}

/**
 * Whether a tap may load the item at all — the one rule behind a greyed tile
 * and every random pick (a folder's hold, a section header's hold): not a
 * plug-in preset whose plug-in is not installed, and not an effect. True for
 * every type-catalog item, which carries neither a kind nor an installed flag.
 */
export function canLoad(kind: ItemKind | undefined, installed?: boolean): boolean {
	return installed !== false && groupOfKind(kind) !== 'effects';
}

/** Whether the item is audio the sample action (Simpler or clip) applies to. A MIDI clip is not. */
export function isSampleLike(kind: ItemKind | undefined): boolean {
	const group = groupOfKind(kind);
	return group === 'samples' || group === 'clips';
}

/** Per-kind counts, as the catalog writes them on a Place and on each folder. */
export type KindCounts = Partial<Record<ItemKind, number>>;

/** Fold per-kind counts into per-group counts. */
export function groupCounts(kinds: KindCounts | undefined): Partial<Record<KindGroup, number>> {
	const out: Partial<Record<KindGroup, number>> = {};
	for (const [kind, n] of Object.entries(kinds ?? {})) {
		const group = groupOfKind(kind as ItemKind);
		if (group && n) out[group] = (out[group] ?? 0) + n;
	}
	return out;
}
