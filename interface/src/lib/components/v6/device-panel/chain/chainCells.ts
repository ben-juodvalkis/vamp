/**
 * The chain overview's cells and their geometry, pure (`ChainOverview`):
 * what a device's cell is, where landing effects go, how unfolded racks
 * expand into the cells after them (ADR-529), where each cell sits on the
 * unit grid and where the racks' arms run. The component reads Live and
 * the stores and hands the answers in.
 */
import { chainUnitLayout, type ChainPlace } from '$lib/utils/chainDrop';
import type { RackChain } from '$lib/services/rackChains.svelte';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';

export type CellKind = 'instrument' | 'rack' | 'max' | 'plugin' | 'effect' | 'chains';

/**
 * What a cell is: only what changes when the chain does. Live values
 * (Device On, a rack's macros) are read in the markup, so a moving
 * parameter repaints its own cell and never rebuilds the list.
 */
export type Cell = {
	/** Stable across Live's renumbering (paths are positions): name, class, and which of those it is. */
	key: string;
	/** Class and name: what the device is, shared by two of a kind. */
	sig: string;
	/** Where Live has it now. */
	path: string;
	device: DeviceRecord;
	kind: CellKind;
	presetKey: string | null;
	tile: string | null;
	ink: string;
	/** The track's Drum Rack, drawn as its Trnsp, and kept first while a pad is scoped. */
	kit: boolean;
	/** A rack Live lets the wire into (ADR-529): it folds and unfolds. */
	foldable?: boolean;
	/** Drawn inside an unfolded rack (ADR-529): the rack, its ink, how deep. */
	inside?: CellInside;
	/** The chain list of an unfolded rack: its chains. */
	chains?: RackChain[];
	/** An effect on its way into Live (ADR-540): its load's id. Drawn, editable, not yet a device (no path to move or open). */
	landing?: string;
};

export type CellInside = { rackPath: string; ink: string; depth: number; chain: RackChain; chains: number };

/**
 * A device that is not the instrument: a rack, a Max device or a plug-in
 * when the app has no preset for it, else an effect.
 */
export function deviceKind(
	className: string,
	presetKey: string | null,
	isChainRack: (className: string) => boolean
): Exclude<CellKind, 'instrument' | 'chains'> {
	if (isChainRack(className) && !presetKey) return 'rack';
	if (className.startsWith('MxDevice') && !presetKey) return 'max';
	if (className.endsWith('PluginDevice')) return 'plugin';
	return 'effect';
}

/** A device path's index in its chain (`…/devices/<n>`), 0 when it has none. */
export function deviceIndexOf(path: string): number {
	const m = /\/devices\/(\d+)$/.exec(path);
	return m ? Number(m[1]) : 0;
}

/** How many devices before `i` in `all` share its class and name: its `nth`, for a stable key. */
export function nthOfKind(all: readonly { name: string; className: string }[], i: number): number {
	const d = all[i];
	return all.slice(0, i).filter((x) => x.name === d.name && x.className === d.className).length;
}

export const isMidiEffectClass = (className: string) => className.startsWith('Midi') || className === 'MxDeviceMidiEffect';

/**
 * Live's devices with the landing ones (ADR-540) put where Live will put
 * them: a MIDI effect after the MIDI effects, anything else at the end.
 */
export function withLanding(live: DeviceRecord[], landing: readonly { device: DeviceRecord }[]): DeviceRecord[] {
	if (!landing.length) return live;
	const out = [...live];
	for (const { device: d } of landing) {
		if (!isMidiEffectClass(d.className)) {
			out.push(d);
			continue;
		}
		const at = out.findIndex((x) => !isMidiEffectClass(x.className));
		out.splice(at < 0 ? out.length : at, 0, d);
	}
	return out;
}

/** Deepest a rack inside a rack unfolds. */
export const MAX_RACK_DEPTH = 4;

export interface ExpandDeps {
	isOpen(rackPath: string): boolean;
	/** An open rack's chains, null until Live has sent them. */
	chainsOf(rackPath: string): RackChain[] | null;
	/** The chain Live shows on a rack (may run past the chains; clamped). */
	chosenOf(rackPath: string): number;
	/** A rack with no macros: it lists its chains in its own cell. */
	isBare(cell: Cell): boolean;
	/** The cell for a device on a rack's chosen chain, or null to draw none (a hidden device). */
	nested(parent: Cell, chain: RackChain, i: number, inside: CellInside): Cell | null;
	/** The ghost cells of effects landing on that chain. */
	landing(parent: Cell, chain: RackChain, inside: CellInside): Cell[];
}

/** A rack's chain-list cell. */
export function listCellOf(rack: Cell, chains: RackChain[], inside: CellInside): Cell {
	return { ...rack, key: `${rack.key}|chains`, kind: 'chains', tile: null, presetKey: null, foldable: false, kit: false, chains, inside };
}

/**
 * Unfolded racks (ADR-529): after a rack's own cell, its chain list (when
 * it has more than one chain) and the chosen chain's devices, as Live's
 * device view shows them; a rack among those unfolds the same way.
 */
