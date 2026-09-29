import { describe, expect, it } from 'vitest';
import { groupGrooves, settleShown, SHOWN_GROUP } from '$lib/components/v6/settings/groovesGroups';
import type { GrooveFile } from '$lib/types/grooves';

const f = (name: string, group: string): GrooveFile => ({ name, group, grid: '1/16', events: [] });
const FILES = [f('Swing 16ths 57', 'Swing/Basic'), f('Swing 8ths 73', 'Swing/Basic'), f('Swing Logic 8ths 51', 'Swing/Logic'), f('Quantize 16', 'Utility')];

describe('groovesGroups', () => {
	it('puts the ticked first in tick order, then every file in its library group', () => {
		const groups = groupGrooves(FILES, ['Swing 8ths 73', 'Quantize 16'], new Set(['Swing 8ths 73', 'Quantize 16']));
		expect(groups.map((g) => [g.id, g.files.map((x) => x.name), g.ticked])).toEqual([
			[SHOWN_GROUP, ['Swing 8ths 73', 'Quantize 16'], 2],
			['Swing/Basic', ['Swing 16ths 57', 'Swing 8ths 73'], 1],
			['Swing/Logic', ['Swing Logic 8ths 51'], 0],
			['Utility', ['Quantize 16'], 1]
		]);
	});

	it('keeps an unticked row in the top group until the next visit, and appends a new tick', () => {
		expect(settleShown(['a', 'b'], ['b'])).toEqual(['a', 'b']);
		expect(settleShown(['a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
		const same = ['a'];
		expect(settleShown(same, ['a'])).toBe(same);
	});

	it('filters by name in every group', () => {
		const groups = groupGrooves(FILES, ['Swing 8ths 73'], new Set(['Swing 8ths 73']), '8THS');
		expect(groups.map((g) => [g.id, g.files.length, g.total])).toEqual([
			[SHOWN_GROUP, 1, 1],
			['Swing/Basic', 1, 2],
			['Swing/Logic', 1, 1],
			['Utility', 0, 1]
		]);
	});
});
