import { describe, it, expect } from 'vitest';
import {
	chainLayout,
	deviceIndexOf,
	deviceKind,
	expandChain,
	nthOfKind,
	rackArms,
	topAt,
	withLanding,
	type Cell,
	type ExpandDeps
} from '$lib/components/v6/device-panel/chain/chainCells';
import type { RackChain } from '$lib/services/rackChains.svelte';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';

const record = (devicePath: string, className: string, name = className): DeviceRecord => ({
	devicePath,
	name,
	className,
	params: new Map(),
	properties: new Map()
});
const cell = (key: string, path: string, extra: Partial<Cell> = {}): Cell => ({
	key,
	sig: key,
	path,
	device: record(path, 'X', key),
	kind: 'effect',
	presetKey: null,
	tile: null,
	ink: '#fff',
	kit: false,
	...extra
});
const isRack = (c: string) => c === 'AudioEffectGroupDevice';

describe('chainCells', () => {
	it('deviceKind: a rack, a Max device or a plug-in without a preset, else an effect', () => {
		expect(deviceKind('AudioEffectGroupDevice', null, isRack)).toBe('rack');
		expect(deviceKind('AudioEffectGroupDevice', 'guitar', isRack)).toBe('effect');
		expect(deviceKind('MxDeviceAudioEffect', null, isRack)).toBe('max');
		expect(deviceKind('AuPluginDevice', null, isRack)).toBe('plugin');
		expect(deviceKind('Reverb', 'reverb', isRack)).toBe('effect');
	});

	it('deviceIndexOf and nthOfKind', () => {
		expect(deviceIndexOf('tracks/0/devices/7')).toBe(7);
		expect(deviceIndexOf('tracks/0')).toBe(0);
		const all = [record('a', 'Eq8', 'EQ'), record('b', 'Reverb'), record('c', 'Eq8', 'EQ')];
		expect(nthOfKind(all, 2)).toBe(1);
		expect(nthOfKind(all, 1)).toBe(0);
	});

	it('withLanding puts a MIDI effect after the MIDI effects, anything else at the end', () => {
		const live = [record('0', 'MidiArpeggiator'), record('1', 'InstrumentVector'), record('2', 'Reverb')];
		const out = withLanding(live, [{ device: record('g1', 'MidiChord') }, { device: record('g2', 'Delay') }]);
		expect(out.map((d) => d.devicePath)).toEqual(['0', 'g1', '1', '2', 'g2']);
	});

	it('expandChain: an open rack draws its chain list, its chosen chain, and nested racks', () => {
		const chains: RackChain[] = [
			{ index: 0, name: 'A', color: null, mute: false, solo: false, volume: null, devices: [{ index: 0, className: 'Reverb', name: 'Reverb', type: 2, rack: false }] },
			{ index: 1, name: 'B', color: null, mute: false, solo: false, volume: null, devices: [{ index: 0, className: 'Delay', name: 'Delay', type: 2, rack: false }] }
		];
		const deps: ExpandDeps = {
			isOpen: (p) => p === 'r',
			chainsOf: (p) => (p === 'r' ? chains : null),
			chosenOf: () => 1,
			isBare: () => false,
			nested: (parent, chain, i, inside) => cell(`${parent.key}|${chain.devices[i].name}`, `r/chains/${chain.index}/devices/${i}`, { inside }),
			landing: () => []
		};
		const rack = cell('rack', 'r', { foldable: true });
		const { cells, tops } = expandChain(null, [cell('eq', 'e'), rack], deps);
		expect(cells.map((c) => c.key)).toEqual(['eq', 'rack', 'rack|chains', 'rack|Delay']);
		expect(tops).toEqual([0, 1, null, null]);
		expect(topAt(tops, 3)).toBe(1);
		expect(cells[3].inside?.chain.name).toBe('B');
	});

	it('chainLayout widens the last cell into a short second row', () => {
		const one = chainLayout([2, 2, 1], 13);
		expect(one.rows).toBe(1);
		expect(one.places.map((p) => p.span)).toEqual([2, 2, 1]);
		const two = chainLayout(Array.from({ length: 8 }, () => 2), 13);
		expect(two.rows).toBe(2);
	});

	it('rackArms runs one arm per row under what a rack unfolded', () => {
		const rack = cell('rack', 'r', { foldable: true });
		const inside = { rackPath: 'r', ink: '#f00', depth: 0, chain: { index: 0, name: 'A', color: null, mute: false, solo: false, volume: null, devices: [] }, chains: 1 };
		const drawn = [rack, cell('n1', 'r/chains/0/devices/0', { inside }), cell('n2', 'r/chains/0/devices/1', { inside })];
		const places = [{ row: 0, col: 0, span: 2 }, { row: 0, col: 2, span: 2 }, { row: 1, col: 0, span: 2 }];
		const arms = rackArms(drawn, places, () => true);
		expect(arms.map((a) => [a.row, a.from, a.to, a.joined])).toEqual([
			[0, 2, 4, true],
			[1, 0, 2, false]
		]);
	});
});