export function expandRack(cell: Cell, depth: number, deps: ExpandDeps, out: Cell[] = []): Cell[] {
	out.push(cell);
	if (!cell.foldable || depth >= MAX_RACK_DEPTH || !deps.isOpen(cell.path)) return out;
	const rackPath = cell.path;
	const chains = deps.chainsOf(rackPath);
	if (!chains) return out;
	// A rack with no macros shows its chain list in its own cell.
	if (chains.length > 1 && !deps.isBare(cell)) {
		out.push(listCellOf(cell, chains, { rackPath, ink: cell.ink, depth, chain: chains[0], chains: chains.length }));
	}
	if (chains.length === 0) return out;
	const chosen = chains[Math.min(deps.chosenOf(rackPath), chains.length - 1)];
	const inside: CellInside = { rackPath, ink: cell.ink, depth, chain: chosen, chains: chains.length };
	// An empty chain draws nothing past the list: its row says it is chosen.
	chosen.devices.forEach((_, i) => {
		const nested = deps.nested(cell, chosen, i, inside);
		if (nested) expandRack(nested, depth + 1, deps, out);
	});
	// An effect on its way into this chain (ADR-540): a ghost cell at its end.
	out.push(...deps.landing(cell, chosen, inside));
	return out;
}

/**
 * The chain as drawn: the kit cell first (under a pad scope), then each
 * top-level cell and what its unfold draws. `tops[i]` is the chain
 * position drawn cell `i` stands for; null for what a rack unfolded.
 */
export function expandChain(
	kit: Cell | null,
	shown: readonly Cell[],
	deps: ExpandDeps
): { cells: Cell[]; tops: (number | null)[] } {
	const cells: Cell[] = [];
	const tops: (number | null)[] = [];
	if (kit) {
		cells.push(kit);
		tops.push(null);
	}
	shown.forEach((cell, i) => {
		expandRack(cell, 0, deps).forEach((c, j) => {
			cells.push(c);
			tops.push(j === 0 ? i : null);
		});
	});
	return { cells, tops };
}

/** The chain position a drawn place stands for: its own, else its rack's. */
export function topAt(tops: readonly (number | null)[], drawnIndex: number): number {
	for (let i = Math.min(drawnIndex, tops.length - 1); i >= 0; i--) {
		if (tops[i] !== null) return tops[i]!;
	}
	return 0;
}

/**
 * The cells on the unit grid (`chainUnitLayout`), one row up to `rowUnits`
 * and two past it. The cells take the whole width: the room a second row
 * leaves widens its last cell, as a row's end always has.
 */
export function chainLayout(widths: readonly number[], rowUnits: number): { cols: number; rows: number; places: ChainPlace[] } {
	const laid = chainUnitLayout(widths, 0, rowUnits);
	const places = laid.places.map((p) => ({ ...p }));
	const last = places[places.length - 1];
	if (last && laid.ghost.span > 0 && laid.ghost.row === last.row) last.span += laid.ghost.span;
	return { cols: laid.cols, rows: laid.rows, places };
}

/** How high a cell stands on its racks' arms: 0 at the top level. */
export function levelOf(cell: Cell): number {
	return cell.inside ? cell.inside.depth + 1 : 0;
}

export interface RackArm {
	key: string;
	path: string;
	name: string;
	ink: string;
	row: number;
	from: number;
	to: number;
	level: number;
	/** The arm grows out of the rack's own cell (same row, right after it). */
	joined: boolean;
}

/**
 * An open rack's arm (ADR-529), a group track's panhandle (ADR-413) in the
 * chain: one per row its unfold reaches, under everything it drew.
 */
export function rackArms(drawn: readonly Cell[], places: readonly ChainPlace[], isOpen: (path: string) => boolean): RackArm[] {
	const out: RackArm[] = [];
	drawn.forEach((cell, i) => {
		if (!cell.foldable || cell.kind === 'chains' || !isOpen(cell.path)) return;
		const own = places[i];
		const under = (c: Cell) => !!c.inside && (c.inside.rackPath === cell.path || c.inside.rackPath.startsWith(`${cell.path}/`));
		let j = i + 1;
		while (j < drawn.length && under(drawn[j])) j++;
		const rows = new Map<number, { from: number; to: number }>();
		for (let k = i + 1; k < j; k++) {
			const p = places[k];
			if (!p) continue;
			const r = rows.get(p.row);
			rows.set(p.row, r ? { from: Math.min(r.from, p.col), to: Math.max(r.to, p.col + p.span) } : { from: p.col, to: p.col + p.span });
		}
		for (const [row, { from, to }] of rows) {
			out.push({
				key: `${cell.key}|arm|${row}`,
				path: cell.path,
				name: cell.device.name,
				ink: cell.ink,
				row,
				from,
				to,
				level: levelOf(cell),
				joined: !!own && own.row === row && own.col + own.span === from
			});
		}
	});
	return out;
}
